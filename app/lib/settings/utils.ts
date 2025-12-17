import type { ShopSettings } from "@prisma/client";

import { defaultSettings, type SettingsDefaults, type PipelineStatus, type AiDomainRule, type UtmSourceRule } from "../aiData";
import type { SettingsUpdate } from "../validation/schemas";

const MIN_RETENTION_MONTHS = 1;
const MAX_RETENTION_MONTHS = 24;

/**
 * 问题 6 修复：增强日期字符串验证
 * 安全地将值转换为 ISO 字符串，处理各种边界情况
 */
const toISOStringOrNull = (value?: Date | string | null): string | null => {
  if (!value) return null;
  
  // 如果是 Date 对象，直接转换
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  
  // 如果是字符串，进行额外验证
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // 空字符串或纯空白字符串返回 null
    if (!trimmed) return null;
    
    // 尝试解析日期
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    
    // 额外验证：确保解析后的年份在合理范围内（1970-2100）
    const year = date.getFullYear();
    if (year < 1970 || year > 2100) return null;
    
    return date.toISOString();
  }
  
  return null;
};

/**
 * 问题 6 修复：增强日期解析
 * 安全地将值转换为 Date 对象，处理各种边界情况
 */
const toDateOrNull = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  
  // 如果是 Date 对象，验证有效性
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  
  // 如果是字符串，进行额外验证
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    
    // 额外验证：确保年份在合理范围内
    const year = date.getFullYear();
    if (year < 1970 || year > 2100) return null;
    
    return date;
  }
  
  return null;
};

// ============================================================================
// 问题 5 修复：JSON 字段运行时类型验证
// ============================================================================

/**
 * 验证 AiDomainRule 数组
 */
const isValidAiDomainRule = (item: unknown): item is AiDomainRule => {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.domain === 'string' &&
    obj.domain.length > 0 &&
    typeof obj.channel === 'string' &&
    (obj.source === 'default' || obj.source === 'custom')
  );
};

const validateAiDomains = (data: unknown): AiDomainRule[] => {
  if (!Array.isArray(data)) return defaultSettings.aiDomains;
  const valid = data.filter(isValidAiDomainRule);
  return valid.length > 0 ? valid : defaultSettings.aiDomains;
};

/**
 * 验证 UtmSourceRule 数组
 */
const isValidUtmSourceRule = (item: unknown): item is UtmSourceRule => {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.value === 'string' &&
    obj.value.length > 0 &&
    typeof obj.channel === 'string' &&
    (obj.source === 'default' || obj.source === 'custom')
  );
};

const validateUtmSources = (data: unknown): UtmSourceRule[] => {
  if (!Array.isArray(data)) return defaultSettings.utmSources;
  const valid = data.filter(isValidUtmSourceRule);
  return valid.length > 0 ? valid : defaultSettings.utmSources;
};

/**
 * 验证 utmMediumKeywords 字符串数组
 */
const validateUtmMediumKeywords = (data: unknown): string[] => {
  if (!Array.isArray(data)) return defaultSettings.utmMediumKeywords;
  const valid = data.filter((item): item is string => 
    typeof item === 'string' && item.trim().length > 0
  );
  return valid.length > 0 ? valid : defaultSettings.utmMediumKeywords;
};

/**
 * 验证 PipelineStatus 数组
 */
const isValidPipelineStatus = (item: unknown): item is PipelineStatus => {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  const validStatuses = ['healthy', 'warning', 'info'];
  return (
    typeof obj.title === 'string' &&
    typeof obj.status === 'string' &&
    validStatuses.includes(obj.status) &&
    typeof obj.detail === 'string'
  );
};

const validatePipelineStatuses = (data: unknown): PipelineStatus[] => {
  if (!Array.isArray(data)) return defaultSettings.pipelineStatuses;
  const valid = data.filter(isValidPipelineStatus);
  return valid.length > 0 ? valid : defaultSettings.pipelineStatuses;
};

const mergePreferredValue = <T>(preferred: T | null | undefined, defaults: readonly T[]): T[] => {
  const unique = new Set(defaults);
  if (preferred !== undefined && preferred !== null) {
    unique.delete(preferred);
    return [preferred, ...unique];
  }
  return [...unique];
};

export const normalizeRetentionMonths = (
  value: number | null | undefined,
  fallback: number,
  max = MAX_RETENTION_MONTHS,
) => {
  const numeric = typeof value === "number" && !Number.isNaN(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(numeric, MIN_RETENTION_MONTHS), max);
};

