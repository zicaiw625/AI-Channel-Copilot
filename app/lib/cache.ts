/**
 * 缓存系统 - 用于优化性能和减少数据库查询
 * 统一的缓存实现，支持 TTL、自动清理、模式匹配删除等功能
 */

import { logger } from "./logger.server";

export interface CacheOptions {
  ttl?: number; // 生存时间（毫秒）
  maxSize?: number; // 最大缓存条目数
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * 内存缓存实现
 * 支持 TTL、自动清理、模式匹配删除等功能
 */
export class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTtl = options.ttl || 5 * 60 * 1000; // 默认5分钟
    this.startCleanup();
  }

  /**
   * 获取缓存数据
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * 获取缓存数据，如果不存在或过期则执行 fetcher 函数
   */
  async getOrSet(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetcher();
    this.set(key, data, ttlMs);
    return data;
  }

  /**
   * 设置缓存数据
   */
  set(key: string, data: T, ttl?: number): void {
    // 如果缓存已满，清理过期条目
    if (this.cache.size >= this.maxSize) {
      this.evictExpired();
    }

    // 如果仍然满，删除最老的条目
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTtl,
    });
  }

  /**
   * 删除缓存条目
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 删除匹配模式的所有缓存条目
   */
  deletePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' 
      ? new RegExp(pattern.replace(/\*/g, '.*'))
      : pattern;
    
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    
    return deleted;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 清理过期条目
   */
  private evictExpired(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug("[Cache] Cleaned expired entries", { cleaned });
    }
  }

  /**
   * 驱逐最旧的缓存条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 启动定期清理任务
   */
  private startCleanup(): void {
    // 每分钟清理一次过期条目
    this.cleanupInterval = setInterval(() => {
      this.evictExpired();
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

  /**
   * 获取缓存统计信息
   */
  getStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const entry of this.cache.values()) {
      if (now - entry.timestamp <= entry.ttl) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      total: this.cache.size,
      valid: validEntries,
      expired: expiredEntries,
      maxSize: this.maxSize,
    };
  }
}

/**
 * 缓存装饰器 - 用于方法级别的缓存
 */
export function cached<T extends unknown[], R>(
  cacheInstance: MemoryCache<R>,
  keyFn?: (...args: T) => string,
  options?: CacheOptions
) {
  return function (target: object, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value as (...args: T) => Promise<R>;

    descriptor.value = async function (...args: T): Promise<R> {
      const key = keyFn ? keyFn(...args) : `${propertyName}:${JSON.stringify(args)}`;

      // 尝试从缓存获取
      const cachedResult = cacheInstance.get(key);
      if (cachedResult !== null) {
        logger.debug("[cache] Cache hit", { key });
        return cachedResult;
      }

      // 执行原方法
      logger.debug("[cache] Cache miss, executing method", { key });
      const result = await method.apply(this, args);

      // 缓存结果
      cacheInstance.set(key, result, options?.ttl);

      return result;
    };

    return descriptor;
  };
}

/**
 * 缓存统计信息类型
 */
export interface CacheStats {
  total: number;
  valid: number;
  expired: number;
  maxSize: number;
}

/**
 * 应用级缓存管理器
 */
export class CacheManager {
  private static instance: CacheManager;
  private caches = new Map<string, MemoryCache<unknown>>();

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * 获取或创建缓存实例
   */
  getCache<T>(name: string, options?: CacheOptions): MemoryCache<T> {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MemoryCache<unknown>(options));
    }
    return this.caches.get(name) as MemoryCache<T>;
  }

  /**
   * 清空所有缓存
   */
  clearAll(): void {
    for (const cacheInstance of this.caches.values()) {
      cacheInstance.clear();
    }
    logger.info("[CacheManager] All caches cleared");
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};

    for (const [name, cacheInstance] of this.caches.entries()) {
      stats[name] = cacheInstance.getStats();
    }

    return stats;
  }

  /**
   * 清理过期条目
   */
  cleanup(): void {
    for (const cacheInstance of this.caches.values()) {
      // 触发清理
      cacheInstance.getStats();
    }
    logger.debug("[CacheManager] Cache cleanup completed");
  }
}

// 全局缓存管理器实例
export const cacheManager = CacheManager.getInstance();

// 常用缓存实例
export const settingsCache = cacheManager.getCache<unknown>("settings", { ttl: 10 * 60 * 1000 }); // 10分钟
export const dashboardCache = cacheManager.getCache<unknown>("dashboard", { ttl: 5 * 60 * 1000 }); // 5分钟
export const customerCache = cacheManager.getCache<unknown>("customers", { ttl: 15 * 60 * 1000 }); // 15分钟

/**
 * 定期清理缓存的工具函数
 */
export const startCacheCleanup = (intervalMs: number = 10 * 60 * 1000) => { // 默认10分钟
  setInterval(() => {
    cacheManager.cleanup();
  }, intervalMs);
};

// ============================================================================
// 预定义的缓存键生成器
// ============================================================================

export const CacheKeys = {
  settings: (shopDomain: string) => `settings:${shopDomain}`,
  dashboard: (shopDomain: string, range: string) => `dashboard:${shopDomain}:${range}`,
  billingState: (shopDomain: string) => `billing:${shopDomain}`,
  customerAcquisition: (shopDomain: string) => `customer-ai:${shopDomain}`,
  orderCount: (shopDomain: string, range: string) => `orders:count:${shopDomain}:${range}`,
};

// ============================================================================
// 预定义的 TTL 常量 (毫秒)
// ============================================================================

export const CacheTTL = {
  SHORT: 1 * 60 * 1000,        // 1 分钟
  MEDIUM: 5 * 60 * 1000,       // 5 分钟
  LONG: 30 * 60 * 1000,        // 30 分钟
  VERY_LONG: 60 * 60 * 1000,   // 1 小时
};

// ============================================================================
// 统一导出的全局缓存实例
// ============================================================================

// 创建一个统一的全局缓存实例，供需要简单缓存的模块使用
const globalCache = new MemoryCache<unknown>({ ttl: CacheTTL.MEDIUM, maxSize: 1000 });

export const cache = {
  get: <T>(key: string): T | null => globalCache.get(key) as T | null,
  set: <T>(key: string, data: T, ttl?: number): void => globalCache.set(key, data, ttl),
  delete: (key: string): boolean => globalCache.delete(key),
  deletePattern: (pattern: string | RegExp): number => globalCache.deletePattern(pattern),
  clear: (): void => globalCache.clear(),
  getStats: () => globalCache.getStats(),
  getOrSet: <T>(key: string, fetcher: () => Promise<T>, ttl?: number): Promise<T> => 
    globalCache.getOrSet(key, fetcher as () => Promise<unknown>, ttl) as Promise<T>,
};
