export type AIChannel = "ChatGPT" | "Perplexity" | "Gemini" | "Copilot" | "Other-AI";

export type TimeRangeKey = "7d" | "30d" | "90d" | "custom";

export type DateRange = {
  key: TimeRangeKey;
  label: string;
  start: Date;
  end: Date;
  days: number;
  fromParam?: string | null;
  toParam?: string | null;
};

type OrderLine = {
  id: string;
  title: string;
  handle: string;
  url: string;
  price: number;
  currency: string;
  quantity: number;
};

export type OrderRecord = {
  id: string;
  name: string;
  createdAt: string;
  totalPrice: number;
  currency: string;
  subtotalPrice?: number;
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
};

export type OverviewMetrics = {
  totalGMV: number;
  aiGMV: number;
  aiShare: number;
  aiOrders: number;
  aiOrderShare: number;
  totalOrders: number;
  aiNewCustomers: number;
  aiNewCustomerRate: number;
  totalNewCustomers: number;
  lastSyncedAt: string;
};

export type ChannelStat = {
  channel: AIChannel;
  gmv: number;
  orders: number;
  newCustomers: number;
  color: string;
};

export type ComparisonRow = {
  channel: string;
  aov: number;
  newCustomerRate: number;
  repeatRate: number;
  sampleSize: number;
  isLowSample: boolean;
};

export type TrendPoint = {
  label: string;
  aiGMV: number;
  aiOrders: number;
  overallGMV: number;
  overallOrders: number;
  byChannel: Partial<Record<AIChannel, { gmv: number; orders: number }>>;
};

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
};

export type PipelineStatus = {
  title: string;
  status: "healthy" | "warning" | "info";
  detail: string;
};

export type TaggingSettings = {
  orderTagPrefix: string;
  customerTag: string;
  writeOrderTags: boolean;
  writeCustomerTags: boolean;
  dryRun?: boolean;
};

export type ExposurePreferences = {
  exposeProducts: boolean;
  exposeCollections: boolean;
  exposeBlogs: boolean;
};

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
  lastOrdersWebhookAt?: string | null;
  lastBackfillAt?: string | null;
  lastTaggingAt?: string | null;
};

export type DashboardData = {
  overview: OverviewMetrics;
  channels: ChannelStat[];
  comparison: ComparisonRow[];
  trend: TrendPoint[];
  topProducts: ProductRow[];
  recentOrders: RawOrderRow[];
  sampleNote: string | null;
  exports: {
    ordersCsv: string;
    productsCsv: string;
  };
};

export type AiDomainRule = {
  domain: string;
  channel: AIChannel | "Other-AI";
  source: "default" | "custom";
};

export type UtmSourceRule = {
  value: string;
  channel: AIChannel | "Other-AI";
};

export const timeRanges: Record<
  TimeRangeKey,
  { label: string; days: number; isCustom?: boolean }
> = {
  "7d": { label: "最近 7 天", days: 7 },
  "30d": { label: "最近 30 天", days: 30 },
  "90d": { label: "最近 90 天", days: 90 },
  custom: { label: "自定义", days: 30, isCustom: true },
};

const channelColors: Record<AIChannel, string> = {
  ChatGPT: "#635bff",
  Perplexity: "#00a2ff",
  Gemini: "#4285f4",
  Copilot: "#0078d4",
  "Other-AI": "#6c6f78",
};

const DEFAULT_RANGE_KEY: TimeRangeKey = "30d";

const storeUrl = "https://demo-store.ai-beauty.example.com";
const now = Date.now();

const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

const formatDateOnly = (date: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const toZonedDate = (date: Date, timeZone?: string) => {
  if (!timeZone) return new Date(date);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")),
  );
};

