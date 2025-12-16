import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { FEATURES, hasFeature } from "../lib/access.server";
import { generateAIOptimizationReport } from "../lib/aiOptimization.server";
import { logger } from "../lib/logger.server";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  
  // Growth 功能检查（如果不是 Growth 用户，仍然显示页面但功能受限）
  const isGrowth = await hasFeature(shopDomain, FEATURES.MULTI_STORE);
  
  const settings = await getSettings(shopDomain);
  const language = settings.languages?.[0] || "中文";

  // 获取优化报告
  const report = await generateAIOptimizationReport(shopDomain, admin, {
    range: "30d",
    language,
    exposurePreferences: settings.exposurePreferences,
  });

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
      const data = await response.json();
      if (data?.data?.shop) {
        shopInfo = {
          name: data.data.shop.name || shopInfo.name,
          url: data.data.shop.url || shopInfo.url,
          description: data.data.shop.description || "",
          logo: data.data.shop.brand?.logo?.image?.url || "",
        };
      }
    }
  } catch (e) {
    logger.warn("[ai-visibility] Failed to fetch shop info", { shopDomain }, { error: e });
  }

  return {
    language,
    shopDomain,
    isGrowth,
    report,
    shopInfo,
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
// Components
// ============================================================================

function CopyButton({ text, en, label, disabled }: { text: string; en: boolean; label?: string; disabled?: boolean }) {
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
    if (disabled) return;
    // 清理之前的 timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [text, disabled]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        background: disabled ? "#919eab" : (copied ? "#52c41a" : "#008060"),
        color: "#fff",
        border: "none",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {copied ? "✓" : "📋"}
      {copied 
        ? (en ? "Copied!" : "已复制！") 
        : (label || (en ? "Copy Code" : "复制代码"))}
    </button>
  );
}

