/**
 * 日期时间处理工具函数
 * 提取自多个文件中的重复代码
 * 
 * 【重要】时区处理说明：
 * - startOfDay/endOfDay 返回的是 UTC 时间点，表示目标时区当天的开始/结束
 * - 例如：Asia/Shanghai 的 2024-01-15 00:00:00 对应 UTC 2024-01-14T16:00:00Z
 * - 这样可以正确用于 DB 查询（createdAt >= start && createdAt <= end）
 */

// ============================================================================
// 内部辅助函数：时区计算核心
// ============================================================================

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** DateTimeFormat 实例缓存，避免重复创建 */
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

/** 获取给定 UTC 时间在目标时区的日期部分 */
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
 */
const getTimeZoneOffsetMs = (timeZone: string, date: Date): number => {
  const p = getParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - date.getTime();
};

/**
 * 将"某时区的本地时间"转换成真正的 UTC Date
 * 使用两次校正处理 DST 边界情况
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
  // 第一次猜测：把本地时间当作 UTC
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
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  let utc = new Date(utcGuess.getTime() - offset);

  // 第二次校正（处理 DST 边界）
  const offset2 = getTimeZoneOffsetMs(timeZone, utc);
  if (offset2 !== offset) {
    utc = new Date(utcGuess.getTime() - offset2);
  }

  return utc;
};

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 将日期转换为指定时区的日期对象（用于显示/存储本地时间）
 * 注意：返回的 Date 对象的 UTC 值实际上是目标时区的"挂钟时间"
 * 主要用于 createdAtLocal 等存储字段
 */
export const toZonedDate = (date: Date, timeZone?: string): Date => {
  if (!timeZone) return new Date(date);
  const p = getParts(date, timeZone);
  return new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  );
};

/**
 * 获取日期的开始时间（目标时区的 00:00:00.000 对应的 UTC 时间点）
 * 
 * 例如：Asia/Shanghai 时区的 2024-01-15 00:00:00 → UTC 2024-01-14T16:00:00.000Z
 * 例如：America/Chicago 时区的 2024-01-15 00:00:00 → UTC 2024-01-15T06:00:00.000Z
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
 * 获取日期的结束时间（目标时区的 23:59:59.999 对应的 UTC 时间点）
 * 
 * 例如：Asia/Shanghai 时区的 2024-01-15 23:59:59.999 → UTC 2024-01-15T15:59:59.999Z
 * 例如：America/Chicago 时区的 2024-01-15 23:59:59.999 → UTC 2024-01-16T05:59:59.999Z
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
 * 返回目标时区该周周一 00:00:00 对应的 UTC 时间点
 */
export const getWeekStart = (date: Date, timeZone?: string): Date => {
  // 先获取目标时区的日期部分
  const p = timeZone ? getParts(date, timeZone) : null;
  
  if (!timeZone || !p) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diff = (day + 6) % 7;
    start.setDate(start.getDate() - diff);
    return start;
  }
  
  // 计算在目标时区中是星期几（0=Sunday, 1=Monday, ...）
  // 使用本地日期创建临时 Date 来获取星期几
  const tempDate = new Date(p.year, p.month - 1, p.day);
  const dayOfWeek = tempDate.getDay();
  const diff = (dayOfWeek + 6) % 7; // 转换为周一=0
  
  // 计算周一的日期
  const mondayDate = new Date(p.year, p.month - 1, p.day - diff);
  
  return zonedTimeToUtc(
    {
      year: mondayDate.getFullYear(),
      month: mondayDate.getMonth() + 1,
      day: mondayDate.getDate(),
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
 * 返回目标时区该月1号 00:00:00 对应的 UTC 时间点
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
