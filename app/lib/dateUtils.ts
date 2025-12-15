/**
 * 日期时间处理工具函数
 * 提取自多个文件中的重复代码
 * 
 * 【重要】时区处理说明：
 * - startOfDay/endOfDay 返回的是"店铺时区当天 00:00:00 / 23:59:59 对应的真实 UTC 时间点"
 * - 这样 DB 查询 createdAt >= start && createdAt <= end 才能正确覆盖完整的一天
 * - toZonedDate 仅用于显示目的，返回的是"假 UTC"（用于 createdAtLocal 字段）
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
 * 计算时区偏移（毫秒）
 * offsetMs = (wall-clock interpreted as UTC) - (real UTC millis)
 * 
 * 注意：只精确到秒级，因为 Intl.DateTimeFormat 不提供毫秒信息
 */
const getTimeZoneOffsetMs = (timeZone: string, date: Date): number => {
  // 截断毫秒，确保计算一致性
  const truncatedMs = Math.floor(date.getTime() / 1000) * 1000;
  const truncatedDate = new Date(truncatedMs);
  const p = getParts(truncatedDate, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - truncatedMs;
};

/**
 * 将"某时区的本地时间"转换成真正的 UTC Date
 * 使用二次校正来处理 DST（夏令时）边界
 */
const zonedTimeToUtc = (
  local: { year: number; month: number; day: number; hour: number; minute: number; second: number; ms?: number },
  timeZone: string,
): Date => {
  // 先计算到秒级的 UTC 时间
  const utcGuessNoMs = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, 0),
  );

  // 一次校正
  let offset = getTimeZoneOffsetMs(timeZone, utcGuessNoMs);
  let utc = new Date(utcGuessNoMs.getTime() - offset);

  // 二次校正（处理 DST 边界情况）
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset) {
    utc = new Date(utcGuessNoMs.getTime() - offset2);
  }

  // 最后加上毫秒
  if (local.ms) {
    utc = new Date(utc.getTime() + local.ms);
  }

  return utc;
};

/**
 * 将日期转换为指定时区的日期对象（用于显示目的）
 * 
 * 【注意】此函数返回的是"假 UTC"：
 * - 把时区本地时间的数值直接放到 UTC Date 中
 * - 仅用于 createdAtLocal 等显示字段，不能用于日期范围计算
 */
export const toZonedDate = (date: Date, timeZone?: string): Date => {
  if (!timeZone) return new Date(date);
  const p = getParts(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
};

/**
 * 获取日期的开始时间（00:00:00.000）
 * 
 * 返回的是"店铺时区当天 00:00:00 对应的真实 UTC 时间点"
 * 例如：Asia/Shanghai 的 2024-01-15 00:00:00 → UTC 2024-01-14T16:00:00Z
 */
export const startOfDay = (date: Date, timeZone?: string): Date => {
  if (!timeZone) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const p = getParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0, ms: 0 }, timeZone);
};

/**
 * 获取日期的结束时间（23:59:59.999）
 * 
 * 返回的是"店铺时区当天 23:59:59.999 对应的真实 UTC 时间点"
 * 例如：Asia/Shanghai 的 2024-01-15 23:59:59 → UTC 2024-01-15T15:59:59Z
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
 * 返回的是"店铺时区该周一 00:00:00 对应的真实 UTC 时间点"
 */
export const getWeekStart = (date: Date, timeZone?: string): Date => {
  const p = timeZone ? getParts(date, timeZone) : null;
  if (!timeZone || !p) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = (day + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d;
  }

  // 在时区本地日期上计算周一
  const localDate = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = localDate.getUTCDay();
  const diff = (day + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - diff);

  return zonedTimeToUtc(
    {
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
      ms: 0,
    },
    timeZone,
  );
};

/**
 * 获取月初日期（用于月趋势分析）
 * 返回的是"店铺时区该月1日 00:00:00 对应的真实 UTC 时间点"
 */
export const getMonthStart = (date: Date, timeZone?: string): Date => {
  const p = timeZone ? getParts(date, timeZone) : null;
  if (!timeZone || !p) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
  }

  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
};
