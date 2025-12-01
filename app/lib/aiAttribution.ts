import type { AIChannel, AiDomainRule, UtmSourceRule, DetectionConfig } from "./aiTypes";

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

export const extractHostname = (value?: string | null) => {
  const url = safeUrl(value);
  if (!url) return null;
  return normalizeDomain(url.hostname);
};

export const domainMatches = (ruleDomain: string, url: URL | null) => {
  if (!url) return false;
  const hostname = normalizeDomain(url.hostname);
  const rule = normalizeDomain(ruleDomain);
  return hostname === rule || hostname.endsWith(`.${rule}`);
};

export const detectCopilotFromBing = (url: URL | null) => {
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

export const aiValueToChannel = (value: string, utmSources: UtmSourceRule[]): AIChannel | null => {
  const normalized = value.toLowerCase();
  const utmMatch = utmSources.find((rule) => rule.value.toLowerCase() === normalized);
  if (utmMatch) return utmMatch.channel as AIChannel;
  const channels: AIChannel[] = ["ChatGPT", "Perplexity", "Gemini", "Copilot", "Other-AI"];
  const channel = channels.find((item) => normalized.includes(item.toLowerCase()));
  return (channel as AIChannel | undefined) || null;
};

export const detectFromNoteAttributes = (
  noteAttributes: { name?: string | null; value?: string | null }[] | undefined,
  utmSources: UtmSourceRule[],
): { aiSource: AIChannel; detection: string } | null => {
  if (!noteAttributes?.length) return null;
  const explicit = noteAttributes.find((attr) =>
    ["ai_source", "ai-channel", "ai_channel", "ai-referrer"].some((key) => (attr.name || "").toLowerCase().includes(key)),
  );
  if (explicit?.value) {
    const channel = aiValueToChannel(explicit.value, utmSources) || ("Other-AI" as AIChannel);
    return { aiSource: channel, detection: `Note attribute ${explicit.name}=${explicit.value} mapped to AI channel` };
  }
  const fuzzyHit = noteAttributes.find((attr) => (attr.value || "").toLowerCase().includes("ai"));
  if (fuzzyHit) {
    return { aiSource: "Other-AI", detection: `Note attribute contains AI hint (${fuzzyHit.name || "note"}=${fuzzyHit.value || ""})` };
  }
  return null;
};

export const extractUtm = (...urls: (string | null | undefined)[]) => {
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
  config: DetectionConfig,
): { aiSource: AIChannel | null; detection: string; signals: string[] } => {
  const refUrl = safeUrl(referrer);
  const landingUrl = safeUrl(landingPage);
  const refDomain = extractHostname(referrer);
  const landingDomain = extractHostname(landingPage);
  const signals: string[] = [];

  const bingCopilotReason = detectCopilotFromBing(refUrl) || detectCopilotFromBing(landingUrl);
  if (bingCopilotReason) {
    const high = config.lang === "English" ? "confidence: high" : "高置信度";
    return { aiSource: "Copilot", detection: `${bingCopilotReason} · ${high}`, signals: [] };
  }

  const domainHitRef = config.aiDomains.find((rule) => domainMatches(rule.domain, refUrl));
  const domainHitLanding = domainHitRef ? undefined : config.aiDomains.find((rule) => domainMatches(rule.domain, landingUrl));
  const domainHit = domainHitRef || domainHitLanding;
  const utmMatch = utmSource ? config.utmSources.find((rule) => rule.value.toLowerCase() === utmSource.toLowerCase()) : undefined;

  if (domainHit) {
    const conflictNote = utmMatch && utmMatch.channel !== domainHit.channel
      ? (config.lang === "English" ? `; conflict: utm_source=${utmSource} → ${utmMatch.channel}` : `; 冲突：utm_source=${utmSource} → ${utmMatch.channel}`)
      : utmMatch
        ? (config.lang === "English" ? `; utm_source=${utmSource} confirmed` : `; utm_source=${utmSource} 已确认`)
        : "";
    if (domainHitRef) signals.push(`referrer matched ${domainHit.domain}`);
    if (domainHitLanding) signals.push(`landing matched ${domainHit.domain}`);
    if (utmMatch) signals.push(`utm_source=${utmSource}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const high = config.lang === "English" ? "confidence: high" : "置信度高";
    return { aiSource: domainHit.channel as AIChannel, detection: `${signals.join(" + ")} · ${high}${conflictNote}`, signals: clamped };
  }

  if (utmMatch) {
    signals.push(`utm_source=${utmSource}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const medium = config.lang === "English" ? "confidence: medium (missing referrer)" : "置信度中等（缺少 referrer）";
    return { aiSource: utmMatch.channel as AIChannel, detection: `${signals.join(" + ")} · ${medium}`, signals: clamped };
  }

  const mediumHit = utmMedium && config.utmMediumKeywords.find((keyword) => utmMedium.toLowerCase().includes(keyword.toLowerCase()));
  if (mediumHit) {
    signals.push(`utm_medium=${utmMedium}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const low = config.lang === "English" ? `confidence: low: only matched medium keyword(${mediumHit}), insufficient` : `置信度低：仅命中 medium 关键词(${mediumHit})，不足以判定 AI`;
    return { aiSource: null, detection: `${signals.join(" + ")} · ${low}`, signals: clamped };
  }

  const noteHit = detectFromNoteAttributes(noteAttributes, config.utmSources);
  if (noteHit) return { ...noteHit, signals: [] };

  const tagPrefix = config.tagPrefix || "AI-Source";
  const tagMatch = tags?.find((tag) => tag.startsWith(tagPrefix));
  if (tagMatch) {
    const suffix = tagMatch.replace(`${tagPrefix}-`, "");
    const channel = ([("ChatGPT"), ("Perplexity"), ("Gemini"), ("Copilot"), ("Other-AI")] as AIChannel[])
      .find((item) => item.toLowerCase() === suffix.toLowerCase()) || ("Other-AI" as AIChannel);
    const clamped = ["existing tag"].slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    const medium = config.lang === "English" ? "confidence: medium (may come from app tag write-back)" : "置信度中等（可能来自本应用标签写回）";
    return { aiSource: channel, detection: `Detected by existing tag ${tagMatch} · ${medium}`, signals: clamped };
  }

  const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
  const none = config.lang === "English"
    ? `No AI signals detected (referrer=${refDomain || "—"}, utm_source=${utmSource || "—"}, landing=${landingDomain || "—"}) · confidence: low`
    : `未检测到 AI 信号（referrer=${refDomain || "—"}, utm_source=${utmSource || "—"}, landing=${landingDomain || "—"}） · 置信度低`;
  return {
    aiSource: null,
    detection: none,
    signals: clamped,
  };
};
