/**
 * Rate Limiting 服务
 * 防止 API 滥用和 DDoS 攻击
 */

import { logger } from '../logger.server';

interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private static instance: RateLimiter;
  private store: Map<string, RateLimitEntry>;
  private cleanupInterval?: NodeJS.Timeout;

  private constructor() {
    this.store = new Map();
    this.startCleanup();
  }

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  /**
   * 检查并记录请求
   * @returns true 如果允许请求，false 如果超出限制
   */
  async checkLimit(
    identifier: string,
    rule: RateLimitRule
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    const key = this.getKey(identifier, rule.windowMs);
    
    let entry = this.store.get(key);

    // 如果没有记录或已过期，创建新记录
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + rule.windowMs
      };
      this.store.set(key, entry);
    }

    // 增加计数
    entry.count++;

    const allowed = entry.count <= rule.maxRequests;
    const remaining = Math.max(0, rule.maxRequests - entry.count);

    if (!allowed) {
      logger.warn('[RateLimit] Request blocked', {
        identifier,
        count: entry.count,
        limit: rule.maxRequests,
        windowMs: rule.windowMs
      });
    }

    return {
      allowed,
      remaining,
      resetAt: entry.resetAt
    };
  }

  /**
   * 重置指定标识符的限制
   */
  reset(identifier: string, windowMs?: number): void {
    if (windowMs) {
      const key = this.getKey(identifier, windowMs);
      this.store.delete(key);
    } else {
      // 删除所有匹配的键
      for (const key of this.store.keys()) {
        if (key.startsWith(`${identifier}:`)) {
          this.store.delete(key);
        }
      }
    }
  }

  /**
   * 获取当前统计信息
   */
  getStats(identifier: string, windowMs: number): RateLimitEntry | null {
    const key = this.getKey(identifier, windowMs);
    const entry = this.store.get(key);
    
    if (!entry || entry.resetAt <= Date.now()) {
      return null;
    }
    
    return entry;
  }

  /**
   * 生成存储键
   */
  private getKey(identifier: string, windowMs: number): string {
    return `${identifier}:${windowMs}`;
  }

  /**
   * 清理过期的记录
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('[RateLimit] Cleanup completed', { cleaned });
    }
  }

  /**
   * 启动定期清理任务
   */
  private startCleanup(): void {
    // 每分钟清理一次过期记录
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);

    // 确保在 Node.js 退出时清理定时器
    if (typeof process !== 'undefined') {
      process.on('beforeExit', () => {
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
        }
      });
    }
  }
}

// ============================================================================
// 预定义的速率限制规则
// ============================================================================

export const RateLimitRules = {
  // API 请求限制
  API_DEFAULT: {
    maxRequests: 60,
    windowMs: 60 * 1000, // 1分钟
    message: 'Too many requests, please try again later'
  },
  
  // Webhook 处理限制
  WEBHOOK: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1分钟
    message: 'Webhook rate limit exceeded'
  },
  
  // Dashboard 查询限制
  DASHBOARD: {
    maxRequests: 30,
    windowMs: 60 * 1000, // 1分钟
    message: 'Dashboard query rate limit exceeded'
  },
  
  // 轮询端点限制 (jobs 状态查询等)
  POLLING: {
    maxRequests: 60,
    windowMs: 60 * 1000, // 1分钟 60次，约每秒1次
    message: 'Polling rate limit exceeded'
  },
  
  // Copilot 查询限制
  COPILOT: {
    maxRequests: 20,
    windowMs: 60 * 1000, // 1分钟
    message: 'Copilot query rate limit exceeded'
  },
  
  // 导出功能限制
  EXPORT: {
    maxRequests: 5,
    windowMs: 5 * 60 * 1000, // 5分钟
    message: 'Export rate limit exceeded'
  },
  
  // 登录尝试限制
  AUTH: {
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15分钟
    message: 'Too many login attempts, please try again later'
  },
  
  // 严格限制 (用于敏感操作)
  STRICT: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 1分钟
    message: 'Rate limit exceeded for sensitive operation'
  }
} as const;

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 检查速率限制并抛出错误
 */
export async function enforceRateLimit(
  identifier: string,
  rule: RateLimitRule = RateLimitRules.API_DEFAULT
): Promise<void> {
  const limiter = RateLimiter.getInstance();
  const result = await limiter.checkLimit(identifier, rule);

  if (!result.allowed) {
    throw new Response(
      JSON.stringify({
        error: rule.message || 'Rate limit exceeded',
        remaining: 0,
        resetAt: new Date(result.resetAt).toISOString()
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': rule.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': result.resetAt.toString(),
          'Retry-After': Math.ceil((result.resetAt - Date.now()) / 1000).toString()
        }
      }
    );
  }
}

/**
 * 获取速率限制响应头
 */
export async function getRateLimitHeaders(
  identifier: string,
  rule: RateLimitRule = RateLimitRules.API_DEFAULT
): Promise<Record<string, string>> {
  const limiter = RateLimiter.getInstance();
  const result = await limiter.checkLimit(identifier, rule);

  return {
    'X-RateLimit-Limit': rule.maxRequests.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toString()
  };
}

/**
 * 创建带速率限制的 Loader/Action 装饰器
 */
export function withRateLimit(
  rule: RateLimitRule = RateLimitRules.API_DEFAULT,
  getIdentifier: (request: Request) => string | Promise<string>
) {
  return function <T extends (...args: any[]) => any>(
    target: T
  ): T {
    return (async (...args: Parameters<T>) => {
      const request = args[0]?.request as Request;
      if (!request) {
        throw new Error('Request object not found in arguments');
      }

      const identifier = await getIdentifier(request);
      await enforceRateLimit(identifier, rule);

      return target(...args);
    }) as T;
  };
}

// 导出单例实例
export const rateLimiter = RateLimiter.getInstance();

