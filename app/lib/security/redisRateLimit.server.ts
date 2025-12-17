/**
 * Redis 分布式限流存储实现
 * 
 * 适用于多实例/Serverless 部署场景
 * 
 * 配置方式：
 * - 设置环境变量 REDIS_URL (如: redis://localhost:6379)
 * - 或设置 REDIS_HOST, REDIS_PORT, REDIS_PASSWORD 单独配置
 * 
 * 依赖：需要安装 ioredis 包
 * npm install ioredis @types/ioredis
 */

import type { RateLimitStore } from './rateLimit.server';
import { logger } from '../logger.server';

// Redis 客户端类型定义（避免硬依赖 ioredis）
interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<'OK'>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  dbsize(): Promise<number>;
  quit(): Promise<'OK'>;
  on(event: string, callback: (...args: unknown[]) => void): void;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// 配置常量
const RATE_LIMIT_KEY_PREFIX = 'ratelimit:';
const DEFAULT_REDIS_PORT = 6379;

/**
 * Redis 配置
 */
export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  connectTimeout?: number;
  maxRetriesPerRequest?: number;
}

/**
 * 从环境变量读取 Redis 配置
 */
export function getRedisConfig(): RedisConfig | null {
  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  
  // 如果没有配置任何 Redis 相关环境变量，返回 null
  if (!url && !host) {
    return null;
  }
  
  return {
    url,
    host: host || 'localhost',
    port: parseInt(process.env.REDIS_PORT || String(DEFAULT_REDIS_PORT), 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || RATE_LIMIT_KEY_PREFIX,
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '5000', 10),
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
  };
}

/**
 * Redis 限流存储实现
 * 使用滑动窗口计数器算法
 */
export class RedisRateLimitStore implements RateLimitStore {
  private client: RedisClient | null = null;
  private keyPrefix: string;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;
  
  constructor(private config: RedisConfig) {
    this.keyPrefix = config.keyPrefix || RATE_LIMIT_KEY_PREFIX;
  }
  
  /**
   * 初始化 Redis 连接
   * 延迟连接，首次使用时才建立
   */
  private async ensureConnected(): Promise<boolean> {
    if (this.isConnected && this.client) {
      return true;
    }
    
    if (this.connectionPromise) {
      await this.connectionPromise;
      return this.isConnected;
    }
    
    this.connectionPromise = this.connect();
    await this.connectionPromise;
    return this.isConnected;
  }
  
  private async connect(): Promise<void> {
    try {
      // 动态导入 ioredis 以避免硬依赖
      const Redis = await import('ioredis').then(m => m.default);
      
      const redisOptions = {
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        connectTimeout: this.config.connectTimeout,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest,
        retryStrategy: (times: number) => {
          if (times > 3) {
            logger.error('[RedisRateLimit] Failed to connect after 3 retries');
            return null; // 停止重试
          }
          return Math.min(times * 100, 3000);
        },
        lazyConnect: true,
      };
      
      // 优先使用 URL 连接
      this.client = this.config.url 
        ? new Redis(this.config.url, redisOptions)
        : new Redis(redisOptions);
      
      // 注册事件处理器
      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('[RedisRateLimit] Connected to Redis');
      });
      
