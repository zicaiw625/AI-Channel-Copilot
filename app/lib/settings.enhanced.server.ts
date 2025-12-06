/**
 * 增强的设置服务
 * 集成缓存、验证和性能优化
 */

import prisma from '../db.server';
import { defaultSettings, type SettingsDefaults } from './aiData';
import { cache, CacheKeys, CacheTTL } from './cache';
import { metrics, MetricNames } from './metrics/collector';
import { logger } from './logger.server';
import { buildSettingsUpdatePayload, mapRecordToSettings as mapRecordToSettingsUtil } from './settings/utils';
import { SettingsUpdateSchema } from './validation/schemas';
import type { SettingsUpdate } from './validation/schemas';

/**
 * 获取商店设置 (带缓存)
 */
export async function getSettings(
  shopDomain: string,
  useCache = true
): Promise<SettingsDefaults> {
  if (!shopDomain) {
    logger.warn('[Settings] Missing shopDomain, returning defaults');
    return defaultSettings;
  }

  // 尝试从缓存获取
  if (useCache) {
    const cacheKey = CacheKeys.settings(shopDomain);
    const cached = cache.get<SettingsDefaults>(cacheKey);
    
    if (cached) {
      metrics.increment(MetricNames.CACHE_HIT, 1, { type: 'settings' });
      return cached;
    }
    
    metrics.increment(MetricNames.CACHE_MISS, 1, { type: 'settings' });
  }

  // 从数据库加载
  const timer = metrics.startTimer('settings.load', { shopDomain });
  
  try {
    const record = await prisma.shopSettings.findUnique({
      where: {
        shopDomain_platform: {
          shopDomain,
          platform: 'shopify',
        },
      },
    });

    const settings = mapRecordToSettingsUtil(record) || defaultSettings;
    
    // 写入缓存
    if (useCache) {
      const cacheKey = CacheKeys.settings(shopDomain);
      cache.set(cacheKey, settings, CacheTTL.LONG);
    }

    metrics.endTimer(timer);
    return settings;
  } catch (error) {
    metrics.endTimer(timer);
    metrics.increment('settings.load.error', 1);
    
    logger.error('[Settings] Failed to load', { shopDomain }, { error });
    return defaultSettings;
  }
}

/**
 * 更新商店设置
 */
export async function updateSettings(
  shopDomain: string,
  updates: SettingsUpdate
): Promise<SettingsDefaults> {
  if (!shopDomain) {
    throw new Error('shopDomain is required');
  }

  // 验证输入
  const validated = SettingsUpdateSchema.parse(updates);
  const { updateData, createData } = buildSettingsUpdatePayload(validated);

  const timer = metrics.startTimer('settings.update', { shopDomain });

  try {
    // Upsert 到数据库
    const record = await prisma.shopSettings.upsert({
      where: {
        shopDomain_platform: {
          shopDomain,
          platform: 'shopify',
        },
      },
      update: updateData,
      create: {
        shopDomain,
        platform: 'shopify',
        ...createData,
      },
    });

    const settings = mapRecordToSettingsUtil(record);

    // 清除缓存
    const cacheKey = CacheKeys.settings(shopDomain);
    cache.delete(cacheKey);
    
    // 清除相关的 dashboard 缓存
    cache.deletePattern(`dashboard:${shopDomain}:*`);

    metrics.endTimer(timer);
    logger.info('[Settings] Updated successfully', { shopDomain });

    return settings;
  } catch (error) {
    metrics.endTimer(timer);
    metrics.increment('settings.update.error', 1);
    
    logger.error('[Settings] Failed to update', { shopDomain }, { error });
    throw error;
  }
}

/**
 * 初始化商店设置
 */
