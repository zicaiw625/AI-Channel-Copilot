import prisma from "../db.server";
import { defaultSettings, type AiDomainRule, type PipelineStatus, type SettingsDefaults, type UtmSourceRule } from "./aiData";
import { createGraphqlSdk, type AdminGraphqlClient } from "./graphqlSdk.server";
import { logger } from "./logger.server";
import { isIgnorableMigrationError, isSchemaMissing } from "./prismaErrors";
import { getPlatform, isDemoMode } from "./runtime.server";
import {
  buildActivityUpdates,
  buildPersistenceData,
  mapRecordToSettings,
  normalizeRetentionMonths,
} from "./settings/utils";


const SHOP_PREFS_QUERY = `#graphql
  query ShopPreferencesForAiCopilot {
    shop {
      currencyCode
      ianaTimezone
    }
  }
`;

const platform = getPlatform();

export const getSettings = async (shopDomain: string): Promise<SettingsDefaults> => {
  if (!shopDomain || isDemoMode()) return defaultSettings;

  try {
    const record = await prisma.shopSettings.findUnique({
      where: { shopDomain_platform: { shopDomain, platform } },
    });
    if (!record) return defaultSettings;
    return mapRecordToSettings(record);
  } catch (error) {
    if (isSchemaMissing(error)) {
      try {
        const legacy = await prisma.shopSettings.findFirst({ where: { shopDomain } });
        return legacy ? mapRecordToSettings(legacy) : defaultSettings;
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
    const sdk = createGraphqlSdk(admin, shopDomain);
    const response = await sdk.request("shopPreferences", SHOP_PREFS_QUERY, {});
    if (!response.ok) {
      let bodyText: string | undefined;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = undefined;
      }
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
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Failed to sync shop preferences", { shopDomain, platform }, { message });
    }
  }

  return settings;
};

export const saveSettings = async (shopDomain: string, payload: SettingsDefaults): Promise<SettingsDefaults> => {
  if (!shopDomain || isDemoMode()) return payload;
  const persistence = buildPersistenceData(payload);

  try {
    await prisma.shopSettings.upsert({
      where: { shopDomain_platform: { shopDomain, platform } },
      create: { shopDomain, platform, ...persistence.create },
      update: persistence.update,
    });
  } catch (error) {
    if (!isSchemaMissing(error)) {
      throw error;
    }
    const existing = await prisma.shopSettings.findFirst({ where: { shopDomain } });
    if (existing) {
      await prisma.shopSettings.update({ where: { id: existing.id }, data: persistence.update });
    } else {
      await prisma.shopSettings.create({ data: { shopDomain, ...persistence.create } });
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

  const prepared = buildActivityUpdates(updates);

  try {
    await prisma.shopSettings.upsert({
      where: { shopDomain_platform: { shopDomain, platform } },
      update: prepared,
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
        retentionMonths: normalizeRetentionMonths(
          defaultSettings.retentionMonths ?? 6,
          defaultSettings.retentionMonths ?? 6,
        ),
        ...prepared,
      },
    });
  } catch (error) {
    if (!isIgnorableMigrationError(error)) {
      throw error;
    }
    const existing = await prisma.shopSettings.findFirst({ where: { shopDomain } });
    if (existing) {
      await prisma.shopSettings.update({
        where: { id: existing.id },
        data: prepared,
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
          retentionMonths: normalizeRetentionMonths(
            defaultSettings.retentionMonths ?? 6,
            defaultSettings.retentionMonths ?? 6,
          ),
          ...prepared,
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
    if (!isSchemaMissing(error)) {
      throw error;
    }
    const existing = await prisma.shopSettings.findFirst({ where: { shopDomain } });
    if (existing) {
      await prisma.shopSettings.delete({ where: { id: existing.id } });
    }
  }
};

export const getInstallCreatedAt = async (shopDomain: string): Promise<Date | null> => {
  if (!shopDomain || isDemoMode()) return null;
  try {
    const record = await prisma.shopSettings.findUnique({ where: { shopDomain_platform: { shopDomain, platform } } });
    return record?.createdAt ?? null;
  } catch {
    try {
      const legacy = await prisma.shopSettings.findFirst({ where: { shopDomain } });
      return legacy?.createdAt ?? null;
    } catch {
      return null;
    }
  }
};

export const normalizeSettingsPayload = (incoming: unknown): SettingsDefaults => {
  let parsed: Partial<SettingsDefaults> = {};
  if (typeof incoming === "string") {
    try {
      parsed = JSON.parse(incoming) as Partial<SettingsDefaults>;
    } catch {
      parsed = {};
    }
  } else {
    parsed = incoming as Partial<SettingsDefaults>;
  }

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
    // 日期字段使用严格的类型检查，避免 0 或空字符串被错误处理
    // 这些字段在 SettingsDefaults 中是 string | null | undefined 类型
    lastOrdersWebhookAt: (typeof parsed.lastOrdersWebhookAt === 'string' && parsed.lastOrdersWebhookAt.trim())
      ? parsed.lastOrdersWebhookAt
      : (parsed.lastOrdersWebhookAt && typeof parsed.lastOrdersWebhookAt === 'object' && 'toISOString' in parsed.lastOrdersWebhookAt)
        ? (parsed.lastOrdersWebhookAt as Date).toISOString()
        : undefined,
    lastBackfillAt: (typeof parsed.lastBackfillAt === 'string' && parsed.lastBackfillAt.trim())
      ? parsed.lastBackfillAt
      : (parsed.lastBackfillAt && typeof parsed.lastBackfillAt === 'object' && 'toISOString' in parsed.lastBackfillAt)
        ? (parsed.lastBackfillAt as Date).toISOString()
        : undefined,
    lastTaggingAt: (typeof parsed.lastTaggingAt === 'string' && parsed.lastTaggingAt.trim())
      ? parsed.lastTaggingAt
      : (parsed.lastTaggingAt && typeof parsed.lastTaggingAt === 'object' && 'toISOString' in parsed.lastTaggingAt)
        ? (parsed.lastTaggingAt as Date).toISOString()
        : undefined,
    retentionMonths: normalizeRetentionMonths(
      parsed.retentionMonths,
      defaultSettings.retentionMonths ?? 6,
    ),
  };
};
