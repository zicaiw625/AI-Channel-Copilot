export type LanguageCode = "en" | "zh";
export type UILanguage = "English" | "中文";

export function normalizeLanguageCode(value: string | null | undefined): LanguageCode | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();

  if (normalized === "english" || /^en(?:[-_][a-z0-9]+)*$/i.test(normalized)) {
    return "en";
  }

  if (normalized === "中文" || /^zh(?:[-_][a-z0-9]+)*$/i.test(normalized)) {
    return "zh";
  }

  return null;
}

export function toUILanguage(value: string | null | undefined, fallback: UILanguage = "中文"): UILanguage {
  const code = normalizeLanguageCode(value);

  if (code === "en") return "English";
  if (code === "zh") return "中文";

  return fallback;
}

export function normalizeLanguageSearchParams(params: URLSearchParams) {
  if (!params.has("lang")) return params;

  const code = normalizeLanguageCode(params.get("lang"));

  if (code) {
    params.set("lang", code);
  } else {
    params.delete("lang");
  }

  return params;
}
