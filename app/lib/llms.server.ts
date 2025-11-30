import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey } from "./aiData";

export const buildLlmsTxt = async (
  shopDomain: string,
  settings: {
    exposurePreferences: { exposeProducts: boolean; exposeCollections: boolean; exposeBlogs: boolean };
    primaryCurrency?: string;
  },
  options?: { range?: TimeRangeKey; topN?: number },
) => {
  const rangeKey = options?.range || "30d";
  const range = resolveDateRange(rangeKey, new Date());
  const topN = options?.topN || 10;
  const lines: string[] = [];

  lines.push("# llms.txt · AI 采集偏好声明（实验性）");
  lines.push("# 本文件仅用于指引 AI 平台抓取范围；不保证平台遵守或立即生效。");
  lines.push("");
  lines.push(`# 站点声明：shop=${shopDomain} · primary_currency=${settings.primaryCurrency || "USD"}`);
  lines.push(`# 时间范围：${range.label} · 依据最近 AI GMV/订单生成 Top 列表`);
  lines.push("");

  if (settings.exposurePreferences.exposeProducts) {
    const products = await prisma.orderProduct.findMany({
      where: { order: { shopDomain, aiSource: { not: null }, createdAt: { gte: range.start, lte: range.end } } },
      take: topN,
    });
    lines.push("allow:");
    products.forEach((p) => {
      if (p.url) lines.push(`  - ${p.url}`);
    });
  } else {
    lines.push("# 未开启产品页暴露（exposeProducts=false）");
  }

  if (settings.exposurePreferences.exposeCollections) {
    lines.push("# 预留：集合/分类页列表需通过 Shopify API 生成");
  } else {
    lines.push("# 未开启集合页暴露（exposeCollections=false）");
  }

  if (settings.exposurePreferences.exposeBlogs) {
    lines.push("# 预留：博客/内容页列表需通过 CMS/Shopify API 生成");
  } else {
    lines.push("# 未开启博客页暴露（exposeBlogs=false）");
  }

  lines.push("");
  lines.push("# 使用范围说明：仅作为 AI 平台参考，不保证搜索/排名变化；请留意各平台策略更新。");

  return lines.join("\n");
};

