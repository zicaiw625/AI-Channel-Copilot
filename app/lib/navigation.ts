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

// ============================================================================
// Route context helpers (tab / backTo / fromTab)
// ============================================================================

export const WORKSPACE_TABS = ["schema", "faq", "llms"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export type BackTo = "dashboard" | "workspace" | "optimization" | "additional";

const WORKSPACE_TABS_SET = new Set<WorkspaceTab>(WORKSPACE_TABS);

function parseToSearchParams(search: string | URLSearchParams) {
  return toSearchParams(search);
}

export function parseBackTo(value: string | null): BackTo | null {
  if (!value) return null;
  const v = value.trim();
  if (v === "dashboard") return "dashboard";
  if (v === "workspace") return "workspace";
  if (v === "optimization") return "optimization";
  if (v === "additional") return "additional";
  return null;
}

export function parseWorkspaceTab(value: string | null | undefined, fallback: WorkspaceTab = "llms"): WorkspaceTab {
  if (!value) return fallback;
  const v = value.trim();
  return WORKSPACE_TABS_SET.has(v as WorkspaceTab) ? (v as WorkspaceTab) : fallback;
}

export function parseAiVisibilityTab(value: string | null | undefined): WorkspaceTab {
  return parseWorkspaceTab(value, "llms");
}

export function buildDashboardHref(search: string | URLSearchParams) {
  return buildEmbeddedAppPath("/app", search, { backTo: null, fromTab: null, tab: null });
}

export function buildAiVisibilityHref(
  search: string | URLSearchParams,
  {
    tab,
    fromTab,
    backTo,
    hash,
  }: {
    tab?: WorkspaceTab;
    fromTab?: WorkspaceTab | null;
    backTo?: BackTo | null;
    hash?: string;
  } = {},
) {
  return buildEmbeddedAppPath(
    "/app/ai-visibility",
    search,
    {
      tab: tab ?? "llms",
      fromTab: fromTab ?? null,
      backTo: backTo ?? null,
    },
    hash,
  );
}

export function buildOptimizationHref(
  search: string | URLSearchParams,
  {
    backTo,
    fromTab,
    hash,
  }: {
    backTo?: BackTo | null;
    fromTab?: WorkspaceTab | null;
    hash?: string;
  } = {},
) {
  return buildEmbeddedAppPath(
    "/app/optimization",
    search,
    {
      backTo: backTo ?? null,
      fromTab: fromTab ?? null,
      tab: null,
    },
    hash,
  );
}

export function buildFunnelHref(
  search: string | URLSearchParams,
  {
    backTo,
    fromTab,
    optimizationBackTo,
    hash,
  }: {
    backTo?: BackTo | null;
    fromTab?: WorkspaceTab | null;
    optimizationBackTo?: BackTo | null;
    hash?: string;
  } = {},
) {
  return buildEmbeddedAppPath(
    "/app/funnel",
    search,
    {
      backTo: backTo ?? null, // funnel back arrow target
      fromTab: fromTab ?? null, // workspace tab context for returning into optimization
      tab: null,
      optimizationBackTo: optimizationBackTo ?? null, // preserve optimization page's original backTo
    },
    hash,
  );
}

export function buildUTMWizardHref(search: string | URLSearchParams, { backTo }: { backTo?: BackTo | null } = {}) {
  return buildEmbeddedAppPath("/app/utm-wizard", search, { backTo: backTo ?? null, fromTab: null, tab: null });
}

export function buildAttributionHref(search: string | URLSearchParams, { backTo }: { backTo?: BackTo | null } = {}) {
  // 允许保留来自 ai-visibility/optimization 的 tab/fromTab 上下文；
  // additional 页面用于“返回 AI SEO 工作台”时可以据此恢复正确的 workspace tab。
  return buildEmbeddedAppPath("/app/additional/attribution", search, { backTo: backTo ?? null });
}

export function buildBillingHref(search: string | URLSearchParams) {
  return buildEmbeddedAppPath("/app/billing", search, { backTo: null, fromTab: null, tab: null });
}

// ----------------------------------------------------------------------------
// Back href builders (for pages that show a back arrow)
// ----------------------------------------------------------------------------

export function buildOptimizationBackHref(search: string | URLSearchParams) {
  const params = parseToSearchParams(search);
  const backTo = parseBackTo(params.get("backTo"));
  const fromTab = parseWorkspaceTab(params.get("fromTab"), "llms");

  return backTo === "dashboard"
    ? buildDashboardHref(params)
    : buildAiVisibilityHref(params, { tab: fromTab, fromTab: null, backTo: null });
}

export function buildFunnelBackHref(search: string | URLSearchParams) {
  const params = parseToSearchParams(search);
  const backTo = parseBackTo(params.get("backTo"));
  const fromTab = parseWorkspaceTab(params.get("fromTab"), "llms");
  const optimizationBackTo = parseBackTo(params.get("optimizationBackTo"));

  return backTo === "dashboard"
    ? buildDashboardHref(params)
    : buildOptimizationHref(params, { backTo: optimizationBackTo, fromTab });
}

export function buildUTMWizardBackHref(search: string | URLSearchParams) {
  const params = parseToSearchParams(search);
  const backTo = parseBackTo(params.get("backTo"));
  return backTo === "dashboard"
    ? buildDashboardHref(params)
    : buildAttributionHref(params, { backTo: null });
}

export function buildAdditionalBackHref(search: string | URLSearchParams) {
  const params = parseToSearchParams(search);
  const backTo = parseBackTo(params.get("backTo"));
  const tabFromQuery = parseWorkspaceTab(params.get("tab") ?? params.get("fromTab"), "llms");
  return backTo === "dashboard"
    ? buildDashboardHref(params)
    : buildAiVisibilityHref(params, { tab: tabFromQuery, fromTab: null, backTo: null });
}

