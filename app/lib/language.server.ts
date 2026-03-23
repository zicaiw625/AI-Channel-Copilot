import type { LoaderFunctionArgs } from "react-router";

import { LANGUAGE_STORAGE_KEY } from "./constants";
import { toUILanguage, type UILanguage } from "./language";

type LoaderRequest = LoaderFunctionArgs["request"];

function readCookieValue(request: LoaderRequest, cookieName: string): string | null {
  const cookieHeader = request.headers.get("Cookie") || "";
  // 简单且足够稳健：只取第一次匹配
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  return match?.[1] ? match[1] : null;
}

/**
 * 服务端：优先从 cookie `aicc_language` 解析 UI 语言。
 * 其次才回退到 settings 的 language。
 */
export function resolveUILanguageFromRequest(request: LoaderRequest, fallbackLanguage: string | undefined): UILanguage {
  const fallback = toUILanguage(fallbackLanguage ?? null, "中文");

  const raw = readCookieValue(request, LANGUAGE_STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const decoded = decodeURIComponent(raw);
    return toUILanguage(decoded, fallback);
  } catch {
    return fallback;
  }
}

