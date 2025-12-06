/**
 * URL 和域名处理工具函数
 * 提取自 aiData.ts 和 aiAttribution.ts 中的重复代码
 */

/**
 * 规范化域名（移除协议前缀和 www.）
 */
export const normalizeDomain = (domain?: string | null): string =>
  (domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();

/**
 * 安全解析 URL，处理各种边缘情况
 */
export const safeUrl = (value?: string | null): URL | null => {
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

/**
 * 从 URL 字符串中提取主机名
 */
export const extractHostname = (value?: string | null): string | null => {
  const url = safeUrl(value);
  if (!url) return null;
  return normalizeDomain(url.hostname);
};

/**
 * 检查域名规则是否匹配 URL
 */
export const domainMatches = (ruleDomain: string, url: URL | null): boolean => {
  if (!url) return false;
  const hostname = normalizeDomain(url.hostname);
  const rule = normalizeDomain(ruleDomain);
  return hostname === rule || hostname.endsWith(`.${rule}`);
};

/**
 * 从 URL 字符串中提取 UTM 参数
 * 优化：确保 utm_source 和 utm_medium 来自同一 URL，避免混淆
 */
export const extractUtm = (...urls: (string | null | undefined)[]): {
  utmSource: string | undefined;
  utmMedium: string | undefined;
  sourceUrl?: string;
} => {
  // 策略：优先返回同时包含 utm_source 和 utm_medium 的 URL
  // 如果没有，则返回第一个包含任一参数的 URL
  let bestMatch: { utmSource?: string; utmMedium?: string; sourceUrl?: string } | null = null;
  let partialMatch: { utmSource?: string; utmMedium?: string; sourceUrl?: string } | null = null;

  for (const value of urls) {
    const parsed = safeUrl(value);
    if (!parsed) continue;
    
    const utmSource = parsed.searchParams.get("utm_source") || undefined;
    const utmMedium = parsed.searchParams.get("utm_medium") || undefined;
    
    if (utmSource && utmMedium) {
      // 找到完整匹配，立即返回
      bestMatch = { utmSource, utmMedium, sourceUrl: value || undefined };
      break;
    }
    
    if ((utmSource || utmMedium) && !partialMatch) {
      // 记录第一个部分匹配
      partialMatch = { utmSource, utmMedium, sourceUrl: value || undefined };
    }
  }

  const result = bestMatch || partialMatch;
  return {
    utmSource: result?.utmSource,
    utmMedium: result?.utmMedium,
    sourceUrl: result?.sourceUrl,
  };
};

/**
 * 检查是否为 Bing Copilot 来源
 * 通过检查 Bing/Microsoft URL 中的 Copilot 相关参数
 * 增强版：支持更多域名和参数格式
 */
export const detectCopilotFromBing = (url: URL | null): string | null => {
  if (!url) return null;
  const hostname = normalizeDomain(url.hostname);
  
  // 扩展支持的域名：Bing 和 Microsoft Copilot 相关域名
  const isCopilotDomain = 
    hostname.endsWith("bing.com") ||
    hostname === "copilot.microsoft.com" ||
    hostname.endsWith(".copilot.microsoft.com") ||
    hostname === "copilot.cloud.microsoft" ||
    hostname.endsWith(".copilot.cloud.microsoft");
  
  if (!isCopilotDomain) return null;

  // 直接是 Copilot 域名，无需检查参数
  if (hostname.includes("copilot")) {
    return `Copilot domain detected (${hostname}${url.pathname})`;
  }

  // Bing 域名需要检查 Copilot 相关参数
  const form = url.searchParams.get("form")?.toLowerCase() || "";
  const ocid = url.searchParams.get("ocid")?.toLowerCase() || "";
  const ref = url.searchParams.get("ref")?.toLowerCase() || "";
  const src = url.searchParams.get("src")?.toLowerCase() || "";
  
  const hasCopilotParam =
    // 路径检测
    url.pathname.includes("/chat") ||
    url.pathname.includes("/copilot") ||
    // form 参数检测
    form.includes("bingai") ||
    form.includes("copilot") ||
    form.includes("edgechat") ||
    form.includes("sydchat") ||
    // ocid 参数检测
    ocid.includes("copilot") ||
    ocid.includes("bingchat") ||
    ocid.includes("sydneyai") ||
    // ref/src 参数检测
    ref.includes("copilot") ||
    src.includes("copilot") ||
    src.includes("bingchat");

  if (!hasCopilotParam) return null;

  return `Bing/Copilot referrer detected (${hostname}${url.pathname})`;
};

