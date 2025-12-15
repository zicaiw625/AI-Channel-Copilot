/**
 * 日期时间处理工具函数
 * 提取自多个文件中的重复代码
 * 
 * 【重要】时区处理说明：
 * - startOfDay/endOfDay 返回的是「该时区当天 00:00:00 / 23:59:59 对应的 UTC 时间点」
 * - 例如：Asia/Shanghai 的 2024-01-15 00:00:00 = UTC 2024-01-14T16:00:00Z
 * - 这样在 DB 查询（createdAt >= start AND createdAt <= end）时才能正确覆盖整天
 */

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// DateTimeFormat 缓存，避免重复创建
const dtfCache = new Map<string, Intl.DateTimeFormat>();

const getDtf = (timeZone: string): Intl.DateTimeFormat => {
  const cached = dtfCache.get(timeZone);
  if (cached) return cached;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  dtfCache.set(timeZone, dtf);
  return dtf;
};

/**
 * 从 Date 对象提取指定时区的本地时间各部分
 */
const getParts = (date: Date, timeZone: string): DateParts => {
  const parts = getDtf(timeZone).formatToParts(date);
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
};

/**
 * 计算时区偏移量（毫秒）
 * offsetMs = (wall-clock interpreted as UTC) - (real UTC millis)
 */
const getTimeZoneOffsetMs = (timeZone: string, date: Date): number => {
  const p = getParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
};

/**
 * 将「某时区的本地时间」转换成真正的 UTC Date
 * 使用两次校正来正确处理 DST 边界
 */
const zonedTimeToUtc = (
  local: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    ms?: number;
  },
  timeZone: string,
): Date => {
  // 先把本地时间当作 UTC 构建一个初始猜测
  const utcGuess = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, local.ms ?? 0),
  );

  // 一次校正
  let offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = new Date(utcGuess.getTime() - offset);

  // 二次校正（处理 DST 边界情况）
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset) {
    utc = new Date(utcGuess.getTime() - offset2);
  }

  return utc;
};

/**
 * 将日期转换为指定时区的日期对象（仅用于提取年月日时分秒显示）
 * 注意：返回的 Date 对象的 UTC 时间等于原时区的本地时间数值，
 *       仅用于 formatDateOnly 等显示场景，不要用于日期范围计算！
 */
export const toZonedDate = (date: Date, timeZone?: string): Date => {
  if (!timeZone) return new Date(date);
  const p = getParts(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
};

/**
 * 获取日期的开始时间（该时区当天 00:00:00.000 对应的 UTC 时间点）
 */
export const startOfDay = (date: Date, timeZone?: string): Date => {
  if (!timeZone) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const p = getParts(date, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
};

/**
 * 获取日期的结束时间（该时区当天 23:59:59.999 对应的 UTC 时间点）
 */
export const endOfDay = (date: Date, timeZone?: string): Date => {
  if (!timeZone) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  }
  const p = getParts(date, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 23, minute: 59, second: 59, ms: 999 },
    timeZone,
  );
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
  if (!timeZone) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = (day + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d;
  }
  const p = getParts(date, timeZone);
  // 先获取当天的 00:00:00
  const dayStart = zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
  // 计算是周几（在目标时区）
  const dayOfWeek = new Date(
    Date.UTC(p.year, p.month - 1, p.day),
  ).getUTCDay();
  const diff = (dayOfWeek + 6) % 7; // 周一 = 0, 周日 = 6
  // 回退到周一
  const mondayParts = getParts(new Date(dayStart.getTime() - diff * 86_400_000), timeZone);
  return zonedTimeToUtc(
    { year: mondayParts.year, month: mondayParts.month, day: mondayParts.day, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
};

/**
 * 获取月初日期（用于月趋势分析）
 */
export const getMonthStart = (date: Date, timeZone?: string): Date => {
  if (!timeZone) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
  }
  const p = getParts(date, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
};
