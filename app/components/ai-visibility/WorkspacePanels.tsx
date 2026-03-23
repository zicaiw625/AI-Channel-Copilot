import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getEmbedCopy, MANUAL_PATH_COPY, toEmbedStatus } from "../../lib/productSchemaEmbedCopy";
import { Banner, Button, Card } from "../ui";

interface CopyButtonProps {
  text: string;
  en: boolean;
  label?: string;
  disabled?: boolean;
}

function CopyButton({ text, en, label, disabled }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);

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
  }, [disabled, text]);

  return (
    <Button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      size="small"
      style={disabled ? { background: "#919eab", borderColor: "#919eab" } : copied ? { background: "#52c41a", borderColor: "#52c41a" } : undefined}
    >
      {copied ? "✓" : "📋"}
      {copied ? (en ? "Copied!" : "已复制！") : (label || (en ? "Copy Code" : "复制代码"))}
    </Button>
  );
}

export function EmbedStatusCard({
  embedEnabled,
  embedDeepLink,
  en,
}: {
  embedEnabled: boolean | null;
  embedDeepLink: string;
  en: boolean;
}) {
  const status = toEmbedStatus(embedEnabled);
  const copy = getEmbedCopy(status);
  const manualPath = en ? MANUAL_PATH_COPY.en : MANUAL_PATH_COPY.zh;

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
    <Card
      padding="tight"
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        marginBottom: 20,
      }}
    >
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
    </Card>
  );
}

