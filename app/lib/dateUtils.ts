/**
 * 日期时间处理工具函数
 * 提取自多个文件中的重复代码
 *
 * 核心修复：正确处理时区转换，确保"某时区的本地时间"能正确转换为 UTC
 */

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// 缓存 DateTimeFormat 实例以提升性能
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
 * 从 Date 对象中提取指定时区的本地时间各部分
 */
const getParts = (date: Date, timeZone: string): DateParts => {
  const parts = getDtf(timeZone).formatToParts(date);
  const pick = (t: string) =>
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
 * 注意：为了避免毫秒误差，使用整秒级别的时间戳进行比较
 */
const getTimeZoneOffsetMs = (timeZone: string, date: Date): number => {
  const p = getParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // 使用整秒级别的时间戳比较，避免毫秒部分导致的偏移计算误差
  const dateSecondsOnly = Math.floor(date.getTime() / 1000) * 1000;
  return asUTC - dateSecondsOnly;
};

/**
 * 将"某时区的本地时间"转换成真正的 UTC Date
 * 核心函数：正确处理时区转换，包括 DST 边界情况
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
  timeZone: string
): Date => {
  // 先假设本地时间就是 UTC，得到一个初始猜测
  const utcGuess = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      local.ms ?? 0
    )
  );

  // 一次校正：根据猜测时间点的时区偏移量修正
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = new Date(utcGuess.getTime() - offset);

  // 二次校正：处理 DST 边界情况
  // 因为 DST 切换时，同一个本地时间可能对应不同的 UTC 时间
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset) {
    utc = new Date(utcGuess.getTime() - offset2);
  }
  return utc;
};

/**
 * 将日期转换为指定时区的日期对象
 * 注意：返回的 Date 对象的 UTC 时间值表示的是该时区的本地时间
 * @deprecated 建议使用 startOfDay/endOfDay 进行时区感知的日期操作
 */
export const toZonedDate = (date: Date, timeZone?: string): Date => {
  if (!timeZone) return new Date(date);

  const p = getParts(date, timeZone);
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  );
};

/**
 * 获取日期的开始时间（00:00:00.000）
 * 返回的是该时区当天 00:00:00 对应的真实 UTC 时间点
 *
 * @param date - 输入日期
 * @param timeZone - IANA 时区标识符（如 'Asia/Shanghai', 'America/Los_Angeles'）
 * @returns UTC Date 对象，表示该时区当天 00:00:00 的精确时刻
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
    timeZone
  );
};

/**
 * 获取日期的结束时间（23:59:59.999）
 * 返回的是该时区当天 23:59:59.999 对应的真实 UTC 时间点
 *
 * @param date - 输入日期
 * @param timeZone - IANA 时区标识符（如 'Asia/Shanghai', 'America/Los_Angeles'）
 * @returns UTC Date 对象，表示该时区当天 23:59:59.999 的精确时刻
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
    timeZone
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
 * 返回的是该时区当周周一 00:00:00 对应的真实 UTC 时间点
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
  // 先得到该时区当天的 00:00:00 UTC 时间
  const dayStart = zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone
  );
  // 获取该时区当天是星期几
  const dayOfWeek = getParts(dayStart, timeZone);
  const localDate = new Date(Date.UTC(dayOfWeek.year, dayOfWeek.month - 1, dayOfWeek.day));
  const day = localDate.getUTCDay();
  const diff = (day + 6) % 7; // 周一为 0

  // 回退到周一
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day - diff, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone
  );
};

/**
 * 获取月初日期（用于月趋势分析）
 * 返回的是该时区当月1日 00:00:00 对应的真实 UTC 时间点
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
    timeZone
  );
};
