import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { buildEmbeddedAppPath } from "../lib/navigation";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const settings = await getSettings(shopDomain);

  return {
    shopDomain,
    language: settings.languages?.[0] || "中文",
    storeUrl: `https://${shopDomain}`,
  };
};

// ============================================================================
// Constants
// ============================================================================

const AI_SOURCES = [
  { id: "chatgpt", name: "ChatGPT", domain: "chat.openai.com", icon: "🤖" },
  { id: "perplexity", name: "Perplexity", domain: "perplexity.ai", icon: "🔍" },
  { id: "claude", name: "Claude", domain: "claude.ai", icon: "🧠" },
  { id: "gemini", name: "Google Gemini", domain: "gemini.google.com", icon: "✨" },
  { id: "copilot", name: "Microsoft Copilot", domain: "copilot.microsoft.com", icon: "💼" },
  { id: "bing", name: "Bing Chat", domain: "bing.com", icon: "🔎" },
] as const;

// ============================================================================
// Components
// ============================================================================

function CopyButton({ text, en }: { text: string; en: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理 timer 防止内存泄漏
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    // 清理之前的 timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        padding: "8px 16px",
        background: copied ? "#52c41a" : "#008060",
        color: "#fff",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        transition: "background 0.2s",
      }}
    >
      {copied ? (en ? "✓ Copied!" : "✓ 已复制！") : (en ? "Copy" : "复制")}
    </button>
  );
}

