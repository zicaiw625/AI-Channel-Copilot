/**
 * AI 渠道归因模块
 * 负责检测订单是否来自 AI 渠道
 */

import type { AIChannel, UtmSourceRule, DetectionConfig, DetectionResult } from "./aiTypes";
import { AI_CHANNELS } from "./aiTypes";
import {
  safeUrl,
  extractHostname,
  domainMatches,
  detectCopilotFromBing,
  extractUtm as extractUtmFromUrls,
} from "./urlUtils";

/**
 * 将 AI 相关值映射到渠道
 * 优化：使用精确匹配和单词边界匹配，避免误判
 */
export const aiValueToChannel = (value: string, utmSources: UtmSourceRule[]): AIChannel | null => {
  const normalized = value.toLowerCase().trim();
  if (!normalized) return null;
  
  // 1. 精确匹配 UTM 规则（最高优先级）
  const utmMatch = utmSources.find((rule) => rule.value.toLowerCase() === normalized);
  if (utmMatch) return utmMatch.channel;
  
  // 2. 精确匹配渠道名称
  const exactMatch = AI_CHANNELS.find((item) => item.toLowerCase() === normalized);
  if (exactMatch) return exactMatch;
  
  // 3. 使用单词边界进行模糊匹配，避免 "notchatgpt" 匹配 "ChatGPT"
  // 缓存正则表达式以提升性能
  const wordBoundaryMatch = AI_CHANNELS.find((item) => {
    // Other-AI 不参与模糊匹配
    if (item === "Other-AI") return false;
    const pattern = new RegExp(`\\b${item.toLowerCase().replace("-", "[-_]?")}\\b`, "i");
    return pattern.test(normalized);
  });
  
  return wordBoundaryMatch || null;
};

/**
 * 从订单备注属性中检测 AI 来源
 * 优化：区分明确的 AI 标识和可能有歧义的词汇，减少误报
 */
export const detectFromNoteAttributes = (
  noteAttributes: { name?: string | null; value?: string | null }[] | undefined,
  utmSources: UtmSourceRule[]
): { aiSource: AIChannel; detection: string } | null => {
  if (!noteAttributes?.length) return null;

  // 1. 显式 AI 字段检测（最高优先级）
  const explicitAiKeys = ["ai_source", "ai-channel", "ai_channel", "ai-referrer", "ai_referrer"];
  const explicit = noteAttributes.find((attr) =>
    explicitAiKeys.some((key) => (attr.name || "").toLowerCase().includes(key))
  );

  if (explicit?.value) {
    const channel = aiValueToChannel(explicit.value, utmSources) || ("Other-AI" as AIChannel);
    return {
      aiSource: channel,
      detection: `Note attribute ${explicit.name}=${explicit.value} mapped to AI channel`,
    };
  }

  // 2. 严格的 AI 平台名称匹配（无歧义）
  const strictPatterns = [
    { pattern: /\bopenai\b/i, channel: "ChatGPT" as AIChannel },
    { pattern: /\bchatgpt\b/i, channel: "ChatGPT" as AIChannel },
    { pattern: /\bperplexity\b/i, channel: "Perplexity" as AIChannel },
    { pattern: /\bcopilot\b/i, channel: "Copilot" as AIChannel },
    { pattern: /\bclaude\b/i, channel: "Other-AI" as AIChannel },
    { pattern: /\bdeepseek\b/i, channel: "Other-AI" as AIChannel },
    { pattern: /\banthropic\b/i, channel: "Other-AI" as AIChannel },
  ];

  for (const attr of noteAttributes) {
    const value = (attr.value || "").toLowerCase();
    for (const { pattern, channel } of strictPatterns) {
      if (pattern.test(value)) {
        return {
          aiSource: channel,
          detection: `Note attribute contains AI platform name (${attr.name || "note"}=${attr.value || ""})`,
        };
      }
    }
  }

  // 3. 可能有歧义的词汇（如 "gemini"）需要额外上下文验证
  const ambiguousPatterns = [
    { pattern: /\bgemini\b/i, channel: "Gemini" as AIChannel },
  ];
  
  // AI 相关上下文关键词
  const aiContextPattern = /\b(ai|llm|chat|assistant|bot|model|gpt|language\s*model)\b/i;

  for (const attr of noteAttributes) {
    const name = (attr.name || "").toLowerCase();
    const value = (attr.value || "").toLowerCase();
    
    for (const { pattern, channel } of ambiguousPatterns) {
      if (pattern.test(value)) {
        // 检查是否有 AI 相关上下文
        if (aiContextPattern.test(name) || aiContextPattern.test(value)) {
          return {
            aiSource: channel,
            detection: `Note attribute contains ${channel} with AI context (${attr.name || "note"}=${attr.value || ""})`,
          };
        }
      }
    }
  }

  // 4. 通用 AI 模式匹配（需要字段名包含相关上下文）
  const aiFieldNamePattern = /\b(source|channel|referr|traffic|campaign|medium)\b/i;
  const genericAiPatterns = [
    /\bai\b/i,           // Standalone "ai" word
    /\bai[-_]/i,         // "ai-" or "ai_" prefix
    /[-_]ai\b/i,         // "-ai" or "_ai" suffix
  ];

  for (const attr of noteAttributes) {
    const name = (attr.name || "").toLowerCase();
    const value = (attr.value || "").toLowerCase();
    
    // 只有当字段名包含相关上下文时，才进行通用 AI 模式匹配
    if (aiFieldNamePattern.test(name)) {
      if (genericAiPatterns.some((pattern) => pattern.test(value))) {
        return {
          aiSource: "Other-AI",
          detection: `Note attribute contains AI hint (${attr.name || "note"}=${attr.value || ""})`,
        };
      }
    }
  }

  return null;
};

