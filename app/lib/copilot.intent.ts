export type CopilotIntent =
  | "ai_performance"
  | "ai_vs_all_aov"
  | "ai_top_products";

/**
 * 意图优先级定义（当得分相同时使用）
 * 更具体的意图优先级更高
 */
const INTENT_PRIORITY: Record<CopilotIntent, number> = {
  ai_top_products: 3,   // 最具体：查询特定产品
  ai_vs_all_aov: 2,     // 中等：对比分析
  ai_performance: 1,    // 最宽泛：整体表现
};

/**
 * 中文关键词匹配辅助函数
 * 由于 JS 正则的 \b 只对 ASCII 有效，中文需要特殊处理
 * 使用前后字符检测来模拟词边界
 */
const matchChineseKeyword = (text: string, keywords: string[]): boolean => {
  for (const kw of keywords) {
    if (text.includes(kw)) return true;
  }
  return false;
};

/**
 * 英文关键词匹配（使用 \b 词边界）
 */
const matchEnglishKeyword = (text: string, pattern: RegExp): boolean => {
  return pattern.test(text);
};

/**
 * 解析用户问题的意图
 * 使用加权评分系统，避免简单的关键词匹配误判
 */
export const parseIntent = (raw?: string | null): CopilotIntent | undefined => {
  if (!raw) return undefined;
  const q = raw.toLowerCase().trim();
  
  // 如果问题太短，无法判断意图
  if (q.length < 2) return undefined;
  
  // 排除否定表达 - 用户可能在问如何关闭/停止某功能
  // 中文否定词不需要词边界
  const chineseNegative = ['不想', '不要', '停止', '关闭', '取消'];
  const negativePatterns = /怎么.*关|如何.*停|not\s+want|don'?t|stop|cancel|disable|turn\s+off/i;
  if (matchChineseKeyword(q, chineseNegative) || negativePatterns.test(q)) return undefined;
  
  // 排除帮助/操作类问题
  const helpPatterns = /怎么.*设置|如何.*配置|怎样.*操作|how\s+to|where\s+is|can\s+i/i;
  if (helpPatterns.test(q)) return undefined;
  
  // 使用加权评分系统
  const scores: Record<CopilotIntent, number> = {
    ai_vs_all_aov: 0,
    ai_top_products: 0,
    ai_performance: 0,
  };
  
  // ===== AOV 对比关键词 =====
  // 高权重：明确的 AOV 相关词汇
  const aovChineseKw = ['客单价', '平均订单'];
  const aovEnglishPattern = /\b(aov|average\s*order\s*value?)\b/i;
  if (matchChineseKeyword(q, aovChineseKw) || matchEnglishKeyword(q, aovEnglishPattern)) {
    scores.ai_vs_all_aov += 5;
  }
  // 中权重：对比/比较类词汇
  const compareChineseKw = ['对比', '比较', '差异'];
  const compareEnglishPattern = /\b(compare|vs\.?|versus|difference)\b/i;
  if (matchChineseKeyword(q, compareChineseKw) || matchEnglishKeyword(q, compareEnglishPattern)) {
    scores.ai_vs_all_aov += 3;
  }
  // 低权重：渠道相关词汇（与对比词组合时更有意义）
  const channelChineseKw = ['渠道', '全站', '整体'];
  const channelEnglishPattern = /\b(channel|overall)\b/i;
  if ((matchChineseKeyword(q, channelChineseKw) || matchEnglishKeyword(q, channelEnglishPattern)) && scores.ai_vs_all_aov > 0) {
    scores.ai_vs_all_aov += 1;
  }
  
  // ===== Top 产品关键词 =====
  // 高权重：明确的排名/热销词汇
  const topChineseKw = ['热门', '热销', '畅销', '排名', '排行'];
  const topEnglishPattern = /\b(top\s*\d*|best\s*sell(?:er)?s?|ranking)\b/i;
  if (matchChineseKeyword(q, topChineseKw) || matchEnglishKeyword(q, topEnglishPattern)) {
    scores.ai_top_products += 5;
  }
  // 中权重：产品相关词汇
  const productChineseKw = ['产品', '商品'];
  const productEnglishPattern = /\b(product|item|sku)\b/i;
  if (matchChineseKeyword(q, productChineseKw) || matchEnglishKeyword(q, productEnglishPattern)) {
    scores.ai_top_products += 2;
  }
  // 低权重：销量相关词汇
  const salesChineseKw = ['销量', '销售', '卖'];
  const salesEnglishPattern = /\b(sell|sale)\b/i;
  if (matchChineseKeyword(q, salesChineseKw) || matchEnglishKeyword(q, salesEnglishPattern)) {
    scores.ai_top_products += 1;
  }
  
  // ===== 整体表现关键词 =====
  // 高权重：明确的表现/业绩词汇
  const perfChineseKw = ['表现', '业绩', '收入'];
  const perfEnglishPattern = /\b(gmv|revenue|performance)\b/i;
  if (matchChineseKeyword(q, perfChineseKw) || matchEnglishKeyword(q, perfEnglishPattern)) {
    scores.ai_performance += 5;
  }
  // 中权重：订单/趋势类词汇
  const trendChineseKw = ['订单', '趋势', '概览', '情况', '状况'];
  const trendEnglishPattern = /\b(order|trend|overview)\b/i;
  if (matchChineseKeyword(q, trendChineseKw) || matchEnglishKeyword(q, trendEnglishPattern)) {
    scores.ai_performance += 3;
  }
  // 低权重：时间范围词汇（暗示在问表现）
  const timeChineseKw = ['最近', '过去', '这周', '本月'];
  const timeEnglishPattern = /\b(last|recent|today|yesterday)\b/i;
  if (matchChineseKeyword(q, timeChineseKw) || matchEnglishKeyword(q, timeEnglishPattern)) {
    scores.ai_performance += 1;
  }
  // 低权重：AI 渠道词汇
  const aiChineseKw = ['ai渠道', 'ai 渠道', '人工智能'];
  const aiEnglishPattern = /\b(ai\s*channel)\b/i;
  if (matchChineseKeyword(q, aiChineseKw) || matchEnglishKeyword(q, aiEnglishPattern)) {
    scores.ai_performance += 1;
  }
  
  // 找出最高分
  const maxScore = Math.max(...Object.values(scores));
  
  // 置信度阈值：至少需要 3 分才返回意图
  // 这样可以避免单个低权重关键词导致的误判
  if (maxScore < 3) return undefined;
  
  // 找出所有最高分的意图
  const entries = Object.entries(scores) as [CopilotIntent, number][];
  const winners = entries.filter(([_, score]) => score === maxScore);
  
  // 如果只有一个最高分，直接返回
  if (winners.length === 1) {
    return winners[0][0];
  }
  
  // 如果有多个最高分，按优先级排序（更具体的意图优先）
  winners.sort((a, b) => INTENT_PRIORITY[b[0]] - INTENT_PRIORITY[a[0]]);
  return winners[0][0];
};

/**
 * 获取意图的置信度描述（用于调试）
 * 使用与 parseIntent 一致的中英文匹配逻辑
 */
export const getIntentConfidence = (raw?: string | null): { intent: CopilotIntent | undefined; confidence: 'high' | 'medium' | 'low' | 'none' } => {
  const intent = parseIntent(raw);
  if (!intent) return { intent: undefined, confidence: 'none' };
  
  // 使用一致的中英文匹配逻辑估算置信度
  const q = (raw || '').toLowerCase();
  
  // 检查各类关键词是否匹配
  const aovMatch = matchChineseKeyword(q, ['aov', '客单价', '对比', 'compare']);
  const topMatch = matchChineseKeyword(q, ['top', '热门', '产品', 'product']);
  const perfMatch = matchChineseKeyword(q, ['表现', 'gmv', '订单', 'performance']);
  
  const matchCount = [aovMatch, topMatch, perfMatch].filter(Boolean).length;
  
  return {
    intent,
    confidence: matchCount > 1 ? 'high' : 'medium',
  };
};

