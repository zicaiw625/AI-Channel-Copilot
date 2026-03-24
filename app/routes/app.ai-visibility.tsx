import { useState, useCallback, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useLocation, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { getLlmsStatus } from "../lib/llms.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { FEATURES, hasFeature } from "../lib/access.server";
import { logger } from "../lib/logger.server";
import { 
  isProductSchemaEmbedEnabled, 
  getAppEmbedDeepLink, 
} from "../lib/themeEmbedStatus.server";
import { requireEnv } from "../lib/env.server";
import { EmbedStatusCard, FAQGenerator, SchemaGenerator, SchemaPreview } from "../components/ai-visibility/WorkspacePanels";
import { TabPanel, Tabs } from "../components/navigation/Tabs";
import { LlmsTxtPanel } from "../components/seo/LlmsTxtPanel";
import { Banner } from "../components/ui";
import {
  getPreservedSearchParams,
  parseAiVisibilityTab,
  type WorkspaceTab,
} from "../lib/navigation";
import { resolveUILanguageFromRequest } from "../lib/language.server";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) throw auth;
  const { admin, session } = auth;
  const shopDomain = session.shop;
  const settings = await getSettings(shopDomain);
  // 优先使用服务端 cookie `aicc_language`，避免与前端切换语言产生中英混排
  const language = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");
  const canManageLlms = await hasFeature(shopDomain, FEATURES.LLMS_BASIC);
  const canUseLlmsAdvanced = await hasFeature(shopDomain, FEATURES.LLMS_ADVANCED);
  const llmsStatus = await getLlmsStatus(shopDomain, settings);

  // 检测 Product Schema App Embed 是否已启用
  const embedEnabled = admin ? await isProductSchemaEmbedEnabled(admin, shopDomain) : null;
  
  // 生成 App Embed 启用的 deep link（带 activateAppId 以直接触发激活流程）
  const apiKey = requireEnv("SHOPIFY_API_KEY");
  const embedDeepLink = getAppEmbedDeepLink(shopDomain, { apiKey });

  // 获取店铺基本信息用于生成代码
  let shopInfo = {
    name: shopDomain.replace(".myshopify.com", ""),
    url: `https://${shopDomain}`,
    description: "",
    logo: "",
  };

  try {
    if (admin) {
      const response = await admin.graphql(`
        query {
          shop {
            name
            description
            url
            brand {
              logo {
                image {
                  url
                }
              }
            }
          }
        }
      `);
      const data = await response.json() as {
        data?: {
          shop?: {
            name?: string | null;
            description?: string | null;
            url?: string | null;
            brand?: {
              logo?: {
                image?: {
                  url?: string | null;
                } | null;
              } | null;
            } | null;
          } | null;
        };
        errors?: Array<{ message?: string }>;
      };

      if (data.errors?.length) {
        throw new Error(data.errors.map((error) => error.message || "Unknown GraphQL error").join("; "));
      }

      if (data?.data?.shop) {
        shopInfo = {
          name: data.data.shop.name || shopInfo.name,
          url: data.data.shop.url || shopInfo.url,
          description: data.data.shop.description || "",
          logo: data.data.shop.brand?.logo?.image?.url || "",
        };
      } else {
        logger.warn("[ai-visibility] Shop info missing from GraphQL response", { shopDomain });
      }
    }
  } catch (e) {
    logger.warn("[ai-visibility] Failed to fetch shop info", { shopDomain }, {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    language,
    shopDomain,
    canManageLlms,
    canUseLlmsAdvanced,
    shopInfo,
    settings,
    llmsStatus: {
      status: llmsStatus.status,
      publicUrl: llmsStatus.publicUrl,
      cachedAt: llmsStatus.cachedAt?.toISOString() || null,
    },
    // 新增：embed 状态相关
    embedEnabled,      // true: 已启用, false: 未启用/未找到, null: 无法确定
    embedDeepLink,     // 一键启用的 deep link
  };
};

// ============================================================================
// Action - 生成代码片段
// ============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent");
  
  if (intent === "generate_schema") {
    // 返回生成的 Schema 代码
    return { ok: true, type: "schema" };
  }
  
  return { ok: false };
};

// ============================================================================
// Main Component
// ============================================================================

type TabId = WorkspaceTab;