/**
 * 导出 extractUtm 函数（使用 urlUtils 中的实现）
 */
export const extractUtm = extractUtmFromUrls;

/**
 * 从订单字段中检测 AI 来源
 * 优先级：referrer > UTM > 备注属性 > 标签
 */
export const detectAiFromFields = (
  referrer: string,
  landingPage: string,
  utmSource: string | undefined,
  utmMedium: string | undefined,
  tags: string[] | undefined,
  noteAttributes: { name?: string | null; value?: string | null }[] | undefined,
  config: DetectionConfig
): DetectionResult => {
  const refUrl = safeUrl(referrer);
  const landingUrl = safeUrl(landingPage);
  const refDomain = extractHostname(referrer);
  const landingDomain = extractHostname(landingPage);
  const signals: string[] = [];

  // 1. 检查 Bing Copilot 特殊情况
  const bingCopilotReason = detectCopilotFromBing(refUrl) || detectCopilotFromBing(landingUrl);
  if (bingCopilotReason) {
    const high = config.lang === "English" ? "confidence: high" : "高置信度";
    return { aiSource: "Copilot", detection: `${bingCopilotReason} · ${high}`, signals: [] };
  }

  // 2. 检查域名匹配
  const domainHitRef = config.aiDomains.find((rule) => domainMatches(rule.domain, refUrl));
  const domainHitLanding = domainHitRef
    ? undefined
    : config.aiDomains.find((rule) => domainMatches(rule.domain, landingUrl));
  const domainHit = domainHitRef || domainHitLanding;

  // 3. 检查 UTM Source 匹配
  const utmMatch = utmSource
    ? config.utmSources.find((rule) => rule.value.toLowerCase() === utmSource.toLowerCase())
    : undefined;

  // 4. 域名匹配优先
  if (domainHit) {
    const conflictNote =
      utmMatch && utmMatch.channel !== domainHit.channel
        ? config.lang === "English"
          ? `; conflict: utm_source=${utmSource} → ${utmMatch.channel}`
          : `; 冲突：utm_source=${utmSource} → ${utmMatch.channel}`
        : utmMatch
          ? config.lang === "English"
            ? `; utm_source=${utmSource} confirmed`
            : `; utm_source=${utmSource} 已确认`
          : "";

    if (domainHitRef) signals.push(`referrer matched ${domainHit.domain}`);
    if (domainHitLanding) signals.push(`landing matched ${domainHit.domain}`);
    if (utmMatch) signals.push(`utm_source=${utmSource}`);

    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const high = config.lang === "English" ? "confidence: high" : "置信度高";

    return {
      aiSource: domainHit.channel,
      detection: `${signals.join(" + ")} · ${high}${conflictNote}`,
      signals: clamped,
    };
  }

  // 5. UTM Source 匹配
  if (utmMatch) {
    signals.push(`utm_source=${utmSource}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const medium =
      config.lang === "English"
        ? "confidence: medium (missing referrer)"
        : "置信度中等（缺少 referrer）";

    return {
      aiSource: utmMatch.channel,
      detection: `${signals.join(" + ")} · ${medium}`,
      signals: clamped,
    };
  }

  // 6. UTM Medium 关键词匹配（低置信度，不判定为 AI）
  const mediumHit =
    utmMedium &&
    config.utmMediumKeywords.find((keyword) =>
      utmMedium.toLowerCase().includes(keyword.toLowerCase())
    );

  if (mediumHit) {
    signals.push(`utm_medium=${utmMedium}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const low =
      config.lang === "English"
        ? `confidence: low: only matched medium keyword(${mediumHit}), insufficient`
        : `置信度低：仅命中 medium 关键词(${mediumHit})，不足以判定 AI`;

    return {
      aiSource: null,
      detection: `${signals.join(" + ")} · ${low}`,
      signals: clamped,
    };
  }

  // 7. 备注属性匹配
  const noteHit = detectFromNoteAttributes(noteAttributes, config.utmSources);
  if (noteHit) return { ...noteHit, signals: [] };

  // 8. 标签匹配
  const tagPrefix = config.tagPrefix || "AI-Source";
  // 支持多种标签格式: "AI-Source-ChatGPT", "AI-Source:ChatGPT", "AI-Source_ChatGPT"
  const tagMatch = tags?.find((tag) => {
    const normalizedTag = tag.toLowerCase();
    const normalizedPrefix = tagPrefix.toLowerCase();
    return normalizedTag.startsWith(normalizedPrefix + "-") ||
           normalizedTag.startsWith(normalizedPrefix + ":") ||
           normalizedTag.startsWith(normalizedPrefix + "_");
  });
  if (tagMatch) {
    // 使用正则提取后缀，支持多种分隔符
    // 转义正则特殊字符以防止正则注入
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffixMatch = tagMatch.match(new RegExp(`^${escapeRegex(tagPrefix)}[-:_](.+)$`, "i"));
    let suffix = suffixMatch ? suffixMatch[1] : tagMatch.slice(tagPrefix.length + 1);
    
    // 清理后缀：移除前导分隔符，处理多个连续分隔符的情况
    suffix = suffix.replace(/^[-:_]+/, "").trim();
    
    // 处理空后缀的边界情况
    if (!suffix) {
      const low =
        config.lang === "English"
          ? "confidence: low (tag has empty suffix)"
          : "置信度低（标签后缀为空）";
      return {
        aiSource: "Other-AI",
        detection: `Tag ${tagMatch} has empty suffix · ${low}`,
        signals: ["existing tag (empty suffix)"],
      };
    }
    
    const channel =
      AI_CHANNELS.find((item) => item.toLowerCase() === suffix.toLowerCase()) ||
      ("Other-AI" as AIChannel);
    const clamped = ["existing tag"].slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const medium =
      config.lang === "English"
        ? "confidence: medium (may come from app tag write-back)"
        : "置信度中等（可能来自本应用标签写回）";

    return {
      aiSource: channel,
      detection: `Detected by existing tag ${tagMatch} · ${medium}`,
      signals: clamped,
    };
  }

  // 9. 未检测到 AI 信号
  const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
  const none =
    config.lang === "English"
      ? `No AI signals detected (referrer=${refDomain || "—"}, utm_source=${utmSource || "—"}, landing=${landingDomain || "—"}) · confidence: low`
      : `未检测到 AI 信号（referrer=${refDomain || "—"}, utm_source=${utmSource || "—"}, landing=${landingDomain || "—"}） · 置信度低`;

  return {
    aiSource: null,
    detection: none,
    signals: clamped,
  };
};
