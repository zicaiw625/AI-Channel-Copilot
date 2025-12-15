/**
 * 日期时间处理工具函数
 * 提取自多个文件中的重复代码
 * 
 * 【重要修复】2024-12 修复时区边界计算问题
 * 原实现把"目标时区的本地时间"误当作"UTC时间"，导致：
 * - UTC-X 时区（如美洲）：endOfDay 提前结束，漏掉当天晚上的订单
 * - UTC+X 时区（如亚洲）：startOfDay 延迟开始，漏掉当天凌晨的订单
 * 
 * 新实现正确计算"某时区本地时间 00:00:00 / 23:59:59" 对应的真实 UTC 时间点
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
 * 获取指定时区下日期的各个部分（年月日时分秒）
 */
const getParts = (date: Date, timeZone: string): DateParts => {
  const parts = getDtf(timeZone).formatToParts(date);
  const pick = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
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
 * 注意：只计算到秒级精度，避免毫秒导致的舍入误差
 */
const getTimeZoneOffsetMs = (timeZone: string, date: Date): number => {
  const p = getParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // 截断 date 的毫秒部分，确保比较精度一致
  const dateMs = Math.floor(date.getTime() / 1000) * 1000;
  return asUTC - dateMs;
};

/**
 * 将"某时区的本地时间"转换成真正的 UTC Date
 * 使用两次校正处理 DST 边界
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
  // 第一次猜测：把本地时间当作 UTC 时间
  const utcGuess = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      local.ms ?? 0,
    ),
  );

  // 第一次校正
  let offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = new Date(utcGuess.getTime() - offset);

  // 第二次校正（处理 DST 边界情况）
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset) {
    utc = new Date(utcGuess.getTime() - offset2);
  }

  return utc;
};

/**
 * 将日期转换为指定时区的日期对象
 * 注意：这个函数返回的 Date 对象的 UTC 值代表的是目标时区的"墙钟时间"
 * 主要用于格式化显示，不应用于时间范围计算
 */
export const toZonedDate = (date: Date, timeZone?: string): Date => {
  if (!timeZone) return new Date(date);

  const p = getParts(date, timeZone);
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  );
};

/**
 * 获取日期的开始时间（00:00:00.000）
 * 返回的是该时区当天 00:00:00 对应的真实 UTC 时间点
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
 * 获取日期的结束时间（23:59:59.999）
 * 返回的是该时区当天 23:59:59.999 对应的真实 UTC 时间点
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
  const start = startOfDay(date, timeZone);
  // 获取该时区下的星期几
  const p = timeZone ? getParts(start, timeZone) : null;
  const dayOfWeek = p
    ? new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
    : start.getDay();
  const diff = (dayOfWeek + 6) % 7;
  // 回退到周一
  if (timeZone) {
    return zonedTimeToUtc(
      {
        year: p!.year,
        month: p!.month,
        day: p!.day - diff,
        hour: 0,
        minute: 0,
        second: 0,
        ms: 0,
      },
      timeZone,
    );
  } else {
    start.setDate(start.getDate() - diff);
    return start;
  }
};

/**
 * 获取月初日期（用于月趋势分析）
 */
export const getMonthStart = (date: Date, timeZone?: string): Date => {
  if (!timeZone) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
    return start;
  }
  const p = getParts(date, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
};
