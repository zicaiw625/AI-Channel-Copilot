/**
 * 升级提示组件
 * 用更有价值感知的方式引导用户升级
 */

import { Link, useLocation } from "react-router";
import type { Lang } from "./types";
import { buildEmbeddedAppPath } from "../../lib/navigation";

export interface UpgradePromptProps {
  lang: Lang;
  /** 提示的具体功能点 */
  feature: "ltv" | "products" | "export" | "copilot" | "funnel" | "history";
  /** 显示模式：overlay 覆盖内容，inline 行内提示 */
  variant?: "overlay" | "inline" | "banner";
}

const featureDetails = {
  ltv: {
    icon: "💎",
    title: { en: "Unlock Customer LTV Analysis", zh: "解锁客户 LTV 分析" },
    description: {
      en: "See which AI channels bring your most valuable customers",
      zh: "了解哪些 AI 渠道带来最有价值的客户",
    },
    benefits: {
      en: [
        "Identify high-value AI customers",
        "Track repeat purchase patterns",
        "Compare LTV across channels",
      ],
      zh: [
        "识别高价值 AI 客户",
        "追踪复购行为模式",
        "跨渠道 LTV 对比",
      ],
    },
  },
  products: {
    icon: "📦",
    title: { en: "Unlock Product Performance", zh: "解锁产品表现分析" },
    description: {
      en: "Discover which products AI assistants recommend most",
      zh: "发现 AI 助手最常推荐的产品",
    },
    benefits: {
      en: [
        "Top AI-selling products",
        "Channel-specific insights",
        "Optimize AI-facing content",
      ],
      zh: [
        "AI 渠道热销产品",
        "渠道级别洞察",
        "优化面向 AI 的内容",
      ],
    },
  },
  export: {
    icon: "📊",
    title: { en: "Unlock Data Export", zh: "解锁数据导出" },
    description: {
      en: "Export detailed AI attribution data for deeper analysis",
      zh: "导出详细的 AI 归因数据进行深入分析",
    },
    benefits: {
      en: [
        "CSV export for all data",
        "Custom date ranges",
        "Integration with BI tools",
      ],
      zh: [
        "所有数据 CSV 导出",
        "自定义日期范围",
        "与 BI 工具集成",
      ],
    },
  },
  copilot: {
    icon: "🤖",
    title: { en: "Unlock AI Copilot", zh: "解锁 AI Copilot" },
    description: {
      en: "Get instant AI-powered insights about your store",
      zh: "获取关于店铺的即时 AI 洞察",
    },
    benefits: {
      en: [
        "Natural language queries",
        "Instant performance summaries",
        "Actionable recommendations",
      ],
      zh: [
        "自然语言查询",
        "即时表现总结",
        "可操作的建议",
      ],
    },
  },
  funnel: {
    icon: "📈",
    title: { en: "Unlock Funnel Analysis", zh: "解锁漏斗分析" },
    description: {
      en: "See the full AI customer journey from visit to purchase",
      zh: "查看从访问到购买的完整 AI 客户旅程",
    },
    benefits: {
      en: [
        "Full conversion funnel",
        "Abandonment analysis",
        "Channel comparison",
      ],
      zh: [
        "完整转化漏斗",
        "放弃率分析",
        "渠道对比",
      ],
    },
  },
  history: {
    icon: "📅",
    title: { en: "Unlock Historical Data", zh: "解锁历史数据" },
    description: {
      en: "Access up to 90 days of AI attribution history",
      zh: "访问最多 90 天的 AI 归因历史",
    },
    benefits: {
      en: [
        "30/90 day trends",
        "Seasonal patterns",
        "Growth tracking",
      ],
      zh: [
        "30/90 天趋势",
        "季节性模式",
        "增长追踪",
      ],
    },
  },
};

export const UpgradePrompt = ({
  lang,
  feature,
  variant = "overlay",
}: UpgradePromptProps) => {
  const en = lang === "English";
  const details = featureDetails[feature];
  const location = useLocation();
  const billingHref = buildEmbeddedAppPath("/app/billing", location.search);

  // Overlay 模式：极简紧凑版
  if (variant === "overlay") {
    return (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(2px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          padding: 8,
        }}
      >
        <div
          style={{
            background: "white",
            padding: "12px 16px",
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            maxWidth: 180,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 20, marginBottom: 6 }}>{details.icon}</div>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: 12,
              fontWeight: 600,
              color: "#212b36",
              lineHeight: 1.3,
            }}
          >
            {en ? details.title.en : details.title.zh}
          </h3>
          <Link
            to={billingHref}
            style={{
              display: "inline-block",
              background: "#635bff",
              color: "white",
              padding: "6px 12px",
              borderRadius: 4,
              textDecoration: "none",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {en ? "Upgrade to Pro" : "升级到 Pro"}
          </Link>
          <div style={{ marginTop: 4, fontSize: 9, color: "#919eab" }}>
            {en ? "14-day free trial" : "14 天免费试用"}
          </div>
        </div>
      </div>
    );
  }

  // Banner 模式：页面顶部横幅
  if (variant === "banner") {
    return (
      <div
        style={{
          background: "linear-gradient(135deg, #635bff 0%, #8b5cf6 100%)",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span style={{ fontSize: 28 }}>{details.icon}</span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "white",
              marginBottom: 2,
            }}
          >
            {en ? details.title.en : details.title.zh}
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
            {en ? details.description.en : details.description.zh}
          </div>
        </div>
        <Link
          to={billingHref}
          style={{
            background: "white",
            color: "#635bff",
            padding: "8px 16px",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {en ? "Upgrade" : "升级"}
        </Link>
      </div>
    );
  }

  // Inline 模式：简洁的行内提示
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "#f4f6f8",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      <span>{details.icon}</span>
      <span style={{ color: "#637381" }}>
        {en ? details.title.en : details.title.zh}
      </span>
      <Link
        to={billingHref}
        style={{
          marginLeft: "auto",
          color: "#635bff",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        {en ? "Upgrade →" : "升级 →"}
      </Link>
    </div>
  );
};

export default UpgradePrompt;
