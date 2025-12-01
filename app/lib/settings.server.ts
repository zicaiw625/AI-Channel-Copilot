import prisma from "../db.server";
import { defaultSettings, type AiDomainRule, type PipelineStatus, type SettingsDefaults, type UtmSourceRule } from "./aiData";
import { getPlatform, isDemoMode } from "./runtime.server";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { logger } from "./logger.server";

const tableMissing = (error: unknown) =>
  error instanceof PrismaClientKnownRequestError && error.code === "P2021";
const columnMissing = (error: unknown) =>
  error instanceof PrismaClientKnownRequestError && error.code === "P2022";
const notFound = (error: unknown) =>
  error instanceof PrismaClientKnownRequestError && error.code === "P2025";

type AdminGraphqlClient = {
  graphql: (query: string, options: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const SHOP_PREFS_QUERY = `#graphql
  query ShopPreferencesForAiCopilot {
    shop {
      currencyCode
      ianaTimezone
    }
  }
`;

const platform = getPlatform();

const clampRetention = (value?: number | null) => {
  const numeric = typeof value === "number" ? Math.floor(value) : null;
  if (!numeric || Number.isNaN(numeric)) return defaultSettings.retentionMonths ?? 6;
  return Math.max(1, numeric);
};

const mapRecordToSettings = (record: {
  aiDomains: unknown;
  utmSources: unknown;
  utmMediumKeywords: unknown;
  gmvMetric: string;
  primaryCurrency?: string | null;
  orderTagPrefix: string;
  customerTag: string;
  writeOrderTags: boolean;
  writeCustomerTags: boolean;
  language: string;
  timezone: string;
  pipelineStatuses?: unknown;
  aiExposurePreferences?: unknown;
  retentionMonths?: number | null;
  lastOrdersWebhookAt?: Date | null;
  lastBackfillAt?: Date | null;
  lastTaggingAt?: Date | null;
  lastCleanupAt?: Date | null;
  taggingDryRun?: boolean | null;
}): SettingsDefaults => ({
  aiDomains: (record.aiDomains as AiDomainRule[]) || defaultSettings.aiDomains,
  utmSources: (record.utmSources as UtmSourceRule[]) || defaultSettings.utmSources,
  utmMediumKeywords:
    (record.utmMediumKeywords as string[]) || defaultSettings.utmMediumKeywords,
  gmvMetric:
    record.gmvMetric === "subtotal_price" ? "subtotal_price" : "current_total_price",
  primaryCurrency: record.primaryCurrency || defaultSettings.primaryCurrency,
  tagging: {
    orderTagPrefix: record.orderTagPrefix,
    customerTag: record.customerTag,
    writeOrderTags: record.writeOrderTags,
    writeCustomerTags: record.writeCustomerTags,
    dryRun: record.taggingDryRun ?? true,
  },
  exposurePreferences: (() => {
    const preferences = record.aiExposurePreferences as
      | SettingsDefaults["exposurePreferences"]
      | null
      | undefined;

    return {
      exposeProducts:
        typeof preferences?.exposeProducts === "boolean"
          ? preferences.exposeProducts
          : defaultSettings.exposurePreferences.exposeProducts,
      exposeCollections:
        typeof preferences?.exposeCollections === "boolean"
          ? preferences.exposeCollections
          : defaultSettings.exposurePreferences.exposeCollections,
      exposeBlogs:
        typeof preferences?.exposeBlogs === "boolean"
          ? preferences.exposeBlogs
          : defaultSettings.exposurePreferences.exposeBlogs,
    };
  })(),
  retentionMonths:
    typeof record.retentionMonths === "number"
      ? clampRetention(record.retentionMonths)
      : defaultSettings.retentionMonths,
  languages: [record.language, ...defaultSettings.languages.filter((l) => l !== record.language)],
  timezones: [record.timezone, ...defaultSettings.timezones.filter((t) => t !== record.timezone)],
  pipelineStatuses:
    (record.pipelineStatuses as SettingsDefaults["pipelineStatuses"]) ||
    defaultSettings.pipelineStatuses,
  lastOrdersWebhookAt: record.lastOrdersWebhookAt?.toISOString() || null,
  lastBackfillAt: record.lastBackfillAt?.toISOString() || null,
  lastTaggingAt: record.lastTaggingAt?.toISOString() || null,
  lastCleanupAt: record.lastCleanupAt?.toISOString() || null,
});

export const getSettings = async (shopDomain: string): Promise<SettingsDefaults> => {
  if (!shopDomain || isDemoMode()) return defaultSettings;

  try {
    const record = await prisma.shopSettings.findUnique({
      where: { shopDomain_platform: { shopDomain, platform } },
    });
    if (!record) return defaultSettings;
    return mapRecordToSettings(record);
  } catch (error) {
    if (tableMissing(error) || columnMissing(error)) {
      try {
        const legacy = await prisma.shopSettings.findFirst({ where: { shopDomain } });
        return legacy ? mapRecordToSettings(legacy as any) : defaultSettings;
      } catch {
        return defaultSettings;
      }
    }
    throw error;
  }
};

export const syncShopPreferences = async (
  admin: AdminGraphqlClient | null,
  shopDomain: string,
  settings: SettingsDefaults,
): Promise<SettingsDefaults> => {
  if (!admin || !shopDomain) return settings;

  try {
    const response = await admin.graphql(SHOP_PREFS_QUERY, { variables: {} });
    if (!response.ok) {
      let bodyText: string | undefined;
      try {
        bodyText = await response.text();
      } catch {}
      logger.error(
        "Failed to sync shop preferences",
        { shopDomain, platform },
        { status: response.status, statusText: response.statusText, body: bodyText },
      );
      return settings;
    }

    const json = (await response.json()) as {
      data?: { shop?: { currencyCode?: string | null; ianaTimezone?: string | null } };
    };

    const currency = json.data?.shop?.currencyCode || undefined;
    const timezone = json.data?.shop?.ianaTimezone || undefined;

    let next = settings;
    let changed = false;

    if (currency && currency !== settings.primaryCurrency) {
      next = { ...next, primaryCurrency: currency };
      changed = true;
    }

    if (
      timezone &&
      settings.timezones &&
      settings.timezones.length &&
      settings.timezones[0] === defaultSettings.timezones[0]
    ) {
      next = {
        ...next,
        timezones: [timezone, ...settings.timezones.filter((value) => value !== timezone)],
      };
      changed = true;
    }

  if (changed) {
      await saveSettings(shopDomain, next);
      return next;
    }
  } catch (error) {
    if (error instanceof Response) {
      logger.warn(
        "Failed to sync shop preferences",
        { shopDomain, platform },
        { message: "auth/session missing or interrupted" },
      );
    } else {
      logger.error(
        "Failed to sync shop preferences",
        { shopDomain, platform },
        { message: (error as any)?.message ?? String(error) },
      );
    }
  }

  return settings;
};

export const saveSettings = async (
  shopDomain: string,
  payload: SettingsDefaults,
): Promise<SettingsDefaults> => {
  if (!shopDomain || isDemoMode()) return payload;
  const primaryCurrency = payload.primaryCurrency || defaultSettings.primaryCurrency || "USD";
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
    retentionMonths: clampRetention(payload.retentionMonths ?? defaultSettings.retentionMonths ?? 6),
    language: payload.languages[0] || "中文",
    timezone: payload.timezones[0] || "UTC",
    pipelineStatuses: payload.pipelineStatuses,
    aiExposurePreferences: payload.exposurePreferences,
  };

  const withOptionalsCreate = {
    ...baseData,
    lastBackfillAt: payload.lastBackfillAt ? new Date(payload.lastBackfillAt) : null,
    lastTaggingAt: payload.lastTaggingAt ? new Date(payload.lastTaggingAt) : null,
    lastCleanupAt: payload.lastCleanupAt ? new Date(payload.lastCleanupAt) : null,
    lastOrdersWebhookAt: payload.lastOrdersWebhookAt ? new Date(payload.lastOrdersWebhookAt) : null,
  };

  const updateOptionals: Record<string, Date | null | undefined | PipelineStatus[] | SettingsDefaults["exposurePreferences"]> = {};
  if (payload.lastBackfillAt) updateOptionals.lastBackfillAt = new Date(payload.lastBackfillAt);
  if (payload.lastTaggingAt) updateOptionals.lastTaggingAt = new Date(payload.lastTaggingAt);
  if (payload.lastCleanupAt) updateOptionals.lastCleanupAt = new Date(payload.lastCleanupAt);
  if (payload.lastOrdersWebhookAt) updateOptionals.lastOrdersWebhookAt = new Date(payload.lastOrdersWebhookAt);
  if (payload.pipelineStatuses) updateOptionals.pipelineStatuses = payload.pipelineStatuses;
  if (payload.exposurePreferences) updateOptionals.aiExposurePreferences = payload.exposurePreferences;

  try {
    await prisma.shopSettings.upsert({
      where: { shopDomain_platform: { shopDomain, platform } },
      create: { shopDomain, platform, ...withOptionalsCreate },
      update: { ...baseData, ...updateOptionals },
    });
  } catch (error) {
    if (!(tableMissing(error) || columnMissing(error))) {
      throw error;
    }
    const existing = await prisma.shopSettings.findFirst({ where: { shopDomain } });
    if (existing) {
      await prisma.shopSettings.update({ where: { id: (existing as any).id }, data: { ...baseData, ...updateOptionals } });
    } else {
      await prisma.shopSettings.create({ data: { shopDomain, ...withOptionalsCreate } });
    }
  }

  return payload;
};

export const markActivity = async (
  shopDomain: string,
  updates: Partial<{
    lastOrdersWebhookAt: Date;
    lastBackfillAt: Date;
    lastTaggingAt: Date;
    lastCleanupAt: Date;
    pipelineStatuses: PipelineStatus[];
  }>,
) => {
  if (!shopDomain || isDemoMode()) return;

  try {
    await prisma.shopSettings.upsert({
      where: { shopDomain_platform: { shopDomain, platform } },
      update: {
        ...(updates.lastOrdersWebhookAt ? { lastOrdersWebhookAt: updates.lastOrdersWebhookAt } : {}),
        ...(updates.lastBackfillAt ? { lastBackfillAt: updates.lastBackfillAt } : {}),
        ...(updates.lastTaggingAt ? { lastTaggingAt: updates.lastTaggingAt } : {}),
        ...(updates.lastCleanupAt ? { lastCleanupAt: updates.lastCleanupAt } : {}),
        ...(updates.pipelineStatuses ? { pipelineStatuses: updates.pipelineStatuses } : {}),
      },
      create: {
        shopDomain,
        platform,
        primaryCurrency: defaultSettings.primaryCurrency,
        aiDomains: defaultSettings.aiDomains,
        utmSources: defaultSettings.utmSources,
        utmMediumKeywords: defaultSettings.utmMediumKeywords,
        orderTagPrefix: defaultSettings.tagging.orderTagPrefix,
        customerTag: defaultSettings.tagging.customerTag,
        writeOrderTags: defaultSettings.tagging.writeOrderTags,
        writeCustomerTags: defaultSettings.tagging.writeCustomerTags,
        taggingDryRun: defaultSettings.tagging.dryRun ?? true,
        language: defaultSettings.languages[0] || "中文",
        timezone: defaultSettings.timezones[0] || "UTC",
        gmvMetric: defaultSettings.gmvMetric,
        retentionMonths: clampRetention(defaultSettings.retentionMonths ?? 6),
        ...(updates.lastOrdersWebhookAt ? { lastOrdersWebhookAt: updates.lastOrdersWebhookAt } : {}),
        ...(updates.lastBackfillAt ? { lastBackfillAt: updates.lastBackfillAt } : {}),
        ...(updates.lastTaggingAt ? { lastTaggingAt: updates.lastTaggingAt } : {}),
        ...(updates.lastCleanupAt ? { lastCleanupAt: updates.lastCleanupAt } : {}),
        ...(updates.pipelineStatuses ? { pipelineStatuses: updates.pipelineStatuses } : {}),
      },
    });
  } catch (error) {
    if (!(tableMissing(error) || columnMissing(error) || notFound(error))) {
      throw error;
    }
    const existing = await prisma.shopSettings.findFirst({ where: { shopDomain } });
    if (existing) {
      await prisma.shopSettings.update({
        where: { id: (existing as any).id },
        data: {
          ...(updates.lastOrdersWebhookAt ? { lastOrdersWebhookAt: updates.lastOrdersWebhookAt } : {}),
          ...(updates.lastBackfillAt ? { lastBackfillAt: updates.lastBackfillAt } : {}),
          ...(updates.lastTaggingAt ? { lastTaggingAt: updates.lastTaggingAt } : {}),
          ...(updates.lastCleanupAt ? { lastCleanupAt: updates.lastCleanupAt } : {}),
          ...(updates.pipelineStatuses ? { pipelineStatuses: updates.pipelineStatuses } : {}),
        },
      });
    } else {
      await prisma.shopSettings.create({
        data: {
          shopDomain,
          primaryCurrency: defaultSettings.primaryCurrency,
          aiDomains: defaultSettings.aiDomains,
          utmSources: defaultSettings.utmSources,
          utmMediumKeywords: defaultSettings.utmMediumKeywords,
          orderTagPrefix: defaultSettings.tagging.orderTagPrefix,
          customerTag: defaultSettings.tagging.customerTag,
          writeOrderTags: defaultSettings.tagging.writeOrderTags,
          writeCustomerTags: defaultSettings.tagging.writeCustomerTags,
          taggingDryRun: defaultSettings.tagging.dryRun ?? true,
          language: defaultSettings.languages[0] || "中文",
          timezone: defaultSettings.timezones[0] || "UTC",
          gmvMetric: defaultSettings.gmvMetric,
          retentionMonths: clampRetention(defaultSettings.retentionMonths ?? 6),
          ...(updates.lastOrdersWebhookAt ? { lastOrdersWebhookAt: updates.lastOrdersWebhookAt } : {}),
          ...(updates.lastBackfillAt ? { lastBackfillAt: updates.lastBackfillAt } : {}),
          ...(updates.lastTaggingAt ? { lastTaggingAt: updates.lastTaggingAt } : {}),
          ...(updates.lastCleanupAt ? { lastCleanupAt: updates.lastCleanupAt } : {}),
          ...(updates.pipelineStatuses ? { pipelineStatuses: updates.pipelineStatuses } : {}),
        },
      });
    }
  }
};

export const updatePipelineStatuses = async (
  shopDomain: string,
  updater: (statuses: PipelineStatus[]) => PipelineStatus[],
) => {
  if (!shopDomain) return;
  const current = await getSettings(shopDomain);
  const next = updater(
    current.pipelineStatuses && current.pipelineStatuses.length
      ? current.pipelineStatuses
      : defaultSettings.pipelineStatuses,
  );
  await markActivity(shopDomain, { pipelineStatuses: next });
};

export const deleteSettings = async (shopDomain: string) => {
  if (!shopDomain || isDemoMode()) return;

  try {
    await prisma.shopSettings.delete({ where: { shopDomain_platform: { shopDomain, platform } } });
  } catch (error) {
    if (!(tableMissing(error) || columnMissing(error))) {
      throw error;
    }
    const existing = await prisma.shopSettings.findFirst({ where: { shopDomain } });
    if (existing) {
      await prisma.shopSettings.delete({ where: { id: (existing as any).id } });
    }
  }
};

export const normalizeSettingsPayload = (incoming: unknown): SettingsDefaults => {
  const parsed =
    typeof incoming === "string"
      ? (JSON.parse(incoming) as Partial<SettingsDefaults>)
      : (incoming as Partial<SettingsDefaults>);

  return {
    aiDomains: Array.isArray(parsed.aiDomains)
      ? (parsed.aiDomains as AiDomainRule[])
      : defaultSettings.aiDomains,
    utmSources: Array.isArray(parsed.utmSources)
      ? (parsed.utmSources as UtmSourceRule[])
      : defaultSettings.utmSources,
    utmMediumKeywords: Array.isArray(parsed.utmMediumKeywords)
      ? (parsed.utmMediumKeywords as string[])
      : defaultSettings.utmMediumKeywords,
    gmvMetric:
      parsed.gmvMetric === "subtotal_price" ? "subtotal_price" : defaultSettings.gmvMetric,
    primaryCurrency:
      typeof parsed.primaryCurrency === "string" && parsed.primaryCurrency
        ? parsed.primaryCurrency
        : defaultSettings.primaryCurrency,
    tagging: {
      orderTagPrefix:
        parsed.tagging?.orderTagPrefix || defaultSettings.tagging.orderTagPrefix,
      customerTag: parsed.tagging?.customerTag || defaultSettings.tagging.customerTag,
      writeOrderTags:
        typeof parsed.tagging?.writeOrderTags === "boolean"
          ? parsed.tagging.writeOrderTags
          : defaultSettings.tagging.writeOrderTags,
      writeCustomerTags:
        typeof parsed.tagging?.writeCustomerTags === "boolean"
          ? parsed.tagging.writeCustomerTags
          : defaultSettings.tagging.writeCustomerTags,
      dryRun:
        typeof parsed.tagging?.dryRun === "boolean"
          ? parsed.tagging.dryRun
          : defaultSettings.tagging.dryRun,
    },
    exposurePreferences: {
      exposeProducts:
        typeof parsed.exposurePreferences?.exposeProducts === "boolean"
          ? parsed.exposurePreferences.exposeProducts
          : defaultSettings.exposurePreferences.exposeProducts,
      exposeCollections:
        typeof parsed.exposurePreferences?.exposeCollections === "boolean"
          ? parsed.exposurePreferences.exposeCollections
          : defaultSettings.exposurePreferences.exposeCollections,
      exposeBlogs:
        typeof parsed.exposurePreferences?.exposeBlogs === "boolean"
          ? parsed.exposurePreferences.exposeBlogs
          : defaultSettings.exposurePreferences.exposeBlogs,
    },
    languages: parsed.languages && parsed.languages.length
      ? parsed.languages
      : defaultSettings.languages,
    timezones: parsed.timezones && parsed.timezones.length
      ? parsed.timezones
      : defaultSettings.timezones,
    pipelineStatuses: Array.isArray(parsed.pipelineStatuses)
      ? (parsed.pipelineStatuses as SettingsDefaults["pipelineStatuses"])
      : defaultSettings.pipelineStatuses,
    lastOrdersWebhookAt: parsed.lastOrdersWebhookAt || undefined,
    lastBackfillAt: parsed.lastBackfillAt || undefined,
    lastTaggingAt: parsed.lastTaggingAt || undefined,
  };
};
