/**
 * 格式化工具类 - 处理货币、数字、日期等格式化逻辑
 */

export interface CurrencyFormatter {
  format(value: number, currency: string, options?: Intl.NumberFormatOptions): string;
  formatCompact(value: number, currency: string): string;
}

/**
 * 通用货币格式化器
 * 支持通过构造函数传入 locale，避免硬编码
 */
export class LocalizedCurrencyFormatter implements CurrencyFormatter {
  private locale: string;
  
  constructor(locale: string = 'zh-CN') {
    this.locale = locale;
  }
  
  format(value: number, currency: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      ...options,
    }).format(value);
  }

  formatCompact(value: number, currency: string): string {
    return new Intl.NumberFormat(this.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      notation: 'compact',
    }).format(value);
  }
}

/**
 * 中文货币格式化器
 * @deprecated 使用 LocalizedCurrencyFormatter 代替
 */
export class IntlCurrencyFormatter implements CurrencyFormatter {
  private formatter: LocalizedCurrencyFormatter;
  
  constructor() {
    this.formatter = new LocalizedCurrencyFormatter('zh-CN');
  }
  
  format(value: number, currency: string, options?: Intl.NumberFormatOptions): string {
    return this.formatter.format(value, currency, options);
  }

  formatCompact(value: number, currency: string): string {
    return this.formatter.formatCompact(value, currency);
  }
}

/**
 * 英文货币格式化器
 * @deprecated 使用 LocalizedCurrencyFormatter 代替
 */
export class EnglishCurrencyFormatter implements CurrencyFormatter {
  private formatter: LocalizedCurrencyFormatter;
  
  constructor() {
    this.formatter = new LocalizedCurrencyFormatter('en-US');
  }
  
  format(value: number, currency: string, options?: Intl.NumberFormatOptions): string {
    return this.formatter.format(value, currency, options);
  }

  formatCompact(value: number, currency: string): string {
    return this.formatter.formatCompact(value, currency);
  }
}

/**
 * 百分比格式化
 */
export const formatPercentage = (value: number, decimals: number = 1): string => {
  return `${(value * 100).toFixed(decimals)}%`;
};

/**
 * 数字格式化
 */
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string => {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
};

/**
 * 根据语言获取相应的格式化器
 * 使用 LocalizedCurrencyFormatter 支持更多语言
 */
export const getCurrencyFormatter = (language: string): CurrencyFormatter => {
  // 语言到 locale 的映射
  const localeMap: Record<string, string> = {
    'English': 'en-US',
    '中文': 'zh-CN',
    'Chinese': 'zh-CN',
    '日本語': 'ja-JP',
    'Japanese': 'ja-JP',
    'Deutsch': 'de-DE',
    'German': 'de-DE',
    'Français': 'fr-FR',
    'French': 'fr-FR',
    'Español': 'es-ES',
    'Spanish': 'es-ES',
  };
  
  const locale = localeMap[language] || (language === 'English' ? 'en-US' : 'zh-CN');
  return new LocalizedCurrencyFormatter(locale);
};

/**
 * 格式化货币值，自动选择格式化器
 */
export const formatCurrency = (
  value: number,
  currency: string,
  language: string = '中文'
): string => {
  const formatter = getCurrencyFormatter(language);
  return formatter.format(value, currency);
};

/**
 * 格式化紧凑货币值（用于大数字）
 */
export const formatCurrencyCompact = (
  value: number,
  currency: string,
  language: string = '中文'
): string => {
  const formatter = getCurrencyFormatter(language);
  return formatter.formatCompact(value, currency);
};
