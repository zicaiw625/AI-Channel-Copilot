import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { FEATURES, hasFeature } from "../lib/access.server";
import { getSettings, saveSettings } from "../lib/settings.server";
import { getLlmsStatus, syncLlmsTxt } from "../lib/llms.server";
import { logger } from "../lib/logger.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session?.shop || "";

  if (!shopDomain || !admin) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const canManageLlms = await hasFeature(shopDomain, FEATURES.LLMS_BASIC);
  if (!canManageLlms) {
    return Response.json({ ok: false, message: "Upgrade required" }, { status: 403 });
  }

  const canUseAdvanced = await hasFeature(shopDomain, FEATURES.LLMS_ADVANCED);

  try {
    const formData = await request.formData();
    const rawExposurePreferences = formData.get("exposurePreferences");
    const currentSettings = await getSettings(shopDomain);

    let nextSettings = currentSettings;

    if (typeof rawExposurePreferences === "string" && rawExposurePreferences.trim()) {
      try {
        const parsed = JSON.parse(rawExposurePreferences) as Partial<typeof currentSettings.exposurePreferences>;
        nextSettings = {
          ...currentSettings,
          exposurePreferences: {
            exposeProducts:
              typeof parsed.exposeProducts === "boolean"
                ? parsed.exposeProducts
                : currentSettings.exposurePreferences.exposeProducts,
            exposeCollections:
              typeof parsed.exposeCollections === "boolean"
                ? parsed.exposeCollections
                : currentSettings.exposurePreferences.exposeCollections,
            exposeBlogs:
              typeof parsed.exposeBlogs === "boolean"
                ? parsed.exposeBlogs
                : currentSettings.exposurePreferences.exposeBlogs,
          },
        };
      } catch {
        return Response.json({ ok: false, message: "Invalid exposure preferences" }, { status: 400 });
      }
    }

    const hasRequestedExposure =
      nextSettings.exposurePreferences.exposeProducts ||
      nextSettings.exposurePreferences.exposeCollections ||
      nextSettings.exposurePreferences.exposeBlogs;

    if (!hasRequestedExposure) {
      nextSettings = {
        ...nextSettings,
        exposurePreferences: {
          ...nextSettings.exposurePreferences,
          exposeProducts: true,
        },
      };
    }

    await saveSettings(shopDomain, nextSettings);

    const syncResult = await syncLlmsTxt(shopDomain, admin, nextSettings, {
      persistSettings: false,
      autoEnableProducts: false,
    });
    const statusInfo = await getLlmsStatus(shopDomain, syncResult.settings);

    return Response.json({
      ok: true,
      status: statusInfo.status,
      publicUrl: statusInfo.publicUrl,
      cachedAt: statusInfo.cachedAt?.toISOString() || null,
      exposurePreferences: syncResult.settings.exposurePreferences,
      autoEnabledProducts: !hasRequestedExposure,
      text: canUseAdvanced ? syncResult.text : undefined,
    });
  } catch (error) {
    logger.error("[llms-sync] Failed to sync llms.txt", { shopDomain }, {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ ok: false, message: "Failed to sync llms.txt" }, { status: 500 });
  }
};
