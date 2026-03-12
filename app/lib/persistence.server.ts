import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { type DateRange, type OrderRecord } from "./aiData";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { getPlatform, isDemoMode } from "./runtime.server";
import { 
  MAX_DETECTION_LENGTH, 
  PERSISTENCE_BATCH_SIZE,
  PERSISTENCE_TRANSACTION_TIMEOUT_MS 
} from "./constants";
import { getSettings } from "./settings.server";
import { toPrismaAiSource } from "./aiSourceMapper";
import { validateOrderData, loadOrdersFromDb as loadOrdersFromDbService } from "./orderService.server";
import { DatabaseError, ValidationError } from "./errors";
import { logger } from "./logger.server";
import { toZonedDate } from "./dateUtils";
import {
  type CustomerState,
  mapCustomerToState,
  createInitialCustomerState,
} from "./mappers/orderMapper";
import { toNumber, roundMoney } from "./queries/helpers";

const tableMissing = (error: unknown) =>
  (error instanceof PrismaClientKnownRequestError && error.code === "P2021") ||
  (error instanceof Error && error.message.includes("not available"));

const platform = getPlatform();

/**
 * 按客户ID分组订单，确保同一客户的订单按时间排序
 * 这样可以避免竞态条件，确保客户统计正确累加
 */
