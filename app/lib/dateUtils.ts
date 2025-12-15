/**
 * 日期时间处理工具函数
 * 
 * 【重要】时区处理说明：
 * - startOfDay/endOfDay 返回的是"某时区当天 00:00:00 / 23:59:59.999 对应的 UTC 时间点"
 * - 例如：Asia/Shanghai 的 2024-01-15 00:00:00 对应 UTC 2024-01-14T16:00:00Z
 * - 这确保了按时间范围过滤订单时，日期边界与店铺时区一致
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

/**
 * 获取或创建指定时区的 DateTimeFormat
 */
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
 * 从 Date 对象中提取指定时区的日期部分
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
 * 计算指定时区相对于 UTC 的偏移量（毫秒）
 * offsetMs = (wall-clock interpreted as UTC) - (real UTC millis)
 */
const getTimeZoneOffsetMs = (timeZone: string, date: Date): number => {
  const p = getParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
};

/**
 * 将"某时区的本地时间"转换成真正的 UTC Date
 * 使用两次校正来处理 DST 边界情况
 */
const zonedTimeToUtc = (
  local: { year: number; month: number; day: number; hour: number; minute: number; second: number; ms?: number },
  timeZone: string,
): Date => {
  const ms = local.ms ?? 0;
  
  // 首先假设这个本地时间就是 UTC，创建一个初始猜测（不含毫秒，避免偏移计算误差）
  const utcGuess = new Date(Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    0, // 先不含毫秒
  ));

  // 第一次校正：减去时区偏移
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = new Date(utcGuess.getTime() - offset);
  
  // 第二次校正：处理 DST 边界（夏令时切换时偏移量可能变化）
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset) {
    utc = new Date(utcGuess.getTime() - offset2);
  }
  
  // 最后加上毫秒
  if (ms > 0) {
    utc = new Date(utc.getTime() + ms);
  }
  
  return utc;
};

/**
 * 将日期转换为指定时区的日期对象
 * 
 * 注意：此函数返回的 Date 对象的 UTC 值代表"该时区本地时间的数值"
 * 主要用于显示和格式化，不应用于时间范围计算
 * 
 * @deprecated 建议直接使用 getParts 获取日期部分，或使用 startOfDay/endOfDay 进行范围计算
 */
export const toZonedDate = (date: Date, timeZone?: string): Date => {
  if (!timeZone) return new Date(date);
  
  const p = getParts(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
};

/**
 * 获取日期的开始时间（00:00:00.000）
 * 
 * 【关键修复】返回的是"指定时区当天 00:00:00 对应的真实 UTC 时间点"
 * 例如：Asia/Shanghai 的 2024-01-15 00:00:00 → UTC 2024-01-14T16:00:00Z
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
 * 
 * 【关键修复】返回的是"指定时区当天 23:59:59.999 对应的真实 UTC 时间点"
 * 例如：Asia/Shanghai 的 2024-01-15 23:59:59.999 → UTC 2024-01-15T15:59:59.999Z
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
 * 
 * 【修复】基于正确的时区计算周一
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
  // 计算该时区本地日期对应的星期几（0=周日, 1=周一, ...）
  const localDate = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  const dayOfWeek = localDate.getUTCDay();
  const diff = (dayOfWeek + 6) % 7; // 转换为周一=0
  
  // 计算周一的日期
  const mondayDate = new Date(localDate);
  mondayDate.setUTCDate(mondayDate.getUTCDate() - diff);
  
  // 返回周一 00:00:00 对应的 UTC 时间
  return zonedTimeToUtc(
    {
      year: mondayDate.getUTCFullYear(),
      month: mondayDate.getUTCMonth() + 1,
      day: mondayDate.getUTCDate(),
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
 * 
 * 【修复】基于正确的时区计算月初
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
