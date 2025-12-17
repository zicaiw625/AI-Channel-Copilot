import { readAppFlags, isProduction } from "./env.server";

const DEFAULT_PLATFORM = "shopify";

export const getPlatform = () => DEFAULT_PLATFORM;

/**
 * 检查是否处于 Demo 模式
 * 
 * 🔒 安全说明：
 * - Demo 模式通过服务端环境变量 DEMO_MODE 控制，用户无法直接修改
 * - 在 Demo 模式下，部分功能会被跳过（如 webhook 处理、数据持久化）
 * - 生产环境应确保 DEMO_MODE=false
 * 
 * @returns 是否处于 Demo 模式
 */
export const isDemoMode = (): boolean => {
  const demo = readAppFlags().demoMode;
  
  // 🔒 安全保护：生产环境强制禁用 demo 模式
  // 即使环境变量被误配置，也会被覆盖
  if (isProduction() && demo) {
    // 仅记录一次警告，避免日志泛滥
    if (typeof globalThis !== "undefined" && !(globalThis as Record<string, unknown>).__demoWarningLogged) {
      console.warn("[security] DEMO_MODE is enabled in production - this will be ignored");
      (globalThis as Record<string, unknown>).__demoWarningLogged = true;
    }
    return false;
  }
  
  return demo;
};

export const allowDemoData = () => isDemoMode();
