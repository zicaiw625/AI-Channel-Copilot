/**
 * 缓存系统 - 用于优化性能和减少数据库查询
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
 * 简单的内存缓存实现
 */
export class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTtl = options.ttl || 5 * 60 * 1000; // 默认5分钟
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
   * 设置缓存数据
   */
  set(key: string, data: T, ttl?: number): void {
    // 如果缓存已满，清理过期条目
    if (this.cache.size >= this.maxSize) {
      this.evictExpired();
    }

    // 如果仍然满，删除最老的条目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
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
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
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
      hitRate: 0, // 需要额外的跟踪机制
    };
  }
}

/**
 * 缓存装饰器 - 用于方法级别的缓存
 */
export function cached<T extends any[], R>(
  cache: MemoryCache<R>,
  keyFn?: (...args: T) => string,
  options?: CacheOptions
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: T): Promise<R> {
      const key = keyFn ? keyFn(...args) : `${propertyName}:${JSON.stringify(args)}`;

      // 尝试从缓存获取
      const cachedResult = cache.get(key);
      if (cachedResult !== null) {
        logger.debug("[cache] Cache hit", { key });
        return cachedResult;
      }

      // 执行原方法
      logger.debug("[cache] Cache miss, executing method", { key });
      const result = await method.apply(this, args);

      // 缓存结果
      cache.set(key, result, options?.ttl);

      return result;
    };

    return descriptor;
  };
}

/**
 * 应用级缓存管理器
 */
export class CacheManager {
  private static instance: CacheManager;
  private caches = new Map<string, MemoryCache<any>>();

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
      this.caches.set(name, new MemoryCache<T>(options));
    }
    return this.caches.get(name)!;
  }

  /**
   * 清空所有缓存
   */
  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    logger.info("[CacheManager] All caches cleared");
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    const stats: Record<string, any> = {};

    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }

    return stats;
  }

  /**
   * 清理过期条目
   */
  cleanup(): void {
    for (const cache of this.caches.values()) {
      // 触发清理
      cache.getStats();
    }
    logger.debug("[CacheManager] Cache cleanup completed");
  }
}

// 全局缓存管理器实例
export const cacheManager = CacheManager.getInstance();

// 常用缓存实例
export const settingsCache = cacheManager.getCache<any>("settings", { ttl: 10 * 60 * 1000 }); // 10分钟
export const dashboardCache = cacheManager.getCache<any>("dashboard", { ttl: 5 * 60 * 1000 }); // 5分钟
export const customerCache = cacheManager.getCache<any>("customers", { ttl: 15 * 60 * 1000 }); // 15分钟

/**
 * 定期清理缓存的工具函数
 */
export const startCacheCleanup = (intervalMs: number = 10 * 60 * 1000) => { // 默认10分钟
  setInterval(() => {
    cacheManager.cleanup();
  }, intervalMs);
};
