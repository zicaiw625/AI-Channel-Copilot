/**
 * 指标收集系统
 * 用于应用性能监控、业务指标跟踪和异常检测
 */

import { logger } from '../logger.server';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer';

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  tags?: Record<string, string | number>;
}

export interface TimerContext {
  name: string;
  startTime: number;
  tags?: Record<string, string | number>;
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private metrics: Map<string, Metric[]>;
  private readonly maxMetricsPerKey = 1000;
  private flushInterval?: NodeJS.Timeout;
  private readonly flushIntervalMs: number;

  private constructor(flushIntervalMs = 60000) {
    this.metrics = new Map();
    this.flushIntervalMs = flushIntervalMs;
    this.startAutoFlush();
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * 记录计数器指标
   */
  increment(
    name: string,
    value = 1,
    tags?: Record<string, string | number>
  ): void {
    this.recordMetric({
      name,
      type: 'counter',
      value,
      timestamp: Date.now(),
      tags
    });
  }

  /**
   * 记录减量指标
   */
  decrement(
    name: string,
    value = 1,
    tags?: Record<string, string | number>
  ): void {
    this.increment(name, -value, tags);
  }

  /**
   * 记录瞬时值指标
   */
  gauge(
    name: string,
    value: number,
    tags?: Record<string, string | number>
  ): void {
    this.recordMetric({
      name,
      type: 'gauge',
      value,
      timestamp: Date.now(),
      tags
    });
  }

  /**
   * 记录直方图指标 (分布数据)
   */
  histogram(
    name: string,
    value: number,
    tags?: Record<string, string | number>
  ): void {
    this.recordMetric({
      name,
      type: 'histogram',
      value,
      timestamp: Date.now(),
      tags
    });
  }

  /**
   * 开始计时
   */
  startTimer(
    name: string,
    tags?: Record<string, string | number>
  ): TimerContext {
    return {
      name,
      startTime: Date.now(),
      tags
    };
  }

  /**
   * 停止计时并记录
   */
  endTimer(context: TimerContext): number {
    const duration = Date.now() - context.startTime;
    this.timing(context.name, duration, context.tags);
    return duration;
  }

  /**
   * 记录时间指标
   */
  timing(
    name: string,
    durationMs: number,
    tags?: Record<string, string | number>
  ): void {
    this.recordMetric({
      name,
      type: 'timer',
      value: durationMs,
      timestamp: Date.now(),
      tags
    });
  }

  /**
   * 装饰器：自动计时函数执行
   */
  static timed(metricName?: string, tags?: Record<string, string | number>) {
    return function (
      target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor
    ) {
      const originalMethod = descriptor.value;
      const name = metricName || `function.${propertyKey}`;

      descriptor.value = async function (...args: any[]) {
        const metrics = MetricsCollector.getInstance();
        const timer = metrics.startTimer(name, tags);

        try {
          const result = await originalMethod.apply(this, args);
          metrics.endTimer(timer);
          return result;
        } catch (error) {
          metrics.endTimer(timer);
          metrics.increment(`${name}.error`, 1, tags);
          throw error;
        }
      };

      return descriptor;
    };
  }

  /**
   * 记录指标
   */
  private recordMetric(metric: Metric): void {
    const key = this.buildKey(metric.name, metric.tags);
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const metrics = this.metrics.get(key)!;
    metrics.push(metric);

    // 防止内存溢出
    if (metrics.length > this.maxMetricsPerKey) {
      metrics.shift();
    }
  }

  /**
   * 构建指标键
   */
  private buildKey(name: string, tags?: Record<string, string | number>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name;
    }

    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');

    return `${name}{${tagString}}`;
  }

  /**
   * 获取聚合统计
   */
  getAggregated(): Record<string, any> {
    const aggregated: Record<string, any> = {};

    for (const [key, metrics] of this.metrics.entries()) {
      if (metrics.length === 0) continue;

      const values = metrics.map(m => m.value);
      const type = metrics[0].type;

      switch (type) {
        case 'counter':
          aggregated[key] = {
            type: 'counter',
            sum: values.reduce((a, b) => a + b, 0),
            count: values.length
          };
          break;

        case 'gauge':
          // Gauge 只保留最新值
          aggregated[key] = {
            type: 'gauge',
            value: values[values.length - 1]
          };
          break;

        case 'timer':
        case 'histogram':
          aggregated[key] = {
            type,
            count: values.length,
            sum: values.reduce((a, b) => a + b, 0),
            avg: values.reduce((a, b) => a + b, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            p50: this.percentile(values, 0.5),
            p95: this.percentile(values, 0.95),
            p99: this.percentile(values, 0.99)
          };
          break;
      }
    }

    return aggregated;
  }

  /**
   * 计算百分位数
   */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * 刷新指标 (发送到监控系统)
   */
  async flush(): Promise<void> {
    if (this.metrics.size === 0) {
      return;
    }

    const aggregated = this.getAggregated();
    
    try {
      // 这里可以对接外部监控系统
      // 例如: Datadog, CloudWatch, Prometheus, etc.
      
      // 目前只记录到日志
      logger.info('[Metrics] Flush', {
        metricsCount: this.metrics.size,
        summary: this.getSummary(aggregated)
      });

      // 可选: 发送到外部监控系统
      if (process.env.METRICS_ENDPOINT) {
        await this.sendToExternalSystem(aggregated);
      }
    } catch (error) {
      logger.error('[Metrics] Flush failed', undefined, { error });
    } finally {
      // 清空已刷新的指标
      this.metrics.clear();
    }
  }

  /**
   * 获取摘要信息
   */
  private getSummary(aggregated: Record<string, any>): any {
    const summary: Record<string, number> = {};

    for (const [key, data] of Object.entries(aggregated)) {
      if (data.type === 'counter') {
        summary[key] = data.sum;
      } else if (data.type === 'gauge') {
        summary[key] = data.value;
      } else if (data.avg !== undefined) {
        summary[key] = Math.round(data.avg);
      }
    }

    return summary;
  }

  /**
   * 发送到外部监控系统
   */
  private async sendToExternalSystem(metrics: Record<string, any>): Promise<void> {
    const endpoint = process.env.METRICS_ENDPOINT;
    if (!endpoint) return;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.METRICS_API_KEY && {
            'Authorization': `Bearer ${process.env.METRICS_API_KEY}`
          })
        },
        body: JSON.stringify({
          timestamp: Date.now(),
          metrics,
          source: 'ai-channel-copilot'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      logger.warn('[Metrics] Failed to send to external system', { error });
    }
  }

