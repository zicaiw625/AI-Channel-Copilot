/**
 * Orders Repository
 * 数据访问层 - 封装所有订单相关的数据库操作
 * 
 * 错误处理策略：
 * - 查询操作：找不到时返回 null，数据库错误抛出 DatabaseError
 * - 写入操作：验证失败抛出 ValidationError，其他错误抛出 DatabaseError
 */

import prisma from '../../db.server';
import { Prisma, type AiSource } from '@prisma/client';
import type { DateRange, OrderRecord } from '../aiTypes';
import { toPrismaAiSource } from '../aiSourceMapper';
import { logger } from '../logger.server';
import { metrics, recordDbMetrics } from '../metrics/collector';
import { DatabaseError, ValidationError } from '../errors';
import {
  mapOrderToRecord,
  type OrderWithProducts,
} from '../mappers/orderMapper';

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const maybe = value as { toNumber?: () => number; toString?: () => string };
  if (typeof maybe?.toNumber === "function") {
    const n = maybe.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof maybe?.toString === "function") {
    const n = Number(maybe.toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

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
      logger.error('[orders.repository] Query failed', { shopDomain, operation }, { error });
      throw new DatabaseError('Failed to query orders by date range', {
        shopDomain,
        operation,
        range: range.label,
      });
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
      logger.error('[orders.repository] countAIOrders failed', { shopDomain }, { error });
      throw new DatabaseError('Failed to count AI orders', { shopDomain, range: range.label });
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
          gmv: toNumber(totalStats._sum[metric]),
          orders: totalStats._count._all,
          newCustomers: totalNewCustomers,
        },
        ai: {
          gmv: toNumber(aiStats._sum[metric]),
          orders: aiStats._count._all,
          newCustomers: aiNewCustomers,
        },
      };
    } catch (error) {
      recordDbMetrics('getAggregateStats', 'Order', Date.now() - startTime, false);
      logger.error('[orders.repository] getAggregateStats failed', { shopDomain }, { error });
      throw new DatabaseError('Failed to get aggregate stats', { shopDomain, range: range.label });
    }
  }

  /**
   * 根据 ID 查询订单
   * 找不到返回 null，数据库错误抛出 DatabaseError
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
      logger.error('[orders.repository] findById failed', { orderId }, { error });
      throw new DatabaseError('Failed to find order by ID', { orderId });
    }
  }

  /**
   * 批量创建或更新订单
   * 【优化】使用批量事务提升性能，避免逐条 upsert
   * 【修复】解决 N+1 查询问题，批量预查询 shopDomain
   */
  async upsertMany(orders: OrderRecord[], shopDomain?: string): Promise<number> {
    if (!orders.length) return 0;
    
    const startTime = Date.now();
    const BATCH_SIZE = 50; // 每批处理 50 条，平衡性能和事务大小
    let successCount = 0;

    try {
      // 分批处理
      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        
        // 使用事务批量处理
        await prisma.$transaction(async (tx) => {
          // 【修复 N+1】批量预查询所有需要 shopDomain 的订单
          let shopDomainMap = new Map<string, string>();
          if (!shopDomain) {
            const orderIds = batch.map(order => order.id);
            const existingOrders = await tx.order.findMany({
              where: { id: { in: orderIds } },
              select: { id: true, shopDomain: true },
            });
            shopDomainMap = new Map(existingOrders.map(o => [o.id, o.shopDomain]));
          }

          for (const order of batch) {
            const prismaAiSource = toPrismaAiSource(order.aiSource);
            
            // 获取 shopDomain：优先使用传入的，否则从预查询结果获取
            const effectiveShopDomain = shopDomain || shopDomainMap.get(order.id) || '';
            
            if (!effectiveShopDomain) {
              logger.warn('[orders.repository] Skipping order without shopDomain', { orderId: order.id });
              continue;
            }

            // 验证 signals 是否为有效的 JSON 数组
            const validatedSignals = Array.isArray(order.signals) ? order.signals : [];

            await tx.order.upsert({
              where: { id: order.id },
              update: {
                name: order.name,
                totalPrice: roundMoney(order.totalPrice),
                currency: order.currency,
                subtotalPrice: order.subtotalPrice === undefined ? undefined : roundMoney(order.subtotalPrice),
                refundTotal: order.refundTotal === undefined ? undefined : roundMoney(order.refundTotal),
                aiSource: prismaAiSource,
                detection: order.detection,
                detectionSignals: validatedSignals as Prisma.InputJsonValue,
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
                shopDomain: effectiveShopDomain,
                name: order.name,
                createdAt: new Date(order.createdAt),
                totalPrice: roundMoney(order.totalPrice),
                currency: order.currency,
                subtotalPrice: order.subtotalPrice === undefined ? undefined : roundMoney(order.subtotalPrice),
                refundTotal: order.refundTotal === undefined ? undefined : roundMoney(order.refundTotal),
                aiSource: prismaAiSource,
                detection: order.detection,
                detectionSignals: validatedSignals as Prisma.InputJsonValue,
                referrer: order.referrer,
                landingPage: order.landingPage,
                utmSource: order.utmSource,
                utmMedium: order.utmMedium,
                sourceName: order.sourceName,
                customerId: order.customerId,
                isNewCustomer: order.isNewCustomer,
              },
            });

            // 【修复一致性】产品处理：无论是否有产品都先删除旧的
            await tx.orderProduct.deleteMany({ where: { orderId: order.id } });
            
            // 如果有新产品则创建
            if (order.products && order.products.length > 0) {
              await tx.orderProduct.createMany({
                data: order.products.map((p) => ({
                  orderId: order.id,
                  productId: p.id,
                  title: p.title,
                  handle: p.handle,
                  url: p.url,
                  price: roundMoney(p.price),
                  currency: p.currency,
                  quantity: p.quantity,
                })),
              });
            }
            
            successCount++;
          }
        }, {
          timeout: 30000, // 30 秒超时
        });
      }

      recordDbMetrics('upsertMany', 'Order', Date.now() - startTime, true);
      metrics.increment('orders.upserted', successCount);

      logger.info('[orders.repository] Batch upsert completed', {
        total: orders.length,
        success: successCount,
        batches: Math.ceil(orders.length / BATCH_SIZE),
        durationMs: Date.now() - startTime,
      });

      return successCount;
    } catch (error) {
      recordDbMetrics('upsertMany', 'Order', Date.now() - startTime, false);
      logger.error('[orders.repository] Batch upsert failed', { 
        total: orders.length, 
        success: successCount 
      }, { error });
      throw error;
    }
  }

  /**
   * 创建或更新单个订单
   * @param order - 订单记录
   * @param shopDomain - 店铺域名（创建时必须）
   * @throws Error 如果 shopDomain 无法确定
   */
  async upsert(order: OrderRecord, shopDomain?: string): Promise<void> {
    const startTime = Date.now();

    try {
      // 先 upsert Order
      const prismaAiSource = toPrismaAiSource(order.aiSource);

      // 尝试获取现有订单的 shopDomain
      let effectiveShopDomain = shopDomain;
      if (!effectiveShopDomain) {
        const existing = await prisma.order.findUnique({
          where: { id: order.id },
          select: { shopDomain: true },
        });
        effectiveShopDomain = existing?.shopDomain || '';
      }

      // 如果仍然没有 shopDomain，抛出验证错误而不是创建无效记录
      if (!effectiveShopDomain) {
        logger.error('[orders.repository] shopDomain validation failed', { orderId: order.id });
        throw new ValidationError(
          'shopDomain is required but not provided and order does not exist',
          'shopDomain',
          order.id
        );
      }

      // 验证 signals 是否为有效的 JSON 数组
      const validatedSignals = Array.isArray(order.signals) ? order.signals : [];

      // 使用事务确保订单和产品更新的原子性
      await prisma.$transaction(async (tx) => {
        await tx.order.upsert({
          where: { id: order.id },
          update: {
            name: order.name,
            totalPrice: roundMoney(order.totalPrice),
            currency: order.currency,
            subtotalPrice: order.subtotalPrice === undefined ? undefined : roundMoney(order.subtotalPrice),
            refundTotal: order.refundTotal === undefined ? undefined : roundMoney(order.refundTotal),
            aiSource: prismaAiSource,
            detection: order.detection,
            detectionSignals: validatedSignals as Prisma.InputJsonValue,
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
            shopDomain: effectiveShopDomain,
            name: order.name,
            createdAt: new Date(order.createdAt),
            totalPrice: roundMoney(order.totalPrice),
            currency: order.currency,
            subtotalPrice: order.subtotalPrice === undefined ? undefined : roundMoney(order.subtotalPrice),
            refundTotal: order.refundTotal === undefined ? undefined : roundMoney(order.refundTotal),
            aiSource: prismaAiSource,
            detection: order.detection,
            detectionSignals: validatedSignals as Prisma.InputJsonValue,
            referrer: order.referrer,
            landingPage: order.landingPage,
            utmSource: order.utmSource,
            utmMedium: order.utmMedium,
            sourceName: order.sourceName,
            customerId: order.customerId,
            isNewCustomer: order.isNewCustomer,
          },
        });

        // 处理 OrderProducts（在同一事务内）
        // 始终先删除旧产品，保持与 upsertMany 的一致性
        await tx.orderProduct.deleteMany({
          where: { orderId: order.id },
        });

        // 如果有新产品则创建
        if (order.products && order.products.length > 0) {
          await tx.orderProduct.createMany({
            data: order.products.map((p) => ({
              orderId: order.id,
              productId: p.id,
              title: p.title,
              handle: p.handle,
              url: p.url,
              price: roundMoney(p.price),
              currency: p.currency,
              quantity: p.quantity,
            })),
          });
        }
      });

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
      logger.error('[orders.repository] getLastOrderAt failed', { shopDomain }, { error });
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

      logger.info('[orders.repository] Deleted old orders', {
        shopDomain,
        count: result.count,
        beforeDate: beforeDate.toISOString(),
      });

      return result.count;
    } catch (error) {
      recordDbMetrics('deleteOlderThan', 'Order', Date.now() - startTime, false);
      logger.error('[orders.repository] deleteOlderThan failed', { shopDomain, beforeDate }, { error });
      throw new DatabaseError('Failed to delete old orders', { 
        shopDomain, 
        beforeDate: beforeDate.toISOString() 
      });
    }
  }

  /**
   * 将数据库记录映射到 OrderRecord
   * 【优化】委托给共享的 mapper 函数，保持一致性
   */
  private mapToOrderRecord(order: OrderWithProducts): OrderRecord {
    return mapOrderToRecord(order, {
      includeProducts: true,
      subtotalFallback: "undefined", // 保持原有行为
    });
  }
}

// 导出单例实例
export const ordersRepository = new OrdersRepository();

