/**
 * AI 数据模块
 * 
 * AI 渠道识别说明（保守估计）
 * - 识别基于 referrer 域名与 UTM（utm_source/utm_medium）等显式信号；部分 AI/浏览器可能隐藏来源。
 * - 因此，本模块的识别结果偏下限，可能低估 AI 真实贡献；仪表盘与导出均按保守估计展示。
 * - 优先级：referrer > UTM > 其它（标签/备注），并记录冲突与命中 signals 供调试。
 */

import { DEFAULT_RANGE_KEY } from "./constants";
import { detectAiFromFields as detectAiFromFieldsRef, extractUtm as extractUtmRef } from "./aiAttribution";
import { metricOrderValue, computeLTV } from "./metrics";
import {
  buildTopCustomers,
  buildOverview as aggBuildOverview,
  buildChannelBreakdown as aggBuildChannelBreakdown,
  buildComparison as aggBuildComparison,
  buildTrend as aggBuildTrend,
  buildProducts as aggBuildProducts,
} from "./aiAggregation";

// 从 aiTypes 重新导出所有类型，保持向后兼容
export type {
  AIChannel,
  TimeRangeKey,
  DateRange,
  OrderLine,
  OrderRecord,
  OverviewMetrics,
  ChannelStat,
  ComparisonRow,
  TrendPoint,
  ProductRow,
  RawOrderRow,
  PipelineStatus,
  TaggingSettings,
  ExposurePreferences,
  SettingsDefaults,
  DashboardData,
  AiDomainRule,
  UtmSourceRule,
  DetectionConfig,
  TopCustomerRow,
} from "./aiTypes";

import type {
  AIChannel,
  TimeRangeKey,
  DateRange,
  OrderRecord,
  ProductRow,
  RawOrderRow,
  AiDomainRule,
  UtmSourceRule,
  SettingsDefaults,
  DashboardData,
} from "./aiTypes";
import { AI_CHANNELS } from "./aiTypes";

// 从 dateUtils 导入日期工具
import { startOfDay, endOfDay, formatDateOnly, parseDateInput } from "./dateUtils";

// 重新导出 AI_CHANNELS 常量
export { AI_CHANNELS } from "./aiTypes";

export const timeRanges: Record<
  TimeRangeKey,
  { label: string; days: number; isCustom?: boolean }
> = {
  "7d": { label: "最近 7 天", days: 7 },
  "30d": { label: "最近 30 天", days: 30 },
  "90d": { label: "最近 90 天", days: 90 },
  custom: { label: "自定义", days: 30, isCustom: true },
};

// Mock 数据配置（仅用于演示）
const DEMO_STORE_URL = "https://demo-store.ai-beauty.example.com";
const DEMO_NOW = Date.now();

/** 计算 N 天前的 ISO 日期字符串（用于 mock 数据） */
const daysAgoISO = (days: number): string => new Date(DEMO_NOW - days * 86_400_000).toISOString();

export const resolveDateRange = (
  key: TimeRangeKey,
  nowDate = new Date(),
  from?: string | null,
  to?: string | null,
  timeZone?: string,
): DateRange => {
  const baseKey: TimeRangeKey = timeRanges[key] ? key : DEFAULT_RANGE_KEY;
  const wantsCustom = baseKey === "custom" || (from && to);

  if (wantsCustom) {
    const start = parseDateInput(from);
    const end = parseDateInput(to);
    if (start && end) {
      const [rangeStart, rangeEnd] =
        start.getTime() <= end.getTime() ? [start, end] : [end, start];
      const normalizedStart = startOfDay(rangeStart, timeZone);
      const normalizedEnd = endOfDay(rangeEnd, timeZone);
      const days = Math.max(
        1,
        Math.round((normalizedEnd.getTime() - normalizedStart.getTime()) / 86_400_000) + 1,
      );
      return {
        key: "custom",
        label: `${formatDateOnly(normalizedStart, timeZone)} → ${formatDateOnly(normalizedEnd, timeZone)}`,
        start: normalizedStart,
        end: normalizedEnd,
        days,
        fromParam: formatDateOnly(normalizedStart, timeZone),
        toParam: formatDateOnly(normalizedEnd, timeZone),
      };
    }
  }

  const preset = timeRanges[baseKey === "custom" ? DEFAULT_RANGE_KEY : baseKey] || timeRanges[DEFAULT_RANGE_KEY];
  const end = endOfDay(nowDate, timeZone);
  const start = startOfDay(end, timeZone);
  start.setUTCDate(start.getUTCDate() - (preset.days - 1));

  return {
    key: baseKey === "custom" ? DEFAULT_RANGE_KEY : baseKey,
    label: preset.label,
    start,
    end,
    days: preset.days,
    fromParam: formatDateOnly(start, timeZone),
    toParam: formatDateOnly(end, timeZone),
  };
};

