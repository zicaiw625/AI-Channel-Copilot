import type { ShopSettings } from "@prisma/client";

import { defaultSettings, type SettingsDefaults, type PipelineStatus } from "../aiData";
import type { SettingsUpdate } from "../validation/schemas";

const MIN_RETENTION_MONTHS = 1;
const MAX_RETENTION_MONTHS = 24;

const toISOStringOrNull = (value?: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toDateOrNull = (value?: string | Date | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

export const mapRecordToSettings = (record?: Partial<ShopSettings> | null): SettingsDefaults => {
  if (!record) return defaultSettings;

  return {
    aiDomains: (record.aiDomains as SettingsDefaults["aiDomains"]) || defaultSettings.aiDomains,
    utmSources: (record.utmSources as SettingsDefaults["utmSources"]) || defaultSettings.utmSources,
    utmMediumKeywords:
      (record.utmMediumKeywords as SettingsDefaults["utmMediumKeywords"]) ||
      defaultSettings.utmMediumKeywords,
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
    pipelineStatuses:
      (record.pipelineStatuses as SettingsDefaults["pipelineStatuses"]) ||
      defaultSettings.pipelineStatuses,
    lastOrdersWebhookAt: toISOStringOrNull(record.lastOrdersWebhookAt),
    lastBackfillAt: toISOStringOrNull(record.lastBackfillAt),
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
    taggingDryRun: payload.tagging.dryRun ?? true,
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
    lastTaggingAt: Date;
    lastCleanupAt: Date;
    pipelineStatuses: PipelineStatus[];
  }>,
) =>
  omitUndefined({
    ...(updates.lastOrdersWebhookAt ? { lastOrdersWebhookAt: updates.lastOrdersWebhookAt } : {}),
    ...(updates.lastBackfillAt ? { lastBackfillAt: updates.lastBackfillAt } : {}),
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
