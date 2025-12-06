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
 * 预编译的渠道匹配正则表达式
 * 在模块加载时初始化，避免每次调用时重新创建
 */
const CHANNEL_WORD_BOUNDARY_PATTERNS: ReadonlyMap<AIChannel, RegExp> = new Map(
  AI_CHANNELS
    .filter((channel): channel is Exclude<AIChannel, "Other-AI"> => channel !== "Other-AI")
    .map((channel) => [
      channel,
      new RegExp(`\\b${channel.toLowerCase().replace("-", "[-_]?")}\\b`, "i"),
    ])
);

/**
 * 预编译的渠道名称小写映射（用于精确匹配）
 */
const CHANNEL_LOWERCASE_MAP: ReadonlyMap<string, AIChannel> = new Map(
  AI_CHANNELS.map((channel) => [channel.toLowerCase(), channel])
);

/**
 * 将 AI 相关值映射到渠道
 * 优化：使用预编译的正则表达式和 Map 查找，提升性能
 */
export const aiValueToChannel = (value: string, utmSources: UtmSourceRule[]): AIChannel | null => {
  const normalized = value.toLowerCase().trim();
  if (!normalized) return null;
  
  // 1. 精确匹配 UTM 规则（最高优先级）
  const utmMatch = utmSources.find((rule) => rule.value.toLowerCase() === normalized);
  if (utmMatch) return utmMatch.channel;
  
  // 2. 精确匹配渠道名称（使用预编译的 Map）
  const exactMatch = CHANNEL_LOWERCASE_MAP.get(normalized);
  if (exactMatch) return exactMatch;
  
  // 3. 使用预编译的正则表达式进行单词边界匹配
  for (const [channel, pattern] of CHANNEL_WORD_BOUNDARY_PATTERNS) {
    if (pattern.test(normalized)) {
      return channel;
    }
  }
  
  return null;
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
  // 注意：使用 (?:^|[_\-\s]) 和 (?:[_\-\s]|$) 来支持下划线和连字符作为边界
  // 因为 \b 在 JavaScript 中不将下划线视为单词边界
  const aiContextPattern = /(?:^|[_\-\s])(ai|llm|chat|assistant|bot|model|gpt)(?:[_\-\s]|$)/i;

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
  // 注意：使用严格的模式避免误判（如 "hawaii" 不应匹配 "ai"）
  // 支持下划线和连字符作为边界，因为字段名常用 snake_case 或 kebab-case
  const aiFieldNamePattern = /(?:^|[_-])(source|channel|referr|traffic|campaign|medium)(?:[_-]|$)/i;
  
  // 严格的 AI 模式：
  // - 独立的 "ai" 单词必须有明确边界（不能是单词的一部分）
  // - 使用负向前瞻/后顾确保 "ai" 不是更长单词的一部分
  const genericAiPatterns = [
    // 匹配独立的 "ai"：前后必须是非字母字符或字符串边界
    // 排除 "hawaii", "email", "again", "contain" 等包含 "ai" 的常见词
    /(?<![a-z])ai(?![a-z])/i,  // "ai" 前后不能是字母
    /^ai[-_]/i,                 // 以 "ai-" 或 "ai_" 开头
    /[-_]ai$/i,                 // 以 "-ai" 或 "_ai" 结尾
    /[-_]ai[-_]/i,              // 中间的 "-ai-" 或 "_ai_"
  ];
  
  // 明确的 AI 相关值白名单（精确匹配）
  const explicitAiValues = new Set([
    "ai",
    "ai-assistant",
    "ai_assistant",
    "ai-chat",
    "ai_chat",
    "ai-search",
    "ai_search",
    "ai-referral",
    "ai_referral",
    "llm",
    "llm-referral",
  ]);

  for (const attr of noteAttributes) {
    const name = (attr.name || "").toLowerCase();
    const value = (attr.value || "").toLowerCase().trim();
    
    // 只有当字段名包含相关上下文时，才进行通用 AI 模式匹配
    if (aiFieldNamePattern.test(name)) {
      // 优先使用白名单精确匹配
      if (explicitAiValues.has(value)) {
        return {
          aiSource: "Other-AI",
          detection: `Note attribute contains AI hint (${attr.name || "note"}=${attr.value || ""})`,
        };
      }
      
      // 使用严格的模式匹配
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
