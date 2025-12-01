export type CopilotIntent =
  | "ai_performance"
  | "ai_vs_all_aov"
  | "ai_top_products";

export const parseIntent = (raw?: string | null): CopilotIntent | undefined => {
  if (!raw) return undefined;
  const q = raw.toLowerCase();
  if (q.includes("aov") || q.includes("客单价") || q.includes("对比") || q.includes("compare") || q.includes(" vs ") || q.includes("versus")) return "ai_vs_all_aov";
  if (q.includes("top") || q.includes("best seller") || q.includes("bestseller") || q.includes("产品") || q.includes("销量")) return "ai_top_products";
  if (q.includes("表现") || q.includes("gmv") || q.includes("订单") || q.includes("performance") || q.includes("overview") || q.includes("trend")) return "ai_performance";
  return undefined;
};

