/**
 * 安全审计工具和检查清单
 * 用于识别和修复安全漏洞
 */

import { logger } from "./logger.server";

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'authentication' | 'authorization' | 'input_validation' | 'data_exposure' | 'injection' | 'csrf' | 'other';
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
}

export class SecurityAuditor {
  private issues: SecurityIssue[] = [];

  reportIssue(issue: SecurityIssue) {
    this.issues.push(issue);

    const logLevel = issue.severity === 'critical' ? 'error' :
                    issue.severity === 'high' ? 'error' : 'warn';

    logger[logLevel]("[SecurityAudit] Security issue detected", {
      severity: issue.severity,
      category: issue.category,
      description: issue.description,
      file: issue.file,
      line: issue.line,
    });
  }

  getIssues(): SecurityIssue[] {
    return [...this.issues];
  }

  getIssuesBySeverity(severity: SecurityIssue['severity']): SecurityIssue[] {
    return this.issues.filter(issue => issue.severity === severity);
  }

  getIssuesByCategory(category: SecurityIssue['category']): SecurityIssue[] {
    return this.issues.filter(issue => issue.category === category);
  }
}

/**
 * 安全检查函数
 */
export const performSecurityAudit = (): SecurityIssue[] => {
  const auditor = new SecurityAuditor();

  // 检查环境变量安全
  checkEnvironmentSecurity(auditor);

  // 检查输入验证
  checkInputValidation(auditor);

  // 检查认证和授权
  checkAuthentication(auditor);

  // 检查数据处理安全
  checkDataHandling(auditor);

  return auditor.getIssues();
};

const checkEnvironmentSecurity = (auditor: SecurityAuditor) => {
  // 检查敏感信息是否在日志中暴露
  if (process.env.NODE_ENV === 'production') {
    // 在生产环境中不应该有调试日志泄露敏感信息
    auditor.reportIssue({
      severity: 'medium',
      category: 'data_exposure',
      description: '确保生产环境中不记录敏感信息到日志',
      recommendation: '审查日志记录，确保不会泄露API密钥、令牌或其他敏感数据',
    });
  }
};

const checkInputValidation = (auditor: SecurityAuditor) => {
  // 检查用户输入验证的充分性
  auditor.reportIssue({
    severity: 'medium',
    category: 'input_validation',
    description: '验证订单数据输入验证是否完整',
    recommendation: '确保所有订单字段都有适当的类型检查和边界验证',
  });

  // 检查URL和重定向安全
  auditor.reportIssue({
    severity: 'medium',
    category: 'input_validation',
    description: '检查URL参数和重定向的安全性',
    recommendation: '验证所有URL参数，防止开放重定向攻击',
  });
};

const checkAuthentication = (auditor: SecurityAuditor) => {
  // 检查Shopify认证集成
  auditor.reportIssue({
    severity: 'low',
    category: 'authentication',
    description: '验证Shopify webhook认证是否正确实现',
    recommendation: '确保所有webhook端点都使用authenticate.webhook中间件',
  });

  // 检查会话管理
  auditor.reportIssue({
    severity: 'medium',
    category: 'authentication',
    description: '检查会话超时和失效处理',
    recommendation: '实现适当的会话管理，确保过期会话被正确清理',
  });
};

const checkDataHandling = (auditor: SecurityAuditor) => {
  // 检查数据加密
  auditor.reportIssue({
    severity: 'medium',
    category: 'data_exposure',
    description: '检查敏感数据存储是否加密',
    recommendation: '确保数据库中存储的敏感信息（如API密钥）已加密',
  });

  // 检查SQL注入防护（虽然使用Prisma，但仍需检查）
  auditor.reportIssue({
    severity: 'low',
    category: 'injection',
    description: '确认使用ORM防止SQL注入',
    recommendation: '继续使用Prisma ORM，不要使用原生SQL查询',
  });

  // 检查XSS防护
  auditor.reportIssue({
    severity: 'medium',
    category: 'other',
    description: '检查前端渲染的安全性',
    recommendation: '确保所有用户输入在渲染前正确转义，防止XSS攻击',
  });
};

/**
 * 安全头检查
 */
export const checkSecurityHeaders = (response: Response): SecurityIssue[] => {
  const issues: SecurityIssue[] = [];
  const headers = response.headers;

  // 检查必要的安全头
  const requiredHeaders = [
    // Shopify Embedded App 需要允许被 admin.shopify.com 以 iframe 嵌入；
    // 点击劫持防护由 CSP 的 frame-ancestors 指令承担，因此不强制 X-Frame-Options。
    { name: 'X-Content-Type-Options', description: '防止MIME类型混淆' },
    { name: 'X-XSS-Protection', description: '启用XSS过滤' },
    { name: 'Strict-Transport-Security', description: '强制HTTPS' },
    { name: 'Content-Security-Policy', description: '内容安全策略' },
  ];

  for (const header of requiredHeaders) {
    if (!headers.get(header.name)) {
      issues.push({
        severity: 'medium',
        category: 'other',
        description: `缺少安全头: ${header.name}`,
        recommendation: `添加 ${header.name} 头以${header.description}`,
      });
    }
  }

  return issues;
};

/**
 * 数据清理工具 - 防止数据泄露
 */
export const sanitizeDataForLogging = (data: any): any => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = { ...data };

  // 移除敏感字段
  const sensitiveFields = [
    'password', 'token', 'key', 'secret', 'apiKey', 'accessToken',
    'authorization', 'cookie', 'session', 'creditCard', 'ssn'
  ];

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  // 递归处理嵌套对象
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeDataForLogging(sanitized[key]);
    }
  }

  return sanitized;
};
