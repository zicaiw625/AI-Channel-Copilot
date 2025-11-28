import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import prisma from "../db.server";

const tableMissing = (error: unknown) =>
  (error instanceof PrismaClientKnownRequestError && error.code === "P2021") ||
  (error instanceof Error && error.message.includes("not available"));

const toIdCandidates = (value: unknown, resource: "Customer" | "Order") => {
  if (value === undefined || value === null) return [];
  const raw = String(value).trim();
  if (!raw) return [];
  if (raw.startsWith("gid://")) return [raw];
  return [raw, `gid://shopify/${resource}/${raw}`];
};

const uniqueCandidates = (values: unknown[], resource: "Customer" | "Order") => {
  const set = new Set<string>();
  values.forEach((value) => {
    toIdCandidates(value, resource).forEach((candidate) => set.add(candidate));
  });
  return Array.from(set);
};

export const extractGdprIdentifiers = (payload: Record<string, unknown> | null) => {
  const source = payload as any;
  const customerInputs = [
    source?.customer_id,
    source?.customerId,
    source?.customer?.id,
  ].filter(Boolean);
  const orderInputs = [
    ...(Array.isArray(source?.orders_to_redact) ? (source.orders_to_redact as unknown[]) : []),
    ...(Array.isArray(source?.orders_requested)
      ? (source.orders_requested as unknown[])
      : []),
  ];

  const customerEmail = source?.customer_email || source?.email || source?.customer?.email;

  return {
    customerIds: uniqueCandidates(customerInputs, "Customer"),
    orderIds: uniqueCandidates(orderInputs, "Order"),
    customerEmail: typeof customerEmail === "string" ? customerEmail : undefined,
  };
};

export const wipeShopData = async (shopDomain: string) => {
  if (!shopDomain) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.orderProduct.deleteMany({ where: { order: { shopDomain } } });
      await tx.order.deleteMany({ where: { shopDomain } });
      await tx.customer.deleteMany({ where: { shopDomain } });
      await tx.shopSettings.deleteMany({ where: { shopDomain } });
      await tx.session.deleteMany({ where: { shop: shopDomain } });
    });
  } catch (error) {
    if (!tableMissing(error)) {
      throw error;
    }
  }
};

export const redactCustomerRecords = async (
  shopDomain: string,
  customerIds: string[],
  orderIds: string[],
) => {
  if (!shopDomain || (!customerIds.length && !orderIds.length)) return;

  try {
    await prisma.$transaction(async (tx) => {
      if (orderIds.length) {
        await tx.orderProduct.deleteMany({ where: { orderId: { in: orderIds } } });
        await tx.order.deleteMany({
          where: { shopDomain, id: { in: orderIds } },
        });
      }

      if (customerIds.length) {
        await tx.order.deleteMany({
          where: { shopDomain, customerId: { in: customerIds } },
        });
        await tx.customer.deleteMany({
          where: { shopDomain, id: { in: customerIds } },
        });
      }
    });
  } catch (error) {
    if (!tableMissing(error)) {
      throw error;
    }
  }
};

export const describeCustomerFootprint = async (shopDomain: string, customerIds: string[]) => {
  if (!shopDomain) {
    return { hasData: false, orders: 0, customers: 0 };
  }

  try {
    const [orders, customers] = await Promise.all([
      customerIds.length
        ? prisma.order.count({ where: { shopDomain, customerId: { in: customerIds } } })
        : 0,
      customerIds.length
        ? prisma.customer.count({ where: { shopDomain, id: { in: customerIds } } })
        : 0,
    ]);

    return {
      hasData: orders > 0 || customers > 0,
      orders,
      customers,
    };
  } catch (error) {
    if (tableMissing(error)) {
      return { hasData: false, orders: 0, customers: 0 };
    }
    throw error;
  }
};
