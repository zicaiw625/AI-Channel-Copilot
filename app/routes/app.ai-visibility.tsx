import { useState, useCallback, useMemo } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Link, useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { requireFeature, FEATURES, hasFeature } from "../lib/access.server";
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

function CopyButton({ text, en, label }: { text: string; en: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {copied ? "✓" : "📋"}
      {copied 
        ? (en ? "Copied!" : "已复制！") 
        : (label || (en ? "Copy Code" : "复制代码"))}
    </button>
  );
}

function SchemaGenerator({
  shopInfo,
  en,
}: {
  shopInfo: { name: string; url: string; description: string; logo: string };
  en: boolean;
}) {
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productCurrency, setProductCurrency] = useState("USD");
  const [productAvailability, setProductAvailability] = useState("InStock");

  const schemaCode = useMemo(() => {
    const schema = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: productName || "Your Product Name",
      description: productDescription || "Your product description",
      brand: {
        "@type": "Brand",
        name: shopInfo.name,
      },
      offers: {
        "@type": "Offer",
        price: productPrice || "0.00",
        priceCurrency: productCurrency,
        availability: `https://schema.org/${productAvailability}`,
        url: shopInfo.url,
      },
    };

    return `<script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
</script>`;
  }, [productName, productDescription, productPrice, productCurrency, productAvailability, shopInfo]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            {en ? "Product Name" : "产品名称"}
          </label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder={en ? "Enter product name" : "输入产品名称"}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #c4cdd5",
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            {en ? "Price" : "价格"}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={productPrice}
              onChange={(e) => setProductPrice(e.target.value)}
              placeholder="99.00"
              style={{
                flex: 1,
                padding: "8px 12px",
                border: "1px solid #c4cdd5",
                borderRadius: 4,
                fontSize: 14,
              }}
            />
            <select
              value={productCurrency}
              onChange={(e) => setProductCurrency(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1px solid #c4cdd5",
                borderRadius: 4,
                fontSize: 14,
              }}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CNY">CNY</option>
              <option value="JPY">JPY</option>
            </select>
          </div>
        </div>
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          {en ? "Description" : "描述"}
        </label>
        <textarea
          value={productDescription}
          onChange={(e) => setProductDescription(e.target.value)}
          placeholder={en ? "Enter product description" : "输入产品描述"}
          rows={3}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: "1px solid #c4cdd5",
            borderRadius: 4,
            fontSize: 14,
            resize: "vertical",
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          {en ? "Availability" : "库存状态"}
        </label>
        <select
          value={productAvailability}
          onChange={(e) => setProductAvailability(e.target.value)}
          style={{
            padding: "8px 12px",
            border: "1px solid #c4cdd5",
            borderRadius: 4,
            fontSize: 14,
          }}
        >
          <option value="InStock">{en ? "In Stock" : "有货"}</option>
          <option value="OutOfStock">{en ? "Out of Stock" : "缺货"}</option>
          <option value="PreOrder">{en ? "Pre-Order" : "预购"}</option>
        </select>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{en ? "Generated Schema Code" : "生成的 Schema 代码"}</span>
        <CopyButton text={schemaCode} en={en} />
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
        {schemaCode}
      </pre>
      
      <div style={{ marginTop: 12, padding: 12, background: "#f0f7ff", borderRadius: 6, fontSize: 13 }}>
        <strong>📍 {en ? "How to use:" : "使用方法："}</strong>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>{en ? "Copy the code above" : "复制上面的代码"}</li>
          <li>{en ? "Go to Shopify Admin → Online Store → Themes → Edit code" : "进入 Shopify 后台 → 在线商店 → 主题 → 编辑代码"}</li>
          <li>{en ? "Open product.liquid or product-template.liquid" : "打开 product.liquid 或 product-template.liquid"}</li>
          <li>{en ? "Paste the code before </head> or at the end of the file" : "将代码粘贴到 </head> 之前或文件末尾"}</li>
        </ol>
      </div>
    </div>
  );
}

function FAQGenerator({ en }: { en: boolean }) {
  const [faqs, setFaqs] = useState([
    { question: "", answer: "" },
  ]);

  const addFaq = () => {
    setFaqs([...faqs, { question: "", answer: "" }]);
  };

  const removeFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  const updateFaq = (index: number, field: "question" | "answer", value: string) => {
    const newFaqs = [...faqs];
    newFaqs[index][field] = value;
    setFaqs(newFaqs);
  };

  const faqSchemaCode = useMemo(() => {
    const validFaqs = faqs.filter(f => f.question && f.answer);
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

    return `<script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
</script>`;
  }, [faqs, en]);

  return (
    <div>
      {faqs.map((faq, index) => (
        <div
          key={index}
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
        <CopyButton text={faqSchemaCode} en={en} />
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

function LlmsTxtGenerator({ shopInfo, en }: { shopInfo: any; en: boolean }) {
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

export default function AIVisibility() {
  const { language, isGrowth, shopInfo, report } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";

  const [activeTab, setActiveTab] = useState<"schema" | "faq" | "llmstxt">("schema");

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
          {[
            { id: "schema", label: en ? "🏷️ Product Schema" : "🏷️ 产品 Schema", icon: "🏷️" },
            { id: "faq", label: en ? "❓ FAQ Schema" : "❓ FAQ Schema", icon: "❓" },
            { id: "llmstxt", label: "📝 llms.txt", icon: "📝" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
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
                    {en ? "Generate Product Structured Data" : "生成产品结构化数据"}
                  </h3>
                </div>
              </div>
              <SchemaGenerator shopInfo={shopInfo} en={en} />
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
            
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {report.suggestions.slice(0, 3).map((suggestion) => (
                <div
                  key={suggestion.id}
                  style={{
                    padding: 12,
                    background: suggestion.priority === "high" ? "#fef3f3" : "#f9fafb",
                    borderRadius: 6,
                    borderLeft: `3px solid ${suggestion.priority === "high" ? "#de3618" : "#008060"}`,
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>
                    {suggestion.title}
                  </div>
                  <div style={{ fontSize: 13, color: "#637381" }}>
                    {suggestion.description}
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