const sanitizeExposurePreferences = (preferences: ShopSettings["aiExposurePreferences"]) => ({
  exposeProducts:
    typeof preferences === "object" && preferences && "exposeProducts" in preferences
      ? Boolean((preferences as Record<string, unknown>).exposeProducts)
      : defaultSettings.exposurePreferences.exposeProducts,
  exposeCollections:
    typeof preferences === "object" && preferences && "exposeCollections" in preferences
      ? Boolean((preferences as Record<string, unknown>).exposeCollections)
      : defaultSettings.exposurePreferences.exposeCollections,
  exposeBlogs:
    typeof preferences === "object" && preferences && "exposeBlogs" in preferences
      ? Boolean((preferences as Record<string, unknown>).exposeBlogs)
      : defaultSettings.exposurePreferences.exposeBlogs,
});

/**
 * 将数据库记录映射为设置对象
 * 问题 5 修复：使用运行时类型验证替代不安全的类型断言
 */
export const mapRecordToSettings = (record?: Partial<ShopSettings> | null): SettingsDefaults => {
  if (!record) return defaultSettings;

  return {
    // 问题 5 修复：使用验证函数确保 JSON 字段类型安全
    aiDomains: validateAiDomains(record.aiDomains),
    utmSources: validateUtmSources(record.utmSources),
    utmMediumKeywords: validateUtmMediumKeywords(record.utmMediumKeywords),
    gmvMetric:
      record.gmvMetric === "subtotal_price" ? "subtotal_price" : defaultSettings.gmvMetric,
    primaryCurrency: record.primaryCurrency || defaultSettings.primaryCurrency,
    tagging: {
      orderTagPrefix: record.orderTagPrefix || defaultSettings.tagging.orderTagPrefix,
      customerTag: record.customerTag || defaultSettings.tagging.customerTag,
      writeOrderTags:
        typeof record.writeOrderTags === "boolean"
          ? record.writeOrderTags
          : defaultSettings.tagging.writeOrderTags,
      writeCustomerTags:
        typeof record.writeCustomerTags === "boolean"
          ? record.writeCustomerTags
          : defaultSettings.tagging.writeCustomerTags,
      dryRun:
        typeof record.taggingDryRun === "boolean"
          ? record.taggingDryRun
          : defaultSettings.tagging.dryRun,
    },
    exposurePreferences: sanitizeExposurePreferences(record.aiExposurePreferences ?? null),
    retentionMonths: normalizeRetentionMonths(
      record.retentionMonths,
      defaultSettings.retentionMonths ?? MIN_RETENTION_MONTHS,
    ),
    languages: mergePreferredValue(record.language, defaultSettings.languages),
    timezones: mergePreferredValue(record.timezone, defaultSettings.timezones),
    // 问题 5 修复：使用验证函数
    pipelineStatuses: validatePipelineStatuses(record.pipelineStatuses),
    lastOrdersWebhookAt: toISOStringOrNull(record.lastOrdersWebhookAt),
    lastBackfillAt: toISOStringOrNull(record.lastBackfillAt),
    lastBackfillAttemptAt: toISOStringOrNull((record as any).lastBackfillAttemptAt),
    lastBackfillOrdersFetched: typeof (record as any).lastBackfillOrdersFetched === 'number' 
      ? (record as any).lastBackfillOrdersFetched 
      : null,
    lastTaggingAt: toISOStringOrNull(record.lastTaggingAt),
    lastCleanupAt: toISOStringOrNull(record.lastCleanupAt),
  };
};

const omitUndefined = <T extends Record<string, unknown>>(input: T) =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;

export const buildPersistenceData = (payload: SettingsDefaults) => {
  const primaryCurrency = payload.primaryCurrency || defaultSettings.primaryCurrency || "USD";
  const retentionMonths = normalizeRetentionMonths(
    payload.retentionMonths,
    defaultSettings.retentionMonths ?? MIN_RETENTION_MONTHS,
  );

  const baseData = {
    aiDomains: payload.aiDomains,
    utmSources: payload.utmSources,
    utmMediumKeywords: payload.utmMediumKeywords,
    gmvMetric: payload.gmvMetric,
    primaryCurrency,
    orderTagPrefix: payload.tagging.orderTagPrefix,
    customerTag: payload.tagging.customerTag,
    writeOrderTags: payload.tagging.writeOrderTags,
    writeCustomerTags: payload.tagging.writeCustomerTags,
    taggingDryRun: payload.tagging.dryRun ?? false,
    retentionMonths,
    language: payload.languages[0] || defaultSettings.languages[0],
    timezone: payload.timezones[0] || defaultSettings.timezones[0],
    pipelineStatuses: payload.pipelineStatuses,
    aiExposurePreferences: payload.exposurePreferences,
  } satisfies Record<string, unknown>;

  const timestamps = {
    lastBackfillAt: toDateOrNull(payload.lastBackfillAt),
    lastTaggingAt: toDateOrNull(payload.lastTaggingAt),
    lastCleanupAt: toDateOrNull(payload.lastCleanupAt),
    lastOrdersWebhookAt: toDateOrNull(payload.lastOrdersWebhookAt),
  } satisfies Record<string, unknown>;

  return {
    create: { ...baseData, ...timestamps },
    update: { ...baseData, ...omitUndefined(timestamps) },
  } as const;
};

