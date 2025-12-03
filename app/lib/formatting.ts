/**
 * 格式化工具类 - 处理货币、数字、日期等格式化逻辑
 */

export interface CurrencyFormatter {
  format(value: number, currency: string, options?: Intl.NumberFormatOptions): string;
  formatCompact(value: number, currency: string): string;
}

export class IntlCurrencyFormatter implements CurrencyFormatter {
  format(value: number, currency: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      ...options,
    }).format(value);
  }

  formatCompact(value: number, currency: string): string {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      notation: 'compact',
    }).format(value);
  }
}

export class EnglishCurrencyFormatter implements CurrencyFormatter {
  format(value: number, currency: string, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      ...options,
    }).format(value);
  }

  formatCompact(value: number, currency: string): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      notation: 'compact',
    }).format(value);
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
 */
export const getCurrencyFormatter = (language: string): CurrencyFormatter => {
  return language === 'English' ? new EnglishCurrencyFormatter() : new IntlCurrencyFormatter();
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
