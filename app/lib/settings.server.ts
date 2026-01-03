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

/**
 * 构建设置记录的默认创建数据
 * 提取为独立函数避免代码重复
 */
const buildDefaultSettingsCreateData = (
  shopDomain: string,
  platformValue: string,
  additionalData: Record<string, unknown> = {},
) => ({
  shopDomain,
  platform: platformValue,
  primaryCurrency: defaultSettings.primaryCurrency,
  aiDomains: defaultSettings.aiDomains,
  utmSources: defaultSettings.utmSources,
  utmMediumKeywords: defaultSettings.utmMediumKeywords,
  orderTagPrefix: defaultSettings.tagging.orderTagPrefix,
  customerTag: defaultSettings.tagging.customerTag,
  writeOrderTags: defaultSettings.tagging.writeOrderTags,
  writeCustomerTags: defaultSettings.tagging.writeCustomerTags,
  taggingDryRun: defaultSettings.tagging.dryRun ?? false,
  language: defaultSettings.languages[0] || "English",
  timezone: defaultSettings.timezones[0] || "UTC",
  gmvMetric: defaultSettings.gmvMetric,
  retentionMonths: normalizeRetentionMonths(
    defaultSettings.retentionMonths ?? 6,
    defaultSettings.retentionMonths ?? 6,
  ),
  ...additionalData,
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

    // 问题 2 修复：总是将 Shopify 时区放在列表首位（如果不同）
    // 这确保用户看到的时区与 Shopify 后台一致
    if (
      timezone &&
      settings.timezones &&
      settings.timezones.length &&
      settings.timezones[0] !== timezone
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
    lastBackfillAttemptAt: Date;
    lastBackfillOrdersFetched: number;
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
      // 问题 3 修复：使用提取的函数避免代码重复
      create: buildDefaultSettingsCreateData(shopDomain, platform, prepared),
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
      // 问题 3 修复：使用提取的函数避免代码重复
      await prisma.shopSettings.create({
        data: buildDefaultSettingsCreateData(shopDomain, "", prepared),
      });
    }
  }
};

/**
 * 更新管道状态
 * 问题 4 修复：使用事务确保原子性，避免并发更新时的竞态条件
 */
export const updatePipelineStatuses = async (
  shopDomain: string,
  updater: (statuses: PipelineStatus[]) => PipelineStatus[],
) => {
  if (!shopDomain || isDemoMode()) return;

  const MAX_RETRIES = 3;
  let attempt = 0;
  
  while (attempt < MAX_RETRIES) {
    try {
      await prisma.$transaction(async (tx) => {
        // 在事务内读取当前状态
        const record = await tx.shopSettings.findUnique({
          where: { shopDomain_platform: { shopDomain, platform } },
          select: { pipelineStatuses: true, updatedAt: true },
        });

        const currentStatuses = (record?.pipelineStatuses as PipelineStatus[] | null) || 
          defaultSettings.pipelineStatuses;
        const next = updater(currentStatuses);

        if (record) {
          // 更新现有记录
          await tx.shopSettings.update({
            where: { shopDomain_platform: { shopDomain, platform } },
            data: { pipelineStatuses: next },
          });
        } else {
          // 创建新记录
          await tx.shopSettings.create({
            data: buildDefaultSettingsCreateData(shopDomain, platform, { pipelineStatuses: next }),
          });
        }
      });
      
      // 成功则退出循环
      return;
    } catch (error) {
      attempt++;
      
      // 检查是否为可重试的并发错误
      const isRetryable = error instanceof Error && 
        (error.message.includes('deadlock') || 
         error.message.includes('could not serialize') ||
         error.message.includes('Transaction'));
      
      if (!isRetryable || attempt >= MAX_RETRIES) {
        // 如果不是可重试错误或已达最大重试次数，回退到非事务方式
        logger.warn("[settings] Transaction failed, falling back to non-transactional update", {
          shopDomain,
          attempt,
          error: (error as Error).message,
        });
        
        // 回退到原有逻辑
        const current = await getSettings(shopDomain);
        const next = updater(
          current.pipelineStatuses && current.pipelineStatuses.length
            ? current.pipelineStatuses
            : defaultSettings.pipelineStatuses,
        );
        await markActivity(shopDomain, { pipelineStatuses: next });
        return;
      }
      
      // 短暂延迟后重试
      await new Promise(resolve => setTimeout(resolve, 50 * attempt));
    }
  }
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

// 类型验证辅助函数
const isValidAiDomainRule = (item: unknown): item is AiDomainRule => {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.domain === 'string' &&
    typeof obj.channel === 'string' &&
    (obj.source === 'default' || obj.source === 'custom')
  );
};

const isValidUtmSourceRule = (item: unknown): item is UtmSourceRule => {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.value === 'string' &&
    typeof obj.channel === 'string' &&
    (obj.source === 'default' || obj.source === 'custom')
  );
};

const isValidPipelineStatus = (item: unknown): item is PipelineStatus => {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  // 验证 status 必须是允许的值之一
  const validStatuses = ['healthy', 'warning', 'info'];
  return (
    typeof obj.title === 'string' &&
    typeof obj.status === 'string' &&
    validStatuses.includes(obj.status) &&
    typeof obj.detail === 'string'
  );
};

// 安全地过滤并验证数组
const validateArray = <T>(
  arr: unknown,
  validator: (item: unknown) => item is T,
  fallback: T[]
): T[] => {
  if (!Array.isArray(arr)) return fallback;
  const valid = arr.filter(validator);
  return valid.length > 0 ? valid : fallback;
};

export const normalizeSettingsPayload = (incoming: unknown): SettingsDefaults => {
  let parsed: Partial<SettingsDefaults> = {};
  if (typeof incoming === "string") {
    try {
      parsed = JSON.parse(incoming) as Partial<SettingsDefaults>;
    } catch (e) {
      logger.warn("[settings] Failed to parse settings JSON", { error: (e as Error).message });
      parsed = {};
    }
  } else if (incoming && typeof incoming === "object") {
    parsed = incoming as Partial<SettingsDefaults>;
  } else {
    parsed = {};
  }

  return {
    // 使用类型验证函数确保数组元素格式正确
    aiDomains: validateArray(parsed.aiDomains, isValidAiDomainRule, defaultSettings.aiDomains),
    utmSources: validateArray(parsed.utmSources, isValidUtmSourceRule, defaultSettings.utmSources),
    // 问题 1 修复：严格验证数组元素为非空字符串
    utmMediumKeywords: Array.isArray(parsed.utmMediumKeywords)
      ? parsed.utmMediumKeywords
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map(s => s.trim())
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
    pipelineStatuses: validateArray(
      parsed.pipelineStatuses,
      isValidPipelineStatus,
      defaultSettings.pipelineStatuses
    ),
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
