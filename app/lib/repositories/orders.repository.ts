/**
 * Orders Repository
 * 数据访问层 - 封装所有订单相关的数据库操作
 */

import prisma from '../../db.server';
import { Prisma, type Order, type OrderProduct, type AiSource } from '@prisma/client';
import type { DateRange, OrderRecord } from '../aiTypes';
import { fromPrismaAiSource, toPrismaAiSource } from '../aiSourceMapper';
import { logger } from '../logger.server';
import { metrics, recordDbMetrics } from '../metrics/collector';

// 数据库订单类型（带 products 关系）
type OrderWithProducts = Order & {
  products: OrderProduct[];
};

export class OrdersRepository {
  /**
   * 根据店铺和日期范围查询订单
   */
  async findByShopAndDateRange(
    shopDomain: string,
    range: DateRange,
    options?: {
      includeProducts?: boolean;
      aiOnly?: boolean;
      limit?: number;
      currency?: string;
    }
  ): Promise<OrderRecord[]> {
    const startTime = Date.now();
    const operation = 'findByShopAndDateRange';

    try {
      const where: Prisma.OrderWhereInput = {
        shopDomain,
        createdAt: { gte: range.start, lte: range.end },
        sourceName: { notIn: ['pos', 'draft'] },
      };

      if (options?.aiOnly) {
        where.aiSource = { not: null };
      }

      if (options?.currency) {
        where.currency = options.currency;
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          products: options?.includeProducts ?? true,
        },
        orderBy: { createdAt: 'desc' },
        ...(options?.limit && { take: options.limit }),
      });

      const mapped = orders.map(order => this.mapToOrderRecord(order));
      
      recordDbMetrics(operation, 'Order', Date.now() - startTime, true);
      metrics.gauge('orders.query_result_size', mapped.length, { shopDomain });

