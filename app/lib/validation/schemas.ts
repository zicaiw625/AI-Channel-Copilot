/**
 * 统一的输入验证 Schema
 * 使用 Zod 进行类型安全的运行时验证
 */

import { z } from 'zod';

// ============================================================================
// 基础类型 Schema
// ============================================================================

export const ShopDomainSchema = z.string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9-]+\.myshopify\.com$/, 'Invalid Shopify domain format')
  .or(z.string().min(1).max(255)); // 允许自定义域名

export const DateStringSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const TimeRangeKeySchema = z.enum(['7d', '30d', '90d', '1y', 'custom']);

export const AISourceSchema = z.enum([
  'ChatGPT',
  'Perplexity', 
  'Gemini',
  'Copilot',
  'Other-AI'
]);

export const CurrencySchema = z.string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Currency must be 3 uppercase letters');

// ============================================================================
// API 请求 Schema
// ============================================================================

export const CopilotRequestSchema = z.object({
  intent: z.enum([
    'overview',
    'comparison', 
    'trend',
    'products',
    'customers',
    'growth',
    'channels'
  ]).optional(),
  question: z.string()
    .min(1)
    .max(500)
    .optional(),
  range: TimeRangeKeySchema.optional(),
  from: DateStringSchema.nullable().optional(),
  to: DateStringSchema.nullable().optional(),
}).refine(
  (data) => data.question || data.intent,
  {
    message: 'Either question or intent must be provided',
    path: ['question', 'intent']
  }
);

export const DashboardQuerySchema = z.object({
  range: TimeRangeKeySchema.default('30d'),
  from: DateStringSchema.nullable().optional(),
  to: DateStringSchema.nullable().optional(),
  timezone: z.string().optional(),
  metric: z.enum(['current_total_price', 'subtotal_price']).optional(),
});

export const ExportRequestSchema = z.object({
  type: z.enum(['orders', 'products', 'customers']),
  range: TimeRangeKeySchema.default('30d'),
  from: DateStringSchema.nullable().optional(),
  to: DateStringSchema.nullable().optional(),
  format: z.enum(['csv', 'json']).default('csv'),
});

// ============================================================================
// Webhook Payload Schema
// ============================================================================

export const ShopifyMoneySchema = z.object({
  amount: z.string(),
  currency_code: z.string(),
});

export const ShopifyCustomerSchema = z.object({
  id: z.number(),
  email: z.string().email().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  orders_count: z.number().optional(),
});

export const ShopifyLineItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  quantity: z.number(),
  price: z.string(),
  product_id: z.number().nullable(),
  variant_id: z.number().nullable(),
});

export const ShopifyOrderWebhookSchema = z.object({
  id: z.number(),
  admin_graphql_api_id: z.string(),
  name: z.string(),
  email: z.string().email().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  total_price: z.string(),
  subtotal_price: z.string().optional(),
  current_total_price: z.string().optional(),
  total_discounts: z.string().optional(),
  currency: z.string(),
  customer: ShopifyCustomerSchema.nullable(),
  line_items: z.array(ShopifyLineItemSchema),
  referring_site: z.string().nullable(),
  landing_site: z.string().nullable(),
  source_name: z.string().nullable(),
  tags: z.string().optional(),
  note_attributes: z.array(z.object({
    name: z.string(),
    value: z.string()
  })).optional(),
  refunds: z.array(z.any()).optional(),
});

export const ShopifyRefundWebhookSchema = z.object({
  id: z.number(),
  order_id: z.number(),
  created_at: z.string().datetime(),
  refund_line_items: z.array(z.object({
    id: z.number(),
    quantity: z.number(),
    line_item_id: z.number(),
    subtotal: z.string().optional(),
  })),
  transactions: z.array(z.object({
    amount: z.string(),
    kind: z.string(),
    status: z.string(),
  })).optional(),
});

export const ShopifyCustomerWebhookSchema = z.object({
  id: z.number(),
  email: z.string().email().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  orders_count: z.number(),
  total_spent: z.string(),
});

// ============================================================================
// Settings Schema
// ============================================================================

/**
 * 问题 7 修复：域名验证正则（与前端一致）
 * 格式：字母数字、点、连字符组成，以有效 TLD 结尾
 */
const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * 问题 7 修复：UTM Source 验证正则（与前端一致）
 * 格式：字母数字、下划线、连字符
 */
const UTM_SOURCE_REGEX = /^[a-z0-9_-]+$/i;

