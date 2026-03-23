import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { AI_SOURCES, BulkGenerator, DetectionPreview, SourceCard, UsageCard } from "../components/utm-wizard/WizardPanels";
import { TabPanel, Tabs } from "../components/navigation/Tabs";
import { InfoCard } from "../components/ui";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import { resolveUILanguageFromRequest } from "../lib/language.server";
import styles from "../styles/app.dashboard.module.css";
import { buildUTMWizardBackHref, parseBackTo } from "../lib/navigation";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) throw auth;
  const { session } = auth;
  const shopDomain = session.shop;
  const settings = await getSettings(shopDomain);

  return {
    shopDomain,
    language: resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文"),
    storeUrl: `https://${shopDomain}`,
  };
};

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Main Component
// ============================================================================

export default function UTMWizard() {
  const { storeUrl, language } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";

  const location = useLocation();
  const backTo = parseBackTo(new URLSearchParams(location.search).get("backTo"));
  const backHref = buildUTMWizardBackHref(location.search);
  const backLabel = backTo === "dashboard"
    ? (en ? "Back to Dashboard" : "返回仪表盘")
    : (en ? "Back to Attribution & Advanced Settings" : "返回归因与高级设置");
  const [productPath, setProductPath] = useState("/products/");
  const [selectedSource, setSelectedSource] = useState<typeof AI_SOURCES[number] | null>(null);
  const [activeTab, setActiveTab] = useState<"single" | "bulk">("single");

  return (
    <s-page heading={en ? "AI Detection Setup Wizard" : "AI 检测设置向导"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
          <Link to={backHref} className={styles.secondaryButton}>
            ← {backLabel}
          </Link>
        </div>

        {/* 说明卡片 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Why This Matters" : "为什么重要"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "Improve AI Traffic Detection Accuracy" : "提高 AI 流量检测准确率"}
              </h3>
            </div>
            <span className={styles.badge} style={{ background: "#e6f7ed", color: "#2e7d32" }}>
              {en ? "Recommended" : "推荐"}
            </span>
          </div>
          
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "1fr 1fr 1fr", 
            gap: 16,
            marginBottom: 16,
          }}>
            <InfoCard
              icon="⚠️"
              title={en ? "Problem" : "问题"}
              description={en 
                ? "AI assistants often don't send referrer headers when users click links"
                : "AI 助手在用户点击链接时通常不发送 referrer 信息"}
              accentColor="#de3618"
            />
            <InfoCard
              icon="✅"
              title={en ? "Solution" : "解决方案"}
              description={en 
                ? "Add UTM parameters to links shared with AI assistants"
                : "在与 AI 助手分享的链接中添加 UTM 参数"}
              accentColor="#008060"
            />
            <InfoCard
              icon="📈"
              title={en ? "Result" : "效果"}
              description={en 
                ? "More reliable attribution for AI-referred traffic"
                : "让 AI 引荐流量的归因更可靠"}
              accentColor="#635bff"
            />
          </div>
          
          <p className={styles.helpText}>
            {en 
              ? "Generate links with UTM parameters for different AI platforms. Share these links in your content, ads, or directly with AI assistants."
              : "为不同 AI 平台生成带 UTM 参数的链接。在内容、广告或直接与 AI 助手分享这些链接。"}
          </p>
        </div>

        {/* 选项卡 */}
        <Tabs
          baseId="utm-wizard-tabs"
          activeTab={activeTab}
          onChange={setActiveTab}
          fitContent
          tabs={[
            { id: "single", label: en ? "Single Link" : "单个链接" },
            { id: "bulk", label: en ? "Bulk Generate" : "批量生成" },
          ]}
        />

        <TabPanel baseId="utm-wizard-tabs" tabId="single" activeTab={activeTab}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* 左侧：配置 */}
            <div className={styles.card}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>{en ? "Step 1" : "步骤 1"}</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Enter Your Product/Page Path" : "输入产品/页面路径"}
                  </h3>
                </div>
              </div>
              
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ 
                    background: "#f4f6f8", 
                    padding: "8px 12px", 
                    borderRadius: "6px 0 0 6px",
                    fontSize: 13,
                    color: "#637381",
                    border: "1px solid #c4cdd5",
                    borderRight: "none",
                  }}>
                    {storeUrl}
                  </span>
                  <input
                    type="text"
                    value={productPath}
                    onChange={(e) => setProductPath(e.target.value)}
                    placeholder="/products/your-product"
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: "0 6px 6px 0",
                      border: "1px solid #c4cdd5",
                      fontSize: 13,
                    }}
                  />
                </div>
                <p style={{ fontSize: 12, color: "#919eab", margin: 0 }}>
                  {en 
                    ? "Enter the path to your product, collection, or page"
                    : "输入产品、集合或页面的路径"}
                </p>
              </div>
              
              <div>
                <p className={styles.sectionLabel} style={{ marginBottom: 12 }}>
                  {en ? "Step 2: Select AI Source" : "步骤 2：选择 AI 来源"}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {AI_SOURCES.map((source) => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      storeUrl={storeUrl}
                      productPath={productPath}
                      en={en}
                      isSelected={selectedSource?.id === source.id}
                      onSelect={() => setSelectedSource(source)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* 右侧：预览 */}
            <div className={styles.card}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>{en ? "Preview" : "预览"}</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Detection Result" : "检测结果"}
                  </h3>
                </div>
                <span className={styles.badge}>
                  {en ? "Preview" : "预览"}
                </span>
              </div>
              
              <DetectionPreview source={selectedSource} en={en} />
            </div>
          </div>
        </TabPanel>

        <TabPanel baseId="utm-wizard-tabs" tabId="bulk" activeTab={activeTab}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{en ? "Bulk Generator" : "批量生成器"}</p>
                <h3 className={styles.sectionTitle}>
                  {en ? "Generate Links for Multiple Products" : "为多个产品生成链接"}
                </h3>
              </div>
            </div>
            
            <BulkGenerator storeUrl={storeUrl} en={en} />
          </div>
        </TabPanel>

        {/* 使用指南 */}
        <div className={styles.card} style={{ marginTop: 20 }}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Usage Guide" : "使用指南"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "How to Use These Links" : "如何使用这些链接"}
              </h3>
            </div>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <UsageCard
              step="1"
              title={en ? "Share with AI" : "与 AI 分享"}
              description={en 
                ? "When asking AI assistants to recommend products, share links with UTM parameters"
                : "当要求 AI 助手推荐产品时，分享带 UTM 参数的链接"}
            />
            <UsageCard
              step="2"
              title={en ? "Content Marketing" : "内容营销"}
              description={en 
                ? "Use UTM links in blog posts, social media, and email campaigns that AI might reference"
                : "在 AI 可能引用的博客文章、社交媒体和邮件营销中使用 UTM 链接"}
            />
            <UsageCard
              step="3"
              title={en ? "Track Results" : "追踪结果"}
              description={en 
                ? "View AI attribution in your dashboard. Orders from these links will show the correct AI source"
                : "在仪表盘中查看 AI 归因。来自这些链接的订单将显示正确的 AI 来源"}
            />
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
