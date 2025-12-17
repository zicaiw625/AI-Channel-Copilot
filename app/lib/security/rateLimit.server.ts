/**
 * Rate Limiting 服务
 * 防止 API 滥用和 DDoS 攻击
 * 
 * 支持两种存储后端：
 * 1. Redis（推荐生产环境）- 支持分布式限流
 * 2. 内存存储（开发/单实例部署）- 自动回退
 * 
 * 配置 Redis：
 * - 设置环境变量 REDIS_URL（如: redis://localhost:6379）
 * - 或设置 REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
 * 
 * 自动回退机制：
 * - 如果 Redis 未配置或连接失败，自动使用内存存储
 * - 记录警告日志提醒运维人员
 */

import { logger } from '../logger.server';
import { getRedisRateLimitStore, isRedisRateLimitEnabled } from './redisRateLimit.server';

interface RateLimitRule {
  maxRequests: number;
  windowMs: number;
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface CheckLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * 🔒 分布式限流存储接口
 * 未来可以实现 Redis 版本替换内存版本
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | null>;
  set(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void>;
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
  delete(key: string): Promise<void>;
  size(): Promise<number>;
}

/**
 * 内存实现的限流存储
 * ⚠️ 仅适用于单实例部署
 */
class InMemoryRateLimitStore implements RateLimitStore {
  private store: Map<string, RateLimitEntry>;
  private readonly MAX_ENTRIES = 100000;
  private readonly EMERGENCY_CLEANUP_THRESHOLD = 0.8;

  constructor() {
    this.store = new Map();
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    const entry = this.store.get(key);
    if (!entry || entry.resetAt <= Date.now()) {
      return null;
    }
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    if (this.store.size > this.MAX_ENTRIES) {
      this.emergencyCleanup();
    }
    this.store.set(key, entry);
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    if (this.store.size > this.MAX_ENTRIES) {
      this.emergencyCleanup();
    }

    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + windowMs
      };
    }

    entry.count++;
    this.store.set(key, entry);

    return { count: entry.count, resetAt: entry.resetAt };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  /**
   * 清理过期条目
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * 紧急清理
   */
  private emergencyCleanup(): void {
    const startSize = this.store.size;
    const now = Date.now();

    // 1. 删除所有过期的
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }

    // 2. 如果还是太多，删除最早过期的 20%
    if (this.store.size > this.MAX_ENTRIES * this.EMERGENCY_CLEANUP_THRESHOLD) {
      const entries = Array.from(this.store.entries())
        .sort((a, b) => a[1].resetAt - b[1].resetAt);
      
      const toDelete = Math.floor(entries.length * 0.2);
      for (let i = 0; i < toDelete; i++) {
        this.store.delete(entries[i][0]);
      }
    }

    logger.warn('[RateLimit] Emergency cleanup triggered', {
      before: startSize,
      after: this.store.size,
      maxEntries: this.MAX_ENTRIES
    });
  }

  /**
   * 获取内部 Map 的 keys（用于迁移到 Redis 时的迭代）
   */
  keys(): IterableIterator<string> {
    return this.store.keys();
  }
}

// 🔒 是否已显示存储类型日志
let storageTypeLogShown = false;

export class RateLimiter {
  private static instance: RateLimiter;
  private static listenerAdded = false;
  private store: RateLimitStore;
  private inMemoryStore: InMemoryRateLimitStore | null = null;
  private cleanupInterval?: NodeJS.Timeout;
  private useRedis = false;
  
  // 内存保护：最大条目数限制
  private readonly MAX_ENTRIES = 100000;
  private readonly EMERGENCY_CLEANUP_THRESHOLD = 0.8;

  private constructor() {
    // 尝试使用 Redis，失败则回退到内存存储
    const redisStore = getRedisRateLimitStore();
    
    if (redisStore) {
      this.store = redisStore;
      this.useRedis = true;
      this.logStorageType('redis');
    } else {
      this.inMemoryStore = new InMemoryRateLimitStore();
      this.store = this.inMemoryStore;
      this.useRedis = false;
      this.startCleanup();
      this.logStorageType('memory');
    }
  }

