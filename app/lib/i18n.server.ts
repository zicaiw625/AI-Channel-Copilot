type Lang = "中文" | "English";

const dict: Record<string, { zh: string; en: string }> = {
  hint_zero_ai: { zh: "选定区间内有订单但未识别到 AI 渠道。建议前往「设置 / 规则 & 导出」补充 AI 域名或 utm_source 规则。", en: "Orders exist in the selected window but no AI channel was detected. Please configure AI domains or utm_source rules in Settings." },
  goto_settings: { zh: "前往设置", en: "Go to Settings" },
  top_customers_title: { zh: "Top Customers by LTV（窗口）", en: "Top Customers by LTV (Window)" },
  col_customer: { zh: "客户 ID", en: "Customer ID" },
  col_ltv: { zh: "LTV", en: "LTV" },
  col_orders: { zh: "订单数", en: "Orders" },
  col_ai: { zh: "AI", en: "AI" },
  export_ltv_csv: { zh: "下载 LTV CSV", en: "Download LTV CSV" },
  channels_section_title: { zh: "渠道贡献（GMV / 订单 / 新客）", en: "Channel Contribution (GMV / Orders / New Customers)" },
  trend_section_title: { zh: "GMV / 订单趋势（按渠道过滤）", en: "GMV / Orders Trend (Filter by Channel)" },
  products_section_title: { zh: "Top Products from AI Channels", en: "Top Products from AI Channels" },
  export_products_csv: { zh: "导出产品榜单 CSV", en: "Export Products CSV" },
};

export const t = (language: Lang, key: keyof typeof dict) => {
  const item = dict[key];
  if (!item) return key;
  return language === "English" ? item.en : item.zh;
};
