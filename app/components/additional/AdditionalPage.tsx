import { useAppBridge } from "@shopify/app-bridge-react";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useFetcher, useLocation, useNavigate } from "react-router";

import {
  channelList,
  defaultSettings,
  type AIChannel,
  type AiDomainRule,
  type TimeRangeKey,
  type UtmSourceRule,
} from "../../lib/aiData";
import {
  BACKFILL_COOLDOWN_MINUTES,
  BACKFILL_STALE_THRESHOLD_SECONDS,
  LANGUAGE_EVENT,
  LANGUAGE_STORAGE_KEY,
  MAX_BACKFILL_DURATION_MS,
  MAX_BACKFILL_DAYS,
  MAX_BACKFILL_ORDERS,
} from "../../lib/constants";
import { downloadFromApi } from "../../lib/downloadUtils";
import { t } from "../../lib/i18n";
import {
  buildEmbeddedAppPath,
  buildAdditionalBackHref,
  buildAiVisibilityHref,
  buildDashboardHref,
  getPreservedSearchParams,
  buildUTMWizardHref,
  parseBackTo,
  parseWorkspaceTab,
} from "../../lib/navigation";
import { LlmsTxtPanel } from "../seo/LlmsTxtPanel";
import styles from "../../styles/app.settings.module.css";

import type {
  AdditionalActionResult,
  AdditionalLoaderData,
} from "../../lib/additional.server";

export type Lang = "English" | "中文";

type AdditionalSectionKey =
  | "attribution"
  | "diagnostics"
  | "export"
  | "health";

function isValidDomain(value: string) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim());
}

function isValidUtmSource(value: string) {
  return /^[a-z0-9_-]+$/i.test(value.trim());
}

interface AdditionalNavItem {
  key: AdditionalSectionKey;
  label: string;
  href: string;
}

export interface AdditionalController {
  data: AdditionalLoaderData;
  language: Lang;
  locale: "en-US" | "zh-CN";
  domains: AiDomainRule[];
  newDomain: string;
  newDomainChannel: AIChannel | "Other-AI";
  utmMappings: UtmSourceRule[];
  newSource: string;
  newSourceChannel: AIChannel | "Other-AI";
  utmMediumInput: string;
  utmMediumKeywords: string[];
  tagging: AdditionalLoaderData["settings"]["tagging"];
  exposurePreferences: AdditionalLoaderData["settings"]["exposurePreferences"];
  timezone: string;
  gmvMetric: string;
  exportWindow: TimeRangeKey;
  advancedExpanded: boolean;
  dashboardHref: string;
  workspaceHref: string;
  backHref: string;
  backLabel: string;
  utmWizardHref: string;
  additionalActionHref: string;
  navItems: AdditionalNavItem[];
  confirmModal: { open: boolean; rule: AiDomainRule | null };
  confirmUtmModal: { open: boolean; rule: UtmSourceRule | null };
  setNewDomain: (value: string) => void;
  setNewDomainChannel: (value: AIChannel | "Other-AI") => void;
  setNewSource: (value: string) => void;
  setNewSourceChannel: (value: AIChannel | "Other-AI") => void;
  setUtmMediumInput: (value: string) => void;
  setTagging: Dispatch<SetStateAction<AdditionalLoaderData["settings"]["tagging"]>>;
  setExposurePreferences: Dispatch<SetStateAction<AdditionalLoaderData["settings"]["exposurePreferences"]>>;
  setTimezone: (value: string) => void;
  setGmvMetric: Dispatch<SetStateAction<"current_total_price" | "subtotal_price">>;
  setExportWindow: (value: TimeRangeKey) => void;
  setAdvancedExpanded: Dispatch<SetStateAction<boolean>>;
  setConfirmModal: Dispatch<SetStateAction<{ open: boolean; rule: AiDomainRule | null }>>;
  setConfirmUtmModal: Dispatch<SetStateAction<{ open: boolean; rule: UtmSourceRule | null }>>;
  submitSettings: () => void;
  addDomain: () => void;
  removeDomain: (rule: AiDomainRule) => void;
  confirmRemoveDomain: () => void;
  addUtmMapping: () => void;
  removeUtmMapping: (rule: UtmSourceRule) => void;
  confirmRemoveUtm: () => void;
  resetToDefaults: () => void;
  triggerBackfill: () => void;
  triggerTagWrite: () => void;
  handleDownload: (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    url: string,
    fallbackFilename: string,
  ) => Promise<void>;
  updateExportWindow: (value: TimeRangeKey) => void;
  applyLanguageChange: (next: Lang) => void;
}

function getSectionCopy(language: Lang, section: AdditionalSectionKey) {
  const en = language === "English";

  switch (section) {
    case "attribution":
      return {
        title: en ? "Attribution, Tracking, and Advanced Controls" : "归因、追踪与高级控制",
        description: t(language, "settings_lede_desc"),
      };
    case "diagnostics":
      return {
        title: en ? "Diagnostics and Attribution Checks" : "诊断与归因排查",
        description: en
          ? "Inspect recent signals and debug why a visit or order was or was not attributed to an AI channel."
          : "检查最近订单信号，排查访问或订单为何被识别或未被识别为 AI 渠道。",
      };
    case "export":
      return {
        title: en ? "Export AI-attributed data" : "导出 AI 归因数据",
        description: en
          ? "Download AI-attributed orders, product summaries, and customer LTV snapshots for deeper analysis."
          : "下载 AI 归因订单、商品汇总和客户 LTV 快照，便于进一步分析。",
      };
    case "health":
      return {
        title: en ? "System health and pipeline status" : "系统健康度与采集状态",
        description: en
          ? "Monitor webhook delivery, backfill activity, queue backlog, and write-back health in one place."
          : "统一查看 Webhook 投递、补拉活动、队列积压和标签回写健康状态。",
      };
  }
}