function SourceCard({
  source,
  storeUrl,
  productPath,
  en,
  isSelected,
  onSelect,
}: {
  source: typeof AI_SOURCES[number];
  storeUrl: string;
  productPath: string;
  en: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { fullUrl, error } = useMemo(() => {
    try {
      const url = new URL(
        productPath.startsWith("/") ? productPath : `/${productPath}`,
        storeUrl
      );
      url.searchParams.set("utm_source", source.id);
      url.searchParams.set("utm_medium", "ai_assistant");
      url.searchParams.set("utm_campaign", "ai_referral");
      return { fullUrl: url.toString(), error: null };
    } catch {
      return { fullUrl: "", error: en ? "Invalid path" : "无效路径" };
    }
  }, [storeUrl, productPath, source.id, en]);

  return (
    <div
      style={{
        border: isSelected ? "2px solid #008060" : "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        background: isSelected ? "#f6ffed" : "#fff",
        cursor: "pointer",
        transition: "all 0.2s",
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 24 }}>{source.icon}</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{source.name}</div>
          <div style={{ fontSize: 12, color: "#637381" }}>{source.domain}</div>
        </div>
        {isSelected && (
          <span style={{
            marginLeft: "auto",
            background: "#52c41a",
            color: "#fff",
            padding: "2px 8px",
            borderRadius: 12,
            fontSize: 11,
          }}>
            {en ? "Selected" : "已选"}
          </span>
        )}
      </div>
      
      {isSelected && (
        <div style={{ marginTop: 12 }}>
          {error ? (
            <div style={{ 
              background: "#fef3f3", 
              padding: 12, 
              borderRadius: 6, 
              fontSize: 12,
              color: "#dc2626",
              marginBottom: 12,
            }}>
              ⚠️ {error}
            </div>
          ) : (
            <>
              <div style={{ 
                background: "#f4f6f8", 
                padding: 12, 
                borderRadius: 6, 
                fontSize: 12,
                wordBreak: "break-all",
                fontFamily: "monospace",
                marginBottom: 12,
              }}>
                {fullUrl}
              </div>
              <CopyButton text={fullUrl} en={en} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DetectionPreview({ 
  source, 
  en 
}: { 
  source: typeof AI_SOURCES[number] | null; 
  en: boolean;
}) {
  if (!source) {
    return (
      <div style={{ 
        textAlign: "center", 
        padding: 40, 
        color: "#919eab",
      }}>
        {en ? "Select an AI source to preview detection" : "选择一个 AI 来源以预览检测结果"}
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: 8, 
        marginBottom: 16,
        padding: "8px 12px",
        background: "#e6f7ed",
        borderRadius: 6,
      }}>
        <span style={{ fontSize: 20 }}>✅</span>
        <span style={{ fontWeight: 600, color: "#2e7d32" }}>
          {en ? "This link will be detected as:" : "此链接将被识别为："}
        </span>
      </div>
      
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "1fr 1fr", 
        gap: 12,
      }}>
        <DetectionField 
          label={en ? "AI Source" : "AI 来源"} 
          value={source.name} 
          icon={source.icon} 
        />
        <DetectionField 
          label="utm_source" 
          value={source.id} 
        />
        <DetectionField 
          label="utm_medium" 
          value="ai_assistant" 
        />
        <DetectionField 
          label="utm_campaign" 
          value="ai_referral" 
        />
      </div>
      
      <div style={{ 
        marginTop: 16, 
        padding: 12, 
        background: "#f0f7ff", 
        borderRadius: 6,
        fontSize: 13,
        color: "#0958d9",
      }}>
        <strong>💡 {en ? "Tip:" : "提示："}</strong>{" "}
        {en 
          ? "When users click this link from AI assistants, orders are more likely to be attributed to the matching AI channel."
          : "当用户从 AI 助手点击此链接时，订单更容易被归因到对应的 AI 渠道。"}
      </div>
    </div>
  );
}

function DetectionField({ 
  label, 
  value, 
  icon 
}: { 
  label: string; 
  value: string; 
  icon?: string;
}) {
  return (
    <div style={{ 
      background: "#f9fafb", 
      padding: 12, 
      borderRadius: 6,
    }}>
      <div style={{ fontSize: 11, color: "#919eab", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
        {icon && <span>{icon}</span>}
        {value}
      </div>
    </div>
  );
}

type AISourceId = typeof AI_SOURCES[number]["id"];

function BulkGenerator({
  storeUrl,
  en,
}: {
  storeUrl: string;
  en: boolean;
}) {
  const [paths, setPaths] = useState("/products/example-product");
  const [selectedSources, setSelectedSources] = useState<AISourceId[]>(["chatgpt", "perplexity"]);

  const { generatedLinks, errorPaths } = useMemo(() => {
    const pathList = paths.split("\n").filter(p => p.trim());
    const links: string[] = [];
    const errors: string[] = [];
    
    for (const path of pathList) {
      for (const sourceId of selectedSources) {
        const source = AI_SOURCES.find(s => s.id === sourceId);
        if (!source) continue;
        
        try {
          const trimmedPath = path.trim();
          const url = new URL(
            trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`,
            storeUrl
          );
          url.searchParams.set("utm_source", source.id);
          url.searchParams.set("utm_medium", "ai_assistant");
          url.searchParams.set("utm_campaign", "ai_referral");
          links.push(`${source.name}: ${url.toString()}`);
        } catch {
          // 记录无效路径，只记录一次
          if (!errors.includes(path.trim())) {
            errors.push(path.trim());
          }
        }
      }
    }
    
    return {
      generatedLinks: links.join("\n"),
      errorPaths: errors,
    };
  }, [paths, selectedSources, storeUrl]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
          {en ? "Product/Page Paths (one per line)" : "产品/页面路径（每行一个）"}
        </label>
        <textarea
          value={paths}
          onChange={(e) => setPaths(e.target.value)}
          placeholder="/products/product-handle&#10;/collections/sale&#10;/pages/about"
          style={{
            width: "100%",
            minHeight: 100,
            padding: 12,
            borderRadius: 6,
            border: "1px solid #c4cdd5",
            fontFamily: "monospace",
            fontSize: 13,
            resize: "vertical",
          }}
        />
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
          {en ? "AI Sources" : "AI 来源"}
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label={en ? "Select AI sources" : "选择 AI 来源"}>
          {AI_SOURCES.map((source) => (
            <label
              key={source.id}
              htmlFor={`bulk-source-${source.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                border: selectedSources.includes(source.id) 
                  ? "2px solid #008060" 
                  : "1px solid #e0e0e0",
                borderRadius: 6,
                cursor: "pointer",
                background: selectedSources.includes(source.id) ? "#f6ffed" : "#fff",
              }}
            >
              <input
                id={`bulk-source-${source.id}`}
                type="checkbox"
                checked={selectedSources.includes(source.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedSources([...selectedSources, source.id]);
                  } else {
                    setSelectedSources(selectedSources.filter(id => id !== source.id));
                  }
                }}
                style={{ display: "none" }}
                aria-label={source.name}
              />
              <span aria-hidden="true">{source.icon}</span>
              <span style={{ fontSize: 13 }}>{source.name}</span>
            </label>
          ))}
        </div>
      </div>
      
      {/* 错误提示 */}
      {errorPaths.length > 0 && (
        <div style={{
          marginBottom: 16,
          padding: 12,
          background: "#fef3f3",
          border: "1px solid #fecaca",
          borderRadius: 6,
          color: "#dc2626",
          fontSize: 13,
        }}>
          <strong>⚠️ {en ? "Invalid paths:" : "无效路径："}</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {errorPaths.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 空状态提示 */}
      {selectedSources.length === 0 && (
        <div style={{
          marginBottom: 16,
          padding: 12,
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          borderRadius: 6,
          color: "#c2410c",
          fontSize: 13,
          textAlign: "center",
        }}>
          {en ? "Please select at least one AI source" : "请至少选择一个 AI 来源"}
        </div>
      )}

      {generatedLinks && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontWeight: 500, fontSize: 14 }}>
              {en ? "Generated Links" : "生成的链接"}
            </label>
            <CopyButton text={generatedLinks} en={en} />
          </div>
          <textarea
            value={generatedLinks}
            readOnly
            aria-label={en ? "Generated links output" : "生成的链接输出"}
            style={{
              width: "100%",
              minHeight: 150,
              padding: 12,
              borderRadius: 6,
              border: "1px solid #c4cdd5",
              fontFamily: "monospace",
              fontSize: 12,
              background: "#f9fafb",
              resize: "vertical",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function UTMWizard() {
  const { storeUrl, language } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";

  const location = useLocation();
  const backTo = new URLSearchParams(location.search).get("backTo");
  const additionalHref = buildEmbeddedAppPath("/app/additional", location.search, { backTo: null });
  const dashboardHref = buildEmbeddedAppPath("/app", location.search, { backTo: null });
  const backHref = backTo === "dashboard" ? dashboardHref : additionalHref;
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
              color="#de3618"
            />
            <InfoCard
              icon="✅"
              title={en ? "Solution" : "解决方案"}
              description={en 
                ? "Add UTM parameters to links shared with AI assistants"
                : "在与 AI 助手分享的链接中添加 UTM 参数"}
              color="#008060"
            />
            <InfoCard
              icon="📈"
              title={en ? "Result" : "效果"}
              description={en 
                ? "More reliable attribution for AI-referred traffic"
                : "让 AI 引荐流量的归因更可靠"}
              color="#635bff"
            />
          </div>
          
          <p className={styles.helpText}>
            {en 
              ? "Generate links with UTM parameters for different AI platforms. Share these links in your content, ads, or directly with AI assistants."
              : "为不同 AI 平台生成带 UTM 参数的链接。在内容、广告或直接与 AI 助手分享这些链接。"}
          </p>
        </div>

        {/* 选项卡 */}
        <div style={{ 
          display: "flex", 
          gap: 4, 
          marginBottom: 20,
          background: "#f4f6f8",
          padding: 4,
          borderRadius: 8,
          width: "fit-content",
        }}>
          <button
            type="button"
            onClick={() => setActiveTab("single")}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: 6,
              background: activeTab === "single" ? "#fff" : "transparent",
              boxShadow: activeTab === "single" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              cursor: "pointer",
              fontWeight: 500,
              color: activeTab === "single" ? "#212b36" : "#637381",
            }}
          >
            {en ? "Single Link" : "单个链接"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("bulk")}
            style={{
              padding: "10px 20px",
              border: "none",
              borderRadius: 6,
              background: activeTab === "bulk" ? "#fff" : "transparent",
              boxShadow: activeTab === "bulk" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              cursor: "pointer",
              fontWeight: 500,
              color: activeTab === "bulk" ? "#212b36" : "#637381",
            }}
          >
            {en ? "Bulk Generate" : "批量生成"}
          </button>
        </div>

        {activeTab === "single" ? (
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
        ) : (
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
        )}

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

function InfoCard({ 
  icon, 
  title, 
  description, 
  color 
}: { 
  icon: string; 
  title: string; 
  description: string; 
  color: string;
}) {
  return (
    <div style={{ 
      padding: 16, 
      background: "#f9fafb", 
      borderRadius: 8,
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontWeight: 600, color }}>{title}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "#637381" }}>{description}</p>
    </div>
  );
}

function UsageCard({ 
  step, 
  title, 
  description 
}: { 
  step: string; 
  title: string; 
  description: string;
}) {
  return (
    <div style={{ 
      padding: 16, 
      background: "#f9fafb", 
      borderRadius: 8,
    }}>
      <div style={{ 
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "#008060",
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        marginBottom: 12,
      }}>
        {step}
      </div>
      <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600 }}>{title}</h4>
      <p style={{ margin: 0, fontSize: 13, color: "#637381" }}>{description}</p>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