  /**
   * 🔒 记录存储类型信息
   * 仅在首次初始化时记录一次
   */
  private logStorageType(type: 'redis' | 'memory'): void {
    if (storageTypeLogShown) return;
    storageTypeLogShown = true;

    const isProduction = process.env.NODE_ENV === 'production';
    const instanceId = process.env.RENDER_INSTANCE_ID || 
                       process.env.FLY_ALLOC_ID || 
                       process.env.DYNO ||  // Heroku
                       process.env.K_REVISION ||  // Cloud Run
                       null;

    if (type === 'redis') {
      logger.info('[RateLimit] ✅ Using Redis for distributed rate limiting', {
        instanceId: instanceId?.slice(0, 20),
      });
    } else if (isProduction) {
      logger.warn('[RateLimit] ⚠️ Using in-memory rate limiting in production', {
        instanceId: instanceId?.slice(0, 20),
        recommendation: 'Set REDIS_URL environment variable for distributed rate limiting',
        documentation: 'https://docs.aicc.app/deployment/rate-limiting',
      });
    } else {
      logger.info('[RateLimit] Using in-memory rate limiting (development mode)');
    }
  }
  
  /**
   * 检查是否使用 Redis 存储
   */
  isUsingRedis(): boolean {
    return this.useRedis;
  }

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  /**
   * 检查并记录请求（会增加计数）
   * @returns 包含 allowed, remaining, resetAt 的结果对象
   */
  async checkLimit(
    identifier: string,
    rule: RateLimitRule
  ): Promise<CheckLimitResult> {
    const key = this.getKey(identifier, rule.windowMs);
    
    // 使用 store 的 increment 方法（支持未来切换到 Redis）
    const { count, resetAt } = await this.store.increment(key, rule.windowMs);

    const allowed = count <= rule.maxRequests;
    const remaining = Math.max(0, rule.maxRequests - count);

    if (!allowed) {
      logger.warn('[RateLimit] Request blocked', {
        identifier: identifier.slice(0, 100), // 限制日志长度
        count,
        limit: rule.maxRequests,
        windowMs: rule.windowMs
      });
    }

    return {
      allowed,
      remaining,
      resetAt
    };
  }

  /**
   * 只读查询当前状态（不增加计数）
   * 用于获取响应头等场景
   */
  async peek(
    identifier: string,
    rule: RateLimitRule
  ): Promise<CheckLimitResult> {
    const now = Date.now();
    const key = this.getKey(identifier, rule.windowMs);
    const entry = await this.store.get(key);

    // 如果没有记录或已过期
    if (!entry || entry.resetAt <= now) {
      return {
        allowed: true,
        remaining: rule.maxRequests,
        resetAt: now + rule.windowMs
      };
    }

    return {
      allowed: entry.count < rule.maxRequests,
      remaining: Math.max(0, rule.maxRequests - entry.count),
      resetAt: entry.resetAt
    };
  }

  /**
   * 重置指定标识符的限制
   */
  async reset(identifier: string, windowMs?: number): Promise<void> {
    if (windowMs) {
      const key = this.getKey(identifier, windowMs);
      await this.store.delete(key);
    } else {
      // 删除所有匹配的键（仅内存存储支持迭代）
      if (this.inMemoryStore) {
        for (const key of this.inMemoryStore.keys()) {
          if (key.startsWith(`${identifier}:`)) {
            await this.store.delete(key);
          }
        }
      } else {
        // Redis 模式下，需要指定 windowMs 才能删除
        logger.warn('[RateLimit] Reset without windowMs not supported in Redis mode', {
          identifier: identifier.slice(0, 50),
        });
      }
    }
  }

  /**
   * 获取当前统计信息（只读，不增加计数）
   */
  async getStats(identifier: string, windowMs: number): Promise<RateLimitEntry | null> {
    const key = this.getKey(identifier, windowMs);
    const entry = await this.store.get(key);
    
    if (!entry || entry.resetAt <= Date.now()) {
      return null;
    }
    
    // 返回副本，防止外部修改
    return { count: entry.count, resetAt: entry.resetAt };
  }

  /**
   * 获取当前存储大小（用于监控）
   */
  async getStoreSize(): Promise<number> {
    return this.store.size();
  }

  /**
   * 生成存储键
   */
  private getKey(identifier: string, windowMs: number): string {
    return `${identifier}:${windowMs}`;
  }

