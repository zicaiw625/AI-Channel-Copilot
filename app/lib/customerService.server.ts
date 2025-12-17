/**
 * 客户数据服务
 * 处理客户数据的查询和管理
 */

import prisma from "../db.server";
import type { DateRange } from "./aiData";
import { DatabaseError, NotFoundError } from "./errors";
import { logger } from "./logger.server";
import { toNumber } from "./queries/helpers";

export interface CustomerData {
  id: string;
  shopDomain: string;
  platform: string;
  acquiredViaAi: boolean;
  firstOrderId: string | null;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  orderCount: number;
  totalSpent: number;
  firstAiOrderId: string | null;
}

/**
 * 根据ID列表批量查询客户数据
 */
export const loadCustomersByIds = async (
  shopDomain: string,
  customerIds: string[]
): Promise<CustomerData[]> => {
  if (!customerIds.length) return [];

  try {
    const customers = await prisma.customer.findMany({
      where: {
        shopDomain,
        id: { in: customerIds },
      },
      select: {
        id: true,
        shopDomain: true,
        platform: true,
        acquiredViaAi: true,
        firstOrderId: true,
        firstOrderAt: true,
        lastOrderAt: true,
        orderCount: true,
        totalSpent: true,
        firstAiOrderId: true,
      },
    });

    return customers.map(c => ({
      ...c,
      acquiredViaAi: Boolean(c.acquiredViaAi),
      totalSpent: toNumber(c.totalSpent),
    }));
  } catch (error) {
    logger.error("[customerService] Failed to load customers by IDs", {
      shopDomain,
      customerCount: customerIds.length,
    }, { error: error instanceof Error ? error.message : String(error) });

    throw new DatabaseError("Failed to load customers", {
      shopDomain,
      customerIds: customerIds.slice(0, 10), // 只记录前10个ID
    });
  }
};

/**
 * 获取客户统计信息
 */
export const getCustomerStats = async (
  shopDomain: string,
  dateRange: DateRange
) => {
  try {
    const [totalCustomers, aiAcquiredCustomers] = await Promise.all([
      prisma.customer.count({
        where: {
          shopDomain,
          firstOrderAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
      }),
      prisma.customer.count({
        where: {
          shopDomain,
          acquiredViaAi: true,
          firstOrderAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
      }),
    ]);

    return {
      totalCustomers,
      aiAcquiredCustomers,
      aiAcquisitionRate: totalCustomers > 0 ? aiAcquiredCustomers / totalCustomers : 0,
    };
  } catch (error) {
    logger.error("[customerService] Failed to get customer stats", {
      shopDomain,
      dateRange: dateRange.label,
    });

    throw new DatabaseError("Failed to get customer statistics", {
      shopDomain,
      dateRange: dateRange.label,
    });
  }
};

/**
 * 更新客户AI获取状态
 */
export const updateCustomerAiAcquisition = async (
  shopDomain: string,
  customerId: string,
  acquiredViaAi: boolean
): Promise<void> => {
  try {
    // 由于 Customer 表的主键是 id，我们需要先验证该客户属于指定商店
    // 使用 updateMany 配合条件过滤来确保安全性
    const result = await prisma.customer.updateMany({
      where: {
        id: customerId,
        shopDomain, // 确保只更新指定商店的客户
      },
      data: {
        acquiredViaAi,
        updatedAt: new Date(),
      },
    });

    if (result.count === 0) {
      // 检查是客户不存在还是属于其他商店
      const existingCustomer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { shopDomain: true },
      });
      
      if (!existingCustomer) {
        throw new NotFoundError("Customer", customerId);
      }
      
      // 客户存在但属于其他商店，出于安全考虑不透露详细信息
      throw new NotFoundError("Customer", customerId);
    }

    logger.info("[customerService] Updated customer AI acquisition status", {
      shopDomain,
      customerId,
      acquiredViaAi,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    
    if ((error as any).code === 'P2025') {
      throw new NotFoundError("Customer", customerId);
    }

    logger.error("[customerService] Failed to update customer AI acquisition", {
      shopDomain,
      customerId,
      acquiredViaAi,
    });

    throw new DatabaseError("Failed to update customer AI acquisition status", {
      shopDomain,
      customerId,
    });
  }
};
