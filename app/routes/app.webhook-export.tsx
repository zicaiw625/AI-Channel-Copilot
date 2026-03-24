import { useState, useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { Banner, Button } from "../components/ui";
import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/settings.server";
import { useUILanguage } from "../lib/useUILanguage";
import { resolveUILanguageFromRequest } from "../lib/language.server";
import styles from "../styles/app.dashboard.module.css";
import { hasFeature, FEATURES } from "../lib/access.server";
import { PageHeader } from "../components/layout/PageHeader";
import { buildBillingHref, buildDashboardHref } from "../lib/navigation";

// ============================================================================
// Loader
// ============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) throw auth;
  const { session } = auth;
  const shopDomain = session.shop;
  
  const isGrowth = await hasFeature(shopDomain, FEATURES.MULTI_STORE);
  const settings = await getSettings(shopDomain);
  const language = resolveUILanguageFromRequest(request, settings.languages?.[0] || "中文");

  // 获取 webhook 配置
  const webhookConfig = (settings as any).webhookExport || {
    enabled: false,
    url: "",
    secret: "",
    events: ["order.created", "daily_summary"],
  };

  return {
    language,
    shopDomain,
    isGrowth,
    webhookConfig,
  };
};

// ============================================================================
// Components
// ============================================================================

function StatusBadge({ status, en }: { status: "success" | "failed" | null; en: boolean }) {
  if (!status) return null;
  
  return (
    <span
      style={{
        padding: "4px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        background: status === "success" ? "#f6ffed" : "#fff1f0",
        color: status === "success" ? "#52c41a" : "#ff4d4f",
        border: `1px solid ${status === "success" ? "#b7eb8f" : "#ffa39e"}`,
      }}
    >
      {status === "success" 
        ? (en ? "✓ Success" : "✓ 成功") 
        : (en ? "✕ Failed" : "✕ 失败")}
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function WebhookExport() {
  const { language, shopDomain, isGrowth, webhookConfig } = useLoaderData<typeof loader>();
  const uiLanguage = useUILanguage(language);
  const en = uiLanguage === "English";
  const location = useLocation();
  const dashboardHref = buildDashboardHref(location.search);
  const billingHref = buildBillingHref(location.search);
  
  const configFetcher = useFetcher();
  const testFetcher = useFetcher();
  const exportFetcher = useFetcher();
  
  const [enabled, setEnabled] = useState(webhookConfig.enabled);
  const [url, setUrl] = useState(webhookConfig.url);
  const [secret, setSecret] = useState(webhookConfig.secret);
  const [events, setEvents] = useState<string[]>(webhookConfig.events);
  const [exportRange, setExportRange] = useState("7d");
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // 同步服务端配置更新到本地状态
  useEffect(() => {
    if (configFetcher.data?.ok && configFetcher.data?.config) {
      const config = configFetcher.data.config;
      setEnabled(config.enabled);
      setUrl(config.url);
      setSecret(config.secret);
      setEvents(config.events);
      setSaveSuccess(true);
      // 3秒后清除成功提示
      const timer = setTimeout(() => setSaveSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [configFetcher.data]);

  const handleSaveConfig = () => {
    configFetcher.submit(
      {
        intent: "update_config",
        enabled: enabled.toString(),
        url,
        secret,
        events: events.join(","),
      },
      { method: "post", action: "/api/webhook-export" }
    );
  };

  const handleTestWebhook = () => {
    testFetcher.submit(
      { intent: "test_webhook", url, secret },
      { method: "post", action: "/api/webhook-export" }
    );
  };

  const handleTriggerExport = () => {
    exportFetcher.submit(
      { intent: "trigger_export", url, secret, range: exportRange },
      { method: "post", action: "/api/webhook-export" }
    );
  };

  const toggleEvent = (event: string) => {
    if (events.includes(event)) {
      setEvents(events.filter(e => e !== event));
    } else {
      setEvents([...events, event]);
    }
  };

  if (!isGrowth) {
    return (
      <s-page heading={en ? "Webhook Export" : "Webhook 导出"}>
        <div className={styles.page}>
          <PageHeader
            back={{ to: dashboardHref, label: en ? "Back to Dashboard" : "返回仪表盘" }}
            actions={[
              {
                to: billingHref,
                label: en ? "Upgrade to Growth" : "升级到 Growth 版",
                variant: "primary",
              },
            ]}
          />

          <div
            style={{
              textAlign: "center",
              padding: 60,
              background: "#f9fafb",
              borderRadius: 12,
              border: "2px dashed #c4cdd5",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#212b36" }}>
              {en ? "Requires Growth" : "需要 Growth 版"}
            </h2>
            <p style={{ margin: "0 0 20px", color: "#637381" }}>
              {en
                ? "Webhook export is available on the Growth plan. Upgrade to automatically push AI order data to your systems."
                : "Webhook 导出功能仅在 Growth 版中可用。升级后可自动将 AI 订单数据推送到您的系统。"}
            </p>
          </div>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading={en ? "Webhook Export" : "Webhook 导出"}>
      <div className={styles.page}>
        <PageHeader
          back={{ to: dashboardHref, label: en ? "Back to Dashboard" : "返回仪表盘" }}
          extra={
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: "#f6ffed",
                border: "1px solid #b7eb8f",
                borderRadius: 20,
                fontSize: 13,
                color: "#389e0d",
                fontWeight: 500,
              }}
            >
              ✨ {en ? "Requires Growth" : "需要 Growth 版"}
            </div>
          }
        />

        {/* 配置卡片 */}
        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Configuration" : "配置"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "Webhook Endpoint Settings" : "Webhook 端点设置"}
              </h3>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize: 14, fontWeight: 500 }}>
                {enabled ? (en ? "Enabled" : "已启用") : (en ? "Disabled" : "已禁用")}
              </span>
            </label>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
              {en ? "Webhook URL" : "Webhook 地址"}
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                border: url && !url.startsWith("https://") ? "1px solid #ff4d4f" : "1px solid #c4cdd5",
                borderRadius: 4,
                fontSize: 14,
              }}
            />
            {url && !url.startsWith("https://") && (
              <div style={{ marginTop: 8 }}>
                <Banner status="critical">
                  {en ? "Only HTTPS URLs are allowed for security" : "出于安全考虑，仅支持 HTTPS 地址"}
                </Banner>
              </div>
            )}
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#637381" }}>
              {en
                ? "The HTTPS URL where we'll send POST requests with your AI order data"
                : "我们将向此 HTTPS 地址发送包含 AI 订单数据的 POST 请求"}
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
              {en ? "Secret Key (Optional)" : "密钥（可选）"}
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={en ? "Enter secret for signature verification" : "输入用于签名验证的密钥"}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                border: "1px solid #c4cdd5",
                borderRadius: 4,
                fontSize: 14,
              }}
            />
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#637381" }}>
              {en
                ? "Used to generate X-AICC-Signature header for request verification"
                : "用于生成 X-AICC-Signature 请求头以验证请求来源"}
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 500 }}>
              {en ? "Events to Send" : "发送的事件"}
            </label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { id: "order.created", label: en ? "New AI Order" : "新 AI 订单" },
                { id: "daily_summary", label: en ? "Daily Summary" : "每日汇总" },
                { id: "weekly_report", label: en ? "Weekly Report" : "每周报告" },
              ].map((event) => (
                <label
                  key={event.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    border: events.includes(event.id)
                      ? "2px solid #008060"
                      : "1px solid #c4cdd5",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: events.includes(event.id) ? "#f6ffed" : "#fff",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={events.includes(event.id)}
                    onChange={() => toggleEvent(event.id)}
                    style={{ display: "none" }}
                  />
                  <span style={{ fontSize: 13 }}>{event.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Button
              type="button"
              onClick={handleSaveConfig}
              disabled={configFetcher.state !== "idle"}
            >
              {configFetcher.state !== "idle"
                ? (en ? "Saving..." : "保存中...")
                : (en ? "Save Configuration" : "保存配置")}
            </Button>
            
            <Button
              type="button"
              onClick={handleTestWebhook}
              disabled={!url || testFetcher.state !== "idle"}
              variant="secondary"
            >
              {testFetcher.state !== "idle"
                ? (en ? "Testing..." : "测试中...")
                : (en ? "Send Test" : "发送测试")}
            </Button>
            
            {testFetcher.data && (
              <StatusBadge 
                status={testFetcher.data.ok ? "success" : "failed"} 
                en={en} 
              />
            )}
          </div>

          {saveSuccess && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: "#f6ffed",
                border: "1px solid #b7eb8f",
                borderRadius: 6,
                fontSize: 13,
                color: "#389e0d",
              }}
            >
              ✓ {en ? "Configuration saved successfully!" : "配置保存成功！"}
            </div>
          )}

          {testFetcher.data?.error && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: "#fff1f0",
                border: "1px solid #ffa39e",
                borderRadius: 6,
                fontSize: 13,
                color: "#cf1322",
              }}
            >
              ✕ {testFetcher.data.error}
            </div>
          )}
        </div>

        {/* 手动导出卡片 */}
        <div className={styles.card} style={{ marginTop: 20 }}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Manual Export" : "手动导出"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "Trigger Data Export Now" : "立即触发数据导出"}
              </h3>
            </div>
          </div>

          <p className={styles.helpText} style={{ marginBottom: 16 }}>
            {en
              ? "Immediately send AI order data to your webhook endpoint."
              : "立即将 AI 订单数据发送到您的 Webhook 端点。"}
          </p>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <select
              value={exportRange}
              onChange={(e) => setExportRange(e.target.value)}
              style={{
                padding: "10px 12px",
                border: "1px solid #c4cdd5",
                borderRadius: 4,
                fontSize: 14,
              }}
            >
              <option value="7d">{en ? "Last 7 Days" : "最近 7 天"}</option>
              <option value="30d">{en ? "Last 30 Days" : "最近 30 天"}</option>
              <option value="90d">{en ? "Last 90 Days" : "最近 90 天"}</option>
            </select>
            
            <Button
              type="button"
              onClick={handleTriggerExport}
              disabled={!url || exportFetcher.state !== "idle"}
              variant="primary"
            >
              {exportFetcher.state !== "idle"
                ? (en ? "Exporting..." : "导出中...")
                : (en ? "Export Now" : "立即导出")}
            </Button>
          </div>

          {exportFetcher.data?.ok && (
            <div style={{ marginTop: 16 }}>
              <Banner status="success" title={en ? "Export completed!" : "导出完成！"}>
                <div>
                  {en ? "Orders exported: " : "导出订单数："}
                  <strong>{exportFetcher.data.ordersExported}</strong>
                </div>
                {exportFetcher.data.summary && (
                  <div style={{ marginTop: 8 }}>
                    AI GMV: ${exportFetcher.data.summary.aiGMV.toFixed(2)} · 
                    AI Orders: {exportFetcher.data.summary.aiOrders} · 
                    AI Share: {exportFetcher.data.summary.aiShare.toFixed(1)}%
                  </div>
                )}
              </Banner>
            </div>
          )}

          {exportFetcher.data?.error && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: "#fff1f0",
                border: "1px solid #ffa39e",
                borderRadius: 6,
                fontSize: 13,
                color: "#cf1322",
              }}
            >
              ✕ {exportFetcher.data.error}
            </div>
          )}
        </div>

        {/* Payload 格式说明 */}
        <div className={styles.card} style={{ marginTop: 20 }}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>{en ? "Reference" : "参考"}</p>
              <h3 className={styles.sectionTitle}>
                {en ? "Webhook Payload Format" : "Webhook 数据格式"}
              </h3>
            </div>
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
{`{
  "event": "data_export",
  "timestamp": "2025-12-09T10:30:00Z",
  "shopDomain": "${shopDomain}",
  "data": {
    "range": "7d",
    "summary": {
      "totalOrders": 150,
      "totalGMV": 12500.00,
      "aiOrders": 23,
      "aiGMV": 2150.00,
      "aiShare": 17.2
    },
    "orders": [
      {
        "id": "gid://shopify/Order/123",
        "name": "#1001",
        "createdAt": "2025-12-08T15:30:00Z",
        "totalPrice": 99.99,
        "currency": "USD",
        "aiSource": "ChatGPT",
        "referrer": "https://chat.openai.com",
        "utmSource": "chatgpt",
        "utmMedium": "ai_assistant"
      }
    ]
  }
}`}
          </pre>

          <div style={{ marginTop: 16, padding: 12, background: "#f0f7ff", borderRadius: 6, fontSize: 13 }}>
            <strong>📍 {en ? "Headers sent with each request:" : "每个请求发送的头信息："}</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              <li><code>Content-Type: application/json</code></li>
              <li><code>X-AICC-Event: data_export | order.created | test</code></li>
              <li><code>X-AICC-Signature: sha256=...</code> {en ? "(if secret is set)" : "（如果设置了密钥）"}</li>
            </ul>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
