/**
 * 服务端国际化模块
 * 
 * 复用 i18n.ts 的词典，确保客户端和服务端翻译一致
 * 
 * 使用方式:
 * ```ts
 * import { t, tp, isEnglish } from "~/lib/i18n.server";
 * const message = t(language, "hint_zero_ai");
 * ```
 */

// 复用客户端 i18n 模块的全部导出
export {
  t,
  tp,
  isEnglish,
  getLocale,
  type Lang,
  type TranslationKey,
  type TranslationEntry,
  translationDict,
} from "./i18n";