export const AiDomainRuleSchema = z.object({
  // 问题 7 修复：添加域名格式验证，与前端一致
  domain: z.string()
    .min(1)
    .max(255)
    .transform(val => val.trim().toLowerCase())
    .refine(val => DOMAIN_REGEX.test(val), {
      message: 'Invalid domain format. Use format like: example.com or sub.example.com',
    }),
  channel: AISourceSchema,
  source: z.enum(['default', 'custom']).default('custom'),
});

export const UtmSourceRuleSchema = z.object({
  // 问题 7 修复：添加 UTM Source 格式验证，与前端一致
  value: z.string()
    .min(1)
    .max(100)
    .transform(val => val.trim().toLowerCase())
    .refine(val => UTM_SOURCE_REGEX.test(val), {
      message: 'Invalid UTM source format. Use only letters, numbers, underscores, and hyphens.',
    }),
  channel: AISourceSchema,
  source: z.enum(['default', 'custom']).default('custom'),
});

export const TaggingSettingsSchema = z.object({
  orderTagPrefix: z.string().max(50).default('AI-Source'),
  customerTag: z.string().max(50).default('AI-Customer'),
  writeOrderTags: z.boolean().default(false),
  writeCustomerTags: z.boolean().default(false),
  dryRun: z.boolean().default(true),
});

export const ExposurePreferencesSchema = z.object({
  exposeProducts: z.boolean().default(false),
  exposeCollections: z.boolean().default(false),
  exposeBlogs: z.boolean().default(false),
});

export const SettingsUpdateSchema = z.object({
  primaryCurrency: CurrencySchema.optional(),
  aiDomains: z.array(AiDomainRuleSchema).optional(),
  utmSources: z.array(UtmSourceRuleSchema).optional(),
  // 问题 7 修复：确保 utmMediumKeywords 中的每个元素都是非空字符串
  utmMediumKeywords: z.array(
    z.string()
      .min(1, 'Keyword cannot be empty')
      .max(100, 'Keyword too long')
      .transform(val => val.trim())
  ).optional(),
  tagging: TaggingSettingsSchema.optional(),
  exposurePreferences: ExposurePreferencesSchema.optional(),
  gmvMetric: z.enum(['current_total_price', 'subtotal_price']).optional(),
  language: z.enum(['中文', 'English']).optional(),
  timezone: z.string().optional(),
  retentionMonths: z.number().int().min(1).max(24).optional(),
});

// ============================================================================
// Billing Schema
// ============================================================================

export const BillingPlanSchema = z.enum(['free', 'pro', 'growth']);

export const BillingStateSchema = z.enum([
  'NO_PLAN',
  'FREE_ACTIVE',
  'PRO_TRIALING',
  'PRO_ACTIVE',
  'GROWTH_TRIALING',
  'GROWTH_ACTIVE',
  'EXPIRED_NO_SUBSCRIPTION',
  'CANCELLED'
]);

export const SubscriptionRequestSchema = z.object({
  planId: BillingPlanSchema,
  trialDays: z.number().int().min(0).max(90).optional(),
});

// ============================================================================
// 辅助验证函数
// ============================================================================

/**
 * 安全地解析并验证数据
 */
export function safeParseJson<T extends z.ZodTypeAny>(
  json: string,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(json);
    const result = schema.safeParse(parsed);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      const errors = result.error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('; ');
      return { success: false, error: errors };
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Invalid JSON' 
    };
  }
}

/**
 * 验证并转换 Shopify Webhook 请求
 */
export function validateWebhookPayload<T extends z.ZodTypeAny>(
  payload: unknown,
  schema: T
): z.infer<T> {
  return schema.parse(payload);
}

/**
 * 创建类型安全的验证中间件
 */
export function createValidator<T extends z.ZodTypeAny>(schema: T) {
  return (data: unknown): z.infer<T> => {
    return schema.parse(data);
  };
}

// ============================================================================
// 类型导出
// ============================================================================

export type CopilotRequest = z.infer<typeof CopilotRequestSchema>;
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;
export type ExportRequest = z.infer<typeof ExportRequestSchema>;
export type ShopifyOrderWebhook = z.infer<typeof ShopifyOrderWebhookSchema>;
export type ShopifyRefundWebhook = z.infer<typeof ShopifyRefundWebhookSchema>;
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
export type SubscriptionRequest = z.infer<typeof SubscriptionRequestSchema>;

