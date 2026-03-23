import { describe, expect, it } from "vitest";

import { normalizeLanguageCode, normalizeLanguageSearchParams, toUILanguage } from "../app/lib/language";

describe("language helpers", () => {
  it("normalizes legacy language values to url-safe codes", () => {
    expect(normalizeLanguageCode("English")).toBe("en");
    expect(normalizeLanguageCode("中文")).toBe("zh");
    expect(normalizeLanguageCode("en-US")).toBe("en");
    expect(normalizeLanguageCode("zh-CN")).toBe("zh");
  });

  it("rejects non-language values instead of matching loose prefixes", () => {
    expect(normalizeLanguageCode("enable")).toBe(null);
    expect(normalizeLanguageCode("zhfoo")).toBe(null);
    expect(normalizeLanguageCode("foo")).toBe(null);
  });

  it("maps normalized codes back to ui language labels", () => {
    expect(toUILanguage("en")).toBe("English");
    expect(toUILanguage("zh")).toBe("中文");
    expect(toUILanguage("English")).toBe("English");
    expect(toUILanguage("中文")).toBe("中文");
    expect(toUILanguage("invalid", "English")).toBe("English");
  });

  it("canonicalizes lang query params in preserved searches", () => {
    const params = new URLSearchParams("lang=English&foo=bar");

    expect(normalizeLanguageSearchParams(params).toString()).toBe("lang=en&foo=bar");
  });
});
