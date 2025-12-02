/* @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useUILanguage } from "../app/lib/useUILanguage";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "../app/lib/constants";

function TestComp({ initial }: { initial: string }) {
  const lang = useUILanguage(initial);
  return <span data-testid="lang">{lang}</span>;
}

describe("useUILanguage", () => {
  it("loads from localStorage and reacts to custom events", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "English");

    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(<TestComp initial="中文" />);
    });

    expect(document.querySelector('[data-testid="lang"]')?.textContent).toBe("English");

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "中文");
    await act(async () => {
      window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: "中文" }));
    });
    expect(document.querySelector('[data-testid="lang"]')?.textContent).toBe("中文");
  });
});