function ProductSchemaEmbed({
  shopInfo,
  shopDomain,
  en,
}: {
  shopInfo: { name: string; url: string; description: string; logo: string };
  shopDomain: string;
  en: boolean;
}) {
  // 生成 Theme Editor deep link
  const themeEditorUrl = `https://${shopDomain}/admin/themes/current/editor?context=apps`;

  return (
    <div>
      {/* 成功状态卡片 */}
      <div style={{
        padding: 24,
        background: "linear-gradient(135deg, #f6ffed 0%, #e6f7ff 100%)",
        borderRadius: 12,
        border: "1px solid #b7eb8f",
        marginBottom: 24,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "#52c41a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            flexShrink: 0,
          }}>
            ✓
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 600, color: "#1a3a1a" }}>
              {en ? "Auto Product Schema Installed!" : "产品 Schema 自动注入已就绪！"}
            </h3>
            <p style={{ margin: 0, color: "#52734d", fontSize: 14, lineHeight: 1.6 }}>
              {en
                ? "We've set up automatic Product Schema injection for your store. No code copying needed! Just enable it in your theme settings."
                : "我们已为您的店铺配置好产品 Schema 自动注入功能。无需复制任何代码！只需在主题设置中开启即可。"}
            </p>
          </div>
        </div>
      </div>

      {/* 步骤指引 */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>
          {en ? "How to Enable (30 seconds)" : "如何开启（30 秒）"}
        </h4>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            {
              step: 1,
              title: en ? "Open Theme Editor" : "打开主题编辑器",
              desc: en ? "Click the button below to go directly to your theme settings" : "点击下方按钮直接跳转到主题设置",
            },
            {
              step: 2,
              title: en ? "Find App Embeds" : "找到 App embeds",
              desc: en ? "In the left sidebar, click 'App embeds' at the bottom" : "在左侧边栏底部，点击「App embeds」",
            },
            {
              step: 3,
              title: en ? "Enable AI Product Schema" : "开启 AI 产品 Schema",
              desc: en ? "Toggle on 'AI Product Schema' and save" : "打开「AI 产品 Schema」开关并保存",
            },
          ].map((item) => (
            <div
              key={item.step}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: 16,
                background: "#f9fafb",
                borderRadius: 8,
              }}
            >
              <div style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#008060",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 600,
                flexShrink: 0,
              }}>
                {item.step}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "#637381" }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 跳转按钮 */}
      <a
        href={themeEditorUrl}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "14px 28px",
          background: "#008060",
          color: "#fff",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
          fontSize: 15,
          boxShadow: "0 2px 8px rgba(0, 128, 96, 0.3)",
          transition: "all 0.2s",
        }}
      >
        {en ? "Open Theme Settings" : "打开主题设置"}
        <span style={{ fontSize: 18 }}>→</span>
      </a>

      {/* Schema 包含的字段说明 */}
      <div style={{
        marginTop: 32,
        padding: 20,
        background: "#f4f6f8",
        borderRadius: 8,
      }}>
        <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>
          {en ? "What's Included in the Schema" : "Schema 包含的字段"}
        </h4>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 8,
          fontSize: 13,
        }}>
          {[
            { icon: "🏷️", label: en ? "Product Name" : "产品名称" },
            { icon: "📝", label: en ? "Description" : "描述" },
            { icon: "🖼️", label: en ? "Images (up to 10)" : "图片（最多10张）" },
            { icon: "🔢", label: "SKU" },
            { icon: "📊", label: en ? "Barcode/GTIN" : "条形码/GTIN" },
            { icon: "🏢", label: en ? "Brand" : "品牌" },
            { icon: "💰", label: en ? "Price & Currency" : "价格和货币" },
            { icon: "📦", label: en ? "Availability" : "库存状态" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>{item.icon}</span>
              <span style={{ color: "#454f5b" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 好处说明 */}
      <div style={{
        marginTop: 16,
        padding: 16,
        background: "#fffbe6",
        border: "1px solid #ffe58f",
        borderRadius: 8,
        fontSize: 13,
      }}>
        <strong>💡 {en ? "Why This Matters" : "为什么这很重要"}</strong>
        <p style={{ margin: "8px 0 0", color: "#614700", lineHeight: 1.6 }}>
          {en
            ? "Product Schema helps AI assistants (like ChatGPT, Perplexity) understand your products better, increasing the chance they recommend your products when users ask for suggestions."
            : "产品 Schema 帮助 AI 助手（如 ChatGPT、Perplexity）更好地理解您的产品，增加用户询问推荐时 AI 推荐您产品的机会。"}
        </p>
      </div>
    </div>
  );
}

// 生成唯一 ID（避免使用模块级计数器，防止 SSR hydration 问题）
function generateFaqId() {
  return `faq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function FAQGenerator({ en }: { en: boolean }) {
  const [faqs, setFaqs] = useState([
    { id: generateFaqId(), question: "", answer: "" },
  ]);

  const addFaq = () => {
    setFaqs([...faqs, { id: generateFaqId(), question: "", answer: "" }]);
  };

  const removeFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  const updateFaq = (index: number, field: "question" | "answer", value: string) => {
    const newFaqs = [...faqs];
    newFaqs[index][field] = value;
    setFaqs(newFaqs);
  };

  // 计算有效的 FAQ（问题和答案都填写）
  const validFaqs = useMemo(() => faqs.filter(f => f.question.trim() && f.answer.trim()), [faqs]);
  const isValid = validFaqs.length > 0;

  const faqSchemaCode = useMemo(() => {
    if (validFaqs.length === 0) {
      return en ? "// Add FAQs above to generate code" : "// 在上方添加 FAQ 以生成代码";
    }

    const schema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: validFaqs.map(faq => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    };

    // 转义 </script> 以防止 XSS 注入
    const safeJsonString = JSON.stringify(schema, null, 2)
      .replace(/<\/script/gi, "<\\/script");

    return `<script type="application/ld+json">
${safeJsonString}
</script>`;
  }, [validFaqs, en]);

  return (
    <div>
      {faqs.map((faq, index) => (
        <div
          key={faq.id}
          style={{
            marginBottom: 16,
            padding: 16,
            background: "#f9fafb",
            borderRadius: 8,
            position: "relative",
          }}
        >
          {faqs.length > 1 && (
            <button
              type="button"
              onClick={() => removeFaq(index)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "transparent",
                border: "none",
                color: "#de3618",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ✕
            </button>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
              {en ? `Question ${index + 1}` : `问题 ${index + 1}`}
            </label>
            <input
              type="text"
              value={faq.question}
              onChange={(e) => updateFaq(index, "question", e.target.value)}
              placeholder={en ? "What is your return policy?" : "你们的退货政策是什么？"}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px",
                border: "1px solid #c4cdd5",
                borderRadius: 4,
                fontSize: 14,
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
              {en ? `Answer ${index + 1}` : `答案 ${index + 1}`}
            </label>
            <textarea
              value={faq.answer}
              onChange={(e) => updateFaq(index, "answer", e.target.value)}
              placeholder={en ? "We offer 30-day free returns..." : "我们提供 30 天免费退货..."}
              rows={2}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px",
                border: "1px solid #c4cdd5",
                borderRadius: 4,
                fontSize: 14,
                resize: "vertical",
              }}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addFaq}
        style={{
          padding: "8px 16px",
          background: "#fff",
          border: "1px dashed #008060",
          borderRadius: 4,
          color: "#008060",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 16,
        }}
      >
        + {en ? "Add FAQ" : "添加 FAQ"}
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{en ? "Generated FAQ Schema" : "生成的 FAQ Schema"}</span>
        <CopyButton text={faqSchemaCode} en={en} disabled={!isValid} />
      </div>
      <pre
        style={{
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: 16,
          borderRadius: 8,
          overflow: "auto",
          fontSize: 12,
          maxHeight: 300,
        }}
      >
        {faqSchemaCode}
      </pre>
    </div>
  );
}

function LlmsTxtGenerator({ shopInfo, en }: { shopInfo: { name: string; url: string; description: string; logo: string }; en: boolean }) {
  const [includeProducts, setIncludeProducts] = useState(true);
  const [includeCollections, setIncludeCollections] = useState(true);
  const [includeBlogs, setIncludeBlogs] = useState(false);
  const [customDescription, setCustomDescription] = useState(shopInfo.description || "");

  const llmsTxtCode = useMemo(() => {
    const lines = [
      `# ${shopInfo.name}`,
      ``,
      `> ${customDescription || (en ? "An online store" : "一个在线商店")}`,
      ``,
      `## ${en ? "Store Information" : "店铺信息"}`,
      `- URL: ${shopInfo.url}`,
      `- Name: ${shopInfo.name}`,
      ``,
    ];

    if (includeProducts) {
      lines.push(`## ${en ? "Products" : "产品"}`);
      lines.push(`${en ? "Browse our product catalog at" : "浏览我们的产品目录"}: ${shopInfo.url}/collections/all`);
      lines.push(``);
    }

    if (includeCollections) {
      lines.push(`## ${en ? "Collections" : "合集"}`);
      lines.push(`${en ? "View all collections at" : "查看所有合集"}: ${shopInfo.url}/collections`);
      lines.push(``);
    }

    if (includeBlogs) {
      lines.push(`## ${en ? "Blog" : "博客"}`);
      lines.push(`${en ? "Read our blog at" : "阅读我们的博客"}: ${shopInfo.url}/blogs/news`);
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(`${en ? "Generated by AI Channel Copilot" : "由 AI Channel Copilot 生成"}`);

    return lines.join("\n");
  }, [shopInfo, customDescription, includeProducts, includeCollections, includeBlogs, en]);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          {en ? "Store Description" : "店铺描述"}
        </label>
        <textarea
          value={customDescription}
          onChange={(e) => setCustomDescription(e.target.value)}
          placeholder={en ? "Describe your store for AI assistants..." : "为 AI 助手描述你的店铺..."}
          rows={3}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 12px",
            border: "1px solid #c4cdd5",
            borderRadius: 4,
            fontSize: 14,
            resize: "vertical",
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 500 }}>
          {en ? "Include Sections" : "包含内容"}
        </label>
        <div style={{ display: "flex", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeProducts}
              onChange={(e) => setIncludeProducts(e.target.checked)}
            />
            {en ? "Products" : "产品"}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeCollections}
              onChange={(e) => setIncludeCollections(e.target.checked)}
            />
            {en ? "Collections" : "合集"}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeBlogs}
              onChange={(e) => setIncludeBlogs(e.target.checked)}
            />
            {en ? "Blog" : "博客"}
          </label>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>llms.txt</span>
        <CopyButton text={llmsTxtCode} en={en} />
      </div>
      <pre
        style={{
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: 16,
          borderRadius: 8,
          overflow: "auto",
          fontSize: 12,
          maxHeight: 300,
        }}
      >
        {llmsTxtCode}
      </pre>

      <div style={{ marginTop: 12, padding: 12, background: "#f6ffed", borderRadius: 6, fontSize: 13 }}>
        <strong>✅ {en ? "Auto-hosted:" : "自动托管："}</strong>{" "}
        {en
          ? "Your llms.txt is automatically hosted at your store's /a/llms/llms.txt URL via our App Proxy."
          : "您的 llms.txt 已通过我们的 App Proxy 自动托管在您店铺的 /a/llms/llms.txt 地址。"}
        <a
          href={`${shopInfo.url}/a/llms/llms.txt`}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: 8, color: "#008060" }}
        >
          {en ? "View live →" : "查看 →"}
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