  /**
   * 清理过期的记录（仅内存存储需要）
   */
  private cleanup(): void {
    // Redis 自动处理过期，无需手动清理
    if (!this.inMemoryStore) return;
    
    const cleaned = this.inMemoryStore.cleanup();

    if (cleaned > 0) {
      void this.store.size().then(remaining => {
        logger.debug('[RateLimit] Cleanup completed', { cleaned, remaining });
      });
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

    // 防止重复添加事件监听器
    if (typeof process !== 'undefined' && !RateLimiter.listenerAdded) {
      RateLimiter.listenerAdded = true;
      
      const cleanupHandler = () => {
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = undefined;
        }
      };
      
      // 使用 once 避免重复执行
      process.once('SIGTERM', cleanupHandler);
      process.once('SIGINT', cleanupHandler);
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
  },
  
  // App Proxy 限制 (llms.txt 等公开端点)
  PROXY: {
    maxRequests: 60,
    windowMs: 60 * 1000, // 1分钟
    message: 'Proxy rate limit exceeded'
  },
  
  // IP 级别的全局限制 (防 DDoS)
  GLOBAL_IP: {
    maxRequests: 300,
    windowMs: 60 * 1000, // 1分钟
    message: 'Too many requests from this IP address'
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
 * 获取速率限制响应头（只读，不消耗配额）
 */
export async function getRateLimitHeaders(
  identifier: string,
  rule: RateLimitRule = RateLimitRules.API_DEFAULT
): Promise<Record<string, string>> {
  const limiter = RateLimiter.getInstance();
  // 使用 peek 方法，不增加计数
  const result = await limiter.peek(identifier, rule);

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

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从请求中提取客户端 IP 地址
 * 支持常见的代理头
 */
export function getClientIp(request: Request): string {
  // 优先级：X-Forwarded-For > X-Real-IP > CF-Connecting-IP > 默认
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // X-Forwarded-For 可能包含多个 IP，取第一个（原始客户端）
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp && isValidIp(firstIp)) {
      return firstIp;
    }
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }
  
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && isValidIp(cfIp)) {
    return cfIp;
  }
  
  return 'unknown';
}

/**
 * 完整的 IP 地址格式验证
 * 支持 IPv4 和完整 IPv6 格式（包括压缩形式）
 */
function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  
  const trimmed = ip.trim();
  
  // IPv4 格式验证
  if (isValidIPv4(trimmed)) return true;
  
  // IPv6 格式验证
  if (isValidIPv6(trimmed)) return true;
  
  return false;
}

/**
 * IPv4 地址验证
 */
function isValidIPv4(ip: string): boolean {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  if (!match) return false;
  
  // 验证每个部分在 0-255 范围内，且没有前导零（除了单独的 0）
  for (let i = 1; i <= 4; i++) {
    const part = match[i];
    const num = parseInt(part, 10);
    if (num < 0 || num > 255) return false;
    // 检查前导零：'01' 不合法，但 '0' 合法
    if (part.length > 1 && part.startsWith('0')) return false;
  }
  
  return true;
}

/**
 * IPv6 地址验证
 * 支持完整格式和压缩格式（::）
 */
function isValidIPv6(ip: string): boolean {
  // 处理 IPv4-mapped IPv6 地址 (::ffff:192.168.1.1)
  const ipv4MappedMatch = ip.match(/^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4MappedMatch) {
    const ipv6Part = ipv4MappedMatch[1];
    const ipv4Part = ipv4MappedMatch[2];
    // 验证 IPv4 部分
    if (!isValidIPv4(ipv4Part)) return false;
    // 继续验证 IPv6 部分（以 : 结尾）
    return isValidIPv6Prefix(ipv6Part + ':');
  }
  
  return isValidIPv6Prefix(ip);
}

/**
 * 验证纯 IPv6 地址（不含 IPv4 部分）
 */
function isValidIPv6Prefix(ip: string): boolean {
  // 检查是否包含非法字符
  if (!/^[0-9a-fA-F:]+$/.test(ip)) return false;
  
  // 处理压缩形式 ::
  const doubleColonCount = (ip.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false; // 最多一个 ::
  
  // 分割并验证
  if (doubleColonCount === 1) {
    // 有压缩形式
    const parts = ip.split('::');
    const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
    const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
    
    // 总共不能超过 8 组
    if (left.length + right.length > 7) return false;
    
    // 验证每个部分
    for (const part of [...left, ...right]) {
      if (!isValidIPv6Part(part)) return false;
    }
  } else {
    // 无压缩形式，必须正好 8 组
    const parts = ip.split(':');
    if (parts.length !== 8) return false;
    
    for (const part of parts) {
      if (!isValidIPv6Part(part)) return false;
    }
  }
  
  return true;
}

/**
 * 验证单个 IPv6 组（1-4 个十六进制字符）
 */
function isValidIPv6Part(part: string): boolean {
  if (!part || part.length > 4) return false;
  return /^[0-9a-fA-F]{1,4}$/.test(part);
}

/**
 * 组合多个标识符创建复合限制键
 */
export function buildRateLimitKey(...parts: (string | undefined | null)[]): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map(p => p.slice(0, 100)) // 限制每部分长度
    .join(':');
}

