/**
 * Dashboard Service 测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { dashboardService } from '~/lib/services/dashboard.service';
import type { DateRange } from '~/lib/aiTypes';

// Mock dependencies
vi.mock('~/lib/repositories/orders.repository', () => ({
  ordersRepository: {
    findByShopAndDateRange: vi.fn(),
    getAggregateStats: vi.fn(),
  },
}));

vi.mock('~/lib/settings.enhanced.server', () => ({
  getSettings: vi.fn(),
}));

vi.mock('~/lib/cache.enhanced', () => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    deletePattern: vi.fn(),
  },
  CacheKeys: {
    dashboard: (shop: string, range: string) => `dashboard:${shop}:${range}`,
  },
  CacheTTL: {
    MEDIUM: 300000,
  },
}));

describe('DashboardService', () => {
  const mockShopDomain = 'test-shop.myshopify.com';
  const mockRange: DateRange = {
    key: '30d',
    label: '最近 30 天',
    start: new Date('2025-11-03'),
    end: new Date('2025-12-03'),
    days: 30,
    fromParam: '2025-11-03',
    toParam: '2025-12-03',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDashboardData', () => {
    it('should return cached data when available', async () => {
      const { cache } = await import('~/lib/cache.enhanced');
      const mockCachedData = {
        overview: {
          totalGMV: 10000,
          netGMV: 9500,
          aiGMV: 2000,
          netAiGMV: 1900,
          aiShare: 0.2,
          aiOrders: 50,
          aiOrderShare: 0.15,
          totalOrders: 300,
          aiNewCustomers: 30,
          aiNewCustomerRate: 0.6,
          totalNewCustomers: 150,
          lastSyncedAt: '2025-12-03T00:00:00Z',
          currency: 'USD',
        },
        channels: [],
        comparison: [],
        trend: [],
        topProducts: [],
        topCustomers: [],
        recentOrders: [],
        sampleNote: null,
        exports: {
          ordersCsv: '',
          productsCsv: '',
          customersCsv: '',
        },
      };

      vi.mocked(cache.get).mockReturnValue(mockCachedData);

      const result = await dashboardService.getDashboardData(mockShopDomain, mockRange);

      expect(result).toEqual(mockCachedData);
      expect(cache.get).toHaveBeenCalledWith(`dashboard:${mockShopDomain}:30d`);
    });

    it('should fetch and cache data when not in cache', async () => {
      const { cache } = await import('~/lib/cache.enhanced');
      const { ordersRepository } = await import('~/lib/repositories/orders.repository');
      const { getSettings } = await import('~/lib/settings.enhanced.server');

      const mockOrders = [
        {
          id: 'gid://shopify/Order/1',
          shopDomain: mockShopDomain,
          name: '#1001',
          createdAt: '2025-11-15T10:00:00Z',
          totalPrice: 100,
          currency: 'USD',
          subtotalPrice: 95,
          refundTotal: 0,
          aiSource: 'ChatGPT' as const,
          customerId: 'customer1',
          isNewCustomer: true,
          products: [],
          tags: [],
        },
      ];

      const mockSettings = {
        primaryCurrency: 'USD',
        gmvMetric: 'current_total_price' as const,
        aiDomains: [],
        utmSources: [],
        utmMediumKeywords: [],
        tagging: {
          orderTagPrefix: 'AI-Source',
          customerTag: 'AI-Customer',
          writeOrderTags: false,
          writeCustomerTags: false,
          dryRun: true,
        },
        exposurePreferences: {
          exposeProducts: false,
          exposeCollections: false,
          exposeBlogs: false,
        },
        retentionMonths: 6,
        languages: ['中文', 'English'],
        timezones: ['UTC'],
        pipelineStatuses: [],
      };

      vi.mocked(cache.get).mockReturnValue(null);
      vi.mocked(ordersRepository.findByShopAndDateRange).mockResolvedValue(mockOrders);
      vi.mocked(getSettings).mockResolvedValue(mockSettings);

      const result = await dashboardService.getDashboardData(mockShopDomain, mockRange);

      expect(result).toBeDefined();
      expect(result.overview).toBeDefined();
      expect(cache.set).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const { cache } = await import('~/lib/cache.enhanced');
      const { ordersRepository } = await import('~/lib/repositories/orders.repository');

      vi.mocked(cache.get).mockReturnValue(null);
      vi.mocked(ordersRepository.findByShopAndDateRange).mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(
        dashboardService.getDashboardData(mockShopDomain, mockRange)
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('getOverview', () => {
    it('should return overview data', async () => {
      const { cache } = await import('~/lib/cache.enhanced');
      
      const mockData = {
        overview: {
          totalGMV: 10000,
          netGMV: 9500,
          aiGMV: 2000,
          netAiGMV: 1900,
          aiShare: 0.2,
          aiOrders: 50,
          aiOrderShare: 0.15,
          totalOrders: 300,
          aiNewCustomers: 30,
          aiNewCustomerRate: 0.6,
          totalNewCustomers: 150,
          lastSyncedAt: '2025-12-03T00:00:00Z',
          currency: 'USD',
        },
        channels: [],
        comparison: [],
        trend: [],
        topProducts: [],
        topCustomers: [],
        recentOrders: [],
        sampleNote: null,
        exports: { ordersCsv: '', productsCsv: '', customersCsv: '' },
      };

      vi.mocked(cache.get).mockReturnValue(mockData);

      const result = await dashboardService.getOverview(mockShopDomain, mockRange);

      expect(result).toEqual(mockData.overview);
    });
  });

  describe('clearCache', () => {
    it('should clear cache for specific range', () => {
      const { cache } = await import('~/lib/cache.enhanced');

      dashboardService.clearCache(mockShopDomain, '30d');

      expect(cache.delete).toHaveBeenCalledWith(`dashboard:${mockShopDomain}:30d`);
    });

    it('should clear all dashboard caches when no range specified', () => {
      const { cache } = await import('~/lib/cache.enhanced');
      vi.mocked(cache.deletePattern).mockReturnValue(3);

      dashboardService.clearCache(mockShopDomain);

      expect(cache.deletePattern).toHaveBeenCalledWith(`dashboard:${mockShopDomain}:*`);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status with orders', async () => {
      const { ordersRepository } = await import('~/lib/repositories/orders.repository');
      const { getSettings } = await import('~/lib/settings.enhanced.server');

      vi.mocked(ordersRepository.getAggregateStats).mockResolvedValue({
        total: { gmv: 10000, orders: 300, newCustomers: 150 },
        ai: { gmv: 2000, orders: 50, newCustomers: 30 },
      });

      vi.mocked(getSettings).mockResolvedValue({
        primaryCurrency: 'USD',
        gmvMetric: 'current_total_price' as const,
        aiDomains: [{ domain: 'chat.openai.com', channel: 'ChatGPT' as const, source: 'default' as const }],
        utmSources: [],
        utmMediumKeywords: [],
        tagging: {
          orderTagPrefix: 'AI-Source',
          customerTag: 'AI-Customer',
          writeOrderTags: false,
          writeCustomerTags: false,
          dryRun: true,
        },
        exposurePreferences: {
          exposeProducts: false,
          exposeCollections: false,
          exposeBlogs: false,
        },
        retentionMonths: 6,
        languages: ['中文'],
        timezones: ['UTC'],
        pipelineStatuses: [],
      });

      const result = await dashboardService.getHealthStatus(mockShopDomain);

      expect(result.healthy).toBe(true);
      expect(result.ordersCount).toBe(300);
      expect(result.aiOrdersCount).toBe(50);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect issues when no orders', async () => {
      const { ordersRepository } = await import('~/lib/repositories/orders.repository');
      const { getSettings } = await import('~/lib/settings.enhanced.server');

      vi.mocked(ordersRepository.getAggregateStats).mockResolvedValue({
        total: { gmv: 0, orders: 0, newCustomers: 0 },
        ai: { gmv: 0, orders: 0, newCustomers: 0 },
      });

      vi.mocked(getSettings).mockResolvedValue({
        primaryCurrency: 'USD',
        gmvMetric: 'current_total_price' as const,
        aiDomains: [],
        utmSources: [],
        utmMediumKeywords: [],
        tagging: {
          orderTagPrefix: 'AI-Source',
          customerTag: 'AI-Customer',
          writeOrderTags: false,
          writeCustomerTags: false,
          dryRun: true,
        },
        exposurePreferences: {
          exposeProducts: false,
          exposeCollections: false,
          exposeBlogs: false,
        },
        retentionMonths: 6,
        languages: ['中文'],
        timezones: ['UTC'],
        pipelineStatuses: [],
      });

      const result = await dashboardService.getHealthStatus(mockShopDomain);

      expect(result.healthy).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues).toContain('No orders in the last 30 days');
      expect(result.issues).toContain('AI domain rules not configured');
    });
  });
});

