/**
 * AI 渠道相关类型定义
 * 统一管理所有 AI 相关的类型定义，避免重复声明
 */

/**
 * 支持的 AI 渠道类型
 */
export type AIChannel = "ChatGPT" | "Perplexity" | "Gemini" | "Copilot" | "Other-AI";

/**
 * 所有支持的 AI 渠道列表
 */
export const AI_CHANNELS: readonly AIChannel[] = [
  "ChatGPT",
  "Perplexity",
  "Gemini",
  "Copilot",
  "Other-AI",
] as const;

/**
 * AI 域名规则
 */
export type AiDomainRule = {
  domain: string;
  channel: AIChannel;
  source: "default" | "custom";
};

/**
 * UTM 来源规则
 */
export type UtmSourceRule = {
  value: string;
  channel: AIChannel;
  source: "default" | "custom";
};

/**
 * AI 检测配置
 */
export type DetectionConfig = {
  aiDomains: AiDomainRule[];
  utmSources: UtmSourceRule[];
  utmMediumKeywords: string[];
  tagPrefix?: string;
  lang?: "中文" | "English";
};

/**
 * 🆕 结构化检测信号（用于证据链展示）
 * 支持更清晰的 UI 展示和数据分析
 */
export type DetectionSignal = {
  /** 信号类型 */
  type: "referrer" | "utm_source" | "utm_medium" | "note_attribute" | "tag" | "bing_copilot";
  /** 原始值 */
  source: string;
  /** 匹配的规则或域名 */
  matched: string;
  /** 置信度分数 (0-100) */
  confidence: number;
  /** 是否为主要判定依据 */
  isPrimary: boolean;
};

/**
 * 🆕 置信度等级
 */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * AI 检测结果
 */
export type DetectionResult = {
  aiSource: AIChannel | null;
  detection: string;
  signals: string[];
  /** 🆕 结构化信号（用于证据链展示） */
  structuredSignals?: DetectionSignal[];
  /** 🆕 最终置信度 */
  confidence?: ConfidenceLevel;
  /** 🆕 置信度分数 (0-100) */
  confidenceScore?: number;
};

/**
 * 时间范围键
 */
export type TimeRangeKey = "7d" | "30d" | "90d" | "custom";

/**
 * 日期范围
 */
export type DateRange = {
  key: TimeRangeKey;
  label: string;
  start: Date;
  end: Date;
  days: number;
  fromParam?: string | null;
  toParam?: string | null;
};

/**
 * 订单产品行
 */
export type OrderLine = {
  id: string;
  title: string;
  handle: string;
  url: string;
  price: number;
  currency: string;
  quantity: number;
};

/**
 * 订单记录（用于内部数据处理）
 */
export type OrderRecord = {
  id: string;
  name: string;
  createdAt: string;
  totalPrice: number;
  currency: string;
  subtotalPrice?: number;
  refundTotal?: number;
  aiSource: AIChannel | null;
  referrer: string;
  landingPage: string;
  utmSource?: string;
  utmMedium?: string;
  sourceName?: string;
  tags?: string[];
  customerId: string | null;
  isNewCustomer: boolean;
  products: OrderLine[];
  detection: string;
  signals: string[];
};

/**
 * 概览指标
 */
export type OverviewMetrics = {
  totalGMV: number;
  netGMV: number;
  aiGMV: number;
  netAiGMV: number;
  aiShare: number;
  aiOrders: number;
  aiOrderShare: number;
  totalOrders: number;
  aiNewCustomers: number;
  aiNewCustomerRate: number;
  totalNewCustomers: number;
  lastSyncedAt: string;
  currency: string;
};

/**
 * 渠道统计
 */
export type ChannelStat = {
  channel: AIChannel;
  gmv: number;
  orders: number;
  newCustomers: number;
  color: string;
};

/**
 * 渠道对比行
 */
export type ComparisonRow = {
  channel: string;
  aov: number;
  newCustomerRate: number;
  repeatRate: number;
  sampleSize: number;
  isLowSample: boolean;
};

/**
 * 趋势数据点
 */
export type TrendPoint = {
  label: string;
  aiGMV: number;
  aiOrders: number;
  overallGMV: number;
  overallOrders: number;
  byChannel: Partial<Record<AIChannel, { gmv: number; orders: number }>>;
};

/**
 * 产品行
 */
export type ProductRow = {
  id: string;
  title: string;
  handle: string;
  url: string;
  aiOrders: number;
  aiGMV: number;
  aiShare: number;
  topChannel: AIChannel | null;
};

/**
 * 原始订单行（用于展示）
 */
export type RawOrderRow = {
  id: string;
  name: string;
  createdAt: string;
  aiSource: AIChannel | null;
  totalPrice: number;
  currency: string;
  referrer: string;
  landingPage: string;
  utmSource?: string;
  utmMedium?: string;
  customerId: string | null;
  sourceName?: string;
  isNewCustomer: boolean;
  detection: string;
  signals: string[];
};

/**
 * 管道状态
 */
export type PipelineStatus = {
  title: string;
  status: "healthy" | "warning" | "info";
  detail: string;
};

/**
 * 标签设置
 */
export type TaggingSettings = {
  orderTagPrefix: string;
  customerTag: string;
  writeOrderTags: boolean;
  writeCustomerTags: boolean;
  dryRun?: boolean;
};

/**
 * AI 曝光偏好设置
 */
export type ExposurePreferences = {
  exposeProducts: boolean;
  exposeCollections: boolean;
  exposeBlogs: boolean;
};

/**
 * 设置默认值
 */
export type SettingsDefaults = {
  aiDomains: AiDomainRule[];
  utmSources: UtmSourceRule[];
  utmMediumKeywords: string[];
  gmvMetric: "current_total_price" | "subtotal_price";
  primaryCurrency?: string;
  tagging: TaggingSettings;
  exposurePreferences: ExposurePreferences;
  languages: string[];
  timezones: string[];
  pipelineStatuses: PipelineStatus[];
  retentionMonths?: number;
  lastOrdersWebhookAt?: string | null;
  lastBackfillAt?: string | null;
  lastTaggingAt?: string | null;
  lastCleanupAt?: string | null;
};

/**
 * 仪表盘数据
 */
export type DashboardData = {
  overview: OverviewMetrics;
  channels: ChannelStat[];
  comparison: ComparisonRow[];
  trend: TrendPoint[];
  topProducts: ProductRow[];
  topCustomers: TopCustomerRow[];
  recentOrders: RawOrderRow[];
  sampleNote: string | null;
  exports: {
    ordersCsv: string;
    productsCsv: string;
    customersCsv: string;
  };
};

/**
 * 顶级客户行
 */
export type TopCustomerRow = {
  customerId: string;
  ltv: number;
  orders: number;
  ai: boolean;
  firstAIAcquired: boolean;
  repeatCount: number;
};

/**
 * GMV 指标类型
 */
export type GmvMetricKey = "current_total_price" | "subtotal_price";
