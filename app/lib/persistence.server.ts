import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { type DateRange, type OrderRecord } from "./aiData";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { getPlatform, isDemoMode } from "./runtime.server";
import { MAX_DASHBOARD_ORDERS, MAX_DETECTION_LENGTH } from "./constants";
import { getSettings } from "./settings.server";
import { toPrismaAiSource } from "./aiSourceMapper";
import { loadCustomersByIds } from "./customerService.server";
import { validateOrderData } from "./orderService.server";
import { DatabaseError, ValidationError } from "./errors";
import { logger } from "./logger.server";

const tableMissing = (error: unknown) =>
  (error instanceof PrismaClientKnownRequestError && error.code === "P2021") ||
  (error instanceof Error && error.message.includes("not available"));

const platform = getPlatform();

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
  const batchSize = 100;

  for (let i = 0; i < orders.length; i += batchSize) {
    chunks.push(orders.slice(i, i + batchSize));
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
          const existingOrders = await tx.order.findMany({ where: { id: { in: orderIds } } });
          const existingCustomers = customerIds.length
            ? await loadCustomersByIds(shopDomain, customerIds)
            : [];

          const orderMap = new Map(existingOrders.map((o) => [o.id, o]));
          const customerState = new Map<string, any>(
            existingCustomers.map((c) => [c.id, { ...c }])
          );

          let localCreated = 0;
          let localUpdated = 0;

          for (const order of chunk) {
            const aiSource = toPrismaAiSource(order.aiSource);
            const createdAt = new Date(order.createdAt);
            const existingOrder = orderMap.get(order.id);
            const detection = (order.detection || "").slice(0, MAX_DETECTION_LENGTH);

            const orderData: Prisma.OrderUpsertArgs["create"] = {
              id: order.id,
              shopDomain,
              platform,
              name: order.name,
              createdAt,
              totalPrice: order.totalPrice,
              currency: order.currency,
              subtotalPrice: order.subtotalPrice ?? order.totalPrice,
              refundTotal: order.refundTotal ?? 0,
              aiSource,
              detection,
              referrer: order.referrer,
              landingPage: order.landingPage,
              utmSource: order.utmSource,
              utmMedium: order.utmMedium,
              sourceName: order.sourceName,
              customerId: order.customerId ?? null,
              isNewCustomer: order.isNewCustomer,
              detectionSignals: order.signals as unknown as Prisma.InputJsonValue,
              createdAtLocal: toZonedDate(createdAt, timeZone),
            };

            await tx.order.upsert({
              where: { id: order.id },
              create: orderData,
              update: orderData,
            });
            const newLines = order.products || [];
            const existingLines = await tx.orderProduct.findMany({ where: { orderId: order.id } });
            const existingByPid = new Map(existingLines.map((p) => [p.productId, p]));
            const nextByPid = new Map(newLines.map((l) => [l.id, l]));

            for (const line of newLines) {
              const prev = existingByPid.get(line.id);
              if (prev) {
                const changed =
                  prev.title !== line.title ||
                  prev.handle !== (line.handle || null) ||
                  prev.url !== (line.url || null) ||
                  prev.price !== line.price ||
                  prev.currency !== (line.currency || prev.currency) ||
                  prev.quantity !== line.quantity;
                if (changed) {
                  await tx.orderProduct.update({
                    where: { id: prev.id },
                    data: {
                      title: line.title,
                      handle: line.handle || null,
                      url: line.url || null,
                      price: line.price,
                      currency: line.currency ?? prev.currency,
                      quantity: line.quantity,
                    },
                  });
                }
              } else {
                await tx.orderProduct.create({
                  data: {
                    orderId: order.id,
                    productId: line.id,
                    title: line.title,
                    handle: line.handle || null,
                    url: line.url || null,
                    price: line.price,
                    currency: line.currency || order.currency || "USD",
                    quantity: line.quantity,
                  },
                });
              }
            }

            for (const prev of existingLines) {
              if (!nextByPid.has(prev.productId)) {
                await tx.orderProduct.delete({ where: { id: prev.id } });
              }
            }

            if (order.customerId) {
              const current = customerState.get(order.customerId) || {
                id: order.customerId,
                shopDomain,
                platform,
                firstOrderAt: createdAt,
                firstOrderId: order.id,
                lastOrderAt: createdAt,
                orderCount: 0,
                totalSpent: 0,
                acquiredViaAi: Boolean(order.aiSource),
                firstAiOrderId: order.aiSource ? order.id : null,
              };

              const isFirstKnownOrder = !current.firstOrderAt || createdAt <= current.firstOrderAt;
              const nextFirstOrderAt = isFirstKnownOrder ? createdAt : current.firstOrderAt;
              const nextFirstOrderId = isFirstKnownOrder ? order.id : current.firstOrderId;

              const previousContribution =
                existingOrder && existingOrder.customerId === order.customerId
                  ? existingOrder.totalPrice
                  : 0;

              const nextOrderCount = existingOrder
                ? Math.max(current.orderCount, 1)
                : current.orderCount + 1;

              const nextTotal = current.totalSpent - previousContribution + order.totalPrice;

              const nextLastOrderAt = current.lastOrderAt && current.lastOrderAt > createdAt
                ? current.lastOrderAt
                : createdAt;

              const acquiredViaAi =
                current.orderCount || existingOrder ? current.acquiredViaAi : Boolean(order.aiSource);

              const firstAiOrderId = current.firstAiOrderId || (order.aiSource ? order.id : null);

              await tx.customer.upsert({
                where: { id: order.customerId },
                create: {
                  id: order.customerId,
                  shopDomain,
                  platform,
                  firstOrderAt: createdAt,
                  firstOrderId: order.id,
                  lastOrderAt: createdAt,
                  orderCount: 1,
                  totalSpent: order.totalPrice,
                  acquiredViaAi,
                  firstAiOrderId,
                },
                update: {
                  shopDomain,
                  platform,
                  firstOrderAt: nextFirstOrderAt,
                  firstOrderId: nextFirstOrderId,
                  lastOrderAt: nextLastOrderAt,
                  orderCount: nextOrderCount,
                  totalSpent: nextTotal,
                  acquiredViaAi,
                  firstAiOrderId,
                },
              });

              customerState.set(order.customerId, {
                ...current,
                firstOrderAt: nextFirstOrderAt,
                firstOrderId: nextFirstOrderId,
                lastOrderAt: nextLastOrderAt,
                orderCount: nextOrderCount,
                totalSpent: nextTotal,
                acquiredViaAi,
                firstAiOrderId,
              });
            }

            if (existingOrder) {
              localUpdated += 1;
            } else {
              localCreated += 1;
            }
          }

          return { created: localCreated, updated: localUpdated };
        },
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