      this.client.on('error', (err: Error) => {
        logger.error('[RedisRateLimit] Redis error', { error: err.message });
      });
      
      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('[RedisRateLimit] Redis connection closed');
      });
      
      // 显式连接
      await (this.client as unknown as { connect(): Promise<void> }).connect();
      this.isConnected = true;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      // 检查是否是模块未安装的错误
      if (message.includes('Cannot find module') || message.includes('ioredis')) {
        logger.warn('[RedisRateLimit] ioredis not installed, falling back to in-memory store', {
          hint: 'Install with: npm install ioredis',
        });
      } else {
        logger.error('[RedisRateLimit] Failed to connect to Redis', { error: message });
      }
      
      this.isConnected = false;
      this.client = null;
    }
  }
  
  /**
   * 生成完整的 Redis key
   */
  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
  
  /**
   * 获取限流条目
   */
  async get(key: string): Promise<RateLimitEntry | null> {
    if (!await this.ensureConnected() || !this.client) {
      return null;
    }
    
    try {
      const fullKey = this.getFullKey(key);
      const data = await this.client.get(fullKey);
      
      if (!data) {
        return null;
      }
      
      const entry = JSON.parse(data) as RateLimitEntry;
      
      // 检查是否过期
      if (entry.resetAt <= Date.now()) {
        await this.client.del(fullKey);
        return null;
      }
      
      return entry;
    } catch (error) {
      logger.error('[RedisRateLimit] Failed to get entry', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  
  /**
   * 设置限流条目
   */
  async set(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void> {
    if (!await this.ensureConnected() || !this.client) {
      return;
    }
    
    try {
      const fullKey = this.getFullKey(key);
      const ttlSeconds = Math.ceil(ttlMs / 1000);
      await this.client.setex(fullKey, ttlSeconds, JSON.stringify(entry));
    } catch (error) {
      logger.error('[RedisRateLimit] Failed to set entry', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  /**
   * 原子递增计数
   * 使用 Redis INCR 实现原子操作，确保多实例并发安全
   */
  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    if (!await this.ensureConnected() || !this.client) {
      // 回退：返回允许的默认值
      return { count: 1, resetAt: Date.now() + windowMs };
    }
    
    try {
      const fullKey = this.getFullKey(key);
      const now = Date.now();
      const ttlSeconds = Math.ceil(windowMs / 1000);
      
      // 使用 INCR 原子递增
      const count = await this.client.incr(fullKey);
      
      // 如果是新 key（count === 1），设置过期时间
      if (count === 1) {
        await this.client.expire(fullKey, ttlSeconds);
      }
      
      // 获取 TTL 来计算 resetAt
      const ttl = await this.client.ttl(fullKey);
      const resetAt = ttl > 0 ? now + ttl * 1000 : now + windowMs;
      
      return { count, resetAt };
    } catch (error) {
      logger.error('[RedisRateLimit] Failed to increment', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      // 回退：返回允许的默认值
      return { count: 1, resetAt: Date.now() + windowMs };
    }
  }
  
  /**
   * 删除限流条目
   */
  async delete(key: string): Promise<void> {
    if (!await this.ensureConnected() || !this.client) {
      return;
    }
    
    try {
      const fullKey = this.getFullKey(key);
      await this.client.del(fullKey);
    } catch (error) {
      logger.error('[RedisRateLimit] Failed to delete entry', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  /**
   * 获取存储大小（估算）
   * 注意：Redis DBSIZE 返回整个数据库的 key 数量，不仅是限流 key
   */
  async size(): Promise<number> {
    if (!await this.ensureConnected() || !this.client) {
      return 0;
    }
    
    try {
      return await this.client.dbsize();
    } catch (error) {
      logger.error('[RedisRateLimit] Failed to get size', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
  
  /**
   * 检查 Redis 连接状态
   */
  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }
  
  /**
   * 关闭 Redis 连接
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.isConnected = false;
        this.client = null;
        logger.info('[RedisRateLimit] Redis connection closed gracefully');
      } catch (error) {
        logger.error('[RedisRateLimit] Failed to close Redis connection', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

// ============================================================================
// 单例和工厂函数
// ============================================================================

let redisStoreInstance: RedisRateLimitStore | null = null;

/**
 * 获取 Redis 限流存储实例
 * 如果 Redis 未配置，返回 null
 */
export function getRedisRateLimitStore(): RedisRateLimitStore | null {
  const config = getRedisConfig();
  
  if (!config) {
    return null;
  }
  
  if (!redisStoreInstance) {
    redisStoreInstance = new RedisRateLimitStore(config);
  }
  
  return redisStoreInstance;
}

/**
 * 检查是否启用了 Redis 限流
 */
export function isRedisRateLimitEnabled(): boolean {
  return getRedisConfig() !== null;
}
