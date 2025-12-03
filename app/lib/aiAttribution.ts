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
 */
export const aiValueToChannel = (value: string, utmSources: UtmSourceRule[]): AIChannel | null => {
  const normalized = value.toLowerCase();
  const utmMatch = utmSources.find((rule) => rule.value.toLowerCase() === normalized);
  if (utmMatch) return utmMatch.channel;
  const channel = AI_CHANNELS.find((item) => normalized.includes(item.toLowerCase()));
  return (channel as AIChannel | undefined) || null;
};

/**
 * 从订单备注属性中检测 AI 来源
 */
export const detectFromNoteAttributes = (
  noteAttributes: { name?: string | null; value?: string | null }[] | undefined,
  utmSources: UtmSourceRule[]
): { aiSource: AIChannel; detection: string } | null => {
  if (!noteAttributes?.length) return null;

  const explicit = noteAttributes.find((attr) =>
    ["ai_source", "ai-channel", "ai_channel", "ai-referrer"].some((key) =>
      (attr.name || "").toLowerCase().includes(key)
    )
  );

  if (explicit?.value) {
    const channel = aiValueToChannel(explicit.value, utmSources) || ("Other-AI" as AIChannel);
    return {
      aiSource: channel,
      detection: `Note attribute ${explicit.name}=${explicit.value} mapped to AI channel`,
    };
  }

  const fuzzyHit = noteAttributes.find((attr) =>
    (attr.value || "").toLowerCase().includes("ai")
  );

  if (fuzzyHit) {
    return {
      aiSource: "Other-AI",
      detection: `Note attribute contains AI hint (${fuzzyHit.name || "note"}=${fuzzyHit.value || ""})`,
    };
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
  const tagMatch = tags?.find((tag) => tag.startsWith(tagPrefix));
  if (tagMatch) {
    const suffix = tagMatch.replace(`${tagPrefix}-`, "");
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