export const loadOrdersFromDb = async (
  shopDomain: string,
  range: DateRange,
): Promise<{ orders: OrderRecord[]; clamped: boolean }> => {
  if (!shopDomain || isDemoMode()) return { orders: [], clamped: false };

  try {
    // 使用新的orderService
    const { loadOrdersFromDb: loadOrders } = await import("./orderService.server");
    return await loadOrders(shopDomain, range, { limit: MAX_DASHBOARD_ORDERS });
  } catch (error) {
    if (tableMissing(error)) {
      logger.warn("[persistence] Database tables not available for order loading", { shopDomain });
      return { orders: [], clamped: false };
    }

    logger.error("[persistence] Failed to load orders", {
      shopDomain,
      range: range.label,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new DatabaseError("Failed to load orders from database", {
      shopDomain,
      range: range.label,
    });
  }
};

export const loadCustomersByIds = async (
  shopDomain: string,
  ids: string[],
): Promise<{ id: string; acquiredViaAi: boolean }[]> => {
  if (!shopDomain || !ids.length || isDemoMode()) return [];

  try {
    const { loadCustomersByIds: loadCustomers } = await import("./customerService.server");
    const customers = await loadCustomers(shopDomain, ids);
    return customers.map(c => ({ id: c.id, acquiredViaAi: c.acquiredViaAi }));
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
    const { orderModel } = models;
    const [totalOrders, aiOrders] = await Promise.all([
      orderModel.count({ where: { shopDomain, platform } }),
      orderModel.count({ where: { shopDomain, platform, aiSource: { not: null } } }),
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
  return Boolean(models);
};
const toZonedDate = (date: Date, timeZone?: string) => {
  if (!timeZone) return new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value || 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
};