const seedOrders: (Omit<OrderRecord, "signals"> & { signals?: string[] })[] = [
  {
    id: "4310",
    name: "#4310",
    createdAt: daysAgoISO(2),
    totalPrice: 188,
    currency: "USD",
    aiSource: "ChatGPT",
    referrer: "https://chat.openai.com/share/insight?id=4310",
    landingPage: `${DEMO_STORE_URL}/products/starter-kit?utm_source=chatgpt&utm_medium=ai-agent`,
    utmSource: "chatgpt",
    utmMedium: "ai-agent",
    sourceName: "web",
    tags: ["AI-Source-ChatGPT"],
    customerId: "c-101",
    isNewCustomer: false,
    products: [
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${DEMO_STORE_URL}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-vitc",
        title: "Radiance Vitamin C Drops",
        handle: "vitamin-c-drops",
        url: `${DEMO_STORE_URL}/products/vitamin-c-drops`,
        price: 92,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "Matched referrer chat.openai.com (AI domain list)",
  },
  {
    id: "4304",
    name: "#4304",
    createdAt: daysAgoISO(6),
    totalPrice: 96,
    currency: "USD",
    aiSource: "Perplexity",
    referrer: "https://www.perplexity.ai/search?q=best+cleanser",
    landingPage: `${DEMO_STORE_URL}/products/calm-foam-cleanser?utm_source=perplexity&utm_medium=organic`,
    utmSource: "perplexity",
    utmMedium: "organic",
    sourceName: "web",
    tags: ["AI-Source-Perplexity"],
    customerId: "c-102",
    isNewCustomer: false,
    products: [
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${DEMO_STORE_URL}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 2,
      },
    ],
    detection: "Matched referrer perplexity.ai",
  },
  {
    id: "4299",
    name: "#4299",
    createdAt: daysAgoISO(11),
    totalPrice: 178,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.instagram.com/",
    landingPage: `${DEMO_STORE_URL}/products/hydra-barrier-cream?utm_source=instagram&utm_medium=paid-social`,
    utmSource: "instagram",
    utmMedium: "paid-social",
    sourceName: "web",
    tags: [],
    customerId: "c-103",
    isNewCustomer: false,
    products: [
      {
        id: "p-hydra",
        title: "Hydra Barrier Cream",
        handle: "hydra-barrier-cream",
        url: `${DEMO_STORE_URL}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "No AI markers detected",
  },
  {
    id: "4287",
    name: "#4287",
    createdAt: daysAgoISO(25),
    totalPrice: 218,
    currency: "USD",
    aiSource: "ChatGPT",
    referrer: "https://chat.openai.com/share/beauty-shortlist",
    landingPage: `${DEMO_STORE_URL}/products/ceramide-repair-serum`,
    sourceName: "web",
    customerId: "c-101",
    isNewCustomer: true,
    products: [
      {
        id: "p-serum",
        title: "Ceramide Repair Serum",
        handle: "ceramide-repair-serum",
        url: `${DEMO_STORE_URL}/products/ceramide-repair-serum`,
        price: 109,
        currency: "USD",
        quantity: 2,
      },
    ],
    detection: "Matched referrer chat.openai.com",
  },
  {
    id: "4291",
    name: "#4291",
    createdAt: daysAgoISO(14),
    totalPrice: 178,
    currency: "USD",
    aiSource: "Perplexity",
    referrer: "https://www.perplexity.ai/",
    landingPage: `${DEMO_STORE_URL}/products/hydra-barrier-cream?utm_source=perplexity&utm_medium=ai-agent`,
    utmSource: "perplexity",
    utmMedium: "ai-agent",
    sourceName: "web",
    customerId: "c-102",
    isNewCustomer: true,
    products: [
      {
        id: "p-hydra",
        title: "Hydra Barrier Cream",
        handle: "hydra-barrier-cream",
        url: `${DEMO_STORE_URL}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "utm_source=perplexity mapped to AI channel",
  },
  {
    id: "4290",
    name: "#4290",
    createdAt: daysAgoISO(20),
    totalPrice: 198,
    currency: "USD",
    aiSource: null,
    referrer: "https://l.instagram.com/",
    landingPage: `${DEMO_STORE_URL}/products/starter-kit?utm_source=meta&utm_medium=retargeting`,
    utmSource: "meta",
    utmMedium: "retargeting",
    sourceName: "web",
    customerId: "c-103",
    isNewCustomer: true,
    products: [
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${DEMO_STORE_URL}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${DEMO_STORE_URL}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "No AI markers detected",
  },
  {
    id: "4301",
    name: "#4301",
    createdAt: daysAgoISO(8),
    totalPrice: 124,
    currency: "USD",
    aiSource: "Gemini",
    referrer: "https://gemini.google.com/app",
    landingPage: `${DEMO_STORE_URL}/products/hydra-barrier-cream?utm_source=gemini&utm_medium=assistant`,
    utmSource: "gemini",
    utmMedium: "assistant",
    sourceName: "web",
    customerId: "c-106",
    isNewCustomer: false,
    products: [
      {
        id: "p-hydra",
        title: "Hydra Barrier Cream",
        handle: "hydra-barrier-cream",
        url: `${DEMO_STORE_URL}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "utm_source=gemini mapped to AI channel",
  },
  {
    id: "4276",
    name: "#4276",
    createdAt: daysAgoISO(45),
    totalPrice: 144,
    currency: "USD",
    aiSource: "Gemini",
    referrer: "https://gemini.google.com/app/discover",
    landingPage: `${DEMO_STORE_URL}/products/starter-kit`,
    sourceName: "web",
    customerId: "c-106",
    isNewCustomer: true,
    products: [
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${DEMO_STORE_URL}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${DEMO_STORE_URL}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "Referrer gemini.google.com flagged as AI",
  },
  {
    id: "4281",
    name: "#4281",
    createdAt: daysAgoISO(32),
    totalPrice: 188,
    currency: "USD",
    aiSource: "Perplexity",
    referrer: "",
    landingPage: `${DEMO_STORE_URL}/products/vitamin-c-drops?utm_source=perplexity&utm_medium=ai-agent`,
    utmSource: "perplexity",
    utmMedium: "ai-agent",
    sourceName: "web",
    customerId: "c-110",
    isNewCustomer: true,
    products: [
      {
        id: "p-vitc",
        title: "Radiance Vitamin C Drops",
        handle: "vitamin-c-drops",
        url: `${DEMO_STORE_URL}/products/vitamin-c-drops`,
        price: 92,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${DEMO_STORE_URL}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "utm_source=perplexity mapped to AI channel",
  },
  {
    id: "4289",
    name: "#4289",
    createdAt: daysAgoISO(21),
    totalPrice: 156,
    currency: "USD",
    aiSource: "Copilot",
    referrer: "https://copilot.microsoft.com/",
    landingPage: `${DEMO_STORE_URL}/products/enzyme-reset-mask?utm_source=copilot&utm_medium=ai-assistant`,
    utmSource: "copilot",
    utmMedium: "ai-assistant",
    sourceName: "web",
    customerId: "c-105",
    isNewCustomer: false,
    products: [
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 2,
      },
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${DEMO_STORE_URL}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "Matched utm_source=copilot",
  },
  {
    id: "4267",
    name: "#4267",
    createdAt: daysAgoISO(60),
    totalPrice: 150,
    currency: "USD",
    aiSource: "Copilot",
    referrer: "https://copilot.microsoft.com/chat",
    landingPage: `${DEMO_STORE_URL}/products/starter-kit`,
    sourceName: "web",
    customerId: "c-105",
    isNewCustomer: true,
    products: [
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${DEMO_STORE_URL}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "Referrer copilot.microsoft.com flagged as AI",
  },
  {
    id: "4254",
    name: "#4254",
    createdAt: daysAgoISO(70),
    totalPrice: 220,
    currency: "USD",
    aiSource: "ChatGPT",
    referrer: "https://chat.openai.com/",
    landingPage: `${DEMO_STORE_URL}/products/hydra-barrier-cream?utm_source=chatgpt&utm_medium=assistant`,
    utmSource: "chatgpt",
    utmMedium: "assistant",
    sourceName: "web",
    customerId: "c-109",
    isNewCustomer: true,
    products: [
      {
        id: "p-hydra",
        title: "Hydra Barrier Cream",
        handle: "hydra-barrier-cream",
        url: `${DEMO_STORE_URL}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${DEMO_STORE_URL}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "utm_source=chatgpt mapped to AI channel",
  },
  {
    id: "4241",
    name: "#4241",
    createdAt: daysAgoISO(3),
    totalPrice: 146,
    currency: "USD",
    aiSource: "Other-AI",
    referrer: "https://claude.ai/chat",
    landingPage: `${DEMO_STORE_URL}/products/vitamin-c-drops?utm_medium=ai-assistant`,
    utmMedium: "ai-assistant",
    sourceName: "web",
    customerId: "c-111",
    isNewCustomer: false,
    products: [
      {
        id: "p-vitc",
        title: "Radiance Vitamin C Drops",
        handle: "vitamin-c-drops",
        url: `${DEMO_STORE_URL}/products/vitamin-c-drops`,
        price: 92,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "Referrer claude.ai matched Other-AI",
  },
  {
    id: "4229",
    name: "#4229",
    createdAt: daysAgoISO(85),
    totalPrice: 102,
    currency: "USD",
    aiSource: "Other-AI",
    referrer: "https://deepseek.com/assistant",
    landingPage: `${DEMO_STORE_URL}/products/enzyme-reset-mask?utm_source=deepseek`,
    utmSource: "deepseek",
    sourceName: "web",
    customerId: "c-111",
    isNewCustomer: true,
    products: [
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${DEMO_STORE_URL}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "utm_source=deepseek mapped to Other-AI",
  },
  {
    id: "4309",
    name: "#4309",
    createdAt: daysAgoISO(1),
    totalPrice: 96,
    currency: "USD",
    aiSource: null,
    referrer: "https://t.co/brand-email",
    landingPage: `${DEMO_STORE_URL}/products/starter-kit?utm_source=email&utm_medium=crm`,
    utmSource: "email",
    utmMedium: "crm",
    sourceName: "web",
    customerId: "c-104",
    isNewCustomer: false,
    products: [
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${DEMO_STORE_URL}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "No AI markers detected",
  },
  {
    id: "4306",
    name: "#4306",
    createdAt: daysAgoISO(4),
    totalPrice: 102,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.google.com/",
    landingPage: `${DEMO_STORE_URL}/products/enzyme-reset-mask?utm_source=google&utm_medium=organic`,
    utmSource: "google",
    utmMedium: "organic",
    sourceName: "web",
    customerId: "c-104",
    isNewCustomer: true,
    products: [
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${DEMO_STORE_URL}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${DEMO_STORE_URL}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "No AI markers detected",
  },
  {
    id: "4269",
    name: "#4269",
    createdAt: daysAgoISO(50),
    totalPrice: 233,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.reddit.com/",
    landingPage: `${DEMO_STORE_URL}/products/hydra-barrier-cream?utm_source=reddit&utm_medium=organic`,
    utmSource: "reddit",
    utmMedium: "organic",
    sourceName: "web",
    customerId: "c-108",
    isNewCustomer: true,
    products: [
      {
        id: "p-hydra",
        title: "Hydra Barrier Cream",
        handle: "hydra-barrier-cream",
        url: `${DEMO_STORE_URL}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-serum",
        title: "Ceramide Repair Serum",
        handle: "ceramide-repair-serum",
        url: `${DEMO_STORE_URL}/products/ceramide-repair-serum`,
        price: 109,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "No AI markers detected",
  },
  {
    id: "4295",
    name: "#4295",
    createdAt: daysAgoISO(12),
    totalPrice: 216,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.bing.com/",
    landingPage: `${DEMO_STORE_URL}/products/hydra-barrier-cream?utm_source=bing&utm_medium=seo`,
    utmSource: "bing",
    utmMedium: "seo",
    sourceName: "web",
    customerId: "c-112",
    isNewCustomer: true,
    products: [
      {
        id: "p-hydra",
        title: "Hydra Barrier Cream",
        handle: "hydra-barrier-cream",
        url: `${DEMO_STORE_URL}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-vitc",
        title: "Radiance Vitamin C Drops",
        handle: "vitamin-c-drops",
        url: `${DEMO_STORE_URL}/products/vitamin-c-drops`,
        price: 92,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "No AI markers detected",
  },
];

const orders: OrderRecord[] = seedOrders.map((order) => ({
  ...order,
  signals: order.signals ?? [],
}));

const defaultAiDomains: AiDomainRule[] = [
  { domain: "chat.openai.com", channel: "ChatGPT", source: "default" },
  { domain: "chatgpt.com", channel: "ChatGPT", source: "default" },
  { domain: "perplexity.ai", channel: "Perplexity", source: "default" },
  { domain: "www.perplexity.ai", channel: "Perplexity", source: "default" },
  { domain: "gemini.google.com", channel: "Gemini", source: "default" },
  { domain: "copilot.microsoft.com", channel: "Copilot", source: "default" },
  { domain: "www.copilot.microsoft.com", channel: "Copilot", source: "default" },
  { domain: "claude.ai", channel: "Other-AI", source: "default" },
  { domain: "deepseek.com", channel: "Other-AI", source: "default" },
];

const defaultUtmSources: UtmSourceRule[] = [
  { value: "chatgpt", channel: "ChatGPT" },
  { value: "perplexity", channel: "Perplexity" },
  { value: "gemini", channel: "Gemini" },
  { value: "copilot", channel: "Copilot" },
  { value: "deepseek", channel: "Other-AI" },
  { value: "claude", channel: "Other-AI" },
];

const defaultUtmMediums = [
  "ai-agent",
  "ai-assistant",
  "assistant",
  "ai-search",
  "ai-chat",
  "ai-referral",
];

const defaultPipelineStatuses: PipelineStatus[] = [
  {
    title: "orders/create webhook",
    status: "healthy",
    detail: "Delivered 12 minutes ago · auto-retries enabled",
  },
  {
    title: "Hourly backfill (last 90 days)",
    status: "info",
    detail: "Catching up 90d orders to avoid webhook gaps",
  },
  {
    title: "AI tagging write-back",
    status: "healthy",
    detail: "Order + customer tags ready · off by default",
  },
];

export const defaultSettings: SettingsDefaults = {
  aiDomains: defaultAiDomains,
  utmSources: defaultUtmSources,
  utmMediumKeywords: defaultUtmMediums,
  gmvMetric: "current_total_price",
  primaryCurrency: "USD",
  tagging: {
    orderTagPrefix: "AI-Source",
    customerTag: "AI-Customer",
    writeOrderTags: false,
    writeCustomerTags: false,
    dryRun: true,
  },
  exposurePreferences: {
    exposeProducts: false,
    exposeCollections: false,
    exposeBlogs: false,
  },
  retentionMonths: 6,
  languages: ["中文", "English"],
  timezones: ["UTC", "America/Los_Angeles", "Asia/Shanghai", "Europe/London"],
  pipelineStatuses: defaultPipelineStatuses,
};

export type DetectionConfig = {
  aiDomains: AiDomainRule[];
  utmSources: UtmSourceRule[];
  utmMediumKeywords: string[];
  tagPrefix?: string;
};

export const LOW_SAMPLE_THRESHOLD = 5;

const normalizeDomain = (domain?: string | null) =>
  (domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();

const safeUrl = (value?: string | null) => {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
};

const extractHostname = (value?: string | null) => {
  const url = safeUrl(value);
  if (!url) return null;
  return normalizeDomain(url.hostname);
};

const domainMatches = (ruleDomain: string, url: URL | null) => {
  if (!url) return false;
  const hostname = normalizeDomain(url.hostname);
  const rule = normalizeDomain(ruleDomain);
  return hostname === rule || hostname.endsWith(`.${rule}`);
};

const detectCopilotFromBing = (url: URL | null) => {
  if (!url) return null;
  const hostname = normalizeDomain(url.hostname);
  if (!hostname.endsWith("bing.com")) return null;

  const form = url.searchParams.get("form")?.toLowerCase() || "";
  const ocid = url.searchParams.get("ocid")?.toLowerCase() || "";
  const hasCopilotParam =
    url.pathname.includes("/chat") ||
    url.pathname.includes("/copilot") ||
    form.includes("bingai") ||
    form.includes("copilot") ||
    ocid.includes("copilot");

  if (!hasCopilotParam) return null;

  return `Bing referrer flagged as Copilot (${hostname}${url.pathname})`;
};

const aiValueToChannel = (value: string, utmSources: UtmSourceRule[]): AIChannel | null => {
  const normalized = value.toLowerCase();
  const utmMatch = utmSources.find(
    (rule) => rule.value.toLowerCase() === normalized,
  );

  if (utmMatch) return utmMatch.channel;

  const channel = channelList.find((item) => normalized.includes(item.toLowerCase()));
  return (channel as AIChannel | undefined) || null;
};

const detectFromNoteAttributes = (
  noteAttributes: { name?: string | null; value?: string | null }[] | undefined,
  utmSources: UtmSourceRule[],
): { aiSource: AIChannel; detection: string } | null => {
  if (!noteAttributes?.length) return null;

  const explicit = noteAttributes.find((attr) =>
    ["ai_source", "ai-channel", "ai_channel", "ai-referrer"].some((key) =>
      (attr.name || "").toLowerCase().includes(key),
    ),
  );

  if (explicit?.value) {
    const channel =
      aiValueToChannel(explicit.value, utmSources) ||
      ("Other-AI" as AIChannel);
    return {
      aiSource: channel,
      detection: `Note attribute ${explicit.name}=${explicit.value} mapped to AI channel`,
    };
  }

  const fuzzyHit = noteAttributes.find(
    (attr) => (attr.value || "").toLowerCase().includes("ai"),
  );

  if (fuzzyHit) {
    return {
      aiSource: "Other-AI",
      detection: `Note attribute contains AI hint (${fuzzyHit.name || "note"}=${fuzzyHit.value || ""})`,
    };
  }

  return null;
};

export const detectAiFromFields = (
  referrer: string,
  landingPage: string,
  utmSource: string | undefined,
  utmMedium: string | undefined,
  tags: string[] | undefined,
  noteAttributes: { name?: string | null; value?: string | null }[] | undefined,
  config: DetectionConfig = {
    aiDomains: defaultAiDomains,
    utmSources: defaultUtmSources,
    utmMediumKeywords: defaultUtmMediums,
    tagPrefix: "AI-Source",
  },
): { aiSource: AIChannel | null; detection: string; signals: string[] } => {
  const refUrl = safeUrl(referrer);
  const landingUrl = safeUrl(landingPage);
  const refDomain = extractHostname(referrer);
  const landingDomain = extractHostname(landingPage);
  const signals: string[] = [];

  const bingCopilotReason = detectCopilotFromBing(refUrl) || detectCopilotFromBing(landingUrl);
  if (bingCopilotReason) {
    return { aiSource: "Copilot", detection: `${bingCopilotReason} · 高置信度`, signals: [] };
  }

  const domainHit = config.aiDomains.find(
    (rule) => domainMatches(rule.domain, refUrl) || domainMatches(rule.domain, landingUrl),
  );

  const utmMatch = utmSource
    ? config.utmSources.find(
        (rule) => rule.value.toLowerCase() === utmSource.toLowerCase(),
      )
    : undefined;

  if (domainHit) {
    const conflictNote =
      utmMatch && utmMatch.channel !== domainHit.channel
        ? `; conflict: utm_source=${utmSource} → ${utmMatch.channel}`
        : utmMatch
          ? `; utm_source=${utmSource} confirmed`
          : "";

    signals.push(`referrer matched ${domainHit.domain}`);
    if (utmMatch) signals.push(`utm_source=${utmSource}`);

    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    return {
      aiSource: domainHit.channel as AIChannel,
      detection: `${signals.join(" + ")} · 置信度高${conflictNote}`,
      signals: clamped,
    };
  }

  if (utmMatch) {
    signals.push(`utm_source=${utmSource}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    return {
      aiSource: utmMatch.channel,
      detection: `${signals.join(" + ")} · 置信度中等（缺少 referrer）`,
      signals: clamped,
    };
  }

  const mediumHit =
    utmMedium &&
    config.utmMediumKeywords.find((keyword) =>
      utmMedium.toLowerCase().includes(keyword.toLowerCase()),
    );

  if (mediumHit) {
    signals.push(`utm_medium=${utmMedium}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    return {
      aiSource: null,
      detection: `${signals.join(" + ")} · 置信度低：仅命中 medium 关键词(${mediumHit})，不足以判定 AI`,
      signals: clamped,
    };
  }

  const noteHit = detectFromNoteAttributes(noteAttributes, config.utmSources);
  if (noteHit) return { ...noteHit, signals: [] };

  const tagPrefix = config.tagPrefix || "AI-Source";
  const tagMatch = tags?.find((tag) => tag.startsWith(tagPrefix));
  if (tagMatch) {
    const suffix = tagMatch.replace(`${tagPrefix}-`, "");
    const channel =
      (channelList.find((item) => item.toLowerCase() === suffix.toLowerCase()) ||
        "Other-AI") as AIChannel;
    const clamped = ["existing tag"].slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    return {
      aiSource: channel,
      detection: `Detected by existing tag ${tagMatch} · 置信度中等（可能来自本应用标签写回）`,
      signals: clamped,
    };
  }

  const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
  return {
    aiSource: null,
    detection: `未检测到 AI 信号（referrer=${refDomain || "—"}, utm_source=${
      utmSource || "—"
    }, landing=${landingDomain || "—"}） · 置信度低`,
    signals: clamped,
  };
};

export const mockOrders = orders;

/** @deprecated 使用 AI_CHANNELS 代替 */
export const channelList: AIChannel[] = [...AI_CHANNELS];




const partitionOrdersByCurrency = (
  records: OrderRecord[],
  primaryCurrency?: string,
): {
  primaryCurrency: string;
  primaryOrders: OrderRecord[];
  foreignOrders: OrderRecord[];
  foreignCurrencies: string[];
} => {
  const preferred = primaryCurrency || records[0]?.currency || "USD";
  const primaryOrders = records.filter((order) => order.currency === preferred);
  const foreignOrders = records.filter((order) => order.currency !== preferred);
  const foreignCurrencies = Array.from(
    new Set(foreignOrders.map((order) => order.currency).filter(Boolean)),
  );

  return { primaryCurrency: preferred, primaryOrders, foreignOrders, foreignCurrencies };
};


const filterOrdersByDateRange = (allOrders: OrderRecord[], range: DateRange) =>
  allOrders.filter((order) => {
    const orderDate = new Date(order.createdAt);
    return orderDate >= range.start && orderDate <= range.end;
  });






const buildRecentOrders = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
): RawOrderRow[] =>
  [...ordersInRange]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 10)
    .map((order) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      aiSource: order.aiSource,
      totalPrice: metricOrderValue(order, metric),
      currency: order.currency,
      referrer: order.referrer,
      landingPage: order.landingPage,
      utmSource: order.utmSource,
      utmMedium: order.utmMedium,
      customerId: order.customerId,
      sourceName: order.sourceName,
      isNewCustomer: order.isNewCustomer,
      detection: order.detection,
      signals: order.signals,
    }));

const toCsvValue = (value: string | number | null | undefined) => {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const buildOrdersCsv = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
) => {
  const comment = `# 仅统计可识别的 AI 流量（依赖 referrer/UTM/标签，结果为保守估计）；GMV 口径=${metric}`;
  const aiOrders = ordersInRange.filter((order) => order.aiSource);
  const header = [
    "order_name",
    "placed_at",
    "ai_channel",
    "gmv",
    "gmv_metric",
    "referrer",
    "landing_page",
    "source_name",
    "utm_source",
    "utm_medium",
    "detection",
    "order_id",
    "customer_id",
    "new_customer",
  ];

  const rows = aiOrders.map((order) => [
    order.name,
    order.createdAt,
    order.aiSource,
    metricOrderValue(order, metric),
    metric,
    order.referrer,
    order.landingPage,
    order.sourceName || "",
    order.utmSource || "",
    order.utmMedium || "",
    order.detection,
    order.id,
    order.customerId,
    order.isNewCustomer ? "true" : "false",
  ]);

  return [comment, header, ...rows].map((cells) => Array.isArray(cells) ? cells.map(toCsvValue).join(",") : cells).join("\n");
};

const buildProductsCsv = (products: ProductRow[]) => {
  const comment = `# 仅统计可识别的 AI 流量（依赖 referrer/UTM/标签，结果为保守估计）`;
  const header = [
    "product_title",
    "ai_orders",
    "ai_gmv",
    "ai_share",
    "top_ai_channel",
    "product_url",
    "product_id",
    "handle",
  ];

  const rows = products.map((product) => [
    product.title,
    product.aiOrders,
    product.aiGMV,
    (product.aiShare * 100).toFixed(1) + "%",
    product.topChannel ?? "",
    product.url,
    product.id,
    product.handle,
  ]);

  return [comment, header, ...rows].map((cells) => Array.isArray(cells) ? cells.map(toCsvValue).join(",") : cells).join("\n");
};

const buildCustomersCsv = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
  acquiredViaAiMap?: Record<string, boolean>,
) => {
  const comment = `# 客户级 LTV（选定时间范围内累计 GMV）；GMV 口径=${metric}`;
  const ltvMap = computeLTV(ordersInRange, metric);
  const counts = ordersInRange.reduce<Record<string, number>>((acc, o) => {
    if (!o.customerId) return acc;
    acc[o.customerId] = (acc[o.customerId] || 0) + 1;
    return acc;
  }, {});
  const fallbackFirstAi: Record<string, boolean> = {};
  ordersInRange.forEach((o) => {
    if (!o.customerId) return;
    const cid = o.customerId;
    const prev = fallbackFirstAi[cid];
    if (prev !== true) {
      fallbackFirstAi[cid] = Boolean(o.isNewCustomer && o.aiSource);
    }
  });
  const header = ["customer_id", "ltv", "gmv_metric", "first_ai_acquired", "repeat_count", "ai_order_share", "first_order_at"];
  const rows: string[][] = [];
  for (const [customerId, ltv] of ltvMap.entries()) {
    const firstAi = acquiredViaAiMap ? Boolean(acquiredViaAiMap[customerId]) : Boolean(fallbackFirstAi[customerId]);
    const total = counts[customerId] || 0;
    const aiCount = ordersInRange.filter((o) => o.customerId === customerId && Boolean(o.aiSource)).length;
    const aiShare = total ? aiCount / total : 0;
    const firstOrderDate = ordersInRange.filter((o) => o.customerId === customerId).map((o) => new Date(o.createdAt)).sort((a, b) => a.getTime() - b.getTime())[0];
    const repeat = Math.max(0, total - 1);
    rows.push([
      customerId,
      String(ltv),
      metric,
      firstAi ? "true" : "false",
      String(repeat),
      aiShare.toFixed(4),
      firstOrderDate ? new Date(firstOrderDate).toISOString() : "",
    ]);
  }
  return [comment, header, ...rows].map((cells) => Array.isArray(cells) ? cells.map(toCsvValue).join(",") : cells).join("\n");
};

const buildSampleNote = (
  overview: OverviewMetrics,
  foreignCurrencies: string[],
  excludedCount: number,
) => {
  const notes = [] as string[];
  if (overview.aiOrders < LOW_SAMPLE_THRESHOLD) {
    notes.push("AI 渠道订单量当前较低（<5），所有指标仅供参考。");
  }

  if (foreignCurrencies.length) {
    notes.push(
      `已过滤 ${excludedCount} 笔非 ${overview.currency} 货币的订单，汇总仅包含 ${overview.currency}。`,
    );
  }

  return notes.length ? notes.join(" ") : null;
};

export const buildDashboardFromOrders = (
  allOrders: OrderRecord[],
  range: DateRange,
  gmvMetric: "current_total_price" | "subtotal_price" = "current_total_price",
  timeZone?: string,
  primaryCurrency?: string,
  acquiredViaAiMap?: Record<string, boolean>,
): DashboardData => {
  const ordersInRange = filterOrdersByDateRange(allOrders, range);
  const excludedBySource = ordersInRange.filter((o) => {
    const src = (o.sourceName || "").toLowerCase();
    return src === "pos" || src === "draft";
  }).length;
  const usableOrders = ordersInRange.filter((o) => {
    const src = (o.sourceName || "").toLowerCase();
    return src !== "pos" && src !== "draft";
  });
  const { primaryCurrency: resolvedCurrency, primaryOrders, foreignOrders, foreignCurrencies } =
    partitionOrdersByCurrency(usableOrders, primaryCurrency);
  const overview = aggBuildOverview(primaryOrders, gmvMetric, resolvedCurrency);
  const channels = aggBuildChannelBreakdown(primaryOrders, gmvMetric);
  const comparison = aggBuildComparison(primaryOrders, gmvMetric);
  const trend = aggBuildTrend(primaryOrders, range, gmvMetric, timeZone);
  const topProducts = aggBuildProducts(primaryOrders, gmvMetric);
  const topCustomers = buildTopCustomers(primaryOrders, gmvMetric, undefined, acquiredViaAiMap);
  const recentOrders = buildRecentOrders(primaryOrders, gmvMetric);
  const ordersCsv = buildOrdersCsv(primaryOrders, gmvMetric);
  const productsCsv = buildProductsCsv(topProducts);
  const customersCsv = buildCustomersCsv(primaryOrders, gmvMetric, acquiredViaAiMap);
  const baseNote = buildSampleNote(overview, foreignCurrencies, foreignOrders.length);
  const posNote = excludedBySource
    ? `已排除 ${excludedBySource} 笔 POS/草稿订单（不计入站外 AI 链路分析）。`
    : null;
  const sampleNote = [baseNote, posNote].filter(Boolean).join(" ") || null;

  return {
    overview,
    channels,
    comparison,
    trend,
    topProducts,
    topCustomers,
    recentOrders,
    sampleNote,
    exports: {
      ordersCsv,
      productsCsv,
      customersCsv,
    },
  };
};

export const buildDashboardData = (
  range: DateRange,
  gmvMetric: "current_total_price" | "subtotal_price" = "current_total_price",
  timeZone?: string,
  primaryCurrency?: string,
): DashboardData => {
  return buildDashboardFromOrders(orders, range, gmvMetric, timeZone, primaryCurrency);
};

type ShopifyMoneySet = {
  shopMoney?: {
    amount?: string | null;
    currencyCode?: string | null;
  } | null;
};

export type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  currentTotalPriceSet?: ShopifyMoneySet | null;
  currentSubtotalPriceSet?: ShopifyMoneySet | null;
  totalRefundedSet?: ShopifyMoneySet | null;
  referringSite?: string | null;
  landingPageUrl?: string | null;
  sourceName?: string | null;
  tags: string[];
  noteAttributes?: { name: string; value: string }[] | null;
  customer?: {
    id: string;
    numberOfOrders?: number | null;
  } | null;
  lineItems: {
    edges: {
      node: {
        id: string;
        quantity: number;
        name: string;
        originalUnitPriceSet?: ShopifyMoneySet | null;
        variant?: {
          product?: {
            id: string;
            title: string;
            handle?: string | null;
            onlineStoreUrl?: string | null;
            legacyResourceId?: string | null;
          } | null;
        } | null;
      };
    }[];
  };
};

export const mapShopifyOrderToRecord = (
  order: ShopifyOrderNode,
  config: SettingsDefaults = defaultSettings,
): OrderRecord => {
  const totalPrice = parseFloat(order.currentTotalPriceSet?.shopMoney?.amount || "0");
  const subtotalRaw = order.currentSubtotalPriceSet?.shopMoney?.amount;
  const subtotalPrice =
    subtotalRaw === undefined || subtotalRaw === null ? undefined : parseFloat(subtotalRaw);
  const refundTotal = parseFloat(order.totalRefundedSet?.shopMoney?.amount || "0");
  const currency =
    order.currentTotalPriceSet?.shopMoney?.currencyCode || config.primaryCurrency || "USD";
  const referrer = order.referringSite || "";
  const landingPage = order.landingPageUrl || "";
  const { utmSource, utmMedium } = extractUtmRef(referrer, landingPage);

  const { aiSource, detection, signals } = detectAiFromFieldsRef(
    referrer,
    landingPage,
    utmSource,
    utmMedium,
    order.tags,
    order.noteAttributes || undefined,
    {
      aiDomains: config.aiDomains,
      utmSources: config.utmSources,
      utmMediumKeywords: config.utmMediumKeywords,
      tagPrefix: config.tagging.orderTagPrefix,
      lang: ((config.languages && config.languages[0]) === "English") ? "English" : "中文",
    },
  );
  const truncatedDetection = detection.slice(0, 200);

  const products: OrderRecord["products"] =
    order.lineItems?.edges?.map(({ node }) => {
      const product = node.variant?.product;
      const handle = product?.handle || "";
      const url = product?.onlineStoreUrl || "";

      return {
        id: product?.id || product?.legacyResourceId?.toString() || node.id,
        title: product?.title || node.name,
        handle,
        url,
        price: parseFloat(node.originalUnitPriceSet?.shopMoney?.amount || "0"),
        currency: node.originalUnitPriceSet?.shopMoney?.currencyCode || currency,
        quantity: node.quantity,
      };
    }) || [];

  const isNewCustomer =
    !order.customer || typeof order.customer.numberOfOrders !== "number"
      ? true
      : order.customer.numberOfOrders <= 1;

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    totalPrice,
    currency,
    subtotalPrice,
    refundTotal,
    aiSource,
    referrer,
    landingPage,
    utmSource,
    utmMedium,
    sourceName: order.sourceName || undefined,
    tags: order.tags || [],
    customerId: order.customer?.id ?? null,
    isNewCustomer,
    products,
    detection: truncatedDetection,
    signals,
  };
};
