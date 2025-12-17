/**
 * Validation Schemas 测试
 * 
 * 测试覆盖:
 * - Shop Domain 验证
 * - 输入验证边界条件
 * - 特殊字符处理
 */

import { describe, it, expect } from "vitest";
import {
  ShopDomainSchema,
  isValidShopDomain,
  validateShopDomain,
  CopilotRequestSchema,
  DashboardQuerySchema,
  SettingsUpdateSchema,
  AiDomainRuleSchema,
  UtmSourceRuleSchema,
  DetectionSignalSchema,
  parseDetectionSignals,
} from "../app/lib/validation/schemas";

describe("ShopDomainSchema", () => {
  describe("有效的 Shopify 域名", () => {
    const validDomains = [
      "test-shop.myshopify.com",
      "my-awesome-store.myshopify.com",
      "shop123.myshopify.com",
      "a.myshopify.com",
      "store-name-with-many-dashes.myshopify.com",
    ];

    it.each(validDomains)("应该接受有效域名: %s", (domain) => {
      expect(ShopDomainSchema.safeParse(domain).success).toBe(true);
    });
  });

  describe("有效的自定义域名", () => {
    const validCustomDomains = [
      "mystore.com",
      "shop.example.co.uk",
      "store.mycompany.io",
      "a.co",
    ];

    it.each(validCustomDomains)("应该接受有效自定义域名: %s", (domain) => {
      expect(ShopDomainSchema.safeParse(domain).success).toBe(true);
    });
  });

  describe("无效的域名", () => {
    const invalidDomains = [
      "",
      "abc", // 太短，不符合域名格式
      "-invalid.myshopify.com", // 以连字符开头
      "no spaces.myshopify.com", // 包含空格
      "domain@invalid.com", // 包含无效字符
    ];

    it.each(invalidDomains)("应该拒绝无效域名: '%s'", (domain) => {
      const result = ShopDomainSchema.safeParse(domain);
      expect(result.success).toBe(false);
    });
  });

  describe("长度限制", () => {
    it("应该拒绝超过 255 字符的域名", () => {
      const longDomain = "a".repeat(250) + ".myshopify.com";
      expect(ShopDomainSchema.safeParse(longDomain).success).toBe(false);
    });

    it("应该拒绝少于 4 字符的域名", () => {
      expect(ShopDomainSchema.safeParse("a.c").success).toBe(false);
    });
  });
});

describe("isValidShopDomain", () => {
  it("应该返回 true 对于有效的 Shopify 域名", () => {
    expect(isValidShopDomain("test-shop.myshopify.com")).toBe(true);
  });

  it("应该返回 true 对于有效的自定义域名", () => {
    expect(isValidShopDomain("mystore.com")).toBe(true);
  });

  it("应该返回 false 对于 null", () => {
    expect(isValidShopDomain(null)).toBe(false);
  });

  it("应该返回 false 对于 undefined", () => {
    expect(isValidShopDomain(undefined)).toBe(false);
  });

  it("应该返回 false 对于非字符串", () => {
    expect(isValidShopDomain(123)).toBe(false);
    expect(isValidShopDomain({})).toBe(false);
    expect(isValidShopDomain([])).toBe(false);
  });
});

describe("validateShopDomain", () => {
  it("应该返回有效域名", () => {
    expect(validateShopDomain("test-shop.myshopify.com")).toBe("test-shop.myshopify.com");
  });

  it("应该抛出错误对于无效域名", () => {
    expect(() => validateShopDomain("")).toThrow();
    expect(() => validateShopDomain(null)).toThrow();
    expect(() => validateShopDomain("abc")).toThrow();
  });
});

