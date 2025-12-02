import { useEffect, useState } from "react";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "./constants";

export const useUILanguage = (initial: string) => {
  const [uiLanguage, setUiLanguage] = useState(initial);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored && stored !== uiLanguage) setUiLanguage(stored);
    } catch { void 0; }
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANGUAGE_STORAGE_KEY && typeof e.newValue === "string") {
        setUiLanguage(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as string | undefined;
        if (detail && detail !== uiLanguage) setUiLanguage(detail);
      } catch { void 0; }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(LANGUAGE_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LANGUAGE_EVENT, onCustom as EventListener);
    };
  }, [uiLanguage]);
  return uiLanguage;
};
