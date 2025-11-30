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
    return { aiSource: "Copilot", detection: `${bingCopilotReason} · 高置信度`, signals: [] };
  }

  const domainHit = config.aiDomains.find((rule) => domainMatches(rule.domain, refUrl) || domainMatches(rule.domain, landingUrl));
  const utmMatch = utmSource ? config.utmSources.find((rule) => rule.value.toLowerCase() === utmSource.toLowerCase()) : undefined;

  if (domainHit) {
    const conflictNote = utmMatch && utmMatch.channel !== domainHit.channel ? `; conflict: utm_source=${utmSource} → ${utmMatch.channel}` : utmMatch ? `; utm_source=${utmSource} confirmed` : "";
    signals.push(`referrer matched ${domainHit.domain}`);
    if (utmMatch) signals.push(`utm_source=${utmSource}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    return { aiSource: domainHit.channel as AIChannel, detection: `${signals.join(" + ")} · 置信度高${conflictNote}`, signals: clamped };
  }

  if (utmMatch) {
    signals.push(`utm_source=${utmSource}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    return { aiSource: utmMatch.channel as AIChannel, detection: `${signals.join(" + ")} · 置信度中等（缺少 referrer）`, signals: clamped };
  }

  const mediumHit = utmMedium && config.utmMediumKeywords.find((keyword) => utmMedium.toLowerCase().includes(keyword.toLowerCase()));
  if (mediumHit) {
    signals.push(`utm_medium=${utmMedium}`);
    const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
    return { aiSource: null, detection: `${signals.join(" + ")} · 置信度低：仅命中 medium 关键词(${mediumHit})，不足以判定 AI`, signals: clamped };
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
    return { aiSource: channel, detection: `Detected by existing tag ${tagMatch} · 置信度中等（可能来自本应用标签写回）`, signals: clamped };
  }

  const clamped = signals.slice(0, 10).map((s) => (s.length > 255 ? s.slice(0, 255) : s));
  return {
    aiSource: null,
    detection: `未检测到 AI 信号（referrer=${refDomain || "—"}, utm_source=${utmSource || "—"}, landing=${landingDomain || "—"}） · 置信度低`,
    signals: clamped,
  };
};

