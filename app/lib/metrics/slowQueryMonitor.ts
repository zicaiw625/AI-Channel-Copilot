/**
 * 数据库慢查询监控
 * 
 * 功能:
 * - 自动检测并记录慢查询
 * - 提供详细的慢查询报告
 * - 支持配置告警阈值
 * - 周期性清理旧数据
 */

import { logger } from "../logger.server";
import { metrics, MetricNames, recordDbMetrics } from "./collector";

// ============================================================================
// Types
// ============================================================================

export interface SlowQueryRecord {
  id: string;
  query: string;
  model: string;
  operation: string;
  durationMs: number;
  timestamp: Date;
  shopDomain?: string;
  metadata?: Record<string, unknown>;
}

export interface SlowQueryConfig {
  /** 慢查询阈值 (毫秒) - 超过此时间将被记录 */
  slowThresholdMs: number;
  /** 严重慢查询阈值 (毫秒) - 超过此时间将触发告警 */
  criticalThresholdMs: number;
  /** 最大保留记录数 */
  maxRecords: number;
  /** 是否启用详细日志 */
  verbose: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: SlowQueryConfig = {
  slowThresholdMs: parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "500", 10),
  criticalThresholdMs: parseInt(process.env.CRITICAL_QUERY_THRESHOLD_MS || "3000", 10),
  maxRecords: parseInt(process.env.SLOW_QUERY_MAX_RECORDS || "1000", 10),
  verbose: process.env.SLOW_QUERY_VERBOSE === "true",
};

// ============================================================================
// Slow Query Monitor
// ============================================================================

class SlowQueryMonitor {
  private static instance: SlowQueryMonitor;
  private records: SlowQueryRecord[] = [];
  private config: SlowQueryConfig;
  private idCounter = 0;

  private constructor(config: Partial<SlowQueryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(): SlowQueryMonitor {
    if (!SlowQueryMonitor.instance) {
      SlowQueryMonitor.instance = new SlowQueryMonitor();
    }
    return SlowQueryMonitor.instance;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SlowQueryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 记录查询并检查是否为慢查询
   */
  recordQuery(
    operation: string,
    model: string,
    durationMs: number,
    options?: {
      query?: string;
      shopDomain?: string;
      metadata?: Record<string, unknown>;
    }
  ): void {
    // 记录到指标系统
    recordDbMetrics(operation, model, durationMs, true);

    // 检查是否超过阈值
    if (durationMs < this.config.slowThresholdMs) {
      return; // 快速查询，无需记录
    }

    const record: SlowQueryRecord = {
      id: `sq_${++this.idCounter}_${Date.now()}`,
      query: options?.query || `${operation} on ${model}`,
      model,
      operation,
      durationMs,
      timestamp: new Date(),
      shopDomain: options?.shopDomain,
      metadata: options?.metadata,
    };

    // 添加记录
    this.records.push(record);

    // 限制记录数量
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }

    // 记录慢查询指标
    metrics.increment("db.slow_query", 1, { operation, model });
    metrics.histogram("db.slow_query_duration", durationMs, { operation, model });

    // 日志记录
    const logLevel = durationMs >= this.config.criticalThresholdMs ? "error" : "warn";
    const isCritical = durationMs >= this.config.criticalThresholdMs;

    if (isCritical) {
      metrics.increment("db.critical_slow_query", 1, { operation, model });
    }

    logger[logLevel]("[SlowQuery] Slow database query detected", {
      id: record.id,
      operation,
      model,
      durationMs,
      isCritical,
      shopDomain: options?.shopDomain,
      threshold: this.config.slowThresholdMs,
      criticalThreshold: this.config.criticalThresholdMs,
    });

    // 详细日志（可选）
    if (this.config.verbose && options?.query) {
      logger.debug("[SlowQuery] Query details", {
        id: record.id,
        query: this.sanitizeQuery(options.query),
        metadata: options.metadata,
      });
    }
  }

  /**
   * 记录查询错误
   */
  recordQueryError(
    operation: string,
    model: string,
    durationMs: number,
    error: Error,
    options?: {
      query?: string;
      shopDomain?: string;
    }
  ): void {
    recordDbMetrics(operation, model, durationMs, false);
    metrics.increment("db.query_error", 1, { operation, model });

    logger.error("[SlowQuery] Database query failed", {
      operation,
      model,
      durationMs,
      error: error.message,
      shopDomain: options?.shopDomain,
    });
  }

  /**
   * 获取慢查询报告
   */
  getReport(options?: {
    since?: Date;
    limit?: number;
    model?: string;
    operation?: string;
  }): {
    total: number;
    critical: number;
    records: SlowQueryRecord[];
    stats: {
      avgDurationMs: number;
      maxDurationMs: number;
      byModel: Record<string, number>;
      byOperation: Record<string, number>;
    };
  } {
    let filtered = [...this.records];

    // 过滤条件
    if (options?.since) {
      filtered = filtered.filter((r) => r.timestamp >= options.since!);
    }
    if (options?.model) {
      filtered = filtered.filter((r) => r.model === options.model);
    }
    if (options?.operation) {
      filtered = filtered.filter((r) => r.operation === options.operation);
    }

    // 限制数量
    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    // 统计
    const durations = filtered.map((r) => r.durationMs);
    const byModel: Record<string, number> = {};
    const byOperation: Record<string, number> = {};

    filtered.forEach((r) => {
      byModel[r.model] = (byModel[r.model] || 0) + 1;
      byOperation[r.operation] = (byOperation[r.operation] || 0) + 1;
    });

    return {
      total: filtered.length,
      critical: filtered.filter((r) => r.durationMs >= this.config.criticalThresholdMs).length,
      records: filtered,
      stats: {
        avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
        byModel,
        byOperation,
      },
    };
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.records = [];
  }

  /**
   * 清除指定时间之前的记录
   */
  clearBefore(date: Date): number {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.timestamp >= date);
    return before - this.records.length;
  }

  /**
   * 清理敏感信息
   */
  private sanitizeQuery(query: string): string {
    // 移除可能的敏感信息（简单实现）
    return query
      .replace(/=\s*'[^']*'/g, "='***'")
      .replace(/=\s*"[^"]*"/g, '="***"')
      .slice(0, 500); // 截断过长的查询
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 包装数据库操作并自动记录性能
 */
export async function withQueryMonitoring<T>(
  operation: string,
  model: string,
  queryFn: () => Promise<T>,
  options?: {
    query?: string;
    shopDomain?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<T> {
  const monitor = SlowQueryMonitor.getInstance();
  const startTime = Date.now();

  try {
    const result = await queryFn();
    const durationMs = Date.now() - startTime;
    monitor.recordQuery(operation, model, durationMs, options);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    monitor.recordQueryError(operation, model, durationMs, error as Error, options);
    throw error;
  }
}

/**
 * 创建计时器用于手动记录
 */
export function createQueryTimer(
  operation: string,
  model: string,
  options?: {
    query?: string;
    shopDomain?: string;
    metadata?: Record<string, unknown>;
  }
): () => void {
  const startTime = Date.now();

  return () => {
    const durationMs = Date.now() - startTime;
    SlowQueryMonitor.getInstance().recordQuery(operation, model, durationMs, options);
  };
}

// ============================================================================
// Exports
// ============================================================================

export const slowQueryMonitor = SlowQueryMonitor.getInstance();

export { SlowQueryMonitor };
