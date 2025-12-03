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
 */
export const extractUtm = (...urls: (string | null | undefined)[]): {
  utmSource: string | undefined;
  utmMedium: string | undefined;
} => {
  let utmSource: string | undefined;
  let utmMedium: string | undefined;

  for (const value of urls) {
    const parsed = safeUrl(value);
    if (!parsed) continue;
    if (!utmSource) utmSource = parsed.searchParams.get("utm_source") || undefined;
    if (!utmMedium) utmMedium = parsed.searchParams.get("utm_medium") || undefined;
    if (utmSource && utmMedium) break;
  }

  return { utmSource, utmMedium };
};

/**
 * 检查是否为 Bing Copilot 来源
 * 通过检查 Bing URL 中的 Copilot 相关参数
 */
export const detectCopilotFromBing = (url: URL | null): string | null => {
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