export function SchemaPreview({ en }: { en: boolean }) {
  const previewCode = useMemo(() => {
    const schema = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "{{ product.title }}",
      description: "{{ product.description | strip_html | truncate: 5000 }}",
      image: ["{{ product.images | first | image_url: width: 1024 }}"],
      sku: "{{ variant.sku | default: product.id }}",
      brand: {
        "@type": "Brand",
        name: "{{ product.vendor }}",
      },
      offers: {
        "@type": "Offer",
        url: "{{ request.origin }}{{ product.url }}",
        price: "{{ variant.price | divided_by: 100.0 }}",
        priceCurrency: "{{ shop.currency }}",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
        seller: {
          "@type": "Organization",
          name: "{{ shop.name }}",
        },
      },
    };
    return JSON.stringify(schema, null, 2);
  }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
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

function isValidUrl(url: string) {
  if (!url.trim()) return true;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isValidPrice(price: string) {
  if (!price.trim()) return false;
  const num = parseFloat(price);
  return !Number.isNaN(num) && num > 0;
}

export function SchemaGenerator({
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
      return en ? "// Please enter a valid Product URL" : "// 请输入有效的产品链接";
    }
    if (!isImageUrlValid) {
      return en ? "// Please enter a valid Image URL" : "// 请输入有效的图片链接";
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

    if (productDescription.trim()) schema.description = productDescription;
    if (productSku.trim()) schema.sku = productSku;
    if (productImage.trim()) schema.image = [productImage];

    const safeJsonString = JSON.stringify(schema, null, 2).replace(/<\/script/gi, "<\\/script");
    return `<script type="application/ld+json">\n${safeJsonString}\n</script>`;
  }, [
    en,
    isImageUrlValid,
    isPriceValid,
    isUrlValid,
    productAvailability,
    productCurrency,
    productDescription,
    productImage,
    productName,
    productPrice,
    productSku,
    productUrl,
    shopInfo.name,
    shopInfo.url,
  ]);

  const validationMessage = useMemo(() => {
    if (!productName.trim()) return en ? "Product Name is required" : "产品名称为必填项";
    if (!productPrice.trim()) return en ? "Price is required" : "价格为必填项";
    if (!isPriceValid) return en ? "Please enter a valid price (positive number)" : "请输入有效价格（正数）";
    if (!isUrlValid) return en ? "Please enter a valid Product URL" : "请输入有效的产品链接";
    if (!isImageUrlValid) return en ? "Please enter a valid Image URL" : "请输入有效的图片链接";
    return null;
  }, [en, isImageUrlValid, isPriceValid, isUrlValid, productName, productPrice]);

  return (
    <div>
      {validationMessage && (
        <div style={{ marginBottom: 16 }}>
          <Banner status="warning">{validationMessage}</Banner>
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
            onChange={(event) => setProductName(event.target.value)}
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
              onChange={(event) => setProductPrice(event.target.value)}
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
              onChange={(event) => setProductCurrency(event.target.value)}
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
            onChange={(event) => setProductSku(event.target.value)}
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
            onChange={(event) => setProductUrl(event.target.value)}
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
          onChange={(event) => setProductImage(event.target.value)}
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
          onChange={(event) => setProductDescription(event.target.value)}
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
          onChange={(event) => setProductAvailability(event.target.value)}
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

      <div style={{ marginTop: 12 }}>
        <Banner status="info">
          <strong>{en ? "How to use:" : "使用方法："}</strong>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>{en ? "Copy the code above" : "复制上面的代码"}</li>
            <li>{en ? "Go to Shopify Admin → Online Store → Themes → Edit code" : "进入 Shopify 后台 → 在线商店 → 主题 → 编辑代码"}</li>
            <li>{en ? "Open main-product.liquid (OS 2.0) or product.liquid (legacy)" : "打开 main-product.liquid（OS 2.0 主题）或 product.liquid（旧版主题）"}</li>
            <li>{en ? "Paste the code before </head> or at the end of the file" : "将代码粘贴到 </head> 之前或文件末尾"}</li>
          </ol>
        </Banner>
      </div>
    </div>
  );
}

function generateFaqId() {
  return `faq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function FAQGenerator({ en }: { en: boolean }) {
  const [faqs, setFaqs] = useState([{ id: generateFaqId(), question: "", answer: "" }]);
  const validFaqs = useMemo(() => faqs.filter((faq) => faq.question.trim() && faq.answer.trim()), [faqs]);
  const isValid = validFaqs.length > 0;

  const addFaq = () => setFaqs([...faqs, { id: generateFaqId(), question: "", answer: "" }]);
  const removeFaq = (index: number) => setFaqs(faqs.filter((_, i) => i !== index));
  const updateFaq = (index: number, field: "question" | "answer", value: string) => {
    const nextFaqs = [...faqs];
    nextFaqs[index][field] = value;
    setFaqs(nextFaqs);
  };

  const faqSchemaCode = useMemo(() => {
    if (validFaqs.length === 0) {
      return en ? "// Add FAQs above to generate code" : "// 在上方添加 FAQ 以生成代码";
    }

    const schema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: validFaqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    };

    const safeJsonString = JSON.stringify(schema, null, 2).replace(/<\/script/gi, "<\\/script");
    return `<script type="application/ld+json">\n${safeJsonString}\n</script>`;
  }, [en, validFaqs]);

  return (
    <div>
      {faqs.map((faq, index) => (
        <Card
          key={faq.id}
          padding="tight"
          style={{
            marginBottom: 16,
            background: "#f9fafb",
            position: "relative",
          }}
        >
          {faqs.length > 1 && (
            <Button
              type="button"
              onClick={() => removeFaq(index)}
              variant="destructive"
              size="small"
              style={{ position: "absolute", top: 8, right: 8, padding: "4px 8px" }}
            >
              ✕
            </Button>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
              {en ? `Question ${index + 1}` : `问题 ${index + 1}`}
            </label>
            <input
              type="text"
              value={faq.question}
              onChange={(event) => updateFaq(index, "question", event.target.value)}
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
              onChange={(event) => updateFaq(index, "answer", event.target.value)}
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
        </Card>
      ))}

      <Button
        type="button"
        onClick={addFaq}
        variant="secondary"
        size="small"
        style={{ marginBottom: 16, borderStyle: "dashed", borderColor: "#008060", color: "#008060" }}
      >
        + {en ? "Add FAQ" : "添加 FAQ"}
      </Button>

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