// Tab 类型定义
type TabId = "schema" | "faq" | "llmstxt";

export default function AIVisibility() {
  const { language, shopDomain, isGrowth, shopInfo, report } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";

  const [activeTab, setActiveTab] = useState<TabId>("schema");

  return (
    <s-page heading={en ? "AI Visibility Suite" : "AI 可见性套件"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12, justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Link to="/app" className={styles.secondaryButton}>
              ← {en ? "Back to Dashboard" : "返回仪表盘"}
            </Link>
            <Link to="/app/optimization" className={styles.primaryButton}>
              {en ? "View AI Score" : "查看 AI 评分"} →
            </Link>
          </div>
          
          {/* Growth 功能标识 */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              background: isGrowth ? "#f6ffed" : "#fff7e6",
              border: `1px solid ${isGrowth ? "#b7eb8f" : "#ffd591"}`,
              borderRadius: 20,
              fontSize: 13,
              color: isGrowth ? "#389e0d" : "#d46b08",
              fontWeight: 500,
            }}
          >
            {isGrowth ? "✨" : "🔒"} {isGrowth 
              ? (en ? "Growth Plan" : "Growth 版") 
              : (en ? "Upgrade to Growth" : "升级到 Growth")}
          </div>
        </div>

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
              {en ? "Growth Feature" : "Growth 功能"}
            </span>
          </div>
          
          <p className={styles.helpText}>
            {en
              ? "Generate Schema markup, FAQ structured data, and llms.txt to help AI assistants understand and recommend your products."
              : "生成 Schema 标记、FAQ 结构化数据和 llms.txt，帮助 AI 助手理解和推荐您的产品。"}
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
        }}>
          {([
            { id: "schema" as const, label: en ? "🏷️ Product Schema" : "🏷️ 产品 Schema" },
            { id: "faq" as const, label: en ? "❓ FAQ Schema" : "❓ FAQ Schema" },
            { id: "llmstxt" as const, label: "📝 llms.txt" },
          ] satisfies { id: TabId; label: string }[]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "12px 20px",
                border: "none",
                borderRadius: 6,
                background: activeTab === tab.id ? "#fff" : "transparent",
                boxShadow: activeTab === tab.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                cursor: "pointer",
                fontWeight: 500,
                color: activeTab === tab.id ? "#212b36" : "#637381",
                fontSize: 14,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div className={styles.card}>
          {activeTab === "schema" && (
            <>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>{en ? "Product Schema" : "产品 Schema"}</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Auto Product Schema Injection" : "产品 Schema 自动注入"}
                  </h3>
                </div>
              </div>
              <ProductSchemaEmbed shopInfo={shopInfo} shopDomain={shopDomain} en={en} />
            </>
          )}

          {activeTab === "faq" && (
            <>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>{en ? "FAQ Schema" : "FAQ Schema"}</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Generate FAQ Structured Data" : "生成 FAQ 结构化数据"}
                  </h3>
                </div>
              </div>
              <FAQGenerator en={en} />
            </>
          )}

          {activeTab === "llmstxt" && (
            <>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>llms.txt</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "AI Crawling Preferences" : "AI 爬取偏好设置"}
                  </h3>
                </div>
              </div>
              <LlmsTxtGenerator shopInfo={shopInfo} en={en} />
            </>
          )}
        </div>

        {/* AI 优化建议摘要 */}
        {report.suggestions.length > 0 && (
          <div className={styles.card} style={{ marginTop: 20 }}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>{en ? "Recommendations" : "优化建议"}</p>
                <h3 className={styles.sectionTitle}>
                  {en ? "Based on Your Store Analysis" : "基于店铺分析的建议"}
                </h3>
              </div>
              <Link to="/app/optimization" style={{ color: "#008060", fontSize: 13, fontWeight: 500 }}>
                {en ? "View All →" : "查看全部 →"}
              </Link>
            </div>
            
            <div className={styles.suggestionList} role="list" aria-label={en ? "Optimization suggestions" : "优化建议列表"}>
              {report.suggestions.slice(0, 3).map((suggestion) => (
                <div
                  key={suggestion.id}
                  role="listitem"
                  aria-label={en ? suggestion.title.en : suggestion.title.zh}
                  className={`${styles.suggestionCard} ${suggestion.priority === "high" ? styles.suggestionCardHigh : ""}`}
                >
                  <div className={styles.suggestionTitle}>
                    {suggestion.priority === "high" && (
                      <span className={styles.suggestionPriorityIcon} aria-label={en ? "High priority" : "高优先级"}>⚠️</span>
                    )}
                    {en ? suggestion.title.en : suggestion.title.zh}
                  </div>
                  <div className={styles.suggestionDescription}>
                    {en ? suggestion.description.en : suggestion.description.zh}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

