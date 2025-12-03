/**
 * 日期时间处理工具函数
 * 提取自多个文件中的重复代码
 */

/**
 * 将日期转换为指定时区的日期对象
 */
export const toZonedDate = (date: Date, timeZone?: string): Date => {
  if (!timeZone) return new Date(date);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value || 0);

  return new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  );
};

/**
 * 获取日期的开始时间（00:00:00.000）
 */
export const startOfDay = (date: Date, timeZone?: string): Date => {
  const copy = toZonedDate(date, timeZone);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

/**
 * 获取日期的结束时间（23:59:59.999）
 */
export const endOfDay = (date: Date, timeZone?: string): Date => {
  const copy = toZonedDate(date, timeZone);
  copy.setUTCHours(23, 59, 59, 999);
  return copy;
};

/**
 * 格式化日期为 YYYY-MM-DD 格式
 */
export const formatDateOnly = (date: Date, timeZone?: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/**
 * 计算 N 天前的日期字符串（ISO 格式）
 */
export const daysAgo = (days: number, fromDate = Date.now()): string =>
  new Date(fromDate - days * 86_400_000).toISOString();

/**
 * 安全解析日期输入
 */
export const parseDateInput = (value?: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

/**
 * 计算两个日期之间的天数
 */
export const daysBetween = (start: Date, end: Date): number => {
  const diffMs = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffMs / 86_400_000);
};

/**
 * 获取周一日期（用于周趋势分析）
 */
export const getWeekStart = (date: Date, timeZone?: string): Date => {
  const start = startOfDay(date, timeZone);
  const day = start.getUTCDay();
  const diff = (day + 6) % 7;
  start.setUTCDate(start.getUTCDate() - diff);
  return start;
};

/**
 * 获取月初日期（用于月趋势分析）
 */
export const getMonthStart = (date: Date, timeZone?: string): Date => {
  const start = startOfDay(date, timeZone);
  start.setUTCDate(1);
  return start;
};

