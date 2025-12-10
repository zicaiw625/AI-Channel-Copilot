import { useEffect, useState, useCallback } from "react";
import { LANGUAGE_EVENT, LANGUAGE_STORAGE_KEY } from "./constants";

export const useUILanguage = (initial: string) => {
  const [uiLanguage, setUiLanguage] = useState(initial);
  
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
      const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored && stored !== initial) {
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
