import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  resolveDateRange,
  type DateRange,
  type TimeRangeKey,
} from "./aiData";
import { didFetchOrdersComplete, fetchOrdersForRange } from "./shopifyOrders.server";
import {
  getSettings,
  markActivity,
  normalizeSettingsPayload,
  saveSettings,
  syncShopPreferences,
} from "./settings.server";
import { mergeSettingsForSave } from "./settings/utils";
import { buildLlmsTxt, updateLlmsTxtCache } from "./llms.server";
import { getDeadLetterJobs, getWebhookQueueSize } from "./webhookQueue.server";
import { persistOrders, removeDeletedOrders } from "./persistence.server";
import { applyAiTags } from "./tagging.server";
import { authenticate } from "../shopify.server";
import { getPlatform, isDemoMode } from "./runtime.server";
import { readAppFlags } from "./env.server";
import {
  BACKFILL_COOLDOWN_MINUTES,
  DEFAULT_RANGE_KEY,
} from "./constants";
import { loadDashboardContext } from "./dashboardContext.server";
import { logger } from "./logger.server";
import { hasFeature, FEATURES } from "./access.server";
import { resolveUILanguageFromRequest } from "./language.server";

export interface AdditionalActionResult {
  ok: boolean;
  intent?: string;
  message?: string;
  errorCode?: string;
  suggestReauth?: boolean;
}

export async function loadAdditionalPageData({ request }: LoaderFunctionArgs) {
  let admin, session;
  let authFailed = false;

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (error) {
    authFailed = true;
  }

  const url = new URL(request.url);
  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);

  if (admin && shopDomain && !authFailed) {
    try {
      settings = await syncShopPreferences(admin, shopDomain, settings);
    } catch (e) {
      logger.warn("[settings] syncShopPreferences failed", { shopDomain }, { error: (e as Error).message });
    }
  }

  const exportRange = (url.searchParams.get("range") as TimeRangeKey) || "90d";
  const { orders, clamped, displayTimezone } = await loadDashboardContext({
    shopDomain,
    admin,
    settings,
    url,
    defaultRangeKey: exportRange || DEFAULT_RANGE_KEY,
    fallbackToShopify: false,
    fallbackIntent: "settings-export",
  });

  const ordersSample = orders.slice(0, 20);
  const [webhookQueueSize, deadLetters, canExport] = await Promise.all([
    getWebhookQueueSize(),
    getDeadLetterJobs(10),
    hasFeature(shopDomain, FEATURES.EXPORTS),
  ]);
  const { showDebugPanels } = readAppFlags();

  return {
    settings,
    exportRange,
    clamped,
    displayTimezone,
    ordersSample,
    webhookQueueSize,
    deadLetters,
    canExport,
    showDebugPanels,
    shopDomain,
  };
}

