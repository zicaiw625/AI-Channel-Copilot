/**
 * 增强型缓存服务
 * 提供内存缓存、TTL 管理、自动清理等功能
 */

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum number of entries
}

export interface CacheEntry<T> {
  data: T;
  expires: number;
  createdAt: number;
}

export class CacheService {
  private static instance: CacheService;
  private cache: Map<string, CacheEntry<any>>;
  private readonly defaultTtl: number;
  private readonly maxSize: number;
  private cleanupInterval?: NodeJS.Timeout;

  private constructor(options: CacheOptions = {}) {
    this.cache = new Map();
    this.defaultTtl = options.ttl || 5 * 60 * 1000; // 默认 5 分钟
    this.maxSize = options.maxSize || 1000;
    
    // 启动定期清理过期条目
    this.startCleanup();
  }

  static getInstance(options?: CacheOptions): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService(options);
    }
    return CacheService.instance;
  }

  /**
   * 获取缓存数据，如果不存在或过期则执行 fetcher 函数
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const data = await fetcher();
    this.set(key, data, ttlMs);
    return data;
  }

  /**
   * 获取缓存数据
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (entry.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * 设置缓存数据
   */
  set<T>(key: string, data: T, ttlMs?: number): void {
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const ttl = ttlMs || this.defaultTtl;
    const now = Date.now();
    
    this.cache.set(key, {
      data,
      expires: now + ttl,
      createdAt: now
    });
  }

  /**
   * 删除指定的缓存条目
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
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    let expired = 0;
    const now = Date.now();
    
    for (const entry of this.cache.values()) {
      if (entry.expires < now) {
        expired++;
      }
    }

    return {
      total: this.cache.size,
      active: this.cache.size - expired,
      expired,
      maxSize: this.maxSize
    };
  }

  /**
   * 删除过期的缓存条目
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires < now) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      // 只在清理了条目时记录日志
      console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }

  /**
   * 启动定期清理任务
   */
  private startCleanup(): void {
    // 每分钟清理一次过期条目
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

  /**
   * 驱逐最旧的缓存条目
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

// 预定义的缓存键生成器
export const CacheKeys = {
  settings: (shopDomain: string) => `settings:${shopDomain}`,
  dashboard: (shopDomain: string, range: string) => `dashboard:${shopDomain}:${range}`,
  billingState: (shopDomain: string) => `billing:${shopDomain}`,
  customerAcquisition: (shopDomain: string) => `customer-ai:${shopDomain}`,
  orderCount: (shopDomain: string, range: string) => `orders:count:${shopDomain}:${range}`,
};

// 预定义的 TTL 常量
export const CacheTTL = {
  SHORT: 1 * 60 * 1000,        // 1 分钟
  MEDIUM: 5 * 60 * 1000,       // 5 分钟
  LONG: 30 * 60 * 1000,        // 30 分钟
  VERY_LONG: 60 * 60 * 1000,   // 1 小时
};

// 导出单例实例
export const cache = CacheService.getInstance();

