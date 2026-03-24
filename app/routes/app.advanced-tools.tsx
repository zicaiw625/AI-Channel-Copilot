import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { resolveUILanguageFromRequest } from "../lib/language.server";
import { useUILanguage } from "../lib/useUILanguage";
import { hasFeature, FEATURES } from "../lib/access.server";
import styles from "../styles/app.dashboard.module.css";
import {
  APP_PATHS,
  buildAiVisibilityHref,
  buildAttributionHref,
  buildDashboardHref,
  buildEmbeddedAppPath,
  buildFunnelHref,
  buildOptimizationHref,
  buildUTMWizardHref,
} from "../lib/navigation";
import { t, type Lang } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) throw auth;
  const { session } = auth;
  const shopDomain = session.shop;
  const settings = await getSettings(shopDomain);
  const language = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");
  const canUseCopilot = await hasFeature(shopDomain, FEATURES.COPILOT);
  const canUseGrowthTools = await hasFeature(shopDomain, FEATURES.MULTI_STORE);
  return { language, canUseCopilot, canUseGrowthTools };
};

export default function AdvancedTools() {
  const { language, canUseCopilot, canUseGrowthTools } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const lang = uiLanguage as Lang;
  const location = useLocation();
  const search = location.search;
  const dashboardHref = buildDashboardHref(search);
  const attributionHref = buildAttributionHref(search);
  const diagnosticsHref = buildEmbeddedAppPath(APP_PATHS.attributionDiagnostics, search, { utmTab: null });
  const exportsHref = buildEmbeddedAppPath(APP_PATHS.attributionExport, search, { utmTab: null });
  const healthHref = buildEmbeddedAppPath(APP_PATHS.attributionHealth, search, { utmTab: null });
  const utmWizardHref = buildUTMWizardHref(search);
  const copilotHref = buildEmbeddedAppPath("/app/copilot", search);
  const multiStoreHref = buildEmbeddedAppPath("/app/multi-store", search);
  const teamHref = buildEmbeddedAppPath("/app/team", search);
  const webhookExportHref = buildEmbeddedAppPath("/app/webhook-export", search);
  const funnelHref = buildFunnelHref(search);
  const optimizationHref = buildOptimizationHref(search);
  const aiWorkspaceHref = buildAiVisibilityHref(search, { tab: "llms" });
  const en = uiLanguage === "English";
  const shopify = useAppBridge();

  return (
    <s-page heading={t(lang, "advanced_tools_page_heading")}>
      <div className={styles.page}>
        <div style={{ marginBottom: 16 }}>
          <Link to={dashboardHref} className={styles.secondaryButton}>
            ← {en ? "Back to Dashboard" : "返回仪表盘"}
          </Link>
        </div>
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{t(lang, "dashboard_tools_label")}</p>
              <h3 className={styles.sectionTitle}>{t(lang, "advanced_tools_page_heading")}</h3>
            </div>
          </div>
          <p className={styles.helpText}>{t(lang, "advanced_tools_intro")}</p>
          <div className={styles.toolGrid}>
            <Link to={aiWorkspaceHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_open_ai_workspace")}
            </Link>
            <Link to={optimizationHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_go_to_optimization")}
            </Link>
            <Link to={funnelHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_tool_funnel")}
            </Link>
            <Link to={attributionHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_tool_attribution")}
            </Link>
            <Link to={diagnosticsHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_tool_diagnostics")}
            </Link>
            <Link to={exportsHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_tool_exports")}
            </Link>
            <Link to={healthHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_tool_system_health")}
            </Link>
            <Link to={utmWizardHref} className={styles.secondaryButton}>
              {t(lang, "dashboard_tool_utm_wizard")}
            </Link>
            {canUseCopilot ? (
              <Link to={copilotHref} className={styles.secondaryButton}>
                Copilot
              </Link>
            ) : (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() =>
                  shopify.toast.show?.(
                    en ? "Upgrade to Pro or Growth to unlock Copilot." : "升级到 Pro 或 Growth 版以解锁 Copilot。",
                  )
                }
              >
                {t(lang, "dashboard_tool_copilot_growth")}
              </button>
            )}
            {canUseGrowthTools ? (
              <>
                <Link to={multiStoreHref} className={styles.secondaryButton}>
                  {t(lang, "dashboard_tool_multi_store")}
                </Link>
                <Link to={teamHref} className={styles.secondaryButton}>
                  {t(lang, "dashboard_tool_team")}
                </Link>
                <Link to={webhookExportHref} className={styles.secondaryButton}>
                  {t(lang, "dashboard_tool_webhook_export")}
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() =>
                    shopify.toast.show?.(
                      en ? "Upgrade to Growth to unlock Multi-Store." : "升级到 Growth 版以解锁多店铺汇总。",
                    )
                  }
                >
                  {t(lang, "dashboard_tool_multi_store_growth")}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() =>
                    shopify.toast.show?.(en ? "Upgrade to Growth to unlock Team." : "升级到 Growth 版以解锁团队功能。")
                  }
                >
                  {t(lang, "dashboard_tool_team_growth")}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() =>
                    shopify.toast.show?.(
                      en ? "Upgrade to Growth to unlock Webhook Export." : "升级到 Growth 版以解锁 Webhook 导出。",
                    )
                  }
                >
                  {t(lang, "dashboard_tool_webhook_export_growth")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