const groupOrdersByCustomer = (
  orders: OrderRecord[]
): Map<string | null, OrderRecord[]> => {
  const grouped = new Map<string | null, OrderRecord[]>();

  for (const order of orders) {
    const key = order.customerId;
    const list = grouped.get(key) || [];
    list.push(order);
    grouped.set(key, list);
  }

  // 对每个客户的订单按时间排序（旧订单优先，确保首单判断正确）
  for (const [, customerOrders] of grouped) {
    customerOrders.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  return grouped;
};

export const persistOrders = async (shopDomain: string, orders: OrderRecord[]) => {
  // 输入验证
  if (!shopDomain) {
    throw new ValidationError("Shop domain is required");
  }

  if (!Array.isArray(orders)) {
    throw new ValidationError("Orders must be an array");
  }

  if (!orders.length || isDemoMode()) {
    logger.info("[persistence] Skipping order persistence", { shopDomain, orderCount: orders.length, isDemo: isDemoMode() });
    return { created: 0, updated: 0 };
  }

  // 验证每笔订单的数据
  for (const order of orders) {
    validateOrderData(order);
  }

  const settings = await getSettings(shopDomain);
  const timeZone = settings.timezones?.[0];

  const chunks: OrderRecord[][] = [];

  for (let i = 0; i < orders.length; i += PERSISTENCE_BATCH_SIZE) {
    chunks.push(orders.slice(i, i + PERSISTENCE_BATCH_SIZE));
  }

  try {
    let created = 0;
    let updated = 0;

    logger.info("[persistence] Starting order persistence", {
      shopDomain,
      totalOrders: orders.length,
      chunks: chunks.length,
    });

    for (const chunk of chunks) {
      const orderIds = chunk.map((order) => order.id);
      const customerIds = Array.from(
        new Set(chunk.map((order) => order.customerId).filter(Boolean) as string[]),
      );

      const { created: batchCreated, updated: batchUpdated } = await prisma.$transaction(
        async (tx) => {
          // 查询已存在的订单（在事务内）
          const existingOrders = await tx.order.findMany({ where: { id: { in: orderIds } } });
          const orderMap = new Map(existingOrders.map((o) => [o.id, o]));

          // 【修复】在事务内查询客户，避免脏读
          const existingCustomers = customerIds.length
            ? await tx.customer.findMany({
                where: { shopDomain, id: { in: customerIds } },
              })
            : [];

          // 【修复】使用类型安全的 CustomerState Map
          const customerStateMap = new Map<string, CustomerState>(
            existingCustomers.map((c) => [c.id, mapCustomerToState(c)])
          );

          let localCreated = 0;
          let localUpdated = 0;

          // 【修复】按客户分组订单，确保同一客户的订单串行处理
          // 这样可以避免竞态条件，确保 orderCount 和 totalSpent 正确累加
          const ordersByCustomer = groupOrdersByCustomer(chunk);

          // 【关键修复】先为所有新客户创建占位记录，避免 Order_customerId_fkey 外键约束失败
          // 问题：Order.customerId 是外键，如果 customer 不存在，upsert order 会失败
          // 解决：在 upsert orders 之前，先创建所有需要的 customer 占位记录
          for (const customerId of customerIds) {
            if (!customerStateMap.has(customerId)) {
              // 找到该客户最早的订单作为初始数据
              const customerOrders = ordersByCustomer.get(customerId) || [];
              const firstOrder = customerOrders[0];
              if (firstOrder) {
                const firstCreatedAt = new Date(firstOrder.createdAt);
                const aiSource = toPrismaAiSource(firstOrder.aiSource);
                
                // 创建初始客户状态
                const initialState = createInitialCustomerState(
                  customerId,
                  shopDomain,
                  platform,
                  {
                    createdAt: firstCreatedAt,
                    id: firstOrder.id,
                    aiSource,
                  }
                );
                
                // 创建占位记录（使用 upsert 避免重复）
                await tx.customer.upsert({
                  where: { id: customerId },
                  create: {
                    id: customerId,
                    shopDomain,
                    platform,
                    firstOrderAt: firstCreatedAt,
                    firstOrderId: firstOrder.id,
                    lastOrderAt: firstCreatedAt,
                    orderCount: 0, // 初始为 0，后面会更新
                    totalSpent: 0,
                    acquiredViaAi: Boolean(aiSource),
                    firstAiOrderId: aiSource ? firstOrder.id : null,
                  },
                  update: {}, // 如果已存在，不更新（理论上不会发生）
                });
                
                customerStateMap.set(customerId, initialState);
              }
            }
          }

          // 先处理所有订单的基本数据和产品
          for (const order of chunk) {
            const aiSource = toPrismaAiSource(order.aiSource);
            const createdAt = new Date(order.createdAt);
            const detection = (order.detection || "").slice(0, MAX_DETECTION_LENGTH);

            // 【修复】基于 Customer 表记录重新计算 isNewCustomer
            // 这比依赖 Shopify API 返回的值更准确，因为：
            // 1. API 可能因权限问题不返回 customer 数据
            // 2. 我们自己的 Customer 表记录更准确
            let computedIsNewCustomer = order.isNewCustomer; // 默认使用 API 返回的值
            if (order.customerId) {
              const customerState = customerStateMap.get(order.customerId);
              if (customerState) {
                // 如果已有客户记录，基于 orderCount 判断
                // orderCount === 0 表示这是该客户的第一笔订单
                computedIsNewCustomer = customerState.orderCount === 0;
              }
              // 如果没有客户记录，说明这是新客户的第一笔订单
              else {
                computedIsNewCustomer = true;
              }
            }

            const orderData: Prisma.OrderUpsertArgs["create"] = {
              id: order.id,
              shopDomain,
              platform,
              name: order.name,
              createdAt,
              totalPrice: roundMoney(order.totalPrice),
              currency: order.currency,
              subtotalPrice: roundMoney(order.subtotalPrice ?? order.totalPrice),
              refundTotal: roundMoney(order.refundTotal ?? 0),
              aiSource,
              detection,
              referrer: order.referrer,
              landingPage: order.landingPage,
              utmSource: order.utmSource,
              utmMedium: order.utmMedium,
              sourceName: order.sourceName,
              customerId: order.customerId ?? null,
              isNewCustomer: computedIsNewCustomer,
              detectionSignals: order.signals as unknown as Prisma.InputJsonValue,
              createdAtLocal: toZonedDate(createdAt, timeZone),
            };

            await tx.order.upsert({
              where: { id: order.id },
              create: orderData,
              update: orderData,
            });

            // 🔧 修复：使用 lineItemId 作为唯一标识，正确处理同一产品的多个 variant
            const newLines = order.products || [];
            const existingLines = await tx.orderProduct.findMany({ where: { orderId: order.id } });
            // 🔧 使用 lineItemId 作为 Map key，而不是 productId
            const existingByLineItemId = new Map(existingLines.map((p) => [p.lineItemId, p]));
            const nextByLineItemId = new Map(newLines.map((l) => [l.lineItemId, l]));

            // 收集批量操作
            const toCreate: Prisma.OrderProductCreateManyInput[] = [];
            const toDeleteIds: number[] = [];
            // 🔧 优化：收集更新操作，改为并行执行，减少 N+1 查询
            const toUpdate: Array<{ id: number; data: Prisma.OrderProductUpdateInput }> = [];

            for (const line of newLines) {
              // 🔧 使用 lineItemId 查找现有记录
              const prev = existingByLineItemId.get(line.lineItemId);
              // 🔧 修复：URL 兜底逻辑 - 如果 onlineStoreUrl 为空但 handle 存在，用 handle 拼接 URL
              // Shopify 的 onlineStoreUrl 在商品未发布到 Online Store 时会为 null
              const lineUrl = line.url || (line.handle ? `https://${shopDomain}/products/${line.handle}` : null);
              
              if (prev) {
                const changed =
                  prev.productId !== line.id ||  // productId 也可能变化（产品被替换）
                  prev.title !== line.title ||
                  prev.handle !== (line.handle || null) ||
                  prev.url !== lineUrl ||
                  toNumber(prev.price) !== roundMoney(line.price) ||
                  prev.currency !== (line.currency || prev.currency) ||
                  prev.quantity !== line.quantity;
                if (changed) {
                  // 🔧 优化：收集更新而不是立即执行
                  toUpdate.push({
                    id: prev.id,
                    data: {
                      productId: line.id,  // 更新 productId（以防产品被替换）
                      title: line.title,
                      handle: line.handle || null,
                      url: lineUrl,
                      price: roundMoney(line.price),
                      currency: line.currency ?? prev.currency,
                      quantity: line.quantity,
                    },
                  });
                }
              } else {
                toCreate.push({
                  orderId: order.id,
                  productId: line.id,
                  lineItemId: line.lineItemId,  // 🔧 新增：存储 lineItemId
                  title: line.title,
                  handle: line.handle || null,
                  url: lineUrl,
                  price: roundMoney(line.price),
                  currency: line.currency || order.currency || "USD",
                  quantity: line.quantity,
                });
              }
            }

            // 🔧 使用 lineItemId 判断哪些行需要删除
            for (const prev of existingLines) {
              if (!nextByLineItemId.has(prev.lineItemId)) {
                toDeleteIds.push(prev.id);
              }
            }

            // 🔧 优化：并行执行更新操作
            // 在事务内并行执行仍然是安全的，可以显著减少总延迟
            if (toUpdate.length > 0) {
              await Promise.all(
                toUpdate.map(({ id, data }) =>
                  tx.orderProduct.update({ where: { id }, data })
                )
              );
            }

            // 批量创建新产品（唯一约束现在基于 orderId + lineItemId）
            if (toCreate.length > 0) {
              await tx.orderProduct.createMany({
                data: toCreate,
                skipDuplicates: true,  // 现在有唯一约束，skipDuplicates 生效
              });
            }

            // 批量删除已移除的产品
            if (toDeleteIds.length > 0) {
              await tx.orderProduct.deleteMany({
                where: { id: { in: toDeleteIds } },
              });
            }

            const existingOrder = orderMap.get(order.id);
            if (existingOrder) {
              localUpdated += 1;
            } else {
              localCreated += 1;
            }
          }

          // 【修复】按客户分组处理客户统计，确保同一客户的多个订单正确累加
          for (const [customerId, customerOrders] of ordersByCustomer) {
            if (!customerId) continue;

            // 获取或创建客户状态
            let current = customerStateMap.get(customerId);
            if (!current) {
              const firstOrder = customerOrders[0];
              const firstCreatedAt = new Date(firstOrder.createdAt);
              current = createInitialCustomerState(
                customerId,
                shopDomain,
                platform,
                {
                  createdAt: firstCreatedAt,
                  id: firstOrder.id,
                  aiSource: toPrismaAiSource(firstOrder.aiSource),
                }
              );
            }

            // 串行处理该客户的所有订单（已按时间排序）
            for (const order of customerOrders) {
              const createdAt = new Date(order.createdAt);
              const existingOrder = orderMap.get(order.id);
              const aiSource = toPrismaAiSource(order.aiSource);

              // 判断是否为最早的订单（显式类型注解避免循环引用类型推断问题）
              const isFirstKnownOrder: boolean =
                !current.firstOrderAt || createdAt <= current.firstOrderAt;
              const nextFirstOrderAt: Date | null = isFirstKnownOrder
                ? createdAt
                : current.firstOrderAt;
              const nextFirstOrderId: string | null = isFirstKnownOrder
                ? order.id
                : current.firstOrderId;

              // 计算订单金额变化
              const previousContribution: number =
                existingOrder && existingOrder.customerId === customerId
                  ? toNumber(existingOrder.totalPrice)
                  : 0;

              // 【修复】订单计数逻辑：
              // - 如果是更新现有订单（订单 ID 已存在），保持当前计数不变
              // - 如果是新订单，计数 +1
              // 注意：之前的 Math.max(current.orderCount, 1) 逻辑有问题，
              // 因为当 orderCount 为 0 时会被错误地设为 1
              const nextOrderCount: number = existingOrder
                ? current.orderCount  // 更新订单：保持不变
                : current.orderCount + 1;  // 新订单：+1

              // 总消费：减去旧订单金额，加上新订单金额
              const nextTotal: number =
                current.totalSpent - previousContribution + roundMoney(order.totalPrice);

              // 最后订单时间
              const nextLastOrderAt: Date =
                current.lastOrderAt && current.lastOrderAt > createdAt
                  ? current.lastOrderAt
                  : createdAt;

              // acquiredViaAi 只在首单时设置，之后不再改变
              const nextAcquiredViaAi: boolean =
                current.orderCount > 0 || existingOrder
                  ? current.acquiredViaAi
                  : Boolean(aiSource);

              // 第一个 AI 订单 ID
              const nextFirstAiOrderId: string | null =
                current.firstAiOrderId || (aiSource ? order.id : null);

              // 更新内存状态（确保下一个订单看到最新值）
              current = {
                ...current,
                firstOrderAt: nextFirstOrderAt,
                firstOrderId: nextFirstOrderId,
                lastOrderAt: nextLastOrderAt,
                orderCount: nextOrderCount,
                totalSpent: nextTotal,
                acquiredViaAi: nextAcquiredViaAi,
                firstAiOrderId: nextFirstAiOrderId,
              };
            }

            // 批量更新客户记录（只写入一次数据库）
            await tx.customer.upsert({
              where: { id: customerId },
              create: {
                id: customerId,
                shopDomain,
                platform,
                firstOrderAt: current.firstOrderAt!,
                firstOrderId: current.firstOrderId!,
                lastOrderAt: current.lastOrderAt!,
                orderCount: current.orderCount,
                totalSpent: current.totalSpent,
                acquiredViaAi: current.acquiredViaAi,
                firstAiOrderId: current.firstAiOrderId,
              },
              update: {
                shopDomain,
                platform,
                firstOrderAt: current.firstOrderAt,
                firstOrderId: current.firstOrderId,
                lastOrderAt: current.lastOrderAt,
                orderCount: current.orderCount,
                totalSpent: current.totalSpent,
                acquiredViaAi: current.acquiredViaAi,
                firstAiOrderId: current.firstAiOrderId,
              },
            });

            // 更新状态缓存
            customerStateMap.set(customerId, current);
          }

          return { created: localCreated, updated: localUpdated };
        },
        {
          // 事务超时配置，避免长时间占用数据库连接
          timeout: PERSISTENCE_TRANSACTION_TIMEOUT_MS,
          // 使用 RepeatableRead 隔离级别，平衡一致性和性能
          // 注：已通过 groupOrdersByCustomer 在内存中按客户分组处理，
          // 避免了同一客户订单的竞态条件，无需 Serializable
          isolationLevel: "RepeatableRead",
        }
      );

      created += batchCreated;
      updated += batchUpdated;
    }

    logger.info("[persistence] Order persistence completed", {
      shopDomain,
      totalCreated: created,
      totalUpdated: updated,
    });

    return { created, updated };
  } catch (error) {
    if (tableMissing(error)) {
      logger.warn("[persistence] Database tables not available", { shopDomain });
      return { created: 0, updated: 0 };
    }

    logger.error("[persistence] Order persistence failed", {
      shopDomain,
      orderCount: orders.length,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof ValidationError || error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError("Failed to persist orders", {
      shopDomain,
      orderCount: orders.length,
    });
  }
};

/**
 * 删除数据库中存在但 Shopify 已不存在的订单
 * 用于后台补位时同步删除已从 Shopify 删除的订单
 * 
 * @param shopDomain - 店铺域名
 * @param range - 时间范围（用于限定同步范围）
 * @param shopifyOrderIds - Shopify 当前返回的订单 ID 集合
 * @returns 删除的订单数量
 */
export const removeDeletedOrders = async (
  shopDomain: string,
  range: DateRange,
  shopifyOrderIds: Set<string>
): Promise<number> => {
  if (!shopDomain || isDemoMode()) {
    return 0;
  }

  try {
    // 查询数据库中该时间范围内的所有订单 ID
    const dbOrders = await prisma.order.findMany({
      where: {
        shopDomain,
        platform,
        createdAt: {
          gte: range.start,
          lte: range.end,
        },
      },
      select: { id: true },
    });

    // 找出数据库中存在但 Shopify 已不存在的订单 ID
    const ordersToDelete = dbOrders
      .map(o => o.id)
      .filter(id => !shopifyOrderIds.has(id));

    if (ordersToDelete.length === 0) {
      logger.debug("[persistence] No deleted orders to remove", {
        shopDomain,
        rangeStart: range.start.toISOString(),
        rangeEnd: range.end.toISOString(),
        dbOrderCount: dbOrders.length,
        shopifyOrderCount: shopifyOrderIds.size,
      });
      return 0;
    }

    // 分批删除订单（OrderProduct 会通过 onDelete: Cascade 自动删除）
    const BATCH_SIZE = 100;
    let totalDeleted = 0;

    for (let i = 0; i < ordersToDelete.length; i += BATCH_SIZE) {
      const batch = ordersToDelete.slice(i, i + BATCH_SIZE);
      
      const result = await prisma.order.deleteMany({
        where: { id: { in: batch } },
      });
      
      totalDeleted += result.count;
    }

    logger.info("[persistence] Removed deleted orders from database", {
      shopDomain,
      rangeStart: range.start.toISOString(),
      rangeEnd: range.end.toISOString(),
      dbOrderCount: dbOrders.length,
      shopifyOrderCount: shopifyOrderIds.size,
      deletedCount: totalDeleted,
    });

    return totalDeleted;
  } catch (error) {
    if (tableMissing(error)) {
      logger.warn("[persistence] Database tables not available for order removal", { shopDomain });
      return 0;
    }

    logger.error("[persistence] Failed to remove deleted orders", {
      shopDomain,
      error: error instanceof Error ? error.message : String(error),
    });

    // 删除失败不抛出异常，只记录日志，避免影响主流程
    return 0;
  }
};

/**
 * 从数据库加载订单
 * @deprecated 请直接从 orderService.server 导入 loadOrdersFromDb
 * 为保持向后兼容，此处重新导出
 */
export const loadOrdersFromDb = loadOrdersFromDbService;

export const loadCustomersByIdsLegacy = async (
  shopDomain: string,
  ids: string[],
): Promise<{ id: string; acquiredViaAi: boolean }[]> => {
  if (!shopDomain || !ids.length || isDemoMode()) return [];

  try {
    // 直接查询数据库，避免循环依赖
    const customers = await prisma.customer.findMany({
      where: { shopDomain, id: { in: ids } },
      select: { id: true, acquiredViaAi: true },
    });
    return customers.map((c) => ({ id: c.id, acquiredViaAi: c.acquiredViaAi }));
  } catch (error) {
    if (tableMissing(error)) {
      logger.warn("[persistence] Database tables not available for customer loading", { shopDomain });
      return [];
    }

    logger.error("[persistence] Failed to load customers", {
      shopDomain,
      customerCount: ids.length,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new DatabaseError("Failed to load customers", {
      shopDomain,
      customerIds: ids.slice(0, 10),
    });
  }
};

export const aggregateAiShare = async (shopDomain: string) => {
  if (!shopDomain) return { aiOrders: 0, totalOrders: 0 };
  try {
    const [totalOrders, aiOrders] = await Promise.all([
      prisma.order.count({ where: { shopDomain, platform } }),
      prisma.order.count({ where: { shopDomain, platform, aiSource: { not: null } } }),
    ]);
    return { aiOrders, totalOrders };
  } catch (error) {
    if (tableMissing(error)) {
      return { aiOrders: 0, totalOrders: 0 };
    }
    throw error;
  }
};

export const hasAnyTables = () => {
  return true;
};
