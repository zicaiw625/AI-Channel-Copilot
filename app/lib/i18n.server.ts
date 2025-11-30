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
  export_orders_csv: { zh: "导出 AI 订单 CSV", en: "Export AI Orders CSV" },
  toggle_gmv: { zh: "GMV", en: "GMV" },
  toggle_orders: { zh: "订单", en: "Orders" },
  toggle_new_customers: { zh: "新客", en: "New Customers" },
  col_acquired_ai: { zh: "首单 AI 获客", en: "First Order AI-acquired" },
  col_repeats: { zh: "复购次数", en: "Repeat Count" },
  settings_lede_desc: { zh: "控制 referrer / UTM 匹配规则、标签写回、语言时区，并导出 AI 渠道订单与产品榜单。所有数据基于 v0.1 保守识别。", en: "Control referrer/UTM rules, tag write-back, language/timezone, and export AI orders and product lists. All data follows v0.1 conservative attribution." },
  ai_conservative_alert: { zh: "AI 渠道识别为保守估计：依赖 referrer/UTM/标签，部分 AI 会隐藏来源；仅统计站外 AI 点击到站并完成订单的链路。", en: "AI attribution is conservative: depends on referrer/UTM/tags; some AI hide referrer. We only count offsite AI clicks that land and convert." },
  default_rules_help: { zh: "默认规则覆盖 ChatGPT / Perplexity / Gemini / Copilot / Claude / DeepSeek 等常见 referrer 与 utm_source；安装后无需改动即可识别主流 AI 域名与 UTM。", en: "Default rules cover common referrers and utm_source for ChatGPT, Perplexity, Gemini, Copilot, Claude, DeepSeek; works out-of-the-box." },
  tag_prefix_help: { zh: "标签默认前缀：订单 AI-Source-*，客户 AI-Customer；可在下方自定义。", en: "Default tag prefixes: Orders AI-Source-*, Customer AI-Customer; customizable below." },
  backfill_protect_alert: { zh: "单次 Backfill 保护：最多回拉 90 天 / 1000 笔订单。大店请拆分时间窗口分批回填，避免 webhook 漏数。", en: "Backfill protection: max 90 days / 1000 orders per run. Split windows for high-volume shops to avoid webhook gaps." },
  backfill_help: { zh: "回拉任务可能需多次覆盖所有历史数据，特别是高日单量或区间较长的店铺，建议拆分时间段循环触发。", en: "Backfill may need multiple runs for full coverage, especially for high-volume or long-range shops." },
  referrer_help: { zh: "编辑默认域名可能导致漏标/误标，建议只新增或停用可疑域名；referrer 匹配优先于 UTM。Copilot 仅在 copilot.microsoft.com 或带 chat/copilot 参数的 bing.com 计入。", en: "Editing default domains may reduce accuracy; prefer adding/disabling suspicious domains. Referrer > UTM. Copilot counted only for copilot.microsoft.com or bing.com with chat/copilot params." },
  tagging_enable_alert: { zh: "启用后将修改订单/客户标签。若依赖标签驱动自动化，请先在测试店验证。避免与既有标签冲突。", en: "Enabling tag write-back modifies order/customer tags. Verify on a test shop if your automations depend on tags. Avoid conflicts." },
  llms_preview_help: { zh: "llms.txt 为实验性标准，不保证产生排名效果；平台采集策略可能变化。", en: "llms.txt is experimental, not guaranteed to improve rankings; platform crawling policies may change." },
  gmv_metric_help: { zh: "仅影响 UI 展示，不影响底层数据口径。", en: "Affects UI display only, not underlying data definitions." },
  customers_ltv_desc: { zh: "字段：customer_id、LTV（窗口内累计 GMV）、GMV 口径、first_ai_acquired、repeat_count、ai_order_share、first_order_at。", en: "Fields: customer_id, LTV (window GMV), gmv_metric, first_ai_acquired, repeat_count, ai_order_share, first_order_at." },
  btn_save: { zh: "保存", en: "Save" },
  btn_write_tags_now: { zh: "立即写回标签", en: "Write Tags Now" },
  btn_backfill_90d: { zh: "补拉最近 90 天订单", en: "Backfill Last 90 Days" },
  btn_add_domain: { zh: "添加域名", en: "Add Domain" },
  btn_delete: { zh: "删除", en: "Delete" },
  btn_add_utm: { zh: "添加 UTM", en: "Add UTM" },
  placeholder_add_domain: { zh: "新增域名，例如 agent.example.com", en: "Add domain e.g. agent.example.com" },
  placeholder_add_utm_source: { zh: "新增 utm_source，例如 ai-referral", en: "Add utm_source e.g. ai-referral" },
  risk_remove_default_domain: { zh: "移除默认域名可能导致漏标", en: "Removing default domain may reduce attribution accuracy" },
  title_delete_rule: { zh: "删除规则", en: "Delete rule" },
};

export const t = (language: Lang, key: keyof typeof dict) => {
  const item = dict[key];
  if (!item) return key;
  return language === "English" ? item.en : item.zh;
};