export async function additionalAction({ request }: ActionFunctionArgs) {
  let shopDomain = "";
  let admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"] | null = null;
  let session: Awaited<ReturnType<typeof authenticate.admin>>["session"] | null = null;

  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
    shopDomain = session?.shop || "";
  } catch (error) {
    if (!isDemoMode()) throw error;
  }

  try {
    const platform = getPlatform();
    const formData = await request.formData();
    const rawIntent = formData.get("intent");
    const intent = typeof rawIntent === "string" && rawIntent ? rawIntent : "save";
    const incoming = formData.get("settings");
    const currentSettings = await getSettings(shopDomain);
    const currentLanguage = resolveUILanguageFromRequest(request, currentSettings.languages?.[0] || "中文");

    if (!incoming) {
      throw new Error(currentLanguage === "English" ? "Missing settings payload" : "缺少设置数据载荷");
    }

    let normalized;
    try {
      normalized = normalizeSettingsPayload(incoming.toString());
    } catch (parseError) {
      return Response.json(
        { ok: false, message: currentLanguage === "English" ? "Invalid settings format. Please refresh and retry." : "设置格式无效，请刷新后重试" } satisfies AdditionalActionResult,
        { status: 400 },
      );
    }

    const existing = await getSettings(shopDomain);
    const merged = mergeSettingsForSave(existing, normalized);

    await saveSettings(shopDomain, merged);

    const exposureChanged = JSON.stringify(existing.exposurePreferences) !== JSON.stringify(merged.exposurePreferences);
    const languageChanged = existing.languages?.[0] !== merged.languages?.[0];
    const shouldRefreshLlms = exposureChanged || languageChanged;

    if (shouldRefreshLlms && admin && shopDomain) {
      try {
        const targetLanguage = merged.languages?.[0] || "中文";
        logger.info("[settings] Refreshing llms.txt cache", {
          shopDomain,
          targetLanguage,
          exposurePreferences: merged.exposurePreferences,
          reason: exposureChanged ? "exposure_changed" : "language_changed",
        });

        const llmsText = await buildLlmsTxt(shopDomain, merged, {
          range: "30d",
          topN: 20,
          admin,
        });
        const cacheResult = await updateLlmsTxtCache(shopDomain, llmsText, { force: true });

        logger.info("[settings] llms.txt cache refresh result", {
          shopDomain,
          targetLanguage,
          updated: cacheResult.updated,
          reason: cacheResult.reason,
        });
      } catch (e) {
        logger.warn("[settings] Failed to refresh llms.txt cache", { shopDomain }, { error: (e as Error).message });
      }
    }

    const calculationTimezone = merged.timezones[0] || "UTC";
    const range: DateRange = resolveDateRange("90d", new Date(), undefined, undefined, calculationTimezone);
    const now = new Date();
    const lastBackfillAt = merged.lastBackfillAt ? new Date(merged.lastBackfillAt) : null;
    const withinCooldown =
      lastBackfillAt &&
      now.getTime() - lastBackfillAt.getTime() < BACKFILL_COOLDOWN_MINUTES * 60 * 1000;

    if (intent === "backfill") {
      if (withinCooldown) {
        return Response.json(
          { ok: false, message: currentLanguage === "English" ? "Backfill cooldown (<30 minutes). Reusing current data." : "距离上次补拉不足 30 分钟，已复用现有数据。" } satisfies AdditionalActionResult,
          { status: 429 },
        );
      }
      if (!admin) {
        return Response.json(
          { ok: false, message: currentLanguage === "English" ? "Authentication required for backfill" : "补拉操作需要认证" } satisfies AdditionalActionResult,
          { status: 401 },
        );
      }
      const {
        orders,
        error: fetchError,
        hitPageLimit,
        hitOrderLimit,
        hitDurationLimit,
      } = await fetchOrdersForRange(admin, range, merged, {
        shopDomain,
        intent: "settings-backfill",
        rangeLabel: range.label,
      });

      if (fetchError) {
        logger.warn("[backfill] settings-trigger failed due to access restriction", {
          platform,
          shopDomain,
          errorCode: fetchError.code,
          suggestReauth: fetchError.suggestReauth,
        });
        return Response.json(
          {
            ok: false,
            message: fetchError.message,
            errorCode: fetchError.code,
            suggestReauth: fetchError.suggestReauth,
          } satisfies AdditionalActionResult,
          { status: 403 },
        );
      }

      const result = await persistOrders(shopDomain, orders);
      const fetchCompleted = didFetchOrdersComplete({
        error: fetchError,
        hitPageLimit,
        hitOrderLimit,
        hitDurationLimit,
      });
      const deletedCount = fetchCompleted
        ? await removeDeletedOrders(shopDomain, range, new Set(orders.map((order) => order.id)))
        : 0;

      await markActivity(shopDomain, {
        lastBackfillAttemptAt: now,
        lastBackfillOrdersFetched: orders.length,
        ...(fetchCompleted ? { lastBackfillAt: now } : {}),
      });
      logger.info(
        "[backfill] settings-trigger completed",
        { platform, shopDomain, intent },
        {
          fetched: orders.length,
          created: result.created,
          updated: result.updated,
          deleted: deletedCount,
          fetchCompleted,
        },
      );
    }

    if (intent === "tag") {
      if (!admin) {
        return Response.json(
          { ok: false, message: currentLanguage === "English" ? "Authentication required for tagging" : "标签写入需要认证" } satisfies AdditionalActionResult,
          { status: 401 },
        );
      }
      const { orders, error: tagFetchError } = await fetchOrdersForRange(admin, range, merged, {
        shopDomain,
        intent: "settings-tagging",
        rangeLabel: range.label,
      });

      if (tagFetchError) {
        logger.warn("[tagging] fetch failed due to access restriction", {
          platform,
          shopDomain,
          errorCode: tagFetchError.code,
          suggestReauth: tagFetchError.suggestReauth,
        });
        return Response.json(
          {
            ok: false,
            message: tagFetchError.message,
            errorCode: tagFetchError.code,
            suggestReauth: tagFetchError.suggestReauth,
          } satisfies AdditionalActionResult,
          { status: 403 },
        );
      }

      const aiOrders = orders.filter((order) => order.aiSource);
      if (merged.tagging.writeOrderTags) {
        await applyAiTags(admin, aiOrders, merged, { shopDomain, intent: "settings-tagging" });
      }
      const result = await persistOrders(shopDomain, orders);
      await markActivity(shopDomain, { lastTaggingAt: new Date() });
      logger.info(
        "[tagging] settings-trigger completed",
        { platform, shopDomain, intent },
        {
          aiOrders: aiOrders.length,
          totalOrders: orders.length,
          created: result.created,
          updated: result.updated,
        },
      );
    }

    return Response.json({ ok: true, intent } satisfies AdditionalActionResult);
  } catch (error) {
    const errorMessage = (error as Error).message || "";
    logger.error("Failed to save settings", { shopDomain }, {
      message: errorMessage,
    });

    let lang = resolveUILanguageFromRequest(request, "中文");
    try {
      const settings = await getSettings(shopDomain);
      lang = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");
    } catch {
      // ignore
    }

    let friendlyMessage: string;
    if (errorMessage.includes("noteAttributes") || errorMessage.includes("doesn't exist on type")) {
      friendlyMessage = lang === "English"
        ? "Query compatibility issue detected. Retrying with fallback query..."
        : "检测到查询兼容性问题，正在切换备用查询...";
    } else if (errorMessage.includes("query failed") || errorMessage.includes("GraphQL")) {
      friendlyMessage = lang === "English"
        ? "Shopify API temporarily unavailable. Please try again."
        : "Shopify API 暂时不可用，请稍后重试。";
    } else if (errorMessage.includes("timeout") || errorMessage.includes("timed out")) {
      friendlyMessage = lang === "English"
        ? "Request timed out. Please try again."
        : "请求超时，请稍后重试。";
    } else {
      friendlyMessage = lang === "English"
        ? "Operation failed. Please check settings and retry."
        : "操作失败，请检查设置后重试。";
    }

    return Response.json(
      { ok: false, message: friendlyMessage } satisfies AdditionalActionResult,
      { status: 400 },
    );
  }
}

export type AdditionalLoaderData = Awaited<ReturnType<typeof loadAdditionalPageData>>;
