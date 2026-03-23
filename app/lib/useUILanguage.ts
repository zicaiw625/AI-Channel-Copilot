import { useEffect, useState, useCallback } from "react";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "./constants";

export const useUILanguage = (initial: string) => {
  const [uiLanguage, setUiLanguage] = useState(initial);

  const getCookieLanguage = () => {
    const cookieHeader = typeof document === "undefined" ? "" : document.cookie || "";
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${LANGUAGE_STORAGE_KEY}=([^;]+)`));
    return match?.[1] ? match[1] : null;
  };
  
  // 使用 useCallback 来稳定事件处理器引用
  const handleStorageEvent = useCallback((e: StorageEvent) => {
    if (e.key === LANGUAGE_STORAGE_KEY && typeof e.newValue === "string") {
      setUiLanguage(e.newValue);
    }
  }, []);

  const handleCustomEvent = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail as string | undefined;
    if (detail) {
      setUiLanguage(detail);
    }
  }, []);

  // 初始化时从 localStorage 读取
  useEffect(() => {
    try {
      // 语言彻底统一：以 cookie 为准（localStorage 可能是旧值）
      const cookieRaw = getCookieLanguage();
      if (cookieRaw) {
        const decoded = decodeURIComponent(cookieRaw);
        if (decoded === "English" || decoded === "中文") {
          setUiLanguage(decoded);
          // 同步 localStorage，避免后续 storage 事件再次把界面拉回旧值
          window.localStorage.setItem(LANGUAGE_STORAGE_KEY, decoded);
          return;
        }
      }

      // cookie 不可用时才回退 localStorage
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored && (stored === "English" || stored === "中文") && stored !== initial) {
        setUiLanguage(stored);
      }
    } catch (error) {
      // localStorage 在某些环境下可能不可用（如隐私模式）
      console.debug("[useUILanguage] localStorage not available:", error);
    }
  }, [initial]);

  // 监听语言变化事件
  useEffect(() => {
    window.addEventListener("storage", handleStorageEvent);
    window.addEventListener(LANGUAGE_EVENT, handleCustomEvent as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorageEvent);
      window.removeEventListener(LANGUAGE_EVENT, handleCustomEvent as EventListener);
    };
  }, [handleStorageEvent, handleCustomEvent]);

  return uiLanguage;
};
