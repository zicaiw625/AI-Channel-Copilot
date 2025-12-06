/**
 * Dashboard Service
 * 业务逻辑层 - 处理仪表盘数据的获取和聚合
 */

import { ordersRepository } from '../repositories/orders.repository';
import { getSettings } from '../settings.enhanced.server';
import { cache, CacheKeys, CacheTTL } from '../cache.enhanced';
import { metrics, withMetrics } from '../metrics/collector';
import { logger } from '../logger.server';
import { buildDashboardFromOrders } from '../aiData';
import type { DashboardData, DateRange } from '../aiTypes';

export class DashboardService {
  /**
   * 获取仪表盘数据
   */
  async getDashboardData(
    shopDomain: string,
    range: DateRange,
    options: {
      useCache?: boolean;
      timezone?: string;
    } = {}
  ): Promise<DashboardData> {
    const { useCache = true, timezone } = options;

    return withMetrics(
      'dashboard.get_data',
      async () => {
        // 尝试从缓存获取
        if (useCache) {
          const cacheKey = CacheKeys.dashboard(shopDomain, range.key);
          const cached = cache.get<DashboardData>(cacheKey);

          if (cached) {
            metrics.increment('dashboard.cache_hit', 1, { shopDomain });
            logger.debug('[DashboardService] Cache hit', { shopDomain, range: range.key });
            return cached;
          }

          metrics.increment('dashboard.cache_miss', 1, { shopDomain });
        }

        // 加载设置和订单数据
        const [settings, orders] = await Promise.all([
          getSettings(shopDomain),
          ordersRepository.findByShopAndDateRange(shopDomain, range, {
            includeProducts: true,
            currency: undefined, // 加载所有货币，在聚合时过滤
          }),
        ]);

        logger.info('[DashboardService] Data loaded', {
          shopDomain,
          ordersCount: orders.length,
          range: range.key,
        });

        // 构建仪表盘数据
        const dashboardData = buildDashboardFromOrders(
          orders,
          range,
          settings.gmvMetric,
          timezone,
          settings.primaryCurrency
        );

        // 写入缓存
        if (useCache) {
          const cacheKey = CacheKeys.dashboard(shopDomain, range.key);
          cache.set(cacheKey, dashboardData, CacheTTL.MEDIUM);
        }

        return dashboardData;
      },
      { shopDomain, range: range.key }
    );
  }

  /**
   * 获取仪表盘概览
   */
  async getOverview(
    shopDomain: string,
    range: DateRange,
    options?: { useCache?: boolean; timezone?: string }
  ) {
    const data = await this.getDashboardData(shopDomain, range, options);
    return data.overview;
  }

  /**
   * 获取渠道对比数据
   */
  async getChannelComparison(
    shopDomain: string,
    range: DateRange,
    options?: { useCache?: boolean; timezone?: string }
  ) {
    const data = await this.getDashboardData(shopDomain, range, options);
    return data.comparison;
  }

  /**
   * 获取趋势数据
   */
  async getTrend(
    shopDomain: string,
    range: DateRange,
    options?: { useCache?: boolean; timezone?: string }
  ) {
    const data = await this.getDashboardData(shopDomain, range, options);
    return data.trend;
  }

  /**
   * 获取热门产品
   */
  async getTopProducts(
    shopDomain: string,
    range: DateRange,
    options?: { useCache?: boolean; timezone?: string }
  ) {
    const data = await this.getDashboardData(shopDomain, range, options);
    return data.topProducts;
  }

  /**
   * 获取热门客户
   */
  async getTopCustomers(
    shopDomain: string,
    range: DateRange,
    options?: { useCache?: boolean; timezone?: string }
  ) {
    const data = await this.getDashboardData(shopDomain, range, options);
    return data.topCustomers;
  }

