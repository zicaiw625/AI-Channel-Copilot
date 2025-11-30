import prisma from "../db.server";
import { resolveDateRange, type TimeRangeKey } from "./aiData";

export const buildLlmsTxt = async (
  shopDomain: string,
  settings: {
    exposurePreferences: { exposeProducts: boolean; exposeCollections: boolean; exposeBlogs: boolean };
    primaryCurrency?: string;
    languages?: string[];
  },
  options?: { range?: TimeRangeKey; topN?: number },
) => {
  const rangeKey = options?.range || "30d";
  const range = resolveDateRange(rangeKey, new Date());
  const topN = options?.topN || 10;
  const lines: string[] = [];
  const language = (settings.languages && settings.languages[0]) || "中文";

  if (language === "English") {
    lines.push("# llms.txt · AI crawling preferences (experimental)");
    lines.push("# This file only guides AI platforms on crawl scope; no guarantee of compliance or immediacy.");
  } else {
    lines.push("# llms.txt · AI 采集偏好声明（实验性）");
    lines.push("# 本文件仅用于指引 AI 平台抓取范围；不保证平台遵守或立即生效。");
  }
  lines.push("");
  if (language === "English") {
    lines.push(`# Site: shop=${shopDomain} · primary_currency=${settings.primaryCurrency || "USD"}`);
    lines.push(`# Time Range: ${range.label} · Top list based on recent AI GMV/orders`);
  } else {
    lines.push(`# 站点声明：shop=${shopDomain} · primary_currency=${settings.primaryCurrency || "USD"}`);
    lines.push(`# 时间范围：${range.label} · 依据最近 AI GMV/订单生成 Top 列表`);
  }
  lines.push("");

  if (settings.exposurePreferences.exposeProducts) {
    const products = await prisma.orderProduct.findMany({
      where: { order: { shopDomain, aiSource: { not: null }, createdAt: { gte: range.start, lte: range.end } } },
      take: topN,
    });
    lines.push(language === "English" ? "allow:" : "allow:");
    products.forEach((p) => {
      if (p.url) lines.push(`  - ${p.url}`);
    });
  } else {
    lines.push(language === "English" ? "# Product page exposure is disabled (exposeProducts=false)" : "# 未开启产品页暴露（exposeProducts=false）");
  }

  if (settings.exposurePreferences.exposeCollections) {
    lines.push(language === "English" ? "# Reserved: collections/categories list to be generated via Shopify API" : "# 预留：集合/分类页列表需通过 Shopify API 生成");
  } else {
    lines.push(language === "English" ? "# Collections exposure is disabled (exposeCollections=false)" : "# 未开启集合页暴露（exposeCollections=false）");
  }

  if (settings.exposurePreferences.exposeBlogs) {
    lines.push(language === "English" ? "# Reserved: blog/content list to be generated via CMS/Shopify API" : "# 预留：博客/内容页列表需通过 CMS/Shopify API 生成");
  } else {
    lines.push(language === "English" ? "# Blog/content exposure is disabled (exposeBlogs=false)" : "# 未开启博客页暴露（exposeBlogs=false）");
  }

  lines.push("");
  lines.push(language === "English" ? "# Scope: for AI platform reference only; no guarantee of search/ranking changes; watch for policy updates." : "# 使用范围说明：仅作为 AI 平台参考，不保证搜索/排名变化；请留意各平台策略更新。");

  return lines.join("\n");
};
