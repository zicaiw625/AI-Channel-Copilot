/**
 * 数据清洗和敏感信息处理
 * 用于日志、错误报告和数据导出
 */

/**
 * 敏感字段列表
 */
const SENSITIVE_KEYS = [
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'privatekey',
  'private_key',
  'credential',
  'authorization',
  'auth',
  'session',
  'cookie',
  'csrftoken',
  'csrf_token',
];

/**
 * PII (个人身份信息) 字段列表
 */
const PII_KEYS = [
  'email',
  'phone',
  'telephone',
  'mobile',
  'address',
  'street',
  'zipcode',
  'postal',
  'ssn',
  'socialsecurity',
  'creditcard',
  'card_number',
  'cvv',
  'passport',
  'driverlicense',
  'firstname',
  'first_name',
  'lastname',
  'last_name',
  'fullname',
  'full_name',
];

/**
 * 检查键名是否包含敏感信息
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase().replace(/[-_\s]/g, '');
  return SENSITIVE_KEYS.some(sensitiveKey => 
    lowerKey.includes(sensitiveKey.toLowerCase())
  );
}

/**
 * 检查键名是否包含 PII
 */
function isPIIKey(key: string): boolean {
  const lowerKey = key.toLowerCase().replace(/[-_\s]/g, '');
  return PII_KEYS.some(piiKey => 
    lowerKey.includes(piiKey.toLowerCase())
  );
}

/**
 * 部分遮蔽字符串 (保留首尾字符)
 */
function maskString(value: string, showChars = 2): string {
  if (value.length <= showChars * 2) {
    return '*'.repeat(value.length);
  }
  
  const start = value.slice(0, showChars);
  const end = value.slice(-showChars);
  const middle = '*'.repeat(Math.min(8, value.length - showChars * 2));
  
  return `${start}${middle}${end}`;
}

/**
 * 遮蔽邮箱地址
 */
function maskEmail(email: string): string {
  const [username, domain] = email.split('@');
  if (!username || !domain) return '***@***.***';
  
  const maskedUsername = username.length > 2 
    ? `${username[0]}***${username[username.length - 1]}`
    : '***';
  
  return `${maskedUsername}@${domain}`;
}

/**
 * 遮蔽电话号码
 */
function maskPhone(phone: string): string {
  // 移除所有非数字字符
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  
  return `***${digits.slice(-4)}`;
}

/**
 * 智能遮蔽值
 */
function maskValue(value: any, key: string): any {
  if (typeof value === 'string') {
    // 邮箱地址
    if (key.toLowerCase().includes('email') && value.includes('@')) {
      return maskEmail(value);
    }
    
    // 电话号码
    if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')) {
      return maskPhone(value);
    }
    
    // 其他敏感信息
    if (isSensitiveKey(key)) {
      return '[REDACTED]';
    }
    
    // PII 信息
    if (isPIIKey(key)) {
      return maskString(value);
    }
    
    return value;
  }
  
  return value;
}

/**
 * 清洗对象中的敏感数据
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  options: {
    redactSensitive?: boolean;
    redactPII?: boolean;
    maxDepth?: number;
  } = {}
): T {
  const {
    redactSensitive = true,
    redactPII = false,
    maxDepth = 10
  } = options;

  function sanitize(value: any, depth = 0): any {
    // 防止无限递归
    if (depth > maxDepth) {
      return '[Max Depth Reached]';
    }

    // 处理 null 和 undefined
    if (value === null || value === undefined) {
      return value;
    }

    // 处理数组
    if (Array.isArray(value)) {
      return value.map(item => sanitize(item, depth + 1));
    }

    // 处理对象
    if (typeof value === 'object') {
      // 处理特殊对象 (Date, RegExp, etc.)
      if (value instanceof Date || value instanceof RegExp) {
        return value;
      }

      const sanitized: Record<string, any> = {};
      
      for (const [key, val] of Object.entries(value)) {
        // 敏感键处理
        if (redactSensitive && isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
          continue;
        }
        
        // PII 键处理
        if (redactPII && isPIIKey(key)) {
          sanitized[key] = maskValue(val, key);
          continue;
        }
        
        // 递归处理
        sanitized[key] = sanitize(val, depth + 1);
      }
      
      return sanitized;
    }

    // 基础类型直接返回
    return value;
  }

  return sanitize(obj, 0) as T;
}

/**
 * 清洗日志数据
 */
export function sanitizeLogData(data: any): any {
  return sanitizeObject(data, {
    redactSensitive: true,
    redactPII: false, // 日志中可以保留部分 PII (遮蔽处理)
    maxDepth: 10
  });
}

/**
 * 清洗导出数据
 */
export function sanitizeExportData(data: any): any {
  return sanitizeObject(data, {
    redactSensitive: true,
    redactPII: true,
    maxDepth: 10
  });
}

/**
 * 清洗错误信息
 */
export function sanitizeError(error: Error | unknown): {
  message: string;
  stack?: string;
  code?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      code: (error as any).code
    };
  }
  
  return {
    message: String(error)
  };
}

/**
 * 清洗 URL 参数 (移除敏感查询参数)
 */
export function sanitizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const sensitiveParams = ['token', 'key', 'secret', 'password', 'session'];
    
    for (const param of sensitiveParams) {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '[REDACTED]');
      }
    }
    
    return urlObj.toString();
  } catch {
    // 如果不是有效 URL，直接返回
    return url;
  }
}

/**
 * 创建安全的用户标识符 (用于日志和监控)
 */
export function createSafeIdentifier(
  shopDomain: string,
  userId?: string | number | null
): string {
  const domainParts = shopDomain.split('.');
  const shopName = domainParts[0] || 'unknown';
  
  // 只保留 shop 名称的前3个字符和后2个字符
  const safeShop = shopName.length > 5
    ? `${shopName.slice(0, 3)}***${shopName.slice(-2)}`
    : `***${shopName.slice(-2)}`;
  
  if (userId) {
    // 对用户 ID 进行哈希处理
    const hashedId = hashUserId(String(userId));
    return `${safeShop}:${hashedId}`;
  }
  
  return safeShop;
}

/**
 * 简单哈希函数 (用于用户 ID)
 */
function hashUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

/**
 * 验证并清洗用户输入
 */
export function sanitizeUserInput(input: string, maxLength = 1000): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  // 移除控制字符和不可见字符
  let sanitized = input.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  
  // 限制长度
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }
  
  // 修剪空白
  sanitized = sanitized.trim();
  
  return sanitized;
}

/**
 * HTML 转义 (防止 XSS)
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  
  return text.replace(/[&<>"'/]/g, (char) => map[char] || char);
}

/**
 * SQL 注入防护 (额外检查层，不替代参数化查询)
 */
export function validateSqlInput(input: string): boolean {
  // 检测常见的 SQL 注入模式
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(--|;|\/\*|\*\/)/g,
    /(union|join|where|having|order by)/gi,
    /(\bor\b.*=.*|and.*=.*)/gi,
  ];
  
  return !sqlPatterns.some(pattern => pattern.test(input));
}

/**
 * 清洗 GraphQL 查询结果
 */
export function sanitizeGraphQLResponse(response: any): any {
  // 移除 Shopify 内部字段
  const internalFields = ['__typename', '_internal'];
  
  function clean(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(clean);
    }
    
    if (obj && typeof obj === 'object') {
      const cleaned: Record<string, any> = {};
      
      for (const [key, value] of Object.entries(obj)) {
        if (!internalFields.includes(key)) {
          cleaned[key] = clean(value);
        }
      }
      
      return cleaned;
    }
    
    return obj;
  }
  
  return clean(response);
}

