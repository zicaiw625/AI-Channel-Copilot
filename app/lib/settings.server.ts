import prisma from "../db.server";
import { defaultSettings, type AiDomainRule, type PipelineStatus, type SettingsDefaults, type UtmSourceRule } from "./aiData";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

const tableMissing = (error: unknown) =>
  error instanceof PrismaClientKnownRequestError && error.code === "P2021";

const mapRecordToSettings = (record: {
  aiDomains: unknown;
  utmSources: unknown;
  utmMediumKeywords: unknown;
  gmvMetric: string;
  orderTagPrefix: string;
  customerTag: string;
  writeOrderTags: boolean;
  writeCustomerTags: boolean;
  language: string;
  timezone: string;
  pipelineStatuses?: unknown;
  lastOrdersWebhookAt?: Date | null;
  lastBackfillAt?: Date | null;
  lastTaggingAt?: Date | null;
  taggingDryRun?: boolean | null;
}): SettingsDefaults => ({
  aiDomains: (record.aiDomains as AiDomainRule[]) || defaultSettings.aiDomains,
  utmSources: (record.utmSources as UtmSourceRule[]) || defaultSettings.utmSources,
  utmMediumKeywords:
    (record.utmMediumKeywords as string[]) || defaultSettings.utmMediumKeywords,
  gmvMetric:
    record.gmvMetric === "subtotal_price" ? "subtotal_price" : "current_total_price",
  tagging: {
    orderTagPrefix: record.orderTagPrefix,
    customerTag: record.customerTag,
    writeOrderTags: record.writeOrderTags,
    writeCustomerTags: record.writeCustomerTags,
    dryRun: record.taggingDryRun ?? true,
  },
  languages: [record.language, ...defaultSettings.languages.filter((l) => l !== record.language)],
  timezones: [record.timezone, ...defaultSettings.timezones.filter((t) => t !== record.timezone)],
  pipelineStatuses:
    (record.pipelineStatuses as SettingsDefaults["pipelineStatuses"]) ||
    defaultSettings.pipelineStatuses,
  lastOrdersWebhookAt: record.lastOrdersWebhookAt?.toISOString() || null,
  lastBackfillAt: record.lastBackfillAt?.toISOString() || null,
  lastTaggingAt: record.lastTaggingAt?.toISOString() || null,
});

export const getSettings = async (shopDomain: string): Promise<SettingsDefaults> => {
  if (!shopDomain) return defaultSettings;

  const shopSettings = (prisma as any).shopSettings;
  if (!shopSettings) return defaultSettings;

  try {
    const record = await shopSettings.findUnique({ where: { shopDomain } });
    if (!record) return defaultSettings;
    return mapRecordToSettings(record);
  } catch (error) {
    if (tableMissing(error)) {
      return defaultSettings;
    }
    throw error;
  }
};

export const saveSettings = async (
  shopDomain: string,
  payload: SettingsDefaults,
): Promise<SettingsDefaults> => {
  if (!shopDomain) return payload;

  const shopSettings = (prisma as any).shopSettings;
  if (!shopSettings) return payload;

  try {
    const baseData = {
      aiDomains: payload.aiDomains,
      utmSources: payload.utmSources,
      utmMediumKeywords: payload.utmMediumKeywords,
      gmvMetric: payload.gmvMetric,
      orderTagPrefix: payload.tagging.orderTagPrefix,
      customerTag: payload.tagging.customerTag,
      writeOrderTags: payload.tagging.writeOrderTags,
      writeCustomerTags: payload.tagging.writeCustomerTags,
      taggingDryRun: payload.tagging.dryRun ?? true,
      language: payload.languages[0] || "中文",
      timezone: payload.timezones[0] || "UTC",
      pipelineStatuses: payload.pipelineStatuses,
    };

    const withOptionalsCreate = {
      ...baseData,
      lastBackfillAt: payload.lastBackfillAt ? new Date(payload.lastBackfillAt) : null,
      lastTaggingAt: payload.lastTaggingAt ? new Date(payload.lastTaggingAt) : null,
      lastOrdersWebhookAt: payload.lastOrdersWebhookAt
        ? new Date(payload.lastOrdersWebhookAt)
        : null,
    };

    const updateOptionals: Record<string, Date | null | undefined | PipelineStatus[]> = {};
    if (payload.lastBackfillAt) updateOptionals.lastBackfillAt = new Date(payload.lastBackfillAt);
    if (payload.lastTaggingAt) updateOptionals.lastTaggingAt = new Date(payload.lastTaggingAt);
    if (payload.lastOrdersWebhookAt) {
      updateOptionals.lastOrdersWebhookAt = new Date(payload.lastOrdersWebhookAt);
    }
    if (payload.pipelineStatuses) updateOptionals.pipelineStatuses = payload.pipelineStatuses;

    await shopSettings.upsert({
      where: { shopDomain },
      create: { shopDomain, ...withOptionalsCreate },
      update: { ...baseData, ...updateOptionals },
    });
  } catch (error) {
    if (!tableMissing(error)) {
      throw error;
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
    pipelineStatuses: PipelineStatus[];
  }>,
) => {
  if (!shopDomain) return;
  const shopSettings = (prisma as any).shopSettings;
  if (!shopSettings) return;

  try {
    await shopSettings.update({
      where: { shopDomain },
      data: {
        ...(updates.lastOrdersWebhookAt ? { lastOrdersWebhookAt: updates.lastOrdersWebhookAt } : {}),
        ...(updates.lastBackfillAt ? { lastBackfillAt: updates.lastBackfillAt } : {}),
        ...(updates.lastTaggingAt ? { lastTaggingAt: updates.lastTaggingAt } : {}),
        ...(updates.pipelineStatuses ? { pipelineStatuses: updates.pipelineStatuses } : {}),
      },
    });
  } catch (error) {
    if (!tableMissing(error)) {
      throw error;
    }
  }
};

export const deleteSettings = async (shopDomain: string) => {
  if (!shopDomain) return;
  const shopSettings = (prisma as any).shopSettings;
  if (!shopSettings) return;

  try {
    await shopSettings.delete({ where: { shopDomain } });
  } catch (error) {
    if (!tableMissing(error)) {
      throw error;
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