  /**
   * 启动自动刷新
   */
  private startAutoFlush(): void {
    this.flushInterval = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);

    // 确保在 Node.js 退出时清理
    if (typeof process !== 'undefined') {
      process.on('beforeExit', () => {
        if (this.flushInterval) {
          clearInterval(this.flushInterval);
        }
        // 最后一次刷新
        void this.flush();
      });
    }
  }

  /**
   * 获取当前指标快照
   */
  getSnapshot(): Record<string, Metric[]> {
    const snapshot: Record<string, Metric[]> = {};
    
    for (const [key, metrics] of this.metrics.entries()) {
      snapshot[key] = [...metrics];
    }
    
    return snapshot;
  }
}

// ============================================================================
// 预定义的指标名称
// ============================================================================

export const MetricNames = {
  // HTTP 请求
  HTTP_REQUEST: 'http.request',
  HTTP_RESPONSE_TIME: 'http.response_time',
  HTTP_ERROR: 'http.error',

  // 数据库
  DB_QUERY: 'db.query',
  DB_QUERY_TIME: 'db.query_time',
  DB_ERROR: 'db.error',
  DB_CONNECTION_POOL: 'db.connection_pool',

  // Webhook
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSED: 'webhook.processed',
  WEBHOOK_FAILED: 'webhook.failed',
  WEBHOOK_QUEUE_SIZE: 'webhook.queue_size',
  WEBHOOK_PROCESSING_TIME: 'webhook.processing_time',

  // Dashboard
  DASHBOARD_QUERY: 'dashboard.query',
  DASHBOARD_QUERY_TIME: 'dashboard.query_time',
  DASHBOARD_CACHE_HIT: 'dashboard.cache_hit',
  DASHBOARD_CACHE_MISS: 'dashboard.cache_miss',

  // Copilot
  COPILOT_QUERY: 'copilot.query',
  COPILOT_RESPONSE_TIME: 'copilot.response_time',
  COPILOT_ERROR: 'copilot.error',

  // Billing
  BILLING_CHECK: 'billing.check',
  BILLING_SUBSCRIPTION_CREATED: 'billing.subscription_created',
  BILLING_SUBSCRIPTION_CANCELLED: 'billing.subscription_cancelled',

  // 缓存
  CACHE_HIT: 'cache.hit',
  CACHE_MISS: 'cache.miss',
  CACHE_SET: 'cache.set',
  CACHE_DELETE: 'cache.delete',
  CACHE_SIZE: 'cache.size',

  // 业务指标
  ORDERS_PROCESSED: 'business.orders_processed',
  AI_ORDERS_DETECTED: 'business.ai_orders_detected',
  CUSTOMERS_CREATED: 'business.customers_created',
} as const;

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 包装异步函数并自动记录执行时间
 */
export async function withMetrics<T>(
  metricName: string,
  operation: () => Promise<T>,
  tags?: Record<string, string | number>
): Promise<T> {
  const metrics = MetricsCollector.getInstance();
  const timer = metrics.startTimer(metricName, tags);

  try {
    const result = await operation();
    metrics.endTimer(timer);
    metrics.increment(`${metricName}.success`, 1, tags);
    return result;
  } catch (error) {
    metrics.endTimer(timer);
    metrics.increment(`${metricName}.error`, 1, tags);
    throw error;
  }
}

/**
 * 记录 HTTP 请求指标
 */
export function recordHttpMetrics(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  const metrics = MetricsCollector.getInstance();
  const tags = { method, path, status: statusCode };

  metrics.increment(MetricNames.HTTP_REQUEST, 1, tags);
  metrics.timing(MetricNames.HTTP_RESPONSE_TIME, durationMs, tags);

  if (statusCode >= 400) {
    metrics.increment(MetricNames.HTTP_ERROR, 1, tags);
  }
}

/**
 * 记录数据库查询指标
 */
export function recordDbMetrics(
  operation: string,
  model: string,
  durationMs: number,
  success: boolean
): void {
  const metrics = MetricsCollector.getInstance();
  const tags = { operation, model };

  metrics.increment(MetricNames.DB_QUERY, 1, tags);
  metrics.timing(MetricNames.DB_QUERY_TIME, durationMs, tags);

  if (!success) {
    metrics.increment(MetricNames.DB_ERROR, 1, tags);
  }
}

// 导出单例实例
export const metrics = MetricsCollector.getInstance();