export const buildActivityUpdates = (
  updates: Partial<{
    lastOrdersWebhookAt: Date;
    lastBackfillAt: Date;
    lastBackfillAttemptAt: Date;
    lastBackfillOrdersFetched: number;
    lastTaggingAt: Date;
    lastCleanupAt: Date;
    pipelineStatuses: PipelineStatus[];
  }>,
) =>
  omitUndefined({
    ...(updates.lastOrdersWebhookAt ? { lastOrdersWebhookAt: updates.lastOrdersWebhookAt } : {}),
    ...(updates.lastBackfillAt ? { lastBackfillAt: updates.lastBackfillAt } : {}),
    ...(updates.lastBackfillAttemptAt ? { lastBackfillAttemptAt: updates.lastBackfillAttemptAt } : {}),
    ...(typeof updates.lastBackfillOrdersFetched === 'number' ? { lastBackfillOrdersFetched: updates.lastBackfillOrdersFetched } : {}),
    ...(updates.lastTaggingAt ? { lastTaggingAt: updates.lastTaggingAt } : {}),
    ...(updates.lastCleanupAt ? { lastCleanupAt: updates.lastCleanupAt } : {}),
    ...(updates.pipelineStatuses ? { pipelineStatuses: updates.pipelineStatuses } : {}),
  });

export const buildSettingsUpdatePayload = (validated: SettingsUpdate) => {
  const retention = normalizeRetentionMonths(
    validated.retentionMonths,
    defaultSettings.retentionMonths ?? MIN_RETENTION_MONTHS,
  );

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (validated.primaryCurrency) updateData.primaryCurrency = validated.primaryCurrency;
  if (validated.aiDomains) updateData.aiDomains = validated.aiDomains;
  if (validated.utmSources) updateData.utmSources = validated.utmSources;
  if (validated.utmMediumKeywords) updateData.utmMediumKeywords = validated.utmMediumKeywords;
  if (validated.gmvMetric) updateData.gmvMetric = validated.gmvMetric;
  if (validated.language) updateData.language = validated.language;
  if (validated.timezone) updateData.timezone = validated.timezone;
  if (validated.retentionMonths !== undefined) updateData.retentionMonths = retention;
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

  const createData = {
    primaryCurrency: validated.primaryCurrency || defaultSettings.primaryCurrency,
    aiDomains: validated.aiDomains || defaultSettings.aiDomains,
    utmSources: validated.utmSources || defaultSettings.utmSources,
    utmMediumKeywords: validated.utmMediumKeywords || defaultSettings.utmMediumKeywords,
    gmvMetric: validated.gmvMetric || defaultSettings.gmvMetric,
    language: validated.language || defaultSettings.languages[0],
    timezone: validated.timezone || defaultSettings.timezones[0],
    retentionMonths: validated.retentionMonths !== undefined
      ? retention
      : defaultSettings.retentionMonths ?? MIN_RETENTION_MONTHS,
    orderTagPrefix: validated.tagging?.orderTagPrefix || defaultSettings.tagging.orderTagPrefix,
    customerTag: validated.tagging?.customerTag || defaultSettings.tagging.customerTag,
    writeOrderTags: validated.tagging?.writeOrderTags ?? defaultSettings.tagging.writeOrderTags,
    writeCustomerTags: validated.tagging?.writeCustomerTags ?? defaultSettings.tagging.writeCustomerTags,
    taggingDryRun: validated.tagging?.dryRun ?? defaultSettings.tagging.dryRun,
    aiExposurePreferences: validated.exposurePreferences || defaultSettings.exposurePreferences,
  } satisfies Record<string, unknown>;

  return { updateData, createData } as const;
};