      return mapped;
    } catch (error) {
      recordDbMetrics(operation, 'Order', Date.now() - startTime, false);
      logger.error('[OrdersRepository] Query failed', { shopDomain, operation }, { error });
      throw error;
    }
  }

  /**
   * 查询 AI 订单数量
   */
  async countAIOrders(
    shopDomain: string,
    range: DateRange,
    aiSource?: string
  ): Promise<number> {
    const startTime = Date.now();

    try {
      const where: Prisma.OrderWhereInput = {
        shopDomain,
        createdAt: { gte: range.start, lte: range.end },
        aiSource: aiSource ? (aiSource as AiSource) : { not: null },
        sourceName: { notIn: ['pos', 'draft'] },
      };

      const count = await prisma.order.count({ where });
      
      recordDbMetrics('countAIOrders', 'Order', Date.now() - startTime, true);
      return count;
    } catch (error) {
      recordDbMetrics('countAIOrders', 'Order', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 获取订单聚合统计
   */
  async getAggregateStats(
    shopDomain: string,
    range: DateRange,
    metric: 'totalPrice' | 'subtotalPrice' = 'totalPrice'
  ): Promise<{
    total: { gmv: number; orders: number; newCustomers: number };
    ai: { gmv: number; orders: number; newCustomers: number };
  }> {
    const startTime = Date.now();

    try {
      const baseWhere: Prisma.OrderWhereInput = {
        shopDomain,
        createdAt: { gte: range.start, lte: range.end },
        sourceName: { notIn: ['pos', 'draft'] },
      };

      const [totalStats, aiStats] = await Promise.all([
        prisma.order.aggregate({
          where: baseWhere,
          _sum: { totalPrice: true, subtotalPrice: true },
          _count: { _all: true },
        }),
        prisma.order.aggregate({
          where: { ...baseWhere, aiSource: { not: null } },
          _sum: { totalPrice: true, subtotalPrice: true },
          _count: { _all: true },
        }),
      ]);

      const [totalNewCustomers, aiNewCustomers] = await Promise.all([
        prisma.order.count({
          where: { ...baseWhere, isNewCustomer: true },
        }),
        prisma.order.count({
          where: { ...baseWhere, aiSource: { not: null }, isNewCustomer: true },
        }),
      ]);

      recordDbMetrics('getAggregateStats', 'Order', Date.now() - startTime, true);

      return {
        total: {
          gmv: (totalStats._sum[metric] as number) || 0,
          orders: totalStats._count._all,
          newCustomers: totalNewCustomers,
        },
        ai: {
          gmv: (aiStats._sum[metric] as number) || 0,
          orders: aiStats._count._all,
          newCustomers: aiNewCustomers,
        },
      };
    } catch (error) {
      recordDbMetrics('getAggregateStats', 'Order', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 根据 ID 查询订单
   */
  async findById(orderId: string): Promise<OrderRecord | null> {
    const startTime = Date.now();

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { products: true },
      });

      recordDbMetrics('findById', 'Order', Date.now() - startTime, true);

      return order ? this.mapToOrderRecord(order) : null;
    } catch (error) {
      recordDbMetrics('findById', 'Order', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 批量创建或更新订单
   */
  async upsertMany(orders: OrderRecord[]): Promise<number> {
    const startTime = Date.now();
    let successCount = 0;

    try {
      for (const order of orders) {
        await this.upsert(order);
        successCount++;
      }

      recordDbMetrics('upsertMany', 'Order', Date.now() - startTime, true);
      metrics.increment('orders.upserted', successCount);

      return successCount;
    } catch (error) {
      recordDbMetrics('upsertMany', 'Order', Date.now() - startTime, false);
      logger.error('[OrdersRepository] Batch upsert failed', { 
        total: orders.length, 
        success: successCount 
      }, { error });
      throw error;
    }
  }

  /**
   * 创建或更新单个订单
   */
  async upsert(order: OrderRecord): Promise<void> {
    const startTime = Date.now();

    try {
      // 先 upsert Order
      const prismaAiSource = toPrismaAiSource(order.aiSource);
      await prisma.order.upsert({
        where: { id: order.id },
        update: {
          name: order.name,
          totalPrice: order.totalPrice,
          currency: order.currency,
          subtotalPrice: order.subtotalPrice,
          refundTotal: order.refundTotal,
          aiSource: prismaAiSource,
          detection: order.detection,
          detectionSignals: order.signals as Prisma.InputJsonValue,
          referrer: order.referrer,
          landingPage: order.landingPage,
          utmSource: order.utmSource,
          utmMedium: order.utmMedium,
          sourceName: order.sourceName,
          customerId: order.customerId,
          isNewCustomer: order.isNewCustomer,
          updatedAt: new Date(),
        },
        create: {
          id: order.id,
          shopDomain: '',
          name: order.name,
          createdAt: new Date(order.createdAt),
          totalPrice: order.totalPrice,
          currency: order.currency,
          subtotalPrice: order.subtotalPrice,
          refundTotal: order.refundTotal,
          aiSource: prismaAiSource,
          detection: order.detection,
          detectionSignals: order.signals as Prisma.InputJsonValue,
          referrer: order.referrer,
          landingPage: order.landingPage,
          utmSource: order.utmSource,
          utmMedium: order.utmMedium,
          sourceName: order.sourceName,
          customerId: order.customerId,
          isNewCustomer: order.isNewCustomer,
        },
      });

      // 处理 OrderProducts
      if (order.products && order.products.length > 0) {
        // 删除旧的 products
        await prisma.orderProduct.deleteMany({
          where: { orderId: order.id },
        });

        // 创建新的 products
        await prisma.orderProduct.createMany({
          data: order.products.map(p => ({
            orderId: order.id,
            productId: p.id,
            title: p.title,
            handle: p.handle,
            url: p.url,
            price: p.price,
            currency: p.currency,
            quantity: p.quantity,
          })),
        });
      }

      recordDbMetrics('upsert', 'Order', Date.now() - startTime, true);
    } catch (error) {
      recordDbMetrics('upsert', 'Order', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 获取店铺最后订单时间
   */
  async getLastOrderAt(shopDomain: string): Promise<Date | null> {
    const startTime = Date.now();

    try {
      const lastOrder = await prisma.order.findFirst({
        where: {
          shopDomain,
          sourceName: { notIn: ['pos', 'draft'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      recordDbMetrics('getLastOrderAt', 'Order', Date.now() - startTime, true);

      return lastOrder?.createdAt ?? null;
    } catch (error) {
      recordDbMetrics('getLastOrderAt', 'Order', Date.now() - startTime, false);
      logger.error('[OrdersRepository] getLastOrderAt failed', { shopDomain }, { error });
      return null;
    }
  }

  /**
   * 删除过期订单
   */
  async deleteOlderThan(shopDomain: string, beforeDate: Date): Promise<number> {
    const startTime = Date.now();

    try {
      const result = await prisma.order.deleteMany({
        where: {
          shopDomain,
          createdAt: { lt: beforeDate },
        },
      });

      recordDbMetrics('deleteOlderThan', 'Order', Date.now() - startTime, true);
      metrics.increment('orders.deleted', result.count, { shopDomain });

      logger.info('[OrdersRepository] Deleted old orders', {
        shopDomain,
        count: result.count,
        beforeDate: beforeDate.toISOString(),
      });

      return result.count;
    } catch (error) {
      recordDbMetrics('deleteOlderThan', 'Order', Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * 将数据库记录映射到 OrderRecord
   */
  private mapToOrderRecord(order: OrderWithProducts): OrderRecord {
    return {
      id: order.id,
      name: order.name,
      createdAt: order.createdAt.toISOString(),
      totalPrice: order.totalPrice,
      currency: order.currency,
      subtotalPrice: order.subtotalPrice ?? undefined,
      refundTotal: order.refundTotal,
      aiSource: fromPrismaAiSource(order.aiSource),
      detection: order.detection || "",
      signals: Array.isArray(order.detectionSignals) ? (order.detectionSignals as string[]) : [],
      referrer: order.referrer || "",
      landingPage: order.landingPage || "",
      utmSource: order.utmSource || undefined,
      utmMedium: order.utmMedium || undefined,
      sourceName: order.sourceName || undefined,
      customerId: order.customerId || null,
      isNewCustomer: order.isNewCustomer,
      tags: [],
      products: order.products?.map((p: OrderProduct) => ({
        id: p.productId,
        title: p.title,
        handle: p.handle || "",
        url: p.url || "",
        price: p.price,
        currency: p.currency,
        quantity: p.quantity,
      })) || [],
    };
  }
}

// 导出单例实例
export const ordersRepository = new OrdersRepository();

