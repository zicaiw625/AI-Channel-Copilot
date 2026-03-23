import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { getLlmsStatus } from "../lib/llms.server";
import { useUILanguage } from "../lib/useUILanguage";
import styles from "../styles/app.dashboard.module.css";
import { FEATURES, hasFeature } from "../lib/access.server";
import { generateAIOptimizationReport } from "../lib/aiOptimization.server";
import { logger } from "../lib/logger.server";
import { 
  isProductSchemaEmbedEnabled, 
  getAppEmbedDeepLink, 
  getAppEmbedManualPath 
} from "../lib/themeEmbedStatus.server";
import { requireEnv } from "../lib/env.server";
import { getEmbedCopy, toEmbedStatus, MANUAL_PATH_COPY } from "../lib/productSchemaEmbedCopy";
import { LlmsTxtPanel } from "../components/seo/LlmsTxtPanel";
import { buildEmbeddedAppPath, getPreservedSearchParams } from "../lib/navigation";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const settings = await getSettings(shopDomain);
  const language = settings.languages?.[0] || "中文";
  const canManageLlms = await hasFeature(shopDomain, FEATURES.LLMS_BASIC);
  const canUseLlmsAdvanced = await hasFeature(shopDomain, FEATURES.LLMS_ADVANCED);
  const llmsStatus = await getLlmsStatus(shopDomain, settings);

  // 检测 Product Schema App Embed 是否已启用
  const embedEnabled = admin ? await isProductSchemaEmbedEnabled(admin, shopDomain) : null;
  
  // 生成 App Embed 启用的 deep link（带 activateAppId 以直接触发激活流程）
  const apiKey = requireEnv("SHOPIFY_API_KEY");
  const embedDeepLink = getAppEmbedDeepLink(shopDomain, { apiKey });
  
  // 获取手动路径说明
  const embedManualPath = getAppEmbedManualPath(language);

  // 获取优化报告（复用已检测的 embedEnabled，避免重复 GraphQL 调用）
  const report = await generateAIOptimizationReport(shopDomain, admin, {
    range: "30d",
    language,
    exposurePreferences: settings.exposurePreferences,
    embedEnabled, // ✅ 复用上面已检测的结果
    apiKey, // ✅ 用于生成带 activateAppId 的 deep link
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
    canManageLlms,
    canUseLlmsAdvanced,
    report,
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
    embedManualPath,   // 手动路径说明 { en, zh }
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

// ============================================================================
// Embed Status Card - 显示 App Embed 启用状态
// 使用公共文案模块确保与 Optimization 页面的文案一致
// ============================================================================

function EmbedStatusCard({
  embedEnabled,
  embedDeepLink,
  en,
}: {
  embedEnabled: boolean | null;
  embedDeepLink: string;
  embedManualPath: { en: string; zh: string }; // 保留参数以保持 API 兼容，但使用公共文案
  en: boolean;
}) {
  // 使用公共文案模块
  const status = toEmbedStatus(embedEnabled);
  const copy = getEmbedCopy(status);
  const manualPath = en ? MANUAL_PATH_COPY.en : MANUAL_PATH_COPY.zh;
  
  // 根据状态配置样式
  const styleConfig = {
    enabled: {
      bg: "#e6f7ed",
      border: "#b7eb8f",
      titleColor: "#389e0d",
      textColor: "#52c41a",
      icon: "✅",
      buttonBg: "#fff",
      buttonColor: "#389e0d",
      buttonBorder: "1px solid #b7eb8f",
      buttonIcon: "⚙️",
    },
    disabled: {
      bg: "#fff7e6",
      border: "#ffd591",
      titleColor: "#d46b08",
      textColor: "#8a6116",
      icon: "⚠️",
      buttonBg: "#008060",
      buttonColor: "#fff",
      buttonBorder: "none",
      buttonIcon: "🚀",
    },
    unknown: {
      bg: "#f0f7ff",
      border: "#91d5ff",
      titleColor: "#0050b3",
      textColor: "#096dd9",
      icon: "ℹ️",
      buttonBg: "#1890ff",
      buttonColor: "#fff",
      buttonBorder: "none",
      buttonIcon: "🔍",
    },
  };
  
  const style = styleConfig[status];
  const isEnabled = status === "enabled";
  
  return (
    <div style={{
      background: style.bg,
      border: `1px solid ${style.border}`,
      borderRadius: 8,
      padding: 20,
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 24 }}>{style.icon}</span>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: style.titleColor }}>
            {en ? copy.title.en : copy.title.zh}
          </h4>
          <p style={{ margin: isEnabled ? 0 : "0 0 12px", fontSize: 14, color: style.textColor }}>
            {en ? copy.description.en : copy.description.zh}
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a
              href={embedDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: isEnabled ? "8px 16px" : "12px 24px",
                background: style.buttonBg,
                color: style.buttonColor,
                border: style.buttonBorder,
                borderRadius: isEnabled ? 4 : 6,
                fontSize: isEnabled ? 13 : 14,
                fontWeight: isEnabled ? 500 : 600,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: isEnabled ? 6 : 8,
              }}
            >
              {style.buttonIcon} {en ? copy.buttonLabel.en : copy.buttonLabel.zh}
            </a>
          </div>
          {!isEnabled && (
            <p style={{ margin: "12px 0 0", fontSize: 12, color: style.textColor }}>
              📍 {en ? "Manual path:" : "手动路径："}{manualPath}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Schema Preview - 预览自动生成的 JSON-LD（仅用于排查）
// ============================================================================

function SchemaPreview({ shopInfo: _shopInfo, en }: { shopInfo: { name: string; url: string }; en: boolean }) {
  // Note: _shopInfo is intentionally unused here as this preview uses Liquid template syntax
  // that references shop.* variables at render time, not the React props
  const previewCode = useMemo(() => {
    const schema = {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "{{ product.title }}",
      "description": "{{ product.description | strip_html | truncate: 5000 }}",
      "image": ["{{ product.images | first | image_url: width: 1024 }}"],
      "sku": "{{ variant.sku | default: product.id }}",
      "brand": {
        "@type": "Brand",
        "name": "{{ product.vendor }}"
      },
      "offers": {
        "@type": "Offer",
        "url": "{{ request.origin }}{{ product.url }}",
        "price": "{{ variant.price | divided_by: 100.0 }}",
        "priceCurrency": "{{ shop.currency }}",
        "availability": "https://schema.org/InStock",
        "itemCondition": "https://schema.org/NewCondition",
        "seller": {
          "@type": "Organization",
          "name": "{{ shop.name }}"
        }
      }
    };
    return JSON.stringify(schema, null, 2);
  }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        marginBottom: 8 
      }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {en ? "JSON-LD Template Preview" : "JSON-LD 模板预览"}
        </span>
        <CopyButton text={previewCode} en={en} label={en ? "Copy Template" : "复制模板"} />
      </div>
      <pre
        style={{
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: 16,
          borderRadius: 8,
          overflow: "auto",
          fontSize: 12,
          maxHeight: 250,
        }}
      >
        {previewCode}
      </pre>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#888" }}>
        💡 {en 
          ? "This is a template showing the structure. Actual values are filled dynamically from your product data."
          : "这是一个模板，展示结构化数据的格式。实际值会从您的产品数据中动态填充。"}
      </p>
    </div>
  );
}

// URL 验证函数
function isValidUrl(url: string): boolean {
  if (!url.trim()) return true; // 可选字段，空值有效
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// 价格验证函数
function isValidPrice(price: string): boolean {
  if (!price.trim()) return false;
  const num = parseFloat(price);
  return !isNaN(num) && num > 0;
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
  const [productSku, setProductSku] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [productImage, setProductImage] = useState("");

  // 检查是否填写了必填字段，并验证价格格式
  const isPriceValid = isValidPrice(productPrice);
  const isUrlValid = isValidUrl(productUrl);
  const isImageUrlValid = isValidUrl(productImage);
  const isValid = productName.trim() && isPriceValid && isUrlValid && isImageUrlValid;

  const schemaCode = useMemo(() => {
    if (!productName.trim() || !isPriceValid) {
      return en 
        ? "// Please fill in Product Name and a valid Price to generate valid schema"
        : "// 请填写产品名称和有效价格以生成有效的 Schema";
    }

    if (!isUrlValid) {
      return en
        ? "// Please enter a valid Product URL"
        : "// 请输入有效的产品链接";
    }

    if (!isImageUrlValid) {
      return en
        ? "// Please enter a valid Image URL"
        : "// 请输入有效的图片链接";
    }

    const productUrlValue = productUrl || `${shopInfo.url}/products/your-product-handle`;

    const schema: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${productUrlValue}#product`,
      name: productName,
      brand: {
        "@type": "Brand",
        name: shopInfo.name,
      },
      offers: {
        "@type": "Offer",
        price: productPrice,
        priceCurrency: productCurrency,
        availability: `https://schema.org/${productAvailability}`,
        url: productUrlValue,
        itemCondition: "https://schema.org/NewCondition",
        seller: {
          "@type": "Organization",
          name: shopInfo.name,
        },
      },
    };

    // 可选字段：仅在有值时添加
    if (productDescription.trim()) {
      schema.description = productDescription;
    }
    if (productSku.trim()) {
      schema.sku = productSku;
    }
    if (productImage.trim()) {
      // image 使用数组格式以支持多图
      schema.image = [productImage];
    }

    // 转义 </script> 以防止 XSS 注入
    const safeJsonString = JSON.stringify(schema, null, 2)
      .replace(/<\/script/gi, "<\\/script");

    return `<script type="application/ld+json">
${safeJsonString}
</script>`;
  }, [productName, productDescription, productPrice, productCurrency, productAvailability, productSku, productUrl, productImage, shopInfo, isPriceValid, isUrlValid, isImageUrlValid, en]);

  // 计算验证错误信息
  const getValidationMessage = () => {
    if (!productName.trim()) {
      return en ? "Product Name is required" : "产品名称为必填项";
    }
    if (!productPrice.trim()) {
      return en ? "Price is required" : "价格为必填项";
    }
    if (!isPriceValid) {
      return en ? "Please enter a valid price (positive number)" : "请输入有效价格（正数）";
    }
    if (!isUrlValid) {
      return en ? "Please enter a valid Product URL" : "请输入有效的产品链接";
    }
    if (!isImageUrlValid) {
      return en ? "Please enter a valid Image URL" : "请输入有效的图片链接";
    }
    return null;
  };

  const validationMessage = getValidationMessage();

  return (
    <div>
      {/* 必填字段提示 */}
      {validationMessage && (
        <div style={{ 
          marginBottom: 16, 
          padding: 12, 
          background: "#fff7e6", 
          border: "1px solid #ffd591",
          borderRadius: 6, 
          fontSize: 13,
          color: "#d46b08",
        }}>
          ⚠️ {validationMessage}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            {en ? "Product Name" : "产品名称"} <span style={{ color: "#de3618" }}>*</span>
          </label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder={en ? "Enter product name" : "输入产品名称"}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              border: `1px solid ${!productName.trim() ? "#ffc58b" : "#c4cdd5"}`,
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            {en ? "Price" : "价格"} <span style={{ color: "#de3618" }}>*</span>
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
                border: `1px solid ${!productPrice.trim() || (productPrice.trim() && !isPriceValid) ? "#ffc58b" : "#c4cdd5"}`,
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
          {productPrice.trim() && !isPriceValid && (
            <span style={{ fontSize: 12, color: "#de3618", marginTop: 4, display: "block" }}>
              {en ? "Enter a valid positive number" : "请输入有效的正数"}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
            {en ? "SKU (optional)" : "SKU（可选）"}
          </label>
          <input
            type="text"
            value={productSku}
            onChange={(e) => setProductSku(e.target.value)}
            placeholder={en ? "e.g., ABC-12345" : "例如：ABC-12345"}
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
            {en ? "Product URL (optional)" : "产品链接（可选）"}
          </label>
          <input
            type="text"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder={`${shopInfo.url}/products/...`}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              border: `1px solid ${productUrl && !isUrlValid ? "#de3618" : "#c4cdd5"}`,
              borderRadius: 4,
              fontSize: 14,
            }}
          />
          {productUrl && !isUrlValid && (
            <span style={{ fontSize: 12, color: "#de3618", marginTop: 4, display: "block" }}>
              {en ? "Enter a valid URL" : "请输入有效的链接"}
            </span>
          )}
        </div>
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          {en ? "Product Image URL (optional)" : "产品图片链接（可选）"}
        </label>
        <input
          type="text"
          value={productImage}
          onChange={(e) => setProductImage(e.target.value)}
          placeholder={en ? "https://cdn.shopify.com/..." : "https://cdn.shopify.com/..."}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 12px",
            border: `1px solid ${productImage && !isImageUrlValid ? "#de3618" : "#c4cdd5"}`,
            borderRadius: 4,
            fontSize: 14,
          }}
        />
        {productImage && !isImageUrlValid && (
          <span style={{ fontSize: 12, color: "#de3618", marginTop: 4, display: "block" }}>
            {en ? "Enter a valid URL" : "请输入有效的链接"}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
          {en ? "Description (optional)" : "描述（可选）"}
        </label>
        <textarea
          value={productDescription}
          onChange={(e) => setProductDescription(e.target.value)}
          placeholder={en ? "Enter product description" : "输入产品描述"}
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
        <CopyButton text={schemaCode} en={en} disabled={!isValid} />
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
          <li>{en ? "Open main-product.liquid (OS 2.0) or product.liquid (legacy)" : "打开 main-product.liquid（OS 2.0 主题）或 product.liquid（旧版主题）"}</li>
          <li>{en ? "Paste the code before </head> or at the end of the file" : "将代码粘贴到 </head> 之前或文件末尾"}</li>
        </ol>
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

// ============================================================================
// Main Component
// ============================================================================

// Tab 类型定义
type TabId = "schema" | "faq" | "llms";

const VALID_TABS: TabId[] = ["schema", "faq", "llms"];

function resolveTab(value: string | null): TabId {
  return VALID_TABS.includes(value as TabId) ? (value as TabId) : "llms";
}

export default function AIVisibility() {
  const { 
    language, 
    canManageLlms,
    canUseLlmsAdvanced,
    shopInfo, 
    shopDomain,
    settings,
    llmsStatus,
    report,
    embedEnabled,
    embedDeepLink,
    embedManualPath,
  } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get("tab"));
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const currentTab = searchParams.get("tab");
    if (!VALID_TABS.includes(currentTab as TabId)) {
      const next = getPreservedSearchParams(location.search);
      next.set("tab", "llms");
      setSearchParams(next, { replace: true });
    }
  }, [location.search, searchParams, setSearchParams]);

  const updateActiveTab = useCallback((tab: TabId) => {
    const next = getPreservedSearchParams(location.search);
    next.set("tab", tab);
    navigate({
      pathname: location.pathname,
      search: `?${next.toString()}`,
      hash: location.hash,
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
    <s-page heading={en ? "AI SEO Workspace" : "AI SEO 工作台"}>
      <div className={styles.page}>
        {/* 顶部导航 */}
        <div style={{ marginBottom: 16, display: "flex", gap: 12, justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Link to={buildEmbeddedAppPath("/app", location.search)} className={styles.secondaryButton}>
              ← {en ? "Back to Dashboard" : "返回仪表盘"}
            </Link>
            <Link to={buildEmbeddedAppPath("/app/optimization", location.search)} className={styles.primaryButton}>
              {en ? "View AI Score" : "查看 AI 评分"} →
            </Link>
          </div>
          
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              background: canUseLlmsAdvanced ? "#f6ffed" : "#f4f6f8",
              border: `1px solid ${canUseLlmsAdvanced ? "#b7eb8f" : "#dfe3e8"}`,
              borderRadius: 20,
              fontSize: 13,
              color: canUseLlmsAdvanced ? "#389e0d" : "#637381",
              fontWeight: 500,
            }}
          >
            {canUseLlmsAdvanced ? "✨" : "ℹ️"} {canUseLlmsAdvanced
              ? (en ? "Advanced llms tools enabled" : "已启用高级 llms 工具")
              : (en ? "Core llms workflow available" : "可使用 llms 核心流程")}
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
            { id: "llms" as const, label: "📝 llms.txt" },
          ] satisfies { id: TabId; label: string }[]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => updateActiveTab(tab.id)}
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
        <div id="product-schema-settings" className={styles.card}>
          {activeTab === "schema" && (
            <>
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
                embedManualPath={embedManualPath}
                en={en}
              />

              {/* 预览模板 */}
              {embedEnabled === true && (
                <SchemaPreview shopInfo={shopInfo} en={en} />
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
                    <div style={{
                      marginBottom: 16,
                      padding: 12,
                      background: "#fff7e6",
                      border: "1px solid #ffd591",
                      borderRadius: 6,
                      fontSize: 13,
                      color: "#d46b08",
                    }}>
                      ⚠️ {en 
                        ? "This is for advanced users with Headless or custom storefronts who cannot use Theme App Extensions. For standard Shopify themes, use the automatic App Embed above instead."
                        : "此功能仅适用于使用 Headless 或自定义 Storefront 的高级用户。如果您使用标准 Shopify 主题，请使用上方的自动 App Embed 功能。"}
                    </div>
                    <SchemaGenerator shopInfo={shopInfo} en={en} />
                  </div>
                )}
              </div>
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

          {activeTab === "llms" && (
            <>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionLabel}>llms.txt</p>
                  <h3 className={styles.sectionTitle}>
                    {en ? "Real llms.txt workflow" : "真实 llms.txt 工作流"}
                  </h3>
                </div>
              </div>
              <LlmsTxtPanel
                language={language}
                shopDomain={shopDomain}
                initialStatus={llmsStatus}
                initialExposurePreferences={settings.exposurePreferences}
                canManage={canManageLlms}
                canUseAdvanced={canUseLlmsAdvanced}
                editable={canManageLlms}
                context="workspace"
              />
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
              <Link to={buildEmbeddedAppPath("/app/optimization", location.search)} style={{ color: "#008060", fontSize: 13, fontWeight: 500 }}>
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