export async function initializeSettings(
  shopDomain: string
): Promise<SettingsDefaults> {
  const timer = metrics.startTimer('settings.initialize', { shopDomain });

  try {
    const existing = await prisma.shopSettings.findUnique({
      where: {
        shopDomain_platform: {
          shopDomain,
          platform: 'shopify',
        },
      },
    });

    if (existing) {
      metrics.endTimer(timer);
      return mapRecordToSettingsUtil(existing);
    }

    // 创建默认设置
    const record = await prisma.shopSettings.create({
      data: {
        shopDomain,
        platform: 'shopify',
        primaryCurrency: defaultSettings.primaryCurrency,
        aiDomains: defaultSettings.aiDomains,
        utmSources: defaultSettings.utmSources,
        utmMediumKeywords: defaultSettings.utmMediumKeywords,
        orderTagPrefix: defaultSettings.tagging.orderTagPrefix,
        customerTag: defaultSettings.tagging.customerTag,
        writeOrderTags: defaultSettings.tagging.writeOrderTags,
        writeCustomerTags: defaultSettings.tagging.writeCustomerTags,
        taggingDryRun: defaultSettings.tagging.dryRun,
        language: defaultSettings.languages[0],
        timezone: defaultSettings.timezones[0],
        gmvMetric: defaultSettings.gmvMetric,
        retentionMonths: defaultSettings.retentionMonths,
        aiExposurePreferences: defaultSettings.exposurePreferences,
        pipelineStatuses: defaultSettings.pipelineStatuses,
      },
    });

    metrics.endTimer(timer);
    logger.info('[Settings] Initialized with defaults', { shopDomain });

    return mapRecordToSettingsUtil(record);
  } catch (error) {
    metrics.endTimer(timer);
    metrics.increment('settings.initialize.error', 1);
    
    logger.error('[Settings] Failed to initialize', { shopDomain }, { error });
    throw error;
  }
}

/**
 * 清除设置缓存
 */
export function clearSettingsCache(shopDomain: string): void {
  const cacheKey = CacheKeys.settings(shopDomain);
  cache.delete(cacheKey);
  logger.debug('[Settings] Cache cleared', { shopDomain });
}

/**
 * 批量获取设置
 */
export async function batchGetSettings(
  shopDomains: string[]
): Promise<Map<string, SettingsDefaults>> {
  const timer = metrics.startTimer('settings.batch_load', {
    count: shopDomains.length
  });

  const results = new Map<string, SettingsDefaults>();

  try {
    // 先从缓存获取
    const uncached: string[] = [];
    
    for (const shopDomain of shopDomains) {
      const cacheKey = CacheKeys.settings(shopDomain);
      const cached = cache.get<SettingsDefaults>(cacheKey);
      
      if (cached) {
        results.set(shopDomain, cached);
        metrics.increment(MetricNames.CACHE_HIT, 1, { type: 'settings' });
      } else {
        uncached.push(shopDomain);
        metrics.increment(MetricNames.CACHE_MISS, 1, { type: 'settings' });
      }
    }

    // 批量查询未缓存的
    if (uncached.length > 0) {
      const records = await prisma.shopSettings.findMany({
        where: {
          shopDomain: { in: uncached },
          platform: 'shopify',
        },
      });

      const recordMap = new Map(
        records.map(r => [r.shopDomain, mapRecordToSettingsUtil(r)])
      );

      for (const shopDomain of uncached) {
        const settings = recordMap.get(shopDomain) || defaultSettings;
        results.set(shopDomain, settings);
        
        // 写入缓存
        const cacheKey = CacheKeys.settings(shopDomain);
        cache.set(cacheKey, settings, CacheTTL.LONG);
      }
    }

    metrics.endTimer(timer);
    return results;
  } catch (error) {
    metrics.endTimer(timer);
    metrics.increment('settings.batch_load.error', 1);
    
    logger.error('[Settings] Batch load failed', { count: shopDomains.length }, { error });
    
    // Fallback: 返回默认设置
    for (const shopDomain of shopDomains) {
      if (!results.has(shopDomain)) {
        results.set(shopDomain, defaultSettings);
      }
    }
    
    return results;
  }
}

// mapRecordToSettings 已从 settings/utils 导入为 mapRecordToSettingsUtil

/**
 * 验证设置完整性
 */
export async function validateSettings(
  shopDomain: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    const settings = await getSettings(shopDomain, false);

    // 验证货币代码
    if (settings.primaryCurrency && !/^[A-Z]{3}$/.test(settings.primaryCurrency)) {
      errors.push(`Invalid currency code: ${settings.primaryCurrency}`);
    }

    // 验证 AI 域名规则
    if (!Array.isArray(settings.aiDomains) || settings.aiDomains.length === 0) {
      errors.push('AI domains must be a non-empty array');
    }

    // 验证 UTM 源规则
    if (!Array.isArray(settings.utmSources) || settings.utmSources.length === 0) {
      errors.push('UTM sources must be a non-empty array');
    }

    // 验证保留期限
    const retentionMonths = settings.retentionMonths ?? 6;
    if (retentionMonths < 1 || retentionMonths > 24) {
      errors.push('Retention months must be between 1 and 24');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
    return { valid: false, errors };
  }
}

