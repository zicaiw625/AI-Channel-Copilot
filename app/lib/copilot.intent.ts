export type CopilotIntent =
  | "ai_performance"
  | "ai_vs_all_aov"
  | "ai_top_products";

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
  const negativePatterns = /不想|不要|停止|关闭|取消|怎么.*关|如何.*停|not\s+want|don'?t|stop|cancel|disable|turn\s+off/i;
  if (negativePatterns.test(q)) return undefined;
  
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
  if (/\b(aov|客单价|平均订单|average\s*order\s*value?)\b/i.test(q)) {
    scores.ai_vs_all_aov += 5;
  }
  // 中权重：对比/比较类词汇
  if (/\b(对比|比较|compare|vs\.?|versus|差异|difference)\b/i.test(q)) {
    scores.ai_vs_all_aov += 3;
  }
  // 低权重：渠道相关词汇（与对比词组合时更有意义）
  if (/\b(渠道|channel|全站|overall|整体)\b/i.test(q) && scores.ai_vs_all_aov > 0) {
    scores.ai_vs_all_aov += 1;
  }
  
  // ===== Top 产品关键词 =====
  // 高权重：明确的排名/热销词汇
  if (/\b(top\s*\d*|热门|热销|best\s*sell(?:er)?s?|畅销|排名|排行|ranking)\b/i.test(q)) {
    scores.ai_top_products += 5;
  }
  // 中权重：产品相关词汇
  if (/\b(产品|商品|product|item|sku)\b/i.test(q)) {
    scores.ai_top_products += 2;
  }
  // 低权重：销量相关词汇
  if (/\b(销量|销售|卖|sell|sale)\b/i.test(q)) {
    scores.ai_top_products += 1;
  }
  
  // ===== 整体表现关键词 =====
  // 高权重：明确的表现/业绩词汇
  if (/\b(表现|业绩|gmv|收入|revenue|performance)\b/i.test(q)) {
    scores.ai_performance += 5;
  }
  // 中权重：订单/趋势类词汇
  if (/\b(订单|order|趋势|trend|概览|overview|情况|状况)\b/i.test(q)) {
    scores.ai_performance += 3;
  }
  // 低权重：时间范围词汇（暗示在问表现）
  if (/\b(最近|过去|last|recent|这周|本月|today|yesterday)\b/i.test(q)) {
    scores.ai_performance += 1;
  }
  // 低权重：AI 渠道词汇
  if (/\b(ai\s*渠道|ai\s*channel|人工智能)\b/i.test(q)) {
    scores.ai_performance += 1;
  }
  
  // 找出最高分
  const maxScore = Math.max(...Object.values(scores));
  
  // 置信度阈值：至少需要 3 分才返回意图
  // 这样可以避免单个低权重关键词导致的误判
  if (maxScore < 3) return undefined;
  
  // 返回最高分的意图
  const entries = Object.entries(scores) as [CopilotIntent, number][];
  const winner = entries.find(([_, score]) => score === maxScore);
  
  return winner?.[0];
};

/**
 * 获取意图的置信度描述（用于调试）
 */
export const getIntentConfidence = (raw?: string | null): { intent: CopilotIntent | undefined; confidence: 'high' | 'medium' | 'low' | 'none' } => {
  const intent = parseIntent(raw);
  if (!intent) return { intent: undefined, confidence: 'none' };
  
  // 简单估算置信度
  const q = (raw || '').toLowerCase();
  const hasMultipleKeywords = [
    /aov|客单价|对比|compare/i,
    /top|热门|产品|product/i,
    /表现|gmv|订单|performance/i,
  ].filter(p => p.test(q)).length > 1;
  
  return {
    intent,
    confidence: hasMultipleKeywords ? 'high' : 'medium',
  };
};