const parseDateInput = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const startOfDay = (date: Date, timeZone?: string) => {
  const copy = toZonedDate(date, timeZone);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

const endOfDay = (date: Date, timeZone?: string) => {
  const copy = toZonedDate(date, timeZone);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
};

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

const orders: OrderRecord[] = [
  {
    id: "4310",
    name: "#4310",
    createdAt: daysAgo(2),
    totalPrice: 188,
    currency: "USD",
    aiSource: "ChatGPT",
    referrer: "https://chat.openai.com/share/insight?id=4310",
    landingPage: `${storeUrl}/products/starter-kit?utm_source=chatgpt&utm_medium=ai-agent`,
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
        url: `${storeUrl}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-vitc",
        title: "Radiance Vitamin C Drops",
        handle: "vitamin-c-drops",
        url: `${storeUrl}/products/vitamin-c-drops`,
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
    createdAt: daysAgo(6),
    totalPrice: 96,
    currency: "USD",
    aiSource: "Perplexity",
    referrer: "https://www.perplexity.ai/search?q=best+cleanser",
    landingPage: `${storeUrl}/products/calm-foam-cleanser?utm_source=perplexity&utm_medium=organic`,
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
        url: `${storeUrl}/products/calm-foam-cleanser`,
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
    createdAt: daysAgo(11),
    totalPrice: 178,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.instagram.com/",
    landingPage: `${storeUrl}/products/hydra-barrier-cream?utm_source=instagram&utm_medium=paid-social`,
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
        url: `${storeUrl}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${storeUrl}/products/enzyme-reset-mask`,
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
    createdAt: daysAgo(25),
    totalPrice: 218,
    currency: "USD",
    aiSource: "ChatGPT",
    referrer: "https://chat.openai.com/share/beauty-shortlist",
    landingPage: `${storeUrl}/products/ceramide-repair-serum`,
    sourceName: "web",
    customerId: "c-101",
    isNewCustomer: true,
    products: [
      {
        id: "p-serum",
        title: "Ceramide Repair Serum",
        handle: "ceramide-repair-serum",
        url: `${storeUrl}/products/ceramide-repair-serum`,
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
    createdAt: daysAgo(14),
    totalPrice: 178,
    currency: "USD",
    aiSource: "Perplexity",
    referrer: "https://www.perplexity.ai/",
    landingPage: `${storeUrl}/products/hydra-barrier-cream?utm_source=perplexity&utm_medium=ai-agent`,
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
        url: `${storeUrl}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${storeUrl}/products/enzyme-reset-mask`,
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
    createdAt: daysAgo(20),
    totalPrice: 198,
    currency: "USD",
    aiSource: null,
    referrer: "https://l.instagram.com/",
    landingPage: `${storeUrl}/products/starter-kit?utm_source=meta&utm_medium=retargeting`,
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
        url: `${storeUrl}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${storeUrl}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${storeUrl}/products/starter-kit`,
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
    createdAt: daysAgo(8),
    totalPrice: 124,
    currency: "USD",
    aiSource: "Gemini",
    referrer: "https://gemini.google.com/app",
    landingPage: `${storeUrl}/products/hydra-barrier-cream?utm_source=gemini&utm_medium=assistant`,
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
        url: `${storeUrl}/products/hydra-barrier-cream`,
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
    createdAt: daysAgo(45),
    totalPrice: 144,
    currency: "USD",
    aiSource: "Gemini",
    referrer: "https://gemini.google.com/app/discover",
    landingPage: `${storeUrl}/products/starter-kit`,
    sourceName: "web",
    customerId: "c-106",
    isNewCustomer: true,
    products: [
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${storeUrl}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${storeUrl}/products/starter-kit`,
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
    createdAt: daysAgo(32),
    totalPrice: 188,
    currency: "USD",
    aiSource: "Perplexity",
    referrer: "",
    landingPage: `${storeUrl}/products/vitamin-c-drops?utm_source=perplexity&utm_medium=ai-agent`,
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
        url: `${storeUrl}/products/vitamin-c-drops`,
        price: 92,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${storeUrl}/products/starter-kit`,
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
    createdAt: daysAgo(21),
    totalPrice: 156,
    currency: "USD",
    aiSource: "Copilot",
    referrer: "https://copilot.microsoft.com/",
    landingPage: `${storeUrl}/products/enzyme-reset-mask?utm_source=copilot&utm_medium=ai-assistant`,
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
        url: `${storeUrl}/products/enzyme-reset-mask`,
        price: 54,
        currency: "USD",
        quantity: 2,
      },
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${storeUrl}/products/calm-foam-cleanser`,
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
    createdAt: daysAgo(60),
    totalPrice: 150,
    currency: "USD",
    aiSource: "Copilot",
    referrer: "https://copilot.microsoft.com/chat",
    landingPage: `${storeUrl}/products/starter-kit`,
    sourceName: "web",
    customerId: "c-105",
    isNewCustomer: true,
    products: [
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${storeUrl}/products/starter-kit`,
        price: 96,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${storeUrl}/products/enzyme-reset-mask`,
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
    createdAt: daysAgo(70),
    totalPrice: 220,
    currency: "USD",
    aiSource: "ChatGPT",
    referrer: "https://chat.openai.com/",
    landingPage: `${storeUrl}/products/hydra-barrier-cream?utm_source=chatgpt&utm_medium=assistant`,
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
        url: `${storeUrl}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-kit",
        title: "Starter Discovery Kit",
        handle: "starter-kit",
        url: `${storeUrl}/products/starter-kit`,
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
    createdAt: daysAgo(3),
    totalPrice: 146,
    currency: "USD",
    aiSource: "Other-AI",
    referrer: "https://claude.ai/chat",
    landingPage: `${storeUrl}/products/vitamin-c-drops?utm_medium=ai-assistant`,
    utmMedium: "ai-assistant",
    sourceName: "web",
    customerId: "c-111",
    isNewCustomer: false,
    products: [
      {
        id: "p-vitc",
        title: "Radiance Vitamin C Drops",
        handle: "vitamin-c-drops",
        url: `${storeUrl}/products/vitamin-c-drops`,
        price: 92,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${storeUrl}/products/enzyme-reset-mask`,
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
    createdAt: daysAgo(85),
    totalPrice: 102,
    currency: "USD",
    aiSource: "Other-AI",
    referrer: "https://deepseek.com/assistant",
    landingPage: `${storeUrl}/products/enzyme-reset-mask?utm_source=deepseek`,
    utmSource: "deepseek",
    sourceName: "web",
    customerId: "c-111",
    isNewCustomer: true,
    products: [
      {
        id: "p-clean",
        title: "Calm Foam Cleanser",
        handle: "calm-foam-cleanser",
        url: `${storeUrl}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${storeUrl}/products/enzyme-reset-mask`,
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
    createdAt: daysAgo(1),
    totalPrice: 96,
    currency: "USD",
    aiSource: null,
    referrer: "https://t.co/brand-email",
    landingPage: `${storeUrl}/products/starter-kit?utm_source=email&utm_medium=crm`,
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
        url: `${storeUrl}/products/starter-kit`,
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
    createdAt: daysAgo(4),
    totalPrice: 102,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.google.com/",
    landingPage: `${storeUrl}/products/enzyme-reset-mask?utm_source=google&utm_medium=organic`,
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
        url: `${storeUrl}/products/calm-foam-cleanser`,
        price: 48,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-mask",
        title: "Enzyme Reset Mask",
        handle: "enzyme-reset-mask",
        url: `${storeUrl}/products/enzyme-reset-mask`,
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
    createdAt: daysAgo(50),
    totalPrice: 233,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.reddit.com/",
    landingPage: `${storeUrl}/products/hydra-barrier-cream?utm_source=reddit&utm_medium=organic`,
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
        url: `${storeUrl}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-serum",
        title: "Ceramide Repair Serum",
        handle: "ceramide-repair-serum",
        url: `${storeUrl}/products/ceramide-repair-serum`,
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
    createdAt: daysAgo(12),
    totalPrice: 216,
    currency: "USD",
    aiSource: null,
    referrer: "https://www.bing.com/",
    landingPage: `${storeUrl}/products/hydra-barrier-cream?utm_source=bing&utm_medium=seo`,
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
        url: `${storeUrl}/products/hydra-barrier-cream`,
        price: 124,
        currency: "USD",
        quantity: 1,
      },
      {
        id: "p-vitc",
        title: "Radiance Vitamin C Drops",
        handle: "vitamin-c-drops",
        url: `${storeUrl}/products/vitamin-c-drops`,
        price: 92,
        currency: "USD",
        quantity: 1,
      },
    ],
    detection: "No AI markers detected",
  },
];

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
    url.searchParams.has("showconv") ||
    url.searchParams.has("iscopiloted") ||
    url.searchParams.get("bpc") === "1" ||
    url.searchParams.get("bpe") === "1" ||
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

const extractUtm = (...urls: (string | null | undefined)[]) => {
  let utmSource: string | undefined;
  let utmMedium: string | undefined;

  urls.forEach((value) => {
    const parsed = safeUrl(value);
    if (!parsed) return;
    if (!utmSource) utmSource = parsed.searchParams.get("utm_source") || undefined;
    if (!utmMedium) utmMedium = parsed.searchParams.get("utm_medium") || undefined;
  });

  return { utmSource, utmMedium };
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
): { aiSource: AIChannel | null; detection: string } => {
  const refUrl = safeUrl(referrer);
  const landingUrl = safeUrl(landingPage);
  const refDomain = extractHostname(referrer);
  const landingDomain = extractHostname(landingPage);
  const signals: string[] = [];

  const bingCopilotReason = detectCopilotFromBing(refUrl) || detectCopilotFromBing(landingUrl);
  if (bingCopilotReason) {
    return { aiSource: "Copilot", detection: `${bingCopilotReason} · 高置信度` };
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

    return {
      aiSource: domainHit.channel as AIChannel,
      detection: `${signals.join(" + ")} · 置信度高${conflictNote}`,
    };
  }

  if (utmMatch) {
    signals.push(`utm_source=${utmSource}`);
    return {
      aiSource: utmMatch.channel,
      detection: `${signals.join(" + ")} · 置信度中等（缺少 referrer）`,
    };
  }

  const mediumHit =
    utmMedium &&
    config.utmMediumKeywords.find((keyword) =>
      utmMedium.toLowerCase().includes(keyword.toLowerCase()),
    );

  if (mediumHit) {
    signals.push(`utm_medium=${utmMedium}`);
    return {
      aiSource: "Other-AI",
      detection: `${signals.join(" + ")} · 置信度低：仅命中 medium 关键词(${mediumHit})`,
    };
  }

  const noteHit = detectFromNoteAttributes(noteAttributes, config.utmSources);
  if (noteHit) return noteHit;

  const tagPrefix = config.tagPrefix || "AI-Source";
  const tagMatch = tags?.find((tag) => tag.startsWith(tagPrefix));
  if (tagMatch) {
    const suffix = tagMatch.replace(`${tagPrefix}-`, "");
    const channel =
      (channelList.find((item) => item.toLowerCase() === suffix.toLowerCase()) ||
        "Other-AI") as AIChannel;
    return {
      aiSource: channel,
      detection: `Detected by existing tag ${tagMatch} · 置信度中等`,
    };
  }

  return {
    aiSource: null,
    detection: `未检测到 AI 信号（referrer=${refDomain || "—"}, utm_source=${
      utmSource || "—"
    }, landing=${landingDomain || "—"}） · 置信度低`,
  };
};

export const mockOrders = orders;

export const channelList: AIChannel[] = [
  "ChatGPT",
  "Perplexity",
  "Gemini",
  "Copilot",
  "Other-AI",
];

type TrendBucket = "day" | "week" | "month";

const determineBucket = (range: DateRange): TrendBucket => {
  if (range.key === "7d") return "day";
  if (range.key === "30d") return "week";
  if (range.key === "90d") return "month";
  if (range.days <= 14) return "day";
  if (range.days <= 60) return "week";
  return "month";
};

const formatDateLabel = (date: Date, bucket: TrendBucket, timeZone?: string) => {
  if (bucket === "day") {
    return formatDateOnly(date, timeZone);
  }

  if (bucket === "week") {
    const startOfWeek = startOfDay(date, timeZone);
    const day = startOfWeek.getUTCDay();
    const diff = (day + 6) % 7;
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - diff);
    return `${formatDateOnly(startOfWeek, timeZone)} · 周`;
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(date);
};

const orderValueByMetric = (
  order: OrderRecord,
  metric: "current_total_price" | "subtotal_price",
) => (metric === "subtotal_price" ? order.subtotalPrice ?? order.totalPrice : order.totalPrice);

const sumGMVByMetric = (
  records: OrderRecord[],
  metric: "current_total_price" | "subtotal_price",
) => records.reduce((total, order) => total + orderValueByMetric(order, metric), 0);

const filterOrdersByDateRange = (allOrders: OrderRecord[], range: DateRange) =>
  allOrders.filter((order) => {
    const orderDate = new Date(order.createdAt);
    return orderDate >= range.start && orderDate <= range.end;
  });

const buildOverview = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
): OverviewMetrics => {
  const aiOrders = ordersInRange.filter((order) => Boolean(order.aiSource));
  const aiGMV = sumGMVByMetric(aiOrders, metric);
  const totalGMV = sumGMVByMetric(ordersInRange, metric);
  const aiNewCustomers = aiOrders.filter((order) => order.isNewCustomer).length;
  const totalNewCustomers = ordersInRange.filter((order) => order.isNewCustomer).length;
  const aiOrdersCount = aiOrders.length;
  const totalOrdersCount = ordersInRange.length;

  return {
    totalGMV,
    aiGMV,
    aiShare: totalGMV ? aiGMV / totalGMV : 0,
    aiOrders: aiOrdersCount,
    aiOrderShare: totalOrdersCount ? aiOrdersCount / totalOrdersCount : 0,
    totalOrders: totalOrdersCount,
    aiNewCustomers,
    aiNewCustomerRate: aiOrdersCount ? aiNewCustomers / aiOrdersCount : 0,
    totalNewCustomers,
    lastSyncedAt: new Date().toISOString(),
  };
};

const buildChannelBreakdown = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
): ChannelStat[] =>
  channelList.map((channel) => {
    const scopedOrders = ordersInRange.filter((order) => order.aiSource === channel);
    return {
      channel,
      gmv: sumGMVByMetric(scopedOrders, metric),
      orders: scopedOrders.length,
      newCustomers: scopedOrders.filter((order) => order.isNewCustomer).length,
      color: channelColors[channel],
    };
  });

const buildComparison = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
): ComparisonRow[] => {
  const scopes: { label: string; filter: (order: OrderRecord) => boolean }[] = [
    { label: "整体", filter: () => true },
    ...channelList.map((channel) => ({
      label: channel,
      filter: (order: OrderRecord) => order.aiSource === channel,
    })),
  ];

  return scopes.map(({ label, filter }) => {
    const scopedOrders = ordersInRange.filter(filter);
    const gmv = sumGMVByMetric(scopedOrders, metric);
    const ordersCount = scopedOrders.length;
    const customers = scopedOrders.reduce<Record<string, number>>((acc, order) => {
      if (!order.customerId) return acc;
      acc[order.customerId] = (acc[order.customerId] || 0) + 1;
      return acc;
    }, {});

    const repeats = Object.values(customers).filter((count) => count > 1).length;

    return {
      channel: label,
      aov: ordersCount ? gmv / ordersCount : 0,
      newCustomerRate: ordersCount
        ? scopedOrders.filter((order) => order.isNewCustomer).length / ordersCount
        : 0,
      repeatRate: Object.keys(customers).length
        ? repeats / Object.keys(customers).length
        : 0,
      sampleSize: ordersCount,
      isLowSample: ordersCount < 5,
    };
  });
};

const buildTrend = (
  ordersInRange: OrderRecord[],
  range: DateRange,
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
  timeZone?: string,
): TrendPoint[] => {
  const bucket = determineBucket(range);
  const buckets = new Map<
    string,
    {
      label: string;
      aiGMV: number;
      aiOrders: number;
      overallGMV: number;
      overallOrders: number;
      byChannel: Partial<Record<AIChannel, { gmv: number; orders: number }>>;
      sortKey: number;
    }
  >();

  ordersInRange.forEach((order) => {
    const bucketStart = startOfDay(new Date(order.createdAt), timeZone);

    if (bucket === "week") {
      const day = bucketStart.getUTCDay();
      const diff = (day + 6) % 7;
      bucketStart.setUTCDate(bucketStart.getUTCDate() - diff);
    }

    if (bucket === "month") {
      bucketStart.setUTCDate(1);
    }

    const label = formatDateLabel(bucketStart, bucket, timeZone);
    if (!buckets.has(label)) {
      buckets.set(label, {
        label,
        aiGMV: 0,
        aiOrders: 0,
        overallGMV: 0,
        overallOrders: 0,
        byChannel: {},
        sortKey: bucketStart.getTime(),
      });
    }

    const bucketValue = buckets.get(label)!;
    const orderValue = orderValueByMetric(order, metric);
    bucketValue.overallGMV += orderValue;
    bucketValue.overallOrders += 1;
    bucketValue.sortKey = Math.min(bucketValue.sortKey, bucketStart.getTime());

    if (order.aiSource) {
      bucketValue.aiGMV += orderValue;
      bucketValue.aiOrders += 1;

      const channelMetrics = bucketValue.byChannel[order.aiSource] || {
        gmv: 0,
        orders: 0,
      };
      channelMetrics.gmv += orderValue;
      channelMetrics.orders += 1;
      bucketValue.byChannel[order.aiSource] = channelMetrics;
    }
  });

  return Array.from(buckets.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...rest }) => rest);
};

const buildProducts = (
  ordersInRange: OrderRecord[],
  metric: "current_total_price" | "subtotal_price" = "current_total_price",
): ProductRow[] => {
  const products = new Map<
    string,
    {
      id: string;
      title: string;
      handle: string;
      url: string;
      aiOrders: number;
      aiGMV: number;
      totalOrders: number;
      byChannel: Partial<Record<AIChannel, number>>;
    }
  >();

  ordersInRange.forEach((order) => {
    const isAI = Boolean(order.aiSource);
    const orderValue = orderValueByMetric(order, metric);
    const lineTotal = order.products.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0,
    );
    const allocationDenominator = lineTotal || order.products.length || 1;
    const productSeen = new Set<string>();

    order.products.forEach((line) => {
      if (!products.has(line.id)) {
        products.set(line.id, {
          id: line.id,
          title: line.title,
          handle: line.handle,
          url: line.url,
          aiOrders: 0,
          aiGMV: 0,
          totalOrders: 0,
          byChannel: {},
        });
      }

      const product = products.get(line.id)!;

      if (!productSeen.has(line.id)) {
        product.totalOrders += 1;
        if (isAI) {
          product.aiOrders += 1;
        }
        productSeen.add(line.id);
      }

      if (isAI) {
        const share =
          lineTotal > 0
            ? (line.price * line.quantity) / lineTotal
            : 1 / allocationDenominator;
        const allocatedGmv = orderValue * share;

        product.aiGMV += allocatedGmv;
        if (order.aiSource) {
          product.byChannel[order.aiSource] =
            (product.byChannel[order.aiSource] || 0) + allocatedGmv;
        }
      }
    });
  });

  return Array.from(products.values())
    .map((product) => {
      const topChannel =
        Object.entries(product.byChannel).sort(([, a], [, b]) => b - a)[0]?.[0] ??
        null;

      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        url: product.url,
        aiOrders: product.aiOrders,
        aiGMV: product.aiGMV,
        aiShare: product.totalOrders ? product.aiOrders / product.totalOrders : 0,
        topChannel: topChannel as AIChannel | null,
      };
    })
    .sort((a, b) => b.aiGMV - a.aiGMV)
    .slice(0, 8);
};

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
      totalPrice: orderValueByMetric(order, metric),
      currency: order.currency,
      referrer: order.referrer,
      landingPage: order.landingPage,
      utmSource: order.utmSource,
      utmMedium: order.utmMedium,
      customerId: order.customerId,
      sourceName: order.sourceName,
      isNewCustomer: order.isNewCustomer,
      detection: order.detection,
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
    orderValueByMetric(order, metric),
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

  return [header, ...rows].map((cells) => cells.map(toCsvValue).join(",")).join("\n");
};

const buildProductsCsv = (products: ProductRow[]) => {
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

  return [header, ...rows].map((cells) => cells.map(toCsvValue).join(",")).join("\n");
};

const buildSampleNote = (overview: OverviewMetrics) => {
  if (overview.aiOrders < LOW_SAMPLE_THRESHOLD) {
    return "AI 渠道订单量当前较低（<5），所有指标仅供参考。";
  }

  return null;
};

export const buildDashboardFromOrders = (
  allOrders: OrderRecord[],
  range: DateRange,
  gmvMetric: "current_total_price" | "subtotal_price" = "current_total_price",
  timeZone?: string,
): DashboardData => {
  const ordersInRange = filterOrdersByDateRange(allOrders, range);
  const overview = buildOverview(ordersInRange, gmvMetric);
  const channels = buildChannelBreakdown(ordersInRange, gmvMetric);
  const comparison = buildComparison(ordersInRange, gmvMetric);
  const trend = buildTrend(ordersInRange, range, gmvMetric, timeZone);
  const topProducts = buildProducts(ordersInRange, gmvMetric);
  const recentOrders = buildRecentOrders(ordersInRange, gmvMetric);
  const ordersCsv = buildOrdersCsv(ordersInRange, gmvMetric);
  const productsCsv = buildProductsCsv(topProducts);
  const sampleNote = buildSampleNote(overview);

  return {
    overview,
    channels,
    comparison,
    trend,
    topProducts,
    recentOrders,
    sampleNote,
    exports: {
      ordersCsv,
      productsCsv,
    },
  };
};

export const buildDashboardData = (
  range: DateRange,
  gmvMetric: "current_total_price" | "subtotal_price" = "current_total_price",
  timeZone?: string,
): DashboardData => {
  return buildDashboardFromOrders(orders, range, gmvMetric, timeZone);
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
  const currency =
    order.currentTotalPriceSet?.shopMoney?.currencyCode || config.primaryCurrency || "USD";
  const referrer = order.referringSite || "";
  const landingPage = order.landingPageUrl || "";
  const { utmSource, utmMedium } = extractUtm(referrer, landingPage);

  const { aiSource, detection } = detectAiFromFields(
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
    },
  );

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
    detection,
  };
};