  /**
   * 获取最近订单
   */
  async getRecentOrders(
    shopDomain: string,
    range: DateRange,
    options?: { useCache?: boolean; timezone?: string }
  ) {
    const data = await this.getDashboardData(shopDomain, range, options);
    return data.recentOrders;
  }

  /**
   * 清除仪表盘缓存
   */
  clearCache(shopDomain: string, range?: string): void {
    if (range) {
      const cacheKey = CacheKeys.dashboard(shopDomain, range);
      cache.delete(cacheKey);
      logger.debug('[DashboardService] Cache cleared', { shopDomain, range });
    } else {
      // 清除该店铺的所有仪表盘缓存
      const deleted = cache.deletePattern(`dashboard:${shopDomain}:*`);
      logger.debug('[DashboardService] All caches cleared', { shopDomain, deleted });
    }
  }

  /**
   * 预热缓存 (为常用时间范围预加载数据)
   */
  async warmupCache(shopDomain: string, timezone?: string): Promise<void> {
    const ranges: Array<'7d' | '30d' | '90d'> = ['7d', '30d', '90d'];
    
    logger.info('[DashboardService] Starting cache warmup', { shopDomain });

    const { resolveDateRange } = await import('../aiData');

    await Promise.allSettled(
      ranges.map(async (rangeKey) => {
        try {
          const range = resolveDateRange(rangeKey, new Date(), null, null, timezone);
          await this.getDashboardData(shopDomain, range, { useCache: false, timezone });
          logger.debug('[DashboardService] Warmup completed for range', { shopDomain, rangeKey });
        } catch (error) {
          logger.warn('[DashboardService] Warmup failed for range', { shopDomain, rangeKey }, { error });
        }
      })
    );

    logger.info('[DashboardService] Cache warmup completed', { shopDomain });
  }

  /**
   * 获取仪表盘健康状态
   */
  async getHealthStatus(shopDomain: string): Promise<{
    healthy: boolean;
    ordersCount: number;
    aiOrdersCount: number;
    lastOrderAt: Date | null;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      const { resolveDateRange } = await import('../aiData');
      const range = resolveDateRange('30d');

      const [settings, stats] = await Promise.all([
        getSettings(shopDomain),
        ordersRepository.getAggregateStats(shopDomain, range),
      ]);

      // 检查订单量
      if (stats.total.orders === 0) {
        issues.push('No orders in the last 30 days');
      }

      // 检查 AI 订单检测
      if (stats.total.orders > 0 && stats.ai.orders === 0) {
        issues.push('No AI orders detected in the last 30 days');
      }

      // 检查设置完整性
      if (!settings.aiDomains || settings.aiDomains.length === 0) {
        issues.push('AI domain rules not configured');
      }

      const healthy = issues.length === 0;

      return {
        healthy,
        ordersCount: stats.total.orders,
        aiOrdersCount: stats.ai.orders,
        lastOrderAt: null, // TODO: 实现最后订单时间查询
        issues,
      };
    } catch (error) {
      logger.error('[DashboardService] Health check failed', { shopDomain }, { error });
      return {
        healthy: false,
        ordersCount: 0,
        aiOrdersCount: 0,
        lastOrderAt: null,
        issues: ['Health check failed: ' + (error instanceof Error ? error.message : String(error))],
      };
    }
  }

  /**
   * 批量获取多个店铺的仪表盘数据
   */
  async batchGetDashboardData(
    requests: Array<{ shopDomain: string; range: DateRange; timezone?: string }>
  ): Promise<Map<string, DashboardData>> {
    const results = new Map<string, DashboardData>();

    await Promise.allSettled(
      requests.map(async ({ shopDomain, range, timezone }) => {
        try {
          const data = await this.getDashboardData(shopDomain, range, { timezone });
          results.set(shopDomain, data);
        } catch (error) {
          logger.error('[DashboardService] Batch load failed for shop', { shopDomain }, { error });
        }
      })
    );

    return results;
  }
}

// 导出单例实例
export const dashboardService = new DashboardService();

