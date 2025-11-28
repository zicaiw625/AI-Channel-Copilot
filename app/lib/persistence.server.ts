import prisma from "../db.server";
import type { Prisma } from "@prisma/client";
import { type AIChannel, type DateRange, type OrderRecord } from "./aiData";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

const tableMissing = (error: unknown) =>
  (error instanceof PrismaClientKnownRequestError && error.code === "P2021") ||
  (error instanceof Error && error.message.includes("not available"));

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

const ensureTables = () => {
  const orderModel = prisma.order;
  const customerModel = prisma.customer;
  const productModel = prisma.orderProduct;

  return { orderModel, customerModel, productModel };
};

export const persistOrders = async (shopDomain: string, orders: OrderRecord[]) => {
  if (!shopDomain || !orders.length) return { created: 0, updated: 0 };

  try {
    ensureTables();
    const { created, updated } = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;

      const orderIds = orders.map((order) => order.id);
      await tx.orderProduct.deleteMany({ where: { orderId: { in: orderIds } } });

      for (const order of orders) {
        const aiSource = toAiEnum(order.aiSource);
        const createdAt = new Date(order.createdAt);

        const orderData: Prisma.OrderUpsertArgs["create"] = {
          id: order.id,
          shopDomain,
          name: order.name,
          createdAt,
          totalPrice: order.totalPrice,
          subtotalPrice: order.subtotalPrice ?? order.totalPrice,
          aiSource,
          detection: order.detection,
          referrer: order.referrer,
          landingPage: order.landingPage,
          utmSource: order.utmSource,
          utmMedium: order.utmMedium,
          sourceName: order.sourceName,
          customerId: order.customerId || null,
          isNewCustomer: order.isNewCustomer,
          createdAtLocal: createdAt,
        };

        const existingOrder = await tx.order.findUnique({ where: { id: order.id } });

        await tx.order.upsert({
          where: { id: order.id },
          create: orderData,
          update: orderData,
        });

        if (order.products?.length) {
          await tx.orderProduct.createMany({
            data: order.products.map((line) => ({
              orderId: order.id,
              productId: line.id,
              title: line.title,
              handle: line.handle || null,
              url: line.url || null,
              price: line.price,
              quantity: line.quantity,
            })),
          });
        }

        if (order.customerId) {
          const existing = await tx.customer.findUnique({
            where: { id: order.customerId },
          });

          const nextOrderCount = (existing?.orderCount ?? 0) + 1;
          const nextTotal = (existing?.totalSpent ?? 0) + order.totalPrice;
          const acquiredViaAi =
            existing?.acquiredViaAi || Boolean(order.aiSource && order.isNewCustomer);
          const firstAiOrderId = existing?.firstAiOrderId || (order.aiSource ? order.id : null);

          await tx.customer.upsert({
            where: { id: order.customerId },
            create: {
              id: order.customerId,
              shopDomain,
              firstOrderAt: createdAt,
              lastOrderAt: createdAt,
              orderCount: 1,
              totalSpent: order.totalPrice,
              acquiredViaAi,
              firstAiOrderId,
            },
            update: {
              shopDomain,
              firstOrderAt: existing?.firstOrderAt || createdAt,
              lastOrderAt: createdAt,
              orderCount: nextOrderCount,
              totalSpent: nextTotal,
              acquiredViaAi,
              firstAiOrderId,
            },
          });
        }

        if (existingOrder) {
          updated += 1;
        } else {
          created += 1;
        }
      }

      return { created, updated };
    });

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
): Promise<OrderRecord[]> => {
  if (!shopDomain) return [];

  try {
    const { orderModel, productModel } = ensureTables();

    const orders = await orderModel.findMany({
      where: {
        shopDomain,
        createdAt: { gte: range.start, lte: range.end },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!orders.length) return [];

    const orderIds = orders.map((o: any) => o.id);
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
        quantity: item.quantity,
      });
      return acc;
    }, {});

    return orders.map((order: any) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt.toISOString(),
      totalPrice: order.totalPrice,
      subtotalPrice: order.subtotalPrice ?? undefined,
      aiSource: fromAiEnum(order.aiSource),
      referrer: order.referrer || "",
      landingPage: order.landingPage || "",
      utmSource: order.utmSource || undefined,
      utmMedium: order.utmMedium || undefined,
      sourceName: order.sourceName || undefined,
      tags: [],
      customerId: order.customerId || "guest",
      isNewCustomer: order.isNewCustomer,
      products: productMap[order.id] || [],
      detection: order.detection || "",
    }));
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
    const { orderModel } = ensureTables();
    const [totalOrders, aiOrders] = await Promise.all([
      orderModel.count({ where: { shopDomain } }),
      orderModel.count({ where: { shopDomain, aiSource: { not: null } } }),
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
  try {
    ensureTables();
    return true;
  } catch {
    return false;
  }
};