describe("CopilotRequestSchema", () => {
  it("应该接受有效的 intent 请求", () => {
    const result = CopilotRequestSchema.safeParse({
      intent: "overview",
      range: "30d",
    });
    expect(result.success).toBe(true);
  });

  it("应该接受有效的 question 请求", () => {
    const result = CopilotRequestSchema.safeParse({
      question: "AI 渠道表现如何？",
      range: "7d",
    });
    expect(result.success).toBe(true);
  });

  it("应该拒绝既没有 intent 也没有 question 的请求", () => {
    const result = CopilotRequestSchema.safeParse({
      range: "30d",
    });
    expect(result.success).toBe(false);
  });

  it("应该拒绝过长的 question", () => {
    const result = CopilotRequestSchema.safeParse({
      question: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("应该拒绝无效的 intent", () => {
    const result = CopilotRequestSchema.safeParse({
      intent: "invalid-intent",
    });
    expect(result.success).toBe(false);
  });
});

describe("DashboardQuerySchema", () => {
  it("应该接受有效的查询参数", () => {
    const result = DashboardQuerySchema.safeParse({
      range: "30d",
      timezone: "Asia/Shanghai",
    });
    expect(result.success).toBe(true);
  });

  it("应该使用默认值", () => {
    const result = DashboardQuerySchema.parse({});
    expect(result.range).toBe("30d");
  });

  it("应该接受自定义日期范围", () => {
    const result = DashboardQuerySchema.safeParse({
      range: "custom",
      from: "2024-01-01",
      to: "2024-01-31",
    });
    expect(result.success).toBe(true);
  });
});

describe("SettingsUpdateSchema", () => {
  it("应该接受有效的设置更新", () => {
    const result = SettingsUpdateSchema.safeParse({
      primaryCurrency: "USD",
      language: "中文",
      timezone: "UTC",
    });
    expect(result.success).toBe(true);
  });

  it("应该拒绝无效的货币代码", () => {
    const result = SettingsUpdateSchema.safeParse({
      primaryCurrency: "US", // 只有 2 个字符
    });
    expect(result.success).toBe(false);
  });

  it("应该验证 retention months 范围", () => {
    expect(SettingsUpdateSchema.safeParse({ retentionMonths: 0 }).success).toBe(false);
    expect(SettingsUpdateSchema.safeParse({ retentionMonths: 1 }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ retentionMonths: 24 }).success).toBe(true);
    expect(SettingsUpdateSchema.safeParse({ retentionMonths: 25 }).success).toBe(false);
  });
});

describe("AiDomainRuleSchema", () => {
  it("应该接受有效的域名规则", () => {
    const result = AiDomainRuleSchema.safeParse({
      domain: "chatgpt.com",
      channel: "ChatGPT",
    });
    expect(result.success).toBe(true);
  });

  it("应该将域名转换为小写", () => {
    const result = AiDomainRuleSchema.parse({
      domain: "ChatGPT.COM",
      channel: "ChatGPT",
    });
    expect(result.domain).toBe("chatgpt.com");
  });

  it("应该拒绝无效的域名格式", () => {
    const result = AiDomainRuleSchema.safeParse({
      domain: "not-a-domain",
      channel: "ChatGPT",
    });
    expect(result.success).toBe(false);
  });
});

describe("UtmSourceRuleSchema", () => {
  it("应该接受有效的 UTM source 规则", () => {
    const result = UtmSourceRuleSchema.safeParse({
      value: "chatgpt",
      channel: "ChatGPT",
    });
    expect(result.success).toBe(true);
  });

  it("应该接受带下划线和连字符的值", () => {
    const result = UtmSourceRuleSchema.safeParse({
      value: "chat_gpt-ai",
      channel: "ChatGPT",
    });
    expect(result.success).toBe(true);
  });

  it("应该拒绝包含特殊字符的值", () => {
    const result = UtmSourceRuleSchema.safeParse({
      value: "chat@gpt!",
      channel: "ChatGPT",
    });
    expect(result.success).toBe(false);
  });
});

describe("DetectionSignalSchema", () => {
  it("应该接受有效的检测信号", () => {
    const result = DetectionSignalSchema.safeParse({
      type: "referrer",
      source: "chatgpt.com",
      matched: "chat.openai.com",
      confidence: 95,
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });

  it("应该限制 confidence 在 0-100 范围", () => {
    expect(DetectionSignalSchema.safeParse({
      type: "referrer",
      source: "test",
      matched: "test",
      confidence: -1,
      isPrimary: false,
    }).success).toBe(false);

    expect(DetectionSignalSchema.safeParse({
      type: "referrer",
      source: "test",
      matched: "test",
      confidence: 101,
      isPrimary: false,
    }).success).toBe(false);
  });
});

describe("parseDetectionSignals", () => {
  it("应该解析有效的 JSON 数组", () => {
    const signals = [
      {
        type: "referrer",
        source: "chatgpt.com",
        matched: "chat.openai.com",
        confidence: 95,
        isPrimary: true,
      },
    ];
    const result = parseDetectionSignals(signals);
    expect(result).toHaveLength(1);
    expect(result![0].type).toBe("referrer");
  });

  it("应该解析 JSON 字符串", () => {
    const signalsJson = JSON.stringify([
      {
        type: "utm_source",
        source: "chatgpt",
        matched: "chatgpt",
        confidence: 80,
        isPrimary: true,
      },
    ]);
    const result = parseDetectionSignals(signalsJson);
    expect(result).toHaveLength(1);
  });

  it("应该返回 null 对于无效数据", () => {
    expect(parseDetectionSignals(null)).toBeNull();
    expect(parseDetectionSignals(undefined)).toBeNull();
    expect(parseDetectionSignals("invalid json")).toBeNull();
    expect(parseDetectionSignals({ invalid: "structure" })).toBeNull();
  });
});

describe("特殊字符处理", () => {
  it("应该正确处理 Unicode 字符", () => {
    const result = CopilotRequestSchema.safeParse({
      question: "AI 渠道表现如何？这是中文问题。",
    });
    expect(result.success).toBe(true);
  });

  it("应该处理 emoji", () => {
    const result = CopilotRequestSchema.safeParse({
      question: "AI performance? 🚀",
    });
    expect(result.success).toBe(true);
  });
});
