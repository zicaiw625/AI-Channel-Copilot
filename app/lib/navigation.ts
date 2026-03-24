import { normalizeLanguageSearchParams } from "./language";

const SHOPIFY_CONTEXT_KEYS = ["host", "embedded", "locale"] as const;

type ParamValue = string | null | undefined;

function toSearchParams(search: string | URLSearchParams) {
  return new URLSearchParams(typeof search === "string" ? search : search.toString());
}

export function getShopifyContextParams(search: string | URLSearchParams) {
  const source = toSearchParams(search);
  const params = new URLSearchParams();

  for (const key of SHOPIFY_CONTEXT_KEYS) {
    const value = source.get(key);
    if (value) {
      params.set(key, value);
    }
  }

  return params;
}

export function getPreservedSearchParams(search: string | URLSearchParams) {
  return normalizeLanguageSearchParams(toSearchParams(search));
}

export function buildEmbeddedAppPath(
  path: string,
  search: string | URLSearchParams,
  extraParams?: Record<string, ParamValue>,
  hash?: string,
) {
  const params = getPreservedSearchParams(search);

  for (const [key, value] of Object.entries(extraParams ?? {})) {
    if (value == null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const resolvedHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";

  return `${path}${query ? `?${query}` : ""}${resolvedHash}`;
}

export function buildEmbeddedAppUrl(
  requestUrl: string | URL,
  path: string,
  extraParams?: Record<string, ParamValue>,
  hash?: string,
) {
  const url = typeof requestUrl === "string" ? new URL(requestUrl) : new URL(requestUrl.toString());
  return new URL(buildEmbeddedAppPath(path, url.search, extraParams, hash), url.origin);
}

export const APP_PATHS = {
  dashboard: "/app",
  aiSeoWorkspace: "/app/ai-seo/workspace",
  aiSeoOptimization: "/app/ai-seo/optimization",
  aiSeoFunnel: "/app/ai-seo/funnel",
  attributionRules: "/app/attribution/rules",
  attributionDiagnostics: "/app/attribution/diagnostics",
  attributionExport: "/app/attribution/export",
  attributionHealth: "/app/attribution/health",
  attributionUtmWizard: "/app/attribution/utm-wizard",
  billing: "/app/billing",
  advancedTools: "/app/advanced-tools",
} as const;

export function toAppRoute(
  path: string,
  search: string | URLSearchParams,
  extraParams?: Record<string, ParamValue>,
  hash?: string,
) {
  return buildEmbeddedAppPath(path, search, extraParams, hash);
}

export const WORKSPACE_TABS = ["schema", "faq", "llms"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const WORKSPACE_TABS_SET = new Set<WorkspaceTab>(WORKSPACE_TABS);

export function parseWorkspaceTab(value: string | null | undefined, fallback: WorkspaceTab = "llms"): WorkspaceTab {
  if (!value) return fallback;
  const v = value.trim();
  return WORKSPACE_TABS_SET.has(v as WorkspaceTab) ? (v as WorkspaceTab) : fallback;
}

export function parseAiVisibilityTab(value: string | null | undefined): WorkspaceTab {
  return parseWorkspaceTab(value, "llms");
}

export const UTM_WIZARD_TABS = ["single", "bulk"] as const;
export type UtmWizardTab = (typeof UTM_WIZARD_TABS)[number];

const UTM_WIZARD_TABS_SET = new Set<UtmWizardTab>(UTM_WIZARD_TABS);

export function parseUtmTab(value: string | null | undefined, fallback: UtmWizardTab = "single"): UtmWizardTab {
  if (!value) return fallback;
  const v = value.trim();
  return UTM_WIZARD_TABS_SET.has(v as UtmWizardTab) ? (v as UtmWizardTab) : fallback;
}

const DASHBOARD_CLEAR: Record<string, ParamValue> = {
  backTo: null,
  fromTab: null,
  tab: null,
  utmTab: null,
  optimizationBackTo: null,
};

export function buildDashboardHref(search: string | URLSearchParams) {
  return buildEmbeddedAppPath(APP_PATHS.dashboard, search, DASHBOARD_CLEAR);
}

export function buildAiVisibilityHref(
  search: string | URLSearchParams,
  { tab, hash }: { tab?: WorkspaceTab; hash?: string } = {},
) {
  return buildEmbeddedAppPath(
    APP_PATHS.aiSeoWorkspace,
    search,
    {
      ...DASHBOARD_CLEAR,
      tab: tab ?? "llms",
    },
    hash,
  );
}

export function buildOptimizationHref(search: string | URLSearchParams, { hash }: { hash?: string } = {}) {
  return buildEmbeddedAppPath(APP_PATHS.aiSeoOptimization, search, { ...DASHBOARD_CLEAR, tab: null }, hash);
}

export function buildFunnelHref(search: string | URLSearchParams, { hash }: { hash?: string } = {}) {
  return buildEmbeddedAppPath(APP_PATHS.aiSeoFunnel, search, { ...DASHBOARD_CLEAR, tab: null }, hash);
}

export function buildUTMWizardHref(
  search: string | URLSearchParams,
  { utmTab }: { utmTab?: UtmWizardTab | null } = {},
) {
  return buildEmbeddedAppPath(APP_PATHS.attributionUtmWizard, search, {
    ...DASHBOARD_CLEAR,
    tab: null,
    utmTab: utmTab ?? "single",
  });
}

export function buildAttributionHref(search: string | URLSearchParams) {
  return buildEmbeddedAppPath(APP_PATHS.attributionRules, search, { ...DASHBOARD_CLEAR, utmTab: null });
}

export function buildBillingHref(search: string | URLSearchParams) {
  return buildEmbeddedAppPath(APP_PATHS.billing, search, DASHBOARD_CLEAR);
}
