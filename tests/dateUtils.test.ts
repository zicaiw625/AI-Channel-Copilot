import { describe, it, expect } from "vitest";
import { startOfDay, endOfDay, getWeekStart, getMonthStart } from "../app/lib/dateUtils";

/**
 * 时区日期计算测试
 * 
 * 验证 startOfDay/endOfDay 返回的 UTC 时间点，转回本地时间后应该是 00:00:00 / 23:59:59
 */
describe("dateUtils timezone handling", () => {
  const testDate = new Date("2024-12-16T10:00:00Z");
  
  const formatLocalTime = (date: Date, timeZone: string) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      // 使用 fractionalSecondDigits 来避免四舍五入问题
    }).format(new Date(Math.floor(date.getTime() / 1000) * 1000)); // 截断毫秒
  };

  const formatLocalDate = (date: Date, timeZone: string) => {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };

  describe("startOfDay", () => {
    it("should return 00:00:00 in UTC timezone", () => {
      const result = startOfDay(testDate, "UTC");
      expect(formatLocalTime(result, "UTC")).toBe("00:00:00");
      expect(formatLocalDate(result, "UTC")).toBe("2024-12-16");
    });

    it("should return 00:00:00 in Asia/Shanghai timezone", () => {
      const result = startOfDay(testDate, "Asia/Shanghai");
      // testDate 是 UTC 10:00，上海是 UTC+8，所以上海本地时间是 18:00
      // startOfDay 应该返回上海 2024-12-16 00:00:00，即 UTC 2024-12-15T16:00:00Z
      expect(formatLocalTime(result, "Asia/Shanghai")).toBe("00:00:00");
      expect(formatLocalDate(result, "Asia/Shanghai")).toBe("2024-12-16");
      expect(result.toISOString()).toBe("2024-12-15T16:00:00.000Z");
    });

    it("should return 00:00:00 in America/Chicago timezone", () => {
      const result = startOfDay(testDate, "America/Chicago");
      // testDate 是 UTC 10:00，芝加哥是 UTC-6，所以芝加哥本地时间是 04:00
      // startOfDay 应该返回芝加哥 2024-12-16 00:00:00，即 UTC 2024-12-16T06:00:00Z
      expect(formatLocalTime(result, "America/Chicago")).toBe("00:00:00");
      expect(formatLocalDate(result, "America/Chicago")).toBe("2024-12-16");
      expect(result.toISOString()).toBe("2024-12-16T06:00:00.000Z");
    });

    it("should return 00:00:00 in America/Los_Angeles timezone", () => {
      const result = startOfDay(testDate, "America/Los_Angeles");
      // testDate 是 UTC 10:00，洛杉矶是 UTC-8，所以洛杉矶本地时间是 02:00
      // startOfDay 应该返回洛杉矶 2024-12-16 00:00:00，即 UTC 2024-12-16T08:00:00Z
      expect(formatLocalTime(result, "America/Los_Angeles")).toBe("00:00:00");
      expect(formatLocalDate(result, "America/Los_Angeles")).toBe("2024-12-16");
      expect(result.toISOString()).toBe("2024-12-16T08:00:00.000Z");
    });
  });

  describe("endOfDay", () => {
    it("should return 23:59:59 in UTC timezone", () => {
      const result = endOfDay(testDate, "UTC");
      expect(formatLocalTime(result, "UTC")).toBe("23:59:59");
      expect(formatLocalDate(result, "UTC")).toBe("2024-12-16");
    });

    it("should return 23:59:59 in Asia/Shanghai timezone", () => {
      const result = endOfDay(testDate, "Asia/Shanghai");
      // endOfDay 应该返回上海 2024-12-16 23:59:59.999，即 UTC 2024-12-16T15:59:59.999Z
      expect(formatLocalTime(result, "Asia/Shanghai")).toBe("23:59:59");
      expect(formatLocalDate(result, "Asia/Shanghai")).toBe("2024-12-16");
      expect(result.toISOString()).toBe("2024-12-16T15:59:59.999Z");
    });

    it("should return 23:59:59 in America/Chicago timezone", () => {
      const result = endOfDay(testDate, "America/Chicago");
      // endOfDay 应该返回芝加哥 2024-12-16 23:59:59.999，即 UTC 2024-12-17T05:59:59.999Z
      expect(formatLocalTime(result, "America/Chicago")).toBe("23:59:59");
      expect(formatLocalDate(result, "America/Chicago")).toBe("2024-12-16");
      expect(result.toISOString()).toBe("2024-12-17T05:59:59.999Z");
    });

    it("should return 23:59:59 in America/Los_Angeles timezone", () => {
      const result = endOfDay(testDate, "America/Los_Angeles");
      // endOfDay 应该返回洛杉矶 2024-12-16 23:59:59.999，即 UTC 2024-12-17T07:59:59.999Z
      expect(formatLocalTime(result, "America/Los_Angeles")).toBe("23:59:59");
      expect(formatLocalDate(result, "America/Los_Angeles")).toBe("2024-12-16");
      expect(result.toISOString()).toBe("2024-12-17T07:59:59.999Z");
    });
  });

  describe("date range coverage", () => {
    it("should correctly cover full day for Asia/Shanghai timezone", () => {
      const start = startOfDay(testDate, "Asia/Shanghai");
      const end = endOfDay(testDate, "Asia/Shanghai");
      
      // 上海时间 2024-12-16 的早上订单（如 01:00）
      const earlyOrder = new Date("2024-12-15T17:00:00Z"); // 上海 01:00
      // 上海时间 2024-12-16 的晚上订单（如 23:00）
      const lateOrder = new Date("2024-12-16T15:00:00Z"); // 上海 23:00
      
      expect(earlyOrder >= start && earlyOrder <= end).toBe(true);
      expect(lateOrder >= start && lateOrder <= end).toBe(true);
    });

    it("should correctly cover full day for America/Chicago timezone", () => {
      const start = startOfDay(testDate, "America/Chicago");
      const end = endOfDay(testDate, "America/Chicago");
      
      // 芝加哥时间 2024-12-16 的早上订单（如 01:00）
      const earlyOrder = new Date("2024-12-16T07:00:00Z"); // 芝加哥 01:00
      // 芝加哥时间 2024-12-16 的晚上订单（如 23:00）
      const lateOrder = new Date("2024-12-17T05:00:00Z"); // 芝加哥 23:00
      
      expect(earlyOrder >= start && earlyOrder <= end).toBe(true);
      expect(lateOrder >= start && lateOrder <= end).toBe(true);
    });
  });

  describe("getWeekStart", () => {
    it("should return Monday 00:00:00 for Asia/Shanghai", () => {
      // 2024-12-16 是周一
      const result = getWeekStart(testDate, "Asia/Shanghai");
      expect(formatLocalDate(result, "Asia/Shanghai")).toBe("2024-12-16");
      expect(formatLocalTime(result, "Asia/Shanghai")).toBe("00:00:00");
    });

    it("should return Monday 00:00:00 for a Wednesday", () => {
      const wednesday = new Date("2024-12-18T10:00:00Z"); // 周三
      const result = getWeekStart(wednesday, "Asia/Shanghai");
      expect(formatLocalDate(result, "Asia/Shanghai")).toBe("2024-12-16"); // 周一
      expect(formatLocalTime(result, "Asia/Shanghai")).toBe("00:00:00");
    });
  });

  describe("getMonthStart", () => {
    it("should return 1st of month 00:00:00 for Asia/Shanghai", () => {
      const result = getMonthStart(testDate, "Asia/Shanghai");
      expect(formatLocalDate(result, "Asia/Shanghai")).toBe("2024-12-01");
      expect(formatLocalTime(result, "Asia/Shanghai")).toBe("00:00:00");
    });

    it("should return 1st of month 00:00:00 for America/Chicago", () => {
      const result = getMonthStart(testDate, "America/Chicago");
      expect(formatLocalDate(result, "America/Chicago")).toBe("2024-12-01");
      expect(formatLocalTime(result, "America/Chicago")).toBe("00:00:00");
    });
  });
});

