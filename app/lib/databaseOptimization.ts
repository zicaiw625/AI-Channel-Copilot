/**
 * 数据库查询优化建议和工具
 * 用于识别和解决数据库性能问题
 */

import { logger } from "./logger.server";

export interface QueryMetrics {
  query: string;
  duration: number;
  rowsAffected: number;
  timestamp: Date;
}

/**
 * 数据库查询性能监控
 */
export class QueryPerformanceMonitor {
  private metrics: QueryMetrics[] = [];
  private readonly maxMetrics = 1000;

  recordQuery(query: string, duration: number, rowsAffected: number = 0) {
    const metric: QueryMetrics = {
      query: query.slice(0, 500), // 限制查询字符串长度
      duration,
      rowsAffected,
      timestamp: new Date(),
    };

    this.metrics.push(metric);

    // 保持数组大小
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // 记录慢查询
    if (duration > 1000) { // 超过1秒的查询
      logger.warn("[QueryPerformance] Slow query detected", {
        duration,
        rowsAffected,
        query: metric.query.slice(0, 200),
      });
    }
  }

  getSlowQueries(thresholdMs: number = 500): QueryMetrics[] {
    return this.metrics.filter(m => m.duration > thresholdMs);
  }

  getAverageQueryTime(): number {
    if (this.metrics.length === 0) return 0;
    const total = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    return total / this.metrics.length;
  }
}

/**
 * 查询优化建议生成器
 */
export class QueryOptimizer {
  /**
   * 分析查询模式并提供优化建议
   */
  static analyzeQueryPatterns(metrics: QueryMetrics[]): string[] {
    const suggestions: string[] = [];

    const slowQueries = metrics.filter(m => m.duration > 1000);
    if (slowQueries.length > metrics.length * 0.1) {
      suggestions.push("发现大量慢查询，建议检查数据库索引");
    }

    // 检查是否有多表查询可以优化
    const multiTableQueries = metrics.filter(m =>
      m.query.includes('JOIN') || m.query.includes('join')
    );
    if (multiTableQueries.length > 0) {
      suggestions.push("检测到多表查询，建议检查外键关系和索引覆盖");
    }

    // 检查是否有大量的OFFSET查询
    const offsetQueries = metrics.filter(m =>
      m.query.includes('OFFSET') || m.query.includes('offset')
    );
    if (offsetQueries.length > metrics.length * 0.2) {
      suggestions.push("发现大量分页查询，考虑使用游标分页或优化LIMIT/OFFSET");
    }

    return suggestions;
  }

  /**
   * 检查是否需要复合索引
   */
  static suggestCompositeIndexes(): string[] {
    return [
      "考虑为 (shopDomain, createdAt) 添加复合索引以优化时间范围查询",
      "为 (shopDomain, aiSource, createdAt) 添加复合索引以优化AI来源分析",
      "为 (shopDomain, customerId) 添加索引以优化客户关联查询",
      "考虑添加部分索引以优化常用过滤条件",
    ];
  }

  /**
   * 分析N+1查询问题
   */
  static detectNPlusOneQueries(queryLogs: string[]): string[] {
    const issues: string[] = [];

    // 检查是否有多個相似的单个ID查询
    const singleIdQueries = queryLogs.filter(q =>
      q.includes('WHERE "id" =') || q.includes("WHERE `id` =")
    );

    if (singleIdQueries.length > 10) {
      issues.push("检测到大量单个ID查询，可能存在N+1查询问题");
    }

    // 检查客户查询模式
    const customerQueries = queryLogs.filter(q =>
      q.includes('customer') || q.includes('Customer')
    );

    if (customerQueries.length > queryLogs.length * 0.3) {
      issues.push("客户相关查询较多，建议使用批量查询和预加载");
    }

    return issues;
  }
}

/**
 * 数据库连接池监控
 */
export class ConnectionPoolMonitor {
  private static instance: ConnectionPoolMonitor;
  private connectionCount = 0;
  private maxConnections = 10;

  static getInstance(): ConnectionPoolMonitor {
    if (!ConnectionPoolMonitor.instance) {
      ConnectionPoolMonitor.instance = new ConnectionPoolMonitor();
    }
    return ConnectionPoolMonitor.instance;
  }

  incrementConnections() {
    this.connectionCount++;
    if (this.connectionCount > this.maxConnections * 0.8) {
      logger.warn("[ConnectionPool] High connection usage detected", {
        current: this.connectionCount,
        max: this.maxConnections,
      });
    }
  }

  decrementConnections() {
    this.connectionCount = Math.max(0, this.connectionCount - 1);
  }

  getConnectionStats() {
    return {
      current: this.connectionCount,
      max: this.maxConnections,
      utilization: this.connectionCount / this.maxConnections,
    };
  }
}

// 导出单例实例
export const queryMonitor = new QueryPerformanceMonitor();
export const connectionMonitor = ConnectionPoolMonitor.getInstance();
