import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { type AIChannel, type DateRange, type OrderRecord } from "./aiData";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { getPlatform, isDemoMode } from "./runtime.server";
import { MAX_DASHBOARD_ORDERS, MAX_DETECTION_LENGTH } from "./constants";
import { getSettings } from "./settings.server";

const tableMissing = (error: unknown) =>
  (error instanceof PrismaClientKnownRequestError && error.code === "P2021") ||
  (error instanceof Error && error.message.includes("not available"));

const platform = getPlatform();

const toAiEnum = (source: AIChannel | null): Prisma.AiSource | null => {
  switch (source) {
    case "ChatGPT":
      return "ChatGPT";
    case "Perplexity":
      return "Perplexity";
    case "Gemini":
      return "Gemini";
    case "Copilot":
      return "Copilot";
    case "Other-AI":
      return "Other_AI";
    default:
      return null;
  }
};

const fromAiEnum = (source: Prisma.AiSource | null): AIChannel | null => {
  if (!source) return null;
  if (source === "Other_AI") return "Other-AI";
  return source as AIChannel;
};

let cachedModels:
  | {
      orderModel: typeof prisma.order;
      customerModel: typeof prisma.customer;
      productModel: typeof prisma.orderProduct;
    }
  | null = null;

const ensureTables = () => {
  if (!cachedModels) {
    const orderModel = prisma.order;
    const customerModel = prisma.customer;
    const productModel = prisma.orderProduct;

    cachedModels = { orderModel, customerModel, productModel };
  }

  return cachedModels;
};

const models = ensureTables();

export const persistOrders = async (shopDomain: string, orders: OrderRecord[]) => {
  if (!shopDomain || !orders.length || isDemoMode()) return { created: 0, updated: 0 };

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

    for (const chunk of chunks) {
      const orderIds = chunk.map((order) => order.id);
      const customerIds = Array.from(
        new Set(chunk.map((order) => order.customerId).filter(Boolean) as string[]),
      );

      const { created: batchCreated, updated: batchUpdated } = await prisma.$transaction(
        async (tx) => {
          const existingOrders = await tx.order.findMany({ where: { id: { in: orderIds } } });
          const existingCustomers = customerIds.length
            ? await tx.customer.findMany({ where: { id: { in: customerIds } } })
            : [];

          const orderMap = new Map(existingOrders.map((o) => [o.id, o]));
          const customerState = new Map(
            existingCustomers.map((c) => [c.id, { ...c }]),
          );

          let localCreated = 0;
          let localUpdated = 0;

          await tx.orderProduct.deleteMany({ where: { orderId: { in: orderIds } } });

          const productBuffer: Prisma.OrderProductCreateManyInput[] = [];

          for (const order of chunk) {
            const aiSource = toAiEnum(order.aiSource);
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
              detectionSignals: order.signals,
              createdAtLocal: toZonedDate(createdAt, timeZone),
            };

            await tx.order.upsert({
              where: { id: order.id },
              create: orderData,
              update: orderData,
            });

            if (order.products?.length) {
              productBuffer.push(
                ...order.products.map((line) => ({
                  orderId: order.id,
                  productId: line.id,
                  title: line.title,
                  handle: line.handle || null,
                  url: line.url || null,
                  price: line.price,
                  currency: line.currency,
                  quantity: line.quantity,
                })),
              );
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

          if (productBuffer.length) {
            await tx.orderProduct.createMany({ data: productBuffer });
          }

          return { created: localCreated, updated: localUpdated };
        },
      );

      created += batchCreated;
      updated += batchUpdated;
    }

    return { created, updated };
  } catch (error) {
    if (tableMissing(error)) {
      return { created: 0, updated: 0 };
    }
    throw error;
  }
};

export const loadOrdersFromDb = async (
  shopDomain: string,
  range: DateRange,
): Promise<{ orders: OrderRecord[]; clamped: boolean }> => {
  if (!shopDomain || isDemoMode()) return { orders: [], clamped: false };

  try {
    const { orderModel, productModel } = models;

    const orders = await orderModel.findMany({
      where: {
        shopDomain,
        platform,
        createdAt: { gte: range.start, lte: range.end },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_DASHBOARD_ORDERS,
    });

    if (!orders.length) return { orders: [], clamped: false };

    const orderIds = orders.map((order) => order.id);
    const products = await productModel.findMany({
      where: { orderId: { in: orderIds } },
    });

    const productMap = products.reduce<Record<string, OrderRecord["products"]>>((acc, item) => {
      acc[item.orderId] = acc[item.orderId] || [];
      acc[item.orderId].push({
        id: item.productId,
        title: item.title,
        handle: item.handle || "",
        url: item.url || "",
        price: item.price,
        currency: item.currency,
        quantity: item.quantity,
      });
      return acc;
    }, {});

    const mappedOrders = orders.map((order) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt.toISOString(),
      totalPrice: order.totalPrice,
      currency: order.currency,
      subtotalPrice: order.subtotalPrice ?? undefined,
      aiSource: fromAiEnum(order.aiSource),
      referrer: order.referrer || "",
      landingPage: order.landingPage || "",
      utmSource: order.utmSource || undefined,
      utmMedium: order.utmMedium || undefined,
      sourceName: order.sourceName || undefined,
      tags: [],
      customerId: order.customerId ?? null,
      isNewCustomer: order.isNewCustomer,
      products: productMap[order.id] || [],
      detection: (order.detection || "").slice(0, MAX_DETECTION_LENGTH),
      signals: order.detectionSignals || [],
    }));

    return { orders: mappedOrders, clamped: orders.length >= MAX_DASHBOARD_ORDERS };
  } catch (error) {
    if (tableMissing(error)) {
      return { orders: [], clamped: false };
    }
    throw error;
  }
};

export const loadCustomersByIds = async (
  shopDomain: string,
  ids: string[],
): Promise<{ id: string; acquiredViaAi: boolean }[]> => {
  if (!shopDomain || !ids.length || isDemoMode()) return [];
  try {
    const { customerModel } = models;
    const customers = await customerModel.findMany({ where: { shopDomain, id: { in: ids } }, select: { id: true, acquiredViaAi: true } });
    return customers.map((c) => ({ id: c.id, acquiredViaAi: Boolean(c.acquiredViaAi) }));
  } catch (error) {
    if (tableMissing(error)) {
      return [];
    }
    throw error;
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