export function useAdditionalController(data: AdditionalLoaderData): AdditionalController {
  const shopify = useAppBridge();
  const fetcher = useFetcher<AdditionalActionResult>();
  const navigate = useNavigate();
  const location = useLocation();

  const [domains, setDomains] = useState<AiDomainRule[]>(data.settings.aiDomains);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainChannel, setNewDomainChannel] = useState<AIChannel | "Other-AI">("Other-AI");
  const [utmMappings, setUtmMappings] = useState<UtmSourceRule[]>(data.settings.utmSources);
  const [newSource, setNewSource] = useState("");
  const [newSourceChannel, setNewSourceChannel] = useState<AIChannel | "Other-AI">("Other-AI");
  const [utmMediumInput, setUtmMediumInput] = useState(data.settings.utmMediumKeywords.join(", "));
  const [tagging, setTagging] = useState(data.settings.tagging);
  const [exposurePreferences, setExposurePreferences] = useState(data.settings.exposurePreferences);
  const [timezone, setTimezone] = useState(data.settings.timezones[0] || "UTC");
  const getInitialLanguage = () => {
    try {
      const cookieHeader = typeof document !== "undefined" ? document.cookie || "" : "";
      const cookieLanguageMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${LANGUAGE_STORAGE_KEY}=([^;]+)`));
      const cookieLanguage = cookieLanguageMatch ? decodeURIComponent(cookieLanguageMatch[1]) : null;
      if (cookieLanguage === "English" || cookieLanguage === "中文") return cookieLanguage as Lang;
    } catch {
      // ignore
    }
    return data.settings.languages[0] as Lang;
  };

  const [language, setLanguage] = useState<Lang>(getInitialLanguage);
  const [gmvMetric, setGmvMetric] = useState<"current_total_price" | "subtotal_price">(
    data.settings.gmvMetric === "subtotal_price" ? "subtotal_price" : "current_total_price",
  );
  const [exportWindow, setExportWindow] = useState<TimeRangeKey>(data.exportRange as TimeRangeKey);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; rule: AiDomainRule | null }>({ open: false, rule: null });
  const [confirmUtmModal, setConfirmUtmModal] = useState<{ open: boolean; rule: UtmSourceRule | null }>({ open: false, rule: null });
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  const locale = language === "English" ? "en-US" : "zh-CN";
  const backTo = location.search ? parseBackTo(new URLSearchParams(location.search).get("backTo")) : null;
  const dashboardHref = buildDashboardHref(location.search);
  const activeWorkspaceTab = parseWorkspaceTab(
    new URLSearchParams(location.search).get("tab") ?? new URLSearchParams(location.search).get("fromTab"),
    "llms",
  );
  const workspaceHref = buildAiVisibilityHref(location.search, { tab: activeWorkspaceTab, fromTab: null, backTo: null });
  const utmWizardHref = buildUTMWizardHref(location.search, { backTo: "additional" });
  const backHref = buildAdditionalBackHref(location.search);
  const backLabel = backTo === "dashboard"
    ? (language === "English" ? "Back to Dashboard" : "返回仪表盘")
    : (language === "English" ? "Back to AI SEO Workspace" : "返回 AI SEO 工作台");
  const additionalActionHref = buildEmbeddedAppPath("/app/additional", location.search);
  const navItems: AdditionalNavItem[] = [
    {
      key: "attribution",
      label: language === "English" ? "Attribution" : "归因规则",
      href: buildEmbeddedAppPath("/app/additional/attribution", location.search, { backTo }),
    },
    {
      key: "diagnostics",
      label: language === "English" ? "Diagnostics" : "诊断排查",
      href: buildEmbeddedAppPath("/app/additional/diagnostics", location.search, { backTo }),
    },
    {
      key: "export",
      label: language === "English" ? "Export" : "数据导出",
      href: buildEmbeddedAppPath("/app/additional/export", location.search, { backTo }),
    },
    {
      key: "health",
      label: language === "English" ? "System Health" : "系统健康",
      href: buildEmbeddedAppPath("/app/additional/health", location.search, { backTo }),
    },
  ];

  const utmMediumKeywords = useMemo(
    () =>
      utmMediumInput
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    [utmMediumInput],
  );

  const sanitizedDomains = useMemo(() => {
    const seen = new Set<string>();
    return domains.filter((rule) => {
      const key = `${rule.domain}::${rule.channel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [domains]);

  const sanitizedUtmSources = useMemo(() => {
    const seen = new Set<string>();
    return utmMappings.filter((rule) => {
      const key = rule.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [utmMappings]);

  const submitPayload = useCallback((payload: Record<string, string>) => {
    fetcher.submit(payload, {
      method: "post",
      encType: "application/x-www-form-urlencoded",
      action: additionalActionHref,
    });
  }, [additionalActionHref, fetcher]);

  const buildSettingsPayload = useCallback((nextLanguage = language) => ({
    aiDomains: sanitizedDomains,
    utmSources: sanitizedUtmSources,
    utmMediumKeywords,
    gmvMetric,
    primaryCurrency: data.settings.primaryCurrency,
    tagging,
    exposurePreferences,
    languages: [nextLanguage, ...data.settings.languages.filter((item) => item !== nextLanguage)],
    timezones: [timezone, ...data.settings.timezones.filter((item) => item !== timezone)],
    pipelineStatuses: data.settings.pipelineStatuses,
  }), [
    data.settings.languages,
    data.settings.pipelineStatuses,
    data.settings.primaryCurrency,
    data.settings.timezones,
    exposurePreferences,
    gmvMetric,
    language,
    sanitizedDomains,
    sanitizedUtmSources,
    tagging,
    timezone,
    utmMediumKeywords,
  ]);

  // 语言彻底统一：以 cookie 为准；cookie 不存在时才回退 localStorage
  useEffect(() => {
    try {
      const cookieHeader = document.cookie || "";
      const cookieLanguageMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${LANGUAGE_STORAGE_KEY}=([^;]+)`));
      const cookieLanguage = cookieLanguageMatch ? decodeURIComponent(cookieLanguageMatch[1]) : null;

      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const next =
        cookieLanguage === "English" || cookieLanguage === "中文"
          ? cookieLanguage
          : stored === "English" || stored === "中文"
            ? stored
            : null;

      if (next) {
        setLanguage(next);
        document.cookie = `${LANGUAGE_STORAGE_KEY}=${encodeURIComponent(next)};path=/;max-age=31536000;SameSite=Lax`;
      }
    } catch {
      // ignore
    }
  }, []);

  // 如果用户在其他页面切语言（通过 CustomEvent），这里同步更新
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Lang | undefined;
      if (detail === "English" || detail === "中文") setLanguage(detail);
    };

    window.addEventListener(LANGUAGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(LANGUAGE_EVENT, handler as EventListener);
  }, []);

  useEffect(() => {
    const hash = location.hash;
    if (!hash) return;

    const timer = setTimeout(() => {
      const element = document.querySelector(hash);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.classList.add("highlight-target");
      setTimeout(() => element.classList.remove("highlight-target"), 2000);
    }, 100);

    return () => clearTimeout(timer);
  }, [location.hash]);

  useEffect(() => {
    if (!fetcher.data) return;

    if (fetcher.data.ok) {
      const message =
        fetcher.data.intent === "tag"
          ? (language === "English" ? "Tag write-back triggered (based on last 60 days AI orders)" : "标签写回已触发（基于最近 60 天 AI 订单）")
          : fetcher.data.intent === "backfill"
            ? (language === "English" ? "Backfilled last 60 days (including AI detection)" : "已补拉最近 60 天订单（含 AI 识别）")
            : (language === "English" ? "Settings saved" : "设置已保存");
      shopify.toast.show?.(message);
      return;
    }

    let friendlyMessage = fetcher.data.message || "";
    if (fetcher.data.errorCode === "pcd_not_approved") {
      friendlyMessage = language === "English"
        ? "Protected Customer Data access not approved. Please apply for PCD access in Shopify Partners Dashboard."
        : "应用尚未获得 Protected Customer Data 访问权限，请在 Shopify Partners Dashboard 申请。";
    } else if (fetcher.data.suggestReauth) {
      friendlyMessage = language === "English"
        ? `${fetcher.data.message} Please reinstall the app to grant updated permissions.`
        : `${fetcher.data.message} 请重新安装应用以授予最新权限。`;
    } else if (friendlyMessage.includes("noteAttributes") || friendlyMessage.includes("doesn't exist on type")) {
      friendlyMessage = language === "English"
        ? "Retrying with compatible query... Please try again."
        : "正在切换兼容查询，请重试...";
    } else if (friendlyMessage.includes("query failed") || friendlyMessage.includes("GraphQL")) {
      friendlyMessage = language === "English"
        ? "Shopify API error. Please try again later."
        : "Shopify API 错误，请稍后重试。";
    } else if (!friendlyMessage || friendlyMessage.includes("failed") || friendlyMessage.includes("error")) {
      friendlyMessage = language === "English"
        ? "Save failed. Check configuration or retry later."
        : "保存失败，请检查配置或稍后重试";
    }
    shopify.toast.show?.(friendlyMessage);
  }, [fetcher.data, language, shopify]);

  const submitSettings = useCallback(() => {
    submitPayload({ settings: JSON.stringify(buildSettingsPayload()) });
  }, [buildSettingsPayload, submitPayload]);

  const triggerBackfill = useCallback(() => {
    submitPayload({
      settings: JSON.stringify(buildSettingsPayload()),
      intent: "backfill",
    });
  }, [buildSettingsPayload, submitPayload]);

  const triggerTagWrite = useCallback(() => {
    submitPayload({
      settings: JSON.stringify(buildSettingsPayload()),
      intent: "tag",
    });
  }, [buildSettingsPayload, submitPayload]);

  const addDomain = useCallback(() => {
    if (!newDomain.trim()) return;
    if (!isValidDomain(newDomain)) {
      shopify.toast.show?.(language === "English" ? "Invalid domain format, e.g. chat.openai.com" : "域名格式不合法，请输入如 chat.openai.com");
      return;
    }
    const trimmed = newDomain.trim().toLowerCase();
    const exists = domains.some((rule) => rule.domain.toLowerCase() === trimmed);
    if (exists) {
      shopify.toast.show?.(language === "English" ? "This domain already exists in the list." : "该域名已存在于列表中。");
      return;
    }
    setDomains((previous) => [...previous, { domain: newDomain.trim(), channel: newDomainChannel, source: "custom" }]);
    setNewDomain("");
    shopify.toast.show?.(language === "English" ? "Custom AI domain added. Click Save to apply." : "已添加自定义 AI 域名，点击保存后生效");
  }, [domains, language, newDomain, newDomainChannel, shopify]);

  const removeDomain = useCallback((rule: AiDomainRule) => {
    if (rule.source === "default") {
      setConfirmModal({ open: true, rule });
      return;
    }
    setDomains((previous) =>
      previous.filter((item) => !(item.domain === rule.domain && item.channel === rule.channel)),
    );
  }, []);

  const confirmRemoveDomain = useCallback(() => {
    if (confirmModal.rule) {
      setDomains((previous) =>
        previous.filter((item) => !(item.domain === confirmModal.rule!.domain && item.channel === confirmModal.rule!.channel)),
      );
    }
    setConfirmModal({ open: false, rule: null });
  }, [confirmModal.rule]);

  const addUtmMapping = useCallback(() => {
    if (!newSource.trim()) return;
    const value = newSource.trim().toLowerCase();
    if (!isValidUtmSource(value)) {
      shopify.toast.show?.(language === "English" ? "utm_source supports letters/numbers/dash/underscore only" : "utm_source 仅支持字母/数字/中划线/下划线");
      return;
    }
    const exists = utmMappings.some((rule) => rule.value.toLowerCase() === value);
    if (exists) {
      shopify.toast.show?.(language === "English" ? "This utm_source value already exists in the list." : "该 utm_source 值已存在于列表中。");
      return;
    }
    setUtmMappings((previous) => [...previous, { value, channel: newSourceChannel, source: "custom" }]);
    setNewSource("");
    shopify.toast.show?.(language === "English" ? "utm_source rule added. Save to apply to detection." : "新增 utm_source 规则，保存后应用到识别逻辑");
  }, [language, newSource, newSourceChannel, shopify, utmMappings]);

  const removeUtmMapping = useCallback((rule: UtmSourceRule) => {
    if (rule.source === "default") {
      setConfirmUtmModal({ open: true, rule });
      return;
    }
    setUtmMappings((previous) => previous.filter((item) => item.value !== rule.value));
  }, []);

  const confirmRemoveUtm = useCallback(() => {
    if (confirmUtmModal.rule) {
      setUtmMappings((previous) => previous.filter((item) => item.value !== confirmUtmModal.rule!.value));
    }
    setConfirmUtmModal({ open: false, rule: null });
  }, [confirmUtmModal.rule]);

  const resetToDefaults = useCallback(() => {
    setDomains(defaultSettings.aiDomains);
    setUtmMappings(defaultSettings.utmSources);
    setUtmMediumInput(defaultSettings.utmMediumKeywords.join(", "));
    shopify.toast.show?.(language === "English" ? "Rules reset to defaults. Click Save to apply." : "已恢复默认规则，点击保存后生效");
  }, [language, shopify]);

  const handleDownload = useCallback(async (
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    url: string,
    fallbackFilename: string,
  ) => {
    event.preventDefault();
    if (!data.canExport) {
      shopify.toast.show?.(language === "English" ? "Upgrade to Pro or Growth to export data." : "升级到 Pro 或 Growth 版以导出数据。");
      return;
    }

    const success = await downloadFromApi(url, fallbackFilename, () => shopify.idToken());
    if (!success) {
      shopify.toast.show?.(language === "English" ? "Download failed. Please try again." : "下载失败，请重试。");
    }
  }, [data.canExport, language, shopify]);

  const updateExportWindow = useCallback((value: TimeRangeKey) => {
    setExportWindow(value);
    const params = getPreservedSearchParams(location.search);
    params.set("range", value);
    navigate({ search: `?${params.toString()}` });
  }, [location.search, navigate]);

  const applyLanguageChange = useCallback((next: Lang) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    try {
      document.cookie = `${LANGUAGE_STORAGE_KEY}=${encodeURIComponent(next)};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: next }));
    } catch {
      // ignore
    }
    submitPayload({ settings: JSON.stringify(buildSettingsPayload(next)) });
  }, [buildSettingsPayload, submitPayload]);

  return {
    data,
    language,
    locale,
    domains,
    newDomain,
    newDomainChannel,
    utmMappings,
    newSource,
    newSourceChannel,
    utmMediumInput,
    utmMediumKeywords,
    tagging,
    exposurePreferences,
    timezone,
    gmvMetric,
    exportWindow,
    advancedExpanded,
    dashboardHref,
    workspaceHref,
    backHref,
    backLabel,
    utmWizardHref,
    additionalActionHref,
    navItems,
    confirmModal,
    confirmUtmModal,
    setNewDomain,
    setNewDomainChannel,
    setNewSource,
    setNewSourceChannel,
    setUtmMediumInput,
    setTagging,
    setExposurePreferences,
    setTimezone,
    setGmvMetric,
    setExportWindow,
    setAdvancedExpanded,
    setConfirmModal,
    setConfirmUtmModal,
    submitSettings,
    addDomain,
    removeDomain,
    confirmRemoveDomain,
    addUtmMapping,
    removeUtmMapping,
    confirmRemoveUtm,
    resetToDefaults,
    triggerBackfill,
    triggerTagWrite,
    handleDownload,
    updateExportWindow,
    applyLanguageChange,
  };
}

function AdditionalSubnav({
  activeKey,
  items,
}: {
  activeKey: AdditionalSectionKey;
  items: AdditionalNavItem[];
}) {
  return (
    <div className={styles.inlineActions} style={{ marginTop: 12 }}>
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.href}
          className={item.key === activeKey ? styles.primaryButton : styles.secondaryButton}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function AdditionalPageLayout({
  activeKey,
  controller,
  children,
}: {
  activeKey: AdditionalSectionKey;
  controller: AdditionalController;
  children: ReactNode;
}) {
  const copy = getSectionCopy(controller.language, activeKey);

  return (
    <s-page heading={controller.language === "English" ? "Attribution & Advanced Settings" : "归因与高级设置"}>
      <div className={styles.page}>
        <div className={styles.inlineActions} style={{ marginBottom: 16 }}>
          <Link to={controller.backHref} className={styles.secondaryButton}>
            ← {controller.backLabel}
          </Link>
        </div>

        <div className={styles.lede}>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
          <div className={styles.alert}>{t(controller.language, "ai_conservative_alert")}</div>
          <p className={styles.helpText}>{t(controller.language, "default_rules_help")}</p>
          <p className={styles.helpText}>{t(controller.language, "tag_prefix_help")}</p>
          <div className={styles.inlineStats}>
            <span>
              {controller.language === "English" ? "Last webhook: " : "最近 webhook："}
              {controller.data.settings.lastOrdersWebhookAt
                ? new Date(controller.data.settings.lastOrdersWebhookAt).toLocaleString(controller.locale)
                : controller.language === "English" ? "None" : "暂无"}
            </span>
            <span>
              {controller.language === "English" ? "Last backfill: " : "最近补拉："}
              {controller.data.settings.lastBackfillAt
                ? new Date(controller.data.settings.lastBackfillAt).toLocaleString(controller.locale)
                : controller.language === "English" ? "None" : "暂无"}
            </span>
            <span>
              {controller.language === "English" ? "Last tagging: " : "最近标签写回："}
              {controller.data.settings.lastTaggingAt
                ? new Date(controller.data.settings.lastTaggingAt).toLocaleString(controller.locale)
                : controller.language === "English" ? "None" : "暂无"}
            </span>
            <span>
              {controller.language === "English" ? "Shop Currency: " : "店铺货币："}
              {controller.data.settings.primaryCurrency || "USD"}
            </span>
            {controller.data.clamped && (
              <span>
                {controller.language === "English"
                  ? "Hint: Export/Backfill is limited to the last 60 days (Shopify default)."
                  : "提示：导出/补拉已限制为最近 60 天内的订单窗口（Shopify 默认限制）。"}
              </span>
            )}
          </div>
          <AdditionalSubnav activeKey={activeKey} items={controller.navItems} />
        </div>

        {children}
      </div>
    </s-page>
  );
}

export function AttributionContent({ controller }: { controller: AdditionalController }) {
  const { language, data } = controller;

  return (
    <>
      <div className={styles.inlineActions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={controller.triggerBackfill}
          data-action="settings-backfill"
        >
          {language === "English" ? "Backfill Last 60 Days" : "补拉最近 60 天订单"}
        </button>
      </div>
      <div className={styles.alert}>{t(language, "backfill_protect_alert")}</div>
      <p className={styles.helpText}>{t(language, "backfill_help")}</p>

      <div className={`${styles.card} ${styles.tipCard}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h3 className={styles.sectionTitle}>
              {language === "English" ? "For better attribution accuracy" : "想要更准确的归因？"}
            </h3>
          </div>
        </div>
        <p>
          {language === "English"
            ? "Use our UTM Link Generator to create trackable links. When AI assistants share these links, attribution is more likely to map to the matching AI channel."
            : "请使用我们生成的带 UTM 链接进行投放。当 AI 助手分享这些链接时，归因结果更容易映射到对应的 AI 渠道。"}
        </p>
        <div className={styles.inlineActions}>
          <Link to={controller.utmWizardHref} className={styles.primaryButton}>
            {language === "English" ? "Generate UTM Links" : "生成 UTM 链接"}
          </Link>
        </div>
      </div>

      <div className={styles.card}>
        <div
          className={`${styles.sectionHeader} ${styles.collapsibleHeader}`}
          onClick={() => controller.setAdvancedExpanded((previous) => !previous)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              controller.setAdvancedExpanded((previous) => !previous);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div>
            <p className={styles.sectionLabel}>{language === "English" ? "Debugging" : "排错工具"}</p>
            <h3 className={styles.sectionTitle}>
              {language === "English" ? "Advanced Settings / Troubleshooting" : "高级设置 / 排错工具"}
            </h3>
            <p className={styles.helpText} style={{ marginTop: 4 }}>
              {language === "English"
                ? "Default rules cover major AI platforms. Expand only if attribution is inaccurate."
                : "默认规则已覆盖主流 AI 平台，无需修改。仅在归因不准确时展开排查。"}
            </p>
          </div>
          <div className={styles.inlineActions}>
            <span className={styles.badge}>{controller.advancedExpanded ? "▼" : "▶"}</span>
          </div>
        </div>

        {controller.advancedExpanded && (
          <div className={styles.collapsibleContent} style={{ marginTop: 12 }}>
            <div className={styles.inlineActions} style={{ marginBottom: 16 }}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={controller.resetToDefaults}
              >
                {language === "English" ? "Reset to Default Rules" : "恢复默认规则"}
              </button>
              <span className={styles.helpText}>
                {language === "English"
                  ? "Restore all referrer/UTM rules to factory defaults"
                  : "将所有 referrer/UTM 规则恢复到出厂设置"}
              </span>
            </div>

            <div className={styles.gridTwo}>
              <div className={`${styles.card} ${styles.nestedCard}`}>
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.sectionLabel}>{t(language, "channels_section_label")}</p>
                    <h3 className={styles.sectionTitle}>{language === "English" ? "Referrer Domains" : "Referrer 域名表"}</h3>
                  </div>
                  <span className={styles.badge}>{t(language, "badge_priority_high")}</span>
                </div>
                <div className={styles.ruleList}>
                  {controller.domains.map((rule) => (
                    <div key={`${rule.domain}-${rule.channel}`} className={styles.ruleRow}>
                      <div>
                        <div className={styles.ruleTitle}>{rule.domain}</div>
                        <div className={styles.ruleMeta}>
                          {language === "English" ? "Channel: " : "渠道："}
                          {rule.channel} · {rule.source === "default" ? (language === "English" ? "Default" : "默认") : (language === "English" ? "Custom" : "自定义")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => controller.removeDomain(rule)}
                        data-action="settings-remove-domain"
                      >
                        {t(language, "btn_delete")}
                      </button>
                    </div>
                  ))}
                </div>
                <div className={styles.addFormSection}>
                  <p className={styles.addFormLabel}>
                    {language === "English" ? "Add Custom Domain" : "添加自定义域名"}
                  </p>
                  <div className={styles.inlineForm}>
                    <div className={styles.formField}>
                      <label className={styles.fieldLabelSmall}>{language === "English" ? "Domain" : "域名"}</label>
                      <input
                        className={styles.input}
                        placeholder={language === "English" ? "e.g. chat.example.com" : "例如 chat.example.com"}
                        value={controller.newDomain}
                        onChange={(event) => controller.setNewDomain(event.target.value)}
                      />
                    </div>
                    <div className={styles.formField}>
                      <label className={styles.fieldLabelSmall}>{language === "English" ? "Channel" : "渠道"}</label>
                      <select
                        className={styles.select}
                        value={controller.newDomainChannel}
                        onChange={(event) => controller.setNewDomainChannel(event.target.value as AIChannel | "Other-AI")}
                      >
                        {channelList.map((channel) => (
                          <option key={channel} value={channel}>
                            {channel}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className={styles.primaryButton} onClick={controller.addDomain}>
                      {t(language, "btn_add_domain")}
                    </button>
                  </div>
                  <p className={styles.helpTextSmall}>
                    {language === "English"
                      ? "Enter a referrer domain to match AI traffic. The domain will be mapped to the selected channel."
                      : "输入来源域名以匹配 AI 流量，该域名将映射到所选渠道。"}
                  </p>
                </div>
                <p className={styles.helpText}>{t(language, "referrer_help")}</p>
              </div>

              <div className={`${styles.card} ${styles.nestedCard}`}>
                <div className={styles.sectionHeader}>
                  <div>
                    <p className={styles.sectionLabel}>{language === "English" ? "UTM Rules" : "UTM 匹配规则"}</p>
                    <h3 className={styles.sectionTitle}>{language === "English" ? "utm_source → Channel Mapping" : "utm_source → 渠道映射"}</h3>
                  </div>
                  <span className={styles.badge}>{t(language, "badge_assist")}</span>
                </div>
                <div className={styles.ruleList}>
                  {controller.utmMappings.map((rule) => (
                    <div key={`${rule.value}-${rule.channel}`} className={styles.ruleRow}>
                      <div>
                        <div className={styles.ruleTitle}>{rule.value}</div>
                        <div className={styles.ruleMeta}>
                          {language === "English" ? "Channel: " : "渠道："}
                          {rule.channel} · {rule.source === "default" ? (language === "English" ? "Default" : "默认") : (language === "English" ? "Custom" : "自定义")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => controller.removeUtmMapping(rule)}
                        data-action="settings-remove-utm"
                      >
                        {t(language, "btn_delete")}
                      </button>
                    </div>
                  ))}
                </div>
                <div className={styles.addFormSection}>
                  <p className={styles.addFormLabel}>
                    {language === "English" ? "Add UTM Source Rule" : "添加 UTM 来源规则"}
                  </p>
                  <div className={styles.inlineForm}>
                    <div className={styles.formField}>
                      <label className={styles.fieldLabelSmall}>{language === "English" ? "utm_source value" : "utm_source 值"}</label>
                      <input
                        className={styles.input}
                        placeholder={language === "English" ? "e.g. chatgpt, perplexity" : "例如 chatgpt, perplexity"}
                        value={controller.newSource}
                        onChange={(event) => controller.setNewSource(event.target.value)}
                      />
                    </div>
                    <div className={styles.formField}>
                      <label className={styles.fieldLabelSmall}>{language === "English" ? "Channel" : "渠道"}</label>
                      <select
                        className={styles.select}
                        value={controller.newSourceChannel}
                        onChange={(event) => controller.setNewSourceChannel(event.target.value as AIChannel | "Other-AI")}
                      >
                        {channelList.map((channel) => (
                          <option key={channel} value={channel}>
                            {channel}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="button" className={styles.primaryButton} onClick={controller.addUtmMapping}>
                      {t(language, "btn_add_utm")}
                    </button>
                  </div>
                  <p className={styles.helpTextSmall}>
                    {language === "English"
                      ? "Match orders by utm_source parameter. If utm_source=chatgpt, map it to ChatGPT."
                      : "通过 utm_source 参数匹配订单。例如，当 utm_source=chatgpt 时，映射到 ChatGPT 渠道。"}
                  </p>
                </div>
                <label className={styles.stackField}>
                  <span className={styles.fieldLabel}>{language === "English" ? "utm_medium keywords (comma separated)" : "utm_medium 关键词（逗号分隔）"}</span>
                  <input
                    className={styles.input}
                    value={controller.utmMediumInput}
                    onChange={(event) => controller.setUtmMediumInput(event.target.value)}
                  />
                  <span className={styles.helpText}>
                    {language === "English" ? "Current keywords: " : "当前关键词："}
                    {controller.utmMediumKeywords.join(", ") || (language === "English" ? "None" : "无")}
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.gridTwo}>
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{language === "English" ? "Tag Write-back" : "标签写回"}</p>
              <h3 className={styles.sectionTitle}>{language === "English" ? "Control Shopify Tagging" : "控制 Shopify 标签行为"}</h3>
            </div>
            <div className={styles.inlineActions}>
              <button type="button" className={styles.secondaryButton} onClick={controller.submitSettings}>
                {t(language, "btn_save")}
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={controller.triggerTagWrite}
                disabled={!controller.tagging.writeOrderTags}
              >
                {t(language, "btn_write_tags_now")}
              </button>
            </div>
          </div>
          <div className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={controller.tagging.writeOrderTags}
              onChange={(event) => controller.setTagging((previous) => ({ ...previous, writeOrderTags: event.target.checked }))}
            />
            <div>
              <div className={styles.ruleTitle}>{language === "English" ? "Write AI channel tags to orders" : "向订单写回 AI 渠道标签"}</div>
              <div className={styles.ruleMeta}>
                {language === "English" ? "Prefix: " : "前缀："}
                {controller.tagging.orderTagPrefix}-ChatGPT / Perplexity / ...
              </div>
            </div>
          </div>
          <div className={styles.alert}>{t(language, "tagging_enable_alert")}</div>
          <label className={styles.stackField}>
            <span className={styles.fieldLabel}>{language === "English" ? "Order tag prefix" : "订单标签前缀"}</span>
            <input
              className={styles.input}
              value={controller.tagging.orderTagPrefix}
              onChange={(event) => controller.setTagging((previous) => ({ ...previous, orderTagPrefix: event.target.value }))}
            />
          </label>
          <p className={styles.helpText}>
            {language === "English"
              ? "Tags are off by default; when enabled, they write to Shopify orders for filtering/export."
              : "标签默认关闭；开启后会回写到 Shopify 订单，便于在后台过滤或导出。"}
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{language === "English" ? "Language / Timezone" : "语言 / 时区"}</p>
              <h3 className={styles.sectionTitle}>{language === "English" ? "Display Preferences & GMV Metric" : "展示偏好 & GMV 口径"}</h3>
            </div>
            <span className={styles.badge}>{t(language, "badge_ui_only")}</span>
          </div>
          <label className={styles.stackField}>
            <span className={styles.fieldLabel}>{language === "English" ? "Language" : "语言"}</span>
            <select
              className={styles.select}
              value={controller.language}
              onChange={(event) => controller.applyLanguageChange(event.target.value as Lang)}
            >
              {data.settings.languages.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className={styles.helpText}>
              {language === "English"
                ? "Language change auto-saves and updates llms.txt immediately."
                : "语言更改会自动保存并立即更新 llms.txt。"}
            </span>
          </label>
          <label className={styles.stackField}>
            <span className={styles.fieldLabel}>{language === "English" ? "Timezone" : "时区"}</span>
            <select
              className={styles.select}
              value={controller.timezone}
              onChange={(event) => controller.setTimezone(event.target.value)}
            >
              {data.settings.timezones.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.stackField}>
            <span className={styles.fieldLabel}>{language === "English" ? "GMV Metric" : "GMV 口径"}</span>
            <select
              className={styles.select}
              value={controller.gmvMetric}
              onChange={(event) => controller.setGmvMetric(event.target.value === "subtotal_price" ? "subtotal_price" : "current_total_price")}
            >
              <option value="current_total_price">{language === "English" ? "current_total_price (includes taxes/shipping)" : "current_total_price（含税/运费）"}</option>
              <option value="subtotal_price">{language === "English" ? "subtotal_price (excludes taxes/shipping)" : "subtotal_price（不含税/运费）"}</option>
            </select>
          </label>
          <p className={styles.helpText}>{t(language, "gmv_metric_help")}</p>
        </div>
      </div>

      <div id="llms-txt-settings" className={styles.card}>
        <LlmsTxtPanel
          language={language}
          shopDomain={data.shopDomain}
          initialStatus={data.llmsStatus}
          initialExposurePreferences={data.settings.exposurePreferences}
          exposurePreferences={controller.exposurePreferences}
          onExposurePreferencesChange={controller.setExposurePreferences}
          canManage={data.canManageLlms}
          canUseAdvanced={data.canUseLlmsAdvanced}
          editable={data.canManageLlms}
          context="settings"
        />
      </div>

      <ConfirmationModal
        open={controller.confirmModal.open}
        title={language === "English" ? "Confirm Removal" : "确认删除"}
        body={language === "English"
          ? "Removing a default domain may reduce attribution accuracy. Are you sure?"
          : "删除默认域名可能导致漏标，确定要移除这一项吗？"}
        confirmLabel={language === "English" ? "Remove" : "删除"}
        cancelLabel={language === "English" ? "Cancel" : "取消"}
        onCancel={() => controller.setConfirmModal({ open: false, rule: null })}
        onConfirm={controller.confirmRemoveDomain}
      />
      <ConfirmationModal
        open={controller.confirmUtmModal.open}
        title={language === "English" ? "Confirm Removal" : "确认删除"}
        body={language === "English"
          ? `Removing the default UTM rule "${controller.confirmUtmModal.rule?.value}" may reduce attribution accuracy. Are you sure?`
          : `删除默认 UTM 规则「${controller.confirmUtmModal.rule?.value}」可能导致漏标，确定要移除吗？`}
        confirmLabel={language === "English" ? "Remove" : "删除"}
        cancelLabel={language === "English" ? "Cancel" : "取消"}
        onCancel={() => controller.setConfirmUtmModal({ open: false, rule: null })}
        onConfirm={controller.confirmRemoveUtm}
      />
    </>
  );
}

export function DiagnosticsContent({ controller }: { controller: AdditionalController }) {
  if (!controller.data.showDebugPanels) {
    return (
      <div className={styles.card}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionLabel}>{controller.language === "English" ? "Diagnostics" : "诊断"}</p>
            <h3 className={styles.sectionTitle}>{controller.language === "English" ? "Recent Orders Diagnosis" : "最近订单诊断"}</h3>
          </div>
          <span className={styles.badge}>{controller.language === "English" ? "Unavailable" : "未开启"}</span>
        </div>
        <p className={styles.helpText}>
          {controller.language === "English"
            ? "Diagnostics panels are currently hidden. Enable debug panels in app flags to inspect recent order signals."
            : "当前未显示诊断面板。如需检查最近订单信号，请先在应用配置中开启调试面板。"}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>{controller.language === "English" ? "Debug" : "调试"}</p>
          <h3 className={styles.sectionTitle}>{controller.language === "English" ? "Recent Orders Diagnosis" : "最近订单诊断"}</h3>
        </div>
        <span className={styles.badge}>{controller.language === "English" ? "Admin" : "仅管理员"}</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{controller.language === "English" ? "Order" : "订单"}</th>
              <th>referrer</th>
              <th>landing</th>
              <th>utm_source</th>
              <th>utm_medium</th>
              <th>AI</th>
              <th>{controller.language === "English" ? "Detection" : "解析"}</th>
            </tr>
          </thead>
          <tbody>
            {(controller.data.ordersSample || []).map((order) => (
              <tr key={order.id}>
                <td>{order.name}</td>
                <td>{order.referrer || ""}</td>
                <td>{order.landingPage || ""}</td>
                <td>{order.utmSource || ""}</td>
                <td>{order.utmMedium || ""}</td>
                <td>{order.aiSource || ""}</td>
                <td>{order.detection || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.helpText}>
        {controller.language === "English"
          ? "Only shows a small sample for debugging attribution signals; referrer has priority over UTM."
          : "用于调试 AI 渠道识别，仅展示少量样本；referrer 识别优先于 UTM。"}
      </p>
    </div>
  );
}

export function ExportContent({ controller }: { controller: AdditionalController }) {
  const { language } = controller;

  return (
    <div className={styles.card}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>{language === "English" ? "Data Export" : "数据导出"}</p>
          <h3 className={styles.sectionTitle}>{language === "English" ? "CSV Download" : "CSV 下载"}</h3>
        </div>
        <span className={styles.badge}>{t(language, "badge_analysis")}</span>
      </div>
      <div className={styles.inlineForm}>
        <label className={styles.fieldLabel}>{language === "English" ? "Export Range" : "导出时间范围"}</label>
        <select
          className={styles.select}
          value={controller.exportWindow}
          onChange={(event) => controller.updateExportWindow(event.target.value as TimeRangeKey)}
        >
          <option value="30d">{language === "English" ? "Last 30 days" : "最近 30 天"}</option>
          <option value="90d">{language === "English" ? "Last 90 days" : "最近 90 天"}</option>
        </select>
        <span className={styles.helpText}>{language === "English" ? "Switch the range to regenerate exports." : "切换后将重新加载并生成对应区间的导出。"}</span>
      </div>

      {!controller.data.canExport && (
        <div className={styles.alert}>
          {language === "English"
            ? "Export features require a Pro subscription. Upgrade to download CSV files."
            : "导出功能需要 Pro 订阅。升级后可下载 CSV 文件。"}
        </div>
      )}

      <div className={styles.exportGrid}>
        <div className={styles.exportCard}>
          <h4>{language === "English" ? "AI Orders Details" : "AI 渠道订单明细"}</h4>
          <p>
            {language === "English"
              ? "Fields: order name, time, AI channel, GMV, referrer, landing_page, source_name, utm_source, utm_medium, detection and comparison IDs."
              : "字段：订单号、下单时间、AI 渠道、GMV、referrer、landing_page、source_name、utm_source、utm_medium、解析结果及对照 ID。"}
          </p>
          <a
            className={styles.primaryButton}
            href={controller.data.canExport ? `/api/export/orders?range=${controller.exportWindow}` : "#"}
            onClick={(event) => controller.handleDownload(event, `/api/export/orders?range=${controller.exportWindow}`, `ai-orders-${controller.exportWindow}.csv`)}
            style={!controller.data.canExport ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            {language === "English" ? "Download CSV" : "下载 CSV"}
          </a>
        </div>
        <div className={styles.exportCard}>
          <h4>{t(language, "products_section_title")}</h4>
          <p>
            {language === "English"
              ? "Fields: product title, AI orders, AI GMV, AI share, top channel, URL, product ID and handle."
              : "字段：产品名、AI 订单数、AI GMV、AI 占比、Top 渠道、URL、产品 ID 和 handle。"}
          </p>
          <a
            className={styles.secondaryButton}
            href={controller.data.canExport ? `/api/export/products?range=${controller.exportWindow}` : "#"}
            onClick={(event) => controller.handleDownload(event, `/api/export/products?range=${controller.exportWindow}`, `ai-products-${controller.exportWindow}.csv`)}
            style={!controller.data.canExport ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            {language === "English" ? "Download CSV" : "下载 CSV"}
          </a>
        </div>
        <div className={styles.exportCard}>
          <h4>{language === "English" ? "Customers LTV (Window)" : "Customers LTV（选定窗口）"}</h4>
          <p>{t(language, "customers_ltv_desc")}</p>
          <a
            className={styles.secondaryButton}
            href={controller.data.canExport ? `/api/export/customers?range=${controller.exportWindow}` : "#"}
            onClick={(event) => controller.handleDownload(event, `/api/export/customers?range=${controller.exportWindow}`, `customers-ltv-${controller.exportWindow}.csv`)}
            style={!controller.data.canExport ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
          >
            {language === "English" ? "Download CSV" : "下载 CSV"}
          </a>
        </div>
      </div>
      <p className={styles.helpText}>
        {language === "English"
          ? "Exports include only AI-attributed orders. If sample size is low, extend the time window before exporting."
          : "导出仅包含已被识别的 AI 渠道订单；若 AI 样本量较低，建议先延长时间窗口。"}
      </p>
    </div>
  );
}

export function HealthContent({ controller }: { controller: AdditionalController }) {
  const { language } = controller;

  return (
    <div className={styles.card}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionLabel}>{language === "English" ? "Data Collection Health" : "数据采集健康度"}</p>
          <h3 className={styles.sectionTitle}>{language === "English" ? "Webhook / Backfill / Tagging" : "Webhook / Backfill / 标签写回"}</h3>
        </div>
        <span className={styles.badge}>{language === "English" ? "Monitor" : "监控"}</span>
      </div>
      <div className={styles.statusList}>
        {controller.data.settings.pipelineStatuses.map((item) => {
          const titleMap: Record<string, string> = {
            "orders/create webhook": language === "English" ? "orders/create webhook" : "订单创建 Webhook",
            "Hourly backfill (last 60 days)": language === "English" ? "Hourly backfill (last 60 days)" : "每小时补拉（最近 60 天）",
            "AI tagging write-back": language === "English" ? "AI tagging write-back" : "AI 标签回写",
          };
          const statusMap: Record<string, string> = {
            healthy: language === "English" ? "HEALTHY" : "正常",
            warning: language === "English" ? "WARNING" : "警告",
            info: language === "English" ? "INFO" : "信息",
          };
          return (
            <div key={item.title} className={styles.statusRow}>
              <div>
                <div className={styles.ruleTitle}>{titleMap[item.title] || item.title}</div>
                <div className={styles.ruleMeta}>{item.detail}</div>
              </div>
              <span className={`${styles.statusBadge} ${item.status === "healthy" ? styles.statusHealthy : item.status === "warning" ? styles.statusWarning : styles.statusInfo}`}>
                {statusMap[item.status] || item.status}
              </span>
            </div>
          );
        })}
        <div className={styles.statusRow}>
          <div>
            <div className={styles.ruleTitle}>{language === "English" ? "Webhook Queue Size" : "Webhook 队列长度"}</div>
            <div className={styles.ruleMeta}>{controller.data.webhookQueueSize}</div>
          </div>
          <span className={`${styles.statusBadge} ${controller.data.webhookQueueSize > 0 ? styles.statusInfo : styles.statusHealthy}`}>
            {controller.data.webhookQueueSize > 0
              ? (language === "English" ? "pending" : "待处理")
              : (language === "English" ? "idle" : "空闲")}
          </span>
        </div>
      </div>

      {controller.data.deadLetters && controller.data.deadLetters.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{language === "English" ? "Shop" : "店铺"}</th>
                <th>{language === "English" ? "Intent" : "意图"}</th>
                <th>{language === "English" ? "Topic" : "主题"}</th>
                <th>{language === "English" ? "Error" : "错误"}</th>
                <th>{language === "English" ? "Finished" : "完成时间"}</th>
              </tr>
            </thead>
            <tbody>
              {controller.data.deadLetters.map((job) => (
                <tr key={job.id}>
                  <td>{job.shopDomain}</td>
                  <td>{job.intent}</td>
                  <td>{job.topic}</td>
                  <td>{job.error || ""}</td>
                  <td>{job.finishedAt ? new Date(job.finishedAt).toLocaleString(controller.locale) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.helpText}>
        {language === "English"
          ? `Backfill limits: cooldown=${BACKFILL_COOLDOWN_MINUTES}min, stale=${BACKFILL_STALE_THRESHOLD_SECONDS}s, days=${MAX_BACKFILL_DAYS}, orders=${MAX_BACKFILL_ORDERS}, duration=${MAX_BACKFILL_DURATION_MS}ms.`
          : `补拉限制：冷却=${BACKFILL_COOLDOWN_MINUTES} 分钟，超时阈值=${BACKFILL_STALE_THRESHOLD_SECONDS} 秒，天数=${MAX_BACKFILL_DAYS}，订单数=${MAX_BACKFILL_ORDERS}，时长=${MAX_BACKFILL_DURATION_MS}ms。`}
      </p>
      <p className={styles.helpText}>
        {language === "English"
          ? "Webhook and scheduled backfill are enabled by default; tag write-back requires enabling it in the Attribution page."
          : "Webhook 和定时补拉默认开启；标签回写需要先在归因规则页手动启用。"}
      </p>
    </div>
  );
}

function ConfirmationModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          maxWidth: 400,
          width: "90%",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.15)",
        }}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <p style={{ margin: "0 0 20px", color: "#555", lineHeight: 1.5 }}>{body}</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "#d72c0d",
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