export default function AIVisibility() {
  const { 
    language, 
    canManageLlms,
    canUseLlmsAdvanced,
    shopInfo, 
    shopDomain,
    settings,
    llmsStatus,
    embedEnabled,
    embedDeepLink,
  } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseAiVisibilityTab(searchParams.get("tab"));
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const currentTab = searchParams.get("tab");
    const resolvedTab = parseAiVisibilityTab(currentTab);
    if (currentTab !== resolvedTab) {
      const next = getPreservedSearchParams(location.search);
      next.set("tab", resolvedTab);
      next.delete("utmTab");
      setSearchParams(next, { replace: true });
    }
  }, [location.search, searchParams, setSearchParams]);

  const updateActiveTab = useCallback((tab: TabId) => {
    const next = getPreservedSearchParams(location.search);
    next.set("tab", tab);
    next.delete("utmTab");
    const nextHash =
      tab === "schema" && location.hash === "#product-schema-settings"
        ? location.hash
        : "";
    navigate({
      pathname: location.pathname,
      search: `?${next.toString()}`,
      hash: nextHash,
    });
  }, [location.hash, location.pathname, location.search, navigate]);

  useEffect(() => {
    const hash = location.hash;
    if (hash) {
      if (hash === "#product-schema-settings" && activeTab !== "schema") {
        const next = getPreservedSearchParams(location.search);
        next.set("tab", "schema");
        setSearchParams(next, { replace: true });
        return;
      }
      const timer = setTimeout(() => {
        const element = document.querySelector(hash);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
          element.classList.add("highlight-target");
          setTimeout(() => element.classList.remove("highlight-target"), 2000);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeTab, location.hash, location.search, setSearchParams]);

  return (
    <s-page heading={en ? "AI SEO" : "AI SEO"}>
      <div className={styles.page}>
        {/* 介绍卡片 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "One-Click AI Optimization" : "一键 AI 优化"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "Make Your Store AI-Ready" : "让你的店铺更容易被 AI 推荐"}
              </h3>
            </div>
            <span className={styles.badge} style={{ background: "#f6ffed", color: "#389e0d" }}>
              {en ? "AI SEO workspace" : "AI SEO 工作台"}
            </span>
          </div>
          
          <p className={styles.helpText}>
            {en
              ? "Generate Schema markup, FAQ structured data, and llms.txt to help AI assistants understand and recommend your products."
              : "生成 Schema 标记、FAQ 结构化数据和 llms.txt，帮助 AI 助手理解和推荐您的产品。"}
          </p>
        </div>

        {/* 选项卡 */}
        <Tabs
          baseId="ai-visibility-tabs"
          activeTab={activeTab}
          onChange={updateActiveTab}
          tabs={[
            { id: "schema", label: en ? "🏷️ Product Schema" : "🏷️ 产品 Schema" },
            { id: "faq", label: en ? "❓ FAQ Schema" : "❓ FAQ Schema" },
            { id: "llms", label: "📝 llms.txt" },
          ]}
        />

        {/* 内容区域 */}
        <div id="product-schema-settings" className={styles.card}>
          <TabPanel baseId="ai-visibility-tabs" tabId="schema" activeTab={activeTab}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>{en ? "Product Schema" : "产品 Schema"}</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Automatic Structured Data" : "自动结构化数据"}
                  </h3>
                </div>
              </div>
              
              <p className={styles.helpText} style={{ marginBottom: 16 }}>
                {en 
                  ? "Product Schema (JSON-LD) helps AI assistants and search engines understand your products. When enabled, it automatically outputs structured data on all product pages."
                  : "Product Schema (JSON-LD) 帮助 AI 助手和搜索引擎理解您的产品。启用后，会自动在所有产品页面输出结构化数据。"}
              </p>

              {/* 启用状态卡片 */}
              <EmbedStatusCard
                embedEnabled={embedEnabled}
                embedDeepLink={embedDeepLink}
                en={en}
              />

              {/* 预览模板 */}
              {embedEnabled === true && (
                <SchemaPreview en={en} />
              )}

              {/* 高级选项 - 折叠区域 */}
              <div style={{ 
                marginTop: 24, 
                borderTop: "1px solid #e0e0e0", 
                paddingTop: 16 
              }}>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#637381",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: 0,
                  }}
                >
                  <span style={{ 
                    transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }}>▶</span>
                  {en 
                    ? "Advanced: Manual Schema Generator (for Headless/Custom Storefront)"
                    : "高级选项：手动 Schema 生成器（用于 Headless/自定义 Storefront）"}
                </button>
                
                {showAdvanced && (
                  <div style={{ 
                    marginTop: 16, 
                    padding: 16, 
                    background: "#f9fafb", 
                    borderRadius: 8,
                    border: "1px solid #e0e0e0",
                  }}>
                    <Banner status="warning">
                      {en
                        ? "This is for advanced users with Headless or custom storefronts who cannot use Theme App Extensions. For standard Shopify themes, use the automatic App Embed above instead."
                        : "此功能仅适用于使用 Headless 或自定义 Storefront 的高级用户。如果您使用标准 Shopify 主题，请使用上方的自动 App Embed 功能。"}
                    </Banner>
                    <SchemaGenerator shopInfo={shopInfo} en={en} />
                  </div>
                )}
              </div>
          </TabPanel>

          <TabPanel baseId="ai-visibility-tabs" tabId="faq" activeTab={activeTab}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>{en ? "FAQ Schema" : "FAQ Schema"}</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Generate FAQ Structured Data" : "生成 FAQ 结构化数据"}
                  </h3>
                </div>
              </div>
              <FAQGenerator en={en} />
          </TabPanel>

          <TabPanel baseId="ai-visibility-tabs" tabId="llms" activeTab={activeTab}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>llms.txt</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Real llms.txt workflow" : "真实 llms.txt 工作流"}
                  </h3>
                </div>
              </div>
              <LlmsTxtPanel
                language={uiLanguage}
                shopDomain={shopDomain}
                initialStatus={llmsStatus}
                initialExposurePreferences={settings.exposurePreferences}
                canManage={canManageLlms}
                canUseAdvanced={canUseLlmsAdvanced}
                editable={canManageLlms}
                context="workspace"
              />
          </TabPanel>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

