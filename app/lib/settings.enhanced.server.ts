/**
 * 增强的设置服务
 * 集成缓存、验证和性能优化
 */

import prisma from '../db.server';
import { cache, CacheKeys, CacheTTL } from './cache.enhanced';
import { metrics, MetricNames } from './metrics/collector';
import { logger } from './logger.server';
import { defaultSettings, type SettingsDefaults } from './aiData';
import type { SettingsUpdate } from './validation/schemas';
import { SettingsUpdateSchema } from './validation/schemas';

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

    const settings = record ? mapRecordToSettings(record) : defaultSettings;
    
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

  const timer = metrics.startTimer('settings.update', { shopDomain });

  try {
    // 准备更新数据
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (validated.primaryCurrency) {
      updateData.primaryCurrency = validated.primaryCurrency;
    }

    if (validated.aiDomains) {
      updateData.aiDomains = validated.aiDomains;
    }

    if (validated.utmSources) {
      updateData.utmSources = validated.utmSources;
    }

    if (validated.utmMediumKeywords) {
      updateData.utmMediumKeywords = validated.utmMediumKeywords;
    }

    if (validated.gmvMetric) {
      updateData.gmvMetric = validated.gmvMetric;
    }

    if (validated.language) {
      updateData.language = validated.language;
    }

    if (validated.timezone) {
      updateData.timezone = validated.timezone;
    }

    if (validated.retentionMonths !== undefined) {
      updateData.retentionMonths = validated.retentionMonths;
    }

    if (validated.tagging) {
      updateData.orderTagPrefix = validated.tagging.orderTagPrefix;
      updateData.customerTag = validated.tagging.customerTag;
      updateData.writeOrderTags = validated.tagging.writeOrderTags;
      updateData.writeCustomerTags = validated.tagging.writeCustomerTags;
      updateData.taggingDryRun = validated.tagging.dryRun;
    }

    if (validated.exposurePreferences) {
      updateData.aiExposurePreferences = validated.exposurePreferences;
    }

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
        ...updateData,
        // 使用默认值填充缺失字段
        primaryCurrency: updateData.primaryCurrency || defaultSettings.primaryCurrency,
        aiDomains: updateData.aiDomains || defaultSettings.aiDomains,
        utmSources: updateData.utmSources || defaultSettings.utmSources,
        utmMediumKeywords: updateData.utmMediumKeywords || defaultSettings.utmMediumKeywords,
        orderTagPrefix: updateData.orderTagPrefix || defaultSettings.tagging.orderTagPrefix,
        customerTag: updateData.customerTag || defaultSettings.tagging.customerTag,
        writeOrderTags: updateData.writeOrderTags ?? defaultSettings.tagging.writeOrderTags,
        writeCustomerTags: updateData.writeCustomerTags ?? defaultSettings.tagging.writeCustomerTags,
        taggingDryRun: updateData.taggingDryRun ?? defaultSettings.tagging.dryRun,
        language: updateData.language || defaultSettings.languages[0],
        timezone: updateData.timezone || defaultSettings.timezones[0],
        gmvMetric: updateData.gmvMetric || defaultSettings.gmvMetric,
        retentionMonths: updateData.retentionMonths ?? defaultSettings.retentionMonths,
      },
    });

    const settings = mapRecordToSettings(record);

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
      return mapRecordToSettings(existing);
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

    return mapRecordToSettings(record);
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
        records.map(r => [r.shopDomain, mapRecordToSettings(r)])
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

/**
 * 将数据库记录映射到设置对象
 */
function mapRecordToSettings(record: any): SettingsDefaults {
  return {
    primaryCurrency: record.primaryCurrency || defaultSettings.primaryCurrency,
    aiDomains: Array.isArray(record.aiDomains) 
      ? record.aiDomains 
      : defaultSettings.aiDomains,
    utmSources: Array.isArray(record.utmSources)
      ? record.utmSources
      : defaultSettings.utmSources,
    utmMediumKeywords: Array.isArray(record.utmMediumKeywords)
      ? record.utmMediumKeywords
      : defaultSettings.utmMediumKeywords,
    gmvMetric: record.gmvMetric || defaultSettings.gmvMetric,
    tagging: {
      orderTagPrefix: record.orderTagPrefix || defaultSettings.tagging.orderTagPrefix,
      customerTag: record.customerTag || defaultSettings.tagging.customerTag,
      writeOrderTags: record.writeOrderTags ?? defaultSettings.tagging.writeOrderTags,
      writeCustomerTags: record.writeCustomerTags ?? defaultSettings.tagging.writeCustomerTags,
      dryRun: record.taggingDryRun ?? defaultSettings.tagging.dryRun,
    },
    exposurePreferences: typeof record.aiExposurePreferences === 'object'
      ? record.aiExposurePreferences
      : defaultSettings.exposurePreferences,
    retentionMonths: record.retentionMonths ?? defaultSettings.retentionMonths,
    languages: [record.language || defaultSettings.languages[0], ...defaultSettings.languages.slice(1)],
    timezones: [record.timezone || defaultSettings.timezones[0], ...defaultSettings.timezones.slice(1)],
    pipelineStatuses: Array.isArray(record.pipelineStatuses)
      ? record.pipelineStatuses
      : defaultSettings.pipelineStatuses,
  };
}

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
    if (!/^[A-Z]{3}$/.test(settings.primaryCurrency)) {
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
    if (settings.retentionMonths < 1 || settings.retentionMonths > 24) {
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

