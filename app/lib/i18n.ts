/**
 * 国际化 (i18n) 模块
 * 
 * 提供类型安全的翻译函数和词典
 * 支持中文和英文两种语言
 * 
 * 使用方式:
 * ```ts
 * import { t, type TranslationKey } from "~/lib/i18n";
 * const message = t(language, "hint_zero_ai");
 * ```
 */

export type Lang = "中文" | "English";

export type TranslationEntry = { zh: string; en: string };

/**
 * 翻译词典
 * 所有 UI 文本都应该在此定义，避免硬编码
 */
const dict: Record<string, TranslationEntry> = {
  // ============================================================================
  // 提示和警告
  // ============================================================================
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
  attribution_timing_note: {
    zh: "新订单刚生成时，Shopify 侧的客户旅程（referrer / UTM 等）有时会晚几秒到数分钟才就绪；本应用会在 webhook 同步、订单更新或补拉后刷新识别。若刚下单未显示为 AI，可稍后刷新或触发补拉。",
    en: "Right after checkout, Shopify’s customer journey fields (referrer / UTM, etc.) can take seconds to a few minutes to populate. This app refreshes attribution via webhooks, order updates, or backfill—refresh or backfill if a new order isn’t labeled yet.",
  },
  default_rules_help: { zh: "默认规则覆盖 ChatGPT / Perplexity / Gemini / Copilot / Claude / DeepSeek 等常见 referrer 与 utm_source；安装后无需改动即可识别主流 AI 域名与 UTM。", en: "Default rules cover common referrers and utm_source for ChatGPT, Perplexity, Gemini, Copilot, Claude, DeepSeek; works out-of-the-box." },
  tag_prefix_help: { zh: "标签默认前缀：订单 AI-Source-*；可在下方自定义。", en: "Default tag prefix: Orders AI-Source-*; customizable below." },
  backfill_protect_alert: { zh: "单次 Backfill 保护：最多回拉 60 天 / 1000 笔订单（Shopify 默认限制）。大店请拆分时间窗口分批回填。", en: "Backfill protection: max 60 days / 1000 orders per run (Shopify default limit). Split windows for high-volume shops." },
  backfill_help: { zh: "回拉任务可能需多次覆盖所有历史数据，特别是高日单量或区间较长的店铺，建议拆分时间段循环触发。", en: "Backfill may need multiple runs for full coverage, especially for high-volume or long-range shops." },
  referrer_help: { zh: "编辑默认域名可能导致漏标/误标，建议只新增或停用可疑域名；referrer 匹配优先于 UTM。Copilot 仅在 copilot.microsoft.com 或带 chat/copilot 参数的 bing.com 计入。", en: "Editing default domains may reduce accuracy; prefer adding/disabling suspicious domains. Referrer > UTM. Copilot counted only for copilot.microsoft.com or bing.com with chat/copilot params." },
  tagging_enable_alert: { zh: "启用后将修改订单标签。若依赖标签驱动自动化，请先在测试店验证。避免与既有标签冲突。", en: "Enabling tag write-back modifies order tags. Verify on a test shop if your automations depend on tags. Avoid conflicts." },
  llms_preview_help: { zh: "llms.txt 为实验性标准，不保证产生排名效果；平台采集策略可能变化。", en: "llms.txt is experimental, not guaranteed to improve rankings; platform crawling policies may change." },
  gmv_metric_help: { zh: "仅影响 UI 展示，不影响底层数据口径。", en: "Affects UI display only, not underlying data definitions." },
  customers_ltv_desc: { zh: "字段：customer_id、LTV（窗口内累计 GMV）、GMV 口径、first_ai_acquired、repeat_count、ai_order_share、first_order_at。", en: "Fields: customer_id, LTV (window GMV), gmv_metric, first_ai_acquired, repeat_count, ai_order_share, first_order_at." },
  btn_save: { zh: "保存", en: "Save" },
  btn_write_tags_now: { zh: "立即写回标签", en: "Write Tags Now" },
  btn_backfill_60d: { zh: "补拉最近 60 天订单", en: "Backfill Last 60 Days" },
  btn_add_domain: { zh: "添加域名", en: "Add Domain" },
  btn_delete: { zh: "删除", en: "Delete" },
  btn_add_utm: { zh: "添加 UTM", en: "Add UTM" },
  placeholder_add_domain: { zh: "新增域名，例如 agent.example.com", en: "Add domain e.g. agent.example.com" },
  placeholder_add_utm_source: { zh: "新增 utm_source，例如 ai-referral", en: "Add utm_source e.g. ai-referral" },
  risk_remove_default_domain: { zh: "移除默认域名可能导致漏标", en: "Removing default domain may reduce attribution accuracy" },
  title_delete_rule: { zh: "删除规则", en: "Delete rule" },
  badge_v01: { zh: "v0.1 内测 · Referrer + UTM", en: "v0.1 Beta · Referrer + UTM" },
  badge_conservative_orders: { zh: "保守识别 · Shopify Orders", en: "Conservative · Shopify Orders" },
  dashboard_title: { zh: "AI Attribution & Growth Dashboard Dashboard", en: "AI Channels Dashboard" },
  dashboard_subheading: { zh: "自动识别来自 ChatGPT / Perplexity / Gemini / Copilot 等 AI 助手的订单，给出保守 GMV 估计与差异洞察。", en: "Automatically detects orders from ChatGPT / Perplexity / Gemini / Copilot and provides conservative GMV estimate and insights." },
  dashboard_warning: { zh: "AI 渠道识别为保守估计，依赖 referrer / UTM / 标签，部分 AI 会隐藏来源；仅统计站外 AI 点击 → 到站 → 完成订单的链路，不含 AI 应用内曝光或自然流量。", en: "AI attribution is conservative, relies on referrer/UTM/tags, some AI hide referrer; counts only offsite AI click → land → order, excludes in-app exposure or generic traffic." },
  dashboard_page_heading: { zh: "AI Attribution & Growth Dashboard", en: "AI Attribution & Growth Dashboard" },
  dashboard_focus_label: { zh: "当前重点：", en: "Focus:" },
  dashboard_results_label: { zh: "结果概览", en: "Results" },
  dashboard_results_title: { zh: "AI 正在带来什么结果", en: "What AI is driving" },
  dashboard_results_badge: { zh: "结果", en: "Outcome" },
  dashboard_trust_label: { zh: "可信度与数据质量", en: "Trust & Data Quality" },
  dashboard_trust_title: { zh: "这些结果有多可靠？", en: "How reliable are these numbers?" },
  dashboard_next_step_label: { zh: "下一步", en: "Next Step" },
  dashboard_next_step_title: { zh: "现在最该做什么？", en: "What should I do now?" },
  dashboard_action_badge: { zh: "行动", en: "Action" },
  dashboard_tools_label: { zh: "工具索引", en: "Tools" },
  dashboard_tools_title: { zh: "查看工具与诊断", en: "Explore tools and diagnostics" },
  dashboard_tools_badge: { zh: "索引", en: "Index" },
  dashboard_reference_badge: { zh: "参考", en: "Reference" },
  dashboard_low_sample_badge: { zh: "低样本", en: "Low sample" },
  dashboard_data_source_prefix: { zh: "证明来源：", en: "Proof source: " },
  dashboard_last_synced_prefix: { zh: "最近同步：", en: "Last synced: " },
  dashboard_last_updated_prefix: { zh: "最近更新：", en: "Last updated: " },
  dashboard_metric_scope_prefix: { zh: "统计口径：", en: "Metric scope: " },
  dashboard_window_truncated: { zh: "当前窗口已截断为最近 {n} 笔订单。", en: "Window truncated to latest {n} orders." },
  dashboard_recent_backfill_reused: { zh: "30 分钟内已有补拉，当前展示复用缓存结果。", en: "Recent backfill detected; cached results are reused." },
  dashboard_backfill_running: { zh: "后台已有补拉任务进行中", en: "A backfill task is already running" },
  dashboard_backfill_triggered: { zh: "已触发（{range}）", en: "Triggered ({range})" },
  dashboard_backfill_running_refresh: { zh: "已有补拉在进行中，稍后刷新", en: "Already running; refresh later" },
  dashboard_backfill_cannot_trigger: { zh: "当前无法触发补拉", en: "Cannot trigger backfill right now" },
  dashboard_zero_ai_review_rules: { zh: "如果归因结果看起来不稳定，先检查 referrer 和 UTM 规则，再决定要不要做优化动作。", en: "If attribution still looks off, review your referrer and UTM rules before making optimization decisions." },
  dashboard_demo_callout: { zh: "当前店铺暂无可识别的 AI 渠道订单，以下为演示数据。可检查时间范围、referrer/UTM 规则，或延长观测窗口后再试。", en: "No identifiable AI orders in this shop. Showing demo data. Check time range, referrer/UTM rules, or extend the window and retry." },
  dashboard_empty_callout: { zh: "最近 60 天内暂无符合条件的订单（Shopify 默认限制）。可能是新店铺，或订单都在 60 天之前。如需访问更早订单，请申请 read_all_orders 权限并重新授权。", en: "No qualifying orders found in the last 60 days (Shopify default limit). This may be a new store, or orders are older than 60 days. To access older orders, request 'read_all_orders' scope and re-authorize." },
  dashboard_open_attribution: { zh: "打开 AI 归因", en: "Open AI Attribution" },
  dashboard_llms_manage_cta: { zh: "在可选增长工具中管理 llms.txt", en: "Manage llms.txt in Visibility Tools" },
  dashboard_go_to_optimization: { zh: "去看优化建议", en: "Go to Optimization" },
  dashboard_fix_ai_visibility: { zh: "去修复 AI 可见性", en: "Fix AI Visibility" },
  dashboard_open_ai_workspace: { zh: "打开可选增长工具", en: "Open visibility tools" },
  dashboard_review_attribution_rules: { zh: "查看来源规则", en: "Review source rules" },
  dashboard_action_opt_description: { zh: "把当前 AI 可见性结果转成可执行的修复动作。", en: "Turn the current AI visibility findings into concrete fixes." },
  dashboard_action_fix_description: { zh: "先完善 llms.txt、Schema 和 FAQ，让 AI 助手更容易理解你的商品目录。", en: "Start with llms.txt, Schema, and FAQ so AI assistants can understand your catalog." },
  dashboard_tool_attribution: { zh: "追踪与归因", en: "Tracking & Attribution" },
  dashboard_tool_diagnostics: { zh: "诊断排查", en: "Diagnostics" },
  dashboard_tool_exports: { zh: "数据导出", en: "Exports" },
  dashboard_tool_system_health: { zh: "系统健康", en: "System Health" },
  dashboard_tool_funnel: { zh: "漏斗分析", en: "Funnel" },
  dashboard_tool_utm_wizard: { zh: "生成可追踪的 AI 链接", en: "Build trackable AI links" },
  dashboard_tool_copilot_growth: { zh: "即时答案（Pro/Growth）", en: "Instant answers (Pro/Growth)" },
  dashboard_tool_multi_store_growth: { zh: "多店铺汇总（Growth）", en: "Multi-Store (Growth)" },
  dashboard_tool_team_growth: { zh: "团队（Growth）", en: "Team (Growth)" },
  dashboard_tool_webhook_export_growth: { zh: "Webhook 导出（Growth）", en: "Webhook Export (Growth)" },
  dashboard_tool_multi_store: { zh: "多店铺汇总", en: "Multi-Store" },
  dashboard_tool_team: { zh: "团队", en: "Team" },
  dashboard_tool_webhook_export: { zh: "Webhook 导出", en: "Webhook Export" },
  dashboard_ai_orders_label: { zh: "AI 订单数", en: "AI Orders" },
  dashboard_ai_share_label: { zh: "AI 占比", en: "AI Share" },
  dashboard_free_plan_notice: { zh: "当前为 Starter 方案（仅限查看最近 7 天数据）。", en: "You are on the Starter plan (limited to the last 7 days of data)." },
  upgrade_short: { zh: "升级", en: "Upgrade" },
  free_trial_14_days: { zh: "14 天免费试用", en: "14-day free trial" },
  meta_synced_at: { zh: "同步时间：", en: "Synced: " },
  meta_updated_at: { zh: "数据最近更新：", en: "Last Updated: " },
  meta_range: { zh: "区间：", en: "Range: " },
  meta_metric_scope: { zh: "数据口径：订单", en: "Metrics: Orders" },
  meta_data_source: { zh: "数据源：", en: "Data Source: " },
  meta_timezones_currency: { zh: "计算时区：", en: "Calc TZ: " },
  status_ops: { zh: "系统状态与操作", en: "System Status & Actions" },
  hint_title: { zh: "提示", en: "Hint" },
  metrics_section_label: { zh: "指标说明", en: "Metrics" },
  metrics_section_title: { zh: "口径定义（固定）", en: "Definitions" },
  kpi_total_gmv: { zh: "总 GMV（所选区间）", en: "Total GMV (Window)" },
  kpi_orders: { zh: "订单", en: "Orders" },
  kpi_new_customers: { zh: "新客", en: "New Customers" },
  kpi_net_gmv: { zh: "净 GMV", en: "Net GMV" },
  kpi_ai_gmv: { zh: "AI 渠道 GMV", en: "AI GMV" },
  kpi_ai_share: { zh: "占比", en: "Share" },
  kpi_ai_orders: { zh: "AI 渠道订单", en: "AI Orders" },
  kpi_ai_order_share: { zh: "总订单", en: "Total Orders" },
  kpi_ai_new_customers: { zh: "AI 新客", en: "AI New Customers" },
  kpi_ai_new_customer_rate: { zh: "AI 渠道新客率", en: "AI New Customer Rate" },
  channels_section_label: { zh: "AI 渠道拆分", en: "AI Channels" },
  comparison_section_label: { zh: "关键指标对比", en: "Key Comparison" },
  table_channel: { zh: "渠道", en: "Channel" },
  table_aov: { zh: "AOV", en: "AOV" },
  table_new_customer_rate: { zh: "新客占比", en: "New Customer Rate" },
  table_repeat_rate: { zh: "简易复购率", en: "Repeat Rate" },
  table_sample: { zh: "样本", en: "Sample" },
  products_table_product: { zh: "产品", en: "Product" },
  products_table_ai_orders: { zh: "AI 渠道订单", en: "AI Orders" },
  products_table_ai_gmv: { zh: "AI GMV", en: "AI GMV" },
  products_table_ai_share: { zh: "AI 占比", en: "AI Share" },
  products_table_top_channel: { zh: "Top 渠道", en: "Top Channel" },
  jobs_section_label: { zh: "任务状态", en: "Jobs" },
  jobs_section_title: { zh: "Backfill & Webhook 队列", en: "Backfill & Webhook Queue" },
  jobs_small_badge: { zh: "排队 / 执行 / 完成 / 错误", en: "Queued / Processing / Completed / Failed" },
  debug_section_label: { zh: "调试视图", en: "Debug" },
  debug_section_title: { zh: "最近订单来源解析", en: "Recent Order Source Parsing" },
  debug_table_order: { zh: "订单", en: "Order" },
  debug_table_time: { zh: "时间", en: "Time" },
  debug_table_ai_channel: { zh: "AI 渠道", en: "AI Channel" },
  debug_table_gmv: { zh: "GMV", en: "GMV" },
  debug_table_ref_utm: { zh: "Referrer / UTM", en: "Referrer / UTM" },
  debug_table_detection: { zh: "解析结果", en: "Detection" },
  debug_table_signals: { zh: "signals", en: "signals" },
  badge_priority_high: { zh: "优先级最高", en: "Highest Priority" },
  badge_assist: { zh: "辅助识别", en: "Assisted" },
  badge_experiment: { zh: "实验", en: "Experimental" },
  badge_ui_only: { zh: "仅影响 UI", en: "UI Only" },
  badge_analysis: { zh: "适合二次分析", en: "For Analysis" },
  badge_monitor: { zh: "监控", en: "Monitor" },
  
  // 覆盖率相关
  detection_coverage: { zh: "AI 检测覆盖率", en: "AI Detection Coverage" },
  coverage_low_warning: { zh: "覆盖率过低意味着 AI 流量可能被低估。", en: "Low coverage means AI traffic may be underreported." },
  coverage_high_success: { zh: "覆盖率优秀！AI 归因置信度更高。", en: "Excellent coverage! AI attribution confidence is higher." },
  setup_utm_links: { zh: "设置 UTM 链接", en: "Setup UTM Links" },
  conservative_attribution_note: { zh: "优先级：referrer > UTM。未带 referrer/UTM 的 AI 流量无法被识别，结果为保守估计。", en: "Priority: referrer > UTM. AI traffic without referrer/UTM cannot be attributed; results are conservative." },
  
  // 低样本量提示
  low_sample_warning: { zh: "样本量较小，指标仅供参考", en: "Sample size is small. Metrics are for reference only." },
  very_low_sample_warning: { zh: "AI 订单极少，数据不具统计意义", en: "Very few AI orders. Data is not statistically reliable." },
  no_ai_orders_detected: { zh: "尚未检测到 AI 渠道订单", en: "No AI orders detected yet" },
  only_n_ai_orders: { zh: "仅检测到 {n} 笔 AI 订单", en: "Only {n} AI order(s) detected" },
  ai_data_collection_hint: { zh: "AI 渠道指标需要更多数据才具有参考价值。", en: "AI channel metrics require more data to be meaningful." },
  extend_date_range_tip: { zh: "建议延长时间范围或在「设置」中检查归因规则。", en: "Try extending the date range or checking your attribution rules in Settings." },
  low_sample_building_insights: { zh: "数据积累中", en: "Building insights" },
  low_sample_building_ai_insights: { zh: "正在积累 AI 渠道数据", en: "Building Your AI Insights" },
  low_sample_n_of_threshold: { zh: "检测到 {count} 笔 AI 订单，需要 {threshold} 笔以获得可靠分析", en: "{count} AI orders detected, {threshold} needed for reliable insights" },
  low_sample_banner_text: { zh: "目前已检测到 {count} 笔 AI 归因订单。建议等待至少 {threshold} 笔订单后再分析趋势，数据会更可靠。", en: "We've detected {count} AI-attributed orders so far. For reliable trends, we recommend waiting until you have at least {threshold} orders." },
  low_sample_what_to_do: { zh: "建议操作", en: "What you can do" },
  low_sample_tip_traffic: { zh: "AI 渠道归因需要持续一段时间的流量积累", en: "AI channel attribution requires consistent traffic over time" },
  low_sample_tip_reliability: { zh: "随着订单数据增加，结果会更加可靠", en: "Results become more reliable as more orders are collected" },
  low_sample_tip_range: { zh: "可以尝试延长时间范围以获得更清晰的数据", en: "Consider extending the date range for a clearer picture" },
  estimate_tooltip: { zh: "此数值为基于有限数据的估算", en: "This value is an estimate based on limited data" },
  estimate_short: { zh: "估", en: "est." },
  whyai_not_ai: { zh: "非 AI", en: "Not AI" },
  whyai_click_to_see: { zh: "点击查看原因", en: "Click to see why" },
  whyai_hide_details: { zh: "收起", en: "Hide Details" },
  whyai_question: { zh: "为什么?", en: "Why AI?" },
  whyai_detection_evidence: { zh: "识别证据", en: "Detection Evidence" },
  whyai_no_specific_evidence: { zh: "未记录具体证据", en: "No specific evidence recorded" },
  whyai_additional_signals: { zh: "其他信号", en: "Additional Signals" },
  whyai_raw_detection: { zh: "原始检测结果", en: "Raw Detection" },
  whyai_confidence_high_text: { zh: "来源域名匹配已知的 AI 平台，这是可靠的证据。", en: "Referrer domain matched a known AI source. This is reliable evidence." },
  whyai_confidence_medium_text: { zh: "通过 UTM 参数或已有标签识别，可能需要核实。", en: "Detected via UTM or existing tag. May need verification." },
  whyai_confidence_low_text: { zh: "信号较弱或仅匹配 medium 关键词，建议检查规则配置。", en: "Weak signal or only medium keyword match. Consider reviewing rules." },
  whyai_referrer_domain: { zh: "来源域名", en: "Referrer Domain" },
  whyai_referrer: { zh: "来源", en: "Referrer" },
  whyai_existing_tag: { zh: "已有标签", en: "Existing Tag" },
  whyai_pretagged: { zh: "应用已标记", en: "Pre-tagged by app" },
  whyai_note_attribute: { zh: "备注属性", en: "Note Attribute" },
  whyai_note_detected: { zh: "从订单备注检测", en: "Detected from order notes" },
  
  // 通用操作
  apply: { zh: "应用", en: "Apply" },
  cancel: { zh: "取消", en: "Cancel" },
  confirm: { zh: "确认", en: "Confirm" },
  loading: { zh: "加载中...", en: "Loading..." },
  refresh: { zh: "刷新", en: "Refresh" },
  download: { zh: "下载", en: "Download" },
  upload: { zh: "上传", en: "Upload" },
  
  // 时间范围
  last_7_days: { zh: "最近 7 天", en: "Last 7 days" },
  last_30_days: { zh: "最近 30 天", en: "Last 30 days" },
  last_90_days: { zh: "最近 90 天", en: "Last 90 days" },
  custom_range: { zh: "自定义", en: "Custom" },
  from_date: { zh: "开始日期", en: "From" },
  to_date: { zh: "结束日期", en: "To" },
  apply_custom: { zh: "应用自定义", en: "Apply Custom" },
  
  // 计费相关
  free_plan: { zh: "免费版", en: "Free Plan" },
  pro_plan: { zh: "专业版", en: "Pro Plan" },
  growth_plan: { zh: "增长版", en: "Growth Plan" },
  upgrade_to_pro: { zh: "升级套餐", en: "Upgrade plan" },
  trial_days_left: { zh: "试用剩余 {n} 天", en: "{n} day(s) trial left" },
  dev_store_env: { zh: "开发店环境", en: "Development store" },
  
  // 错误信息
  error_generic: { zh: "发生错误，请稍后重试", en: "An error occurred. Please try again later." },
  error_network: { zh: "网络错误，请检查连接", en: "Network error. Please check your connection." },
  error_unauthorized: { zh: "未授权，请重新登录", en: "Unauthorized. Please log in again." },
  error_rate_limit: { zh: "请求过于频繁，请稍后重试", en: "Too many requests. Please try again later." },
  
  // Dashboard 新增
  overall: { zh: "整体", en: "Overall" },
  ai_channels: { zh: "AI 渠道", en: "AI Channels" },
  non_ai: { zh: "非 AI / 未识别", en: "Non-AI / Unattributed" },
  awaiting_data: { zh: "等待数据", en: "Awaiting data" },
  all: { zh: "全部", en: "All" },
  filter_by: { zh: "按...过滤", en: "Filter by..." },
  new_short: { zh: "新客", en: "New" },
  ai_net_gmv: { zh: "AI 净 GMV", en: "AI Net GMV" },
  site_new_short: { zh: "全站新客", en: "Site New" },
  trend_label: { zh: "趋势", en: "Trend" },
  all_orders: { zh: "全部订单", en: "All Orders" },
  ai_summary: { zh: "AI 汇总", en: "AI Summary" },
  total_gmv: { zh: "总 GMV", en: "Total GMV" },
  total_orders: { zh: "总订单", en: "Total Orders" },
  trend_help_text: { zh: "可切换 GMV / 订单并按渠道过滤；样本量低时单笔订单会放大波动，解读时需结合渠道详情。", en: "Toggle GMV/Orders and filter by channel. Low sample sizes can exaggerate variance; read alongside channel details." },
  estimated_value: { zh: "估算值", en: "Estimated value" },
  no_data_available: { zh: "暂无数据", en: "No data available" },
  estimated_visit_cart_note: { zh: "访问和加购数据是基于结账/订单模式的估算。启用 checkout webhook 可获得更准确的数据。", en: "Visit and cart data are estimates based on checkout/order patterns. Enable checkout webhooks for more accurate data." },
  ai_channel_insight: { zh: "AI 渠道洞察", en: "AI Channel Insight" },
  ai_conversion_similar: { zh: "AI 渠道转化率与整体相近。", en: "AI channel conversion rate is similar to overall." },
  ai_conversion_better: { zh: "AI 渠道转化率高出整体 {diff}%，这是高意向流量！", en: "AI channel converts {diff}% better than overall. High-intent traffic!" },
  ai_conversion_lower: { zh: "AI 渠道转化率低于整体 {diff}%，建议优化面向 AI 的内容。", en: "AI channel converts {diff}% lower than overall. Consider optimizing AI-facing content." },
  
  // Backfill 相关
  backfill_in_background: { zh: "后台补拉", en: "Backfill in background" },
  backfilling: { zh: "后台补拉中...", en: "Backfilling..." },
  backfill_triggered: { zh: "已触发后台任务", en: "Background task triggered" },
  backfill_in_flight: { zh: "已有补拉在进行中，稍后刷新", en: "A backfill is already running; refresh later" },
  
  // Webhook 相关
  webhook_status: { zh: "Webhook 状态", en: "Webhook Status" },
  pending: { zh: "待处理", en: "Pending" },
  processing: { zh: "处理中", en: "Processing" },
  completed: { zh: "已完成", en: "Completed" },
  failed: { zh: "失败", en: "Failed" },
  
  // ============================================================================
  // 登录页面
  // ============================================================================
  login_title: { zh: "登录", en: "Log in" },
  shop_domain_label: { zh: "店铺域名", en: "Shop domain" },
  login_to_shopify: { zh: "登录 Shopify 店铺", en: "Log in to Shopify" },
  
  // ============================================================================
  // 首页/落地页
  // ============================================================================
  landing_badge: { zh: "AI Attribution for Shopify · v1", en: "AI Attribution for Shopify · v1" },
  landing_heading: { zh: "先看清哪些 AI 助手真正带来订单", en: "See which AI assistants actually drive orders" },
  landing_text: { zh: "先追踪 AI 归因订单、GMV 和新客，再决定可选增长工具值不值得开。", en: "Track AI-attributed orders, GMV, and new customers first, then decide whether visibility tools are worth the effort." },
  shop_placeholder: { zh: "your-store.myshopify.com", en: "your-store.myshopify.com" },
  chip_conservative: { zh: "Referrer + UTM 保守识别", en: "Conservative: Referrer + UTM" },
  chip_ai_gmv: { zh: "AI 渠道 GMV / 订单 / 新客", en: "AI GMV / Orders / New Customers" },
  chip_top_products: { zh: "AI 渠道热销产品", en: "Top Products from AI Channels" },
  chip_export: { zh: "标签写回 & CSV 导出", en: "Tag write-back & CSV export" },
  switch_to_chinese: { zh: "切换为中文", en: "切换为中文" },
  switch_to_english: { zh: "Switch to English", en: "Switch to English" },
  features_v01: { zh: "第 1 周能看到什么", en: "What you get in week 1" },
  feature_data_ingress: { zh: "数据接入：Shopify Admin API + orders/create webhook + 60 天回补。", en: "Data ingress: Shopify Admin API + orders/create webhook + 60-day backfill." },
  feature_ai_attribution: { zh: "AI 归因：预置 AI 域名与 UTM 规则，覆盖 ChatGPT / Perplexity / Gemini / Copilot。", en: "AI attribution: preset AI domains and UTM rules for ChatGPT, Perplexity, Gemini, and Copilot." },
  feature_dashboard: { zh: "仪表盘：AI 订单、AI GMV、新客、AOV、复购，与整体表现对比。", en: "Dashboard: AI orders, AI GMV, new customers, AOV, repeat, and overall comparison." },
  feature_debug: { zh: "调试视图：每笔 AI 归因订单的 referrer / UTM / 订单链路。", en: "Debug view: matched referrer / UTM / order trail for every AI-attributed order." },
  feature_settings: { zh: "设置与导出：规则、标签、语言、时区和 CSV。", en: "Settings & export: rules, tags, language, timezone, and CSVs." },
  who_is_it_for: { zh: "适合想先证明 AI 收入，再考虑增长工具的 Shopify 商家。", en: "Shopify stores that want proof before spending on visibility tools." },
  target_audience: { zh: "年 GMV 20万-500万美金的 DTC 品牌主 / 增长负责人 / 数据分析师，希望量化 AI 助手带来的真实 GMV 与客单表现。", en: "DTC brands with annual GMV of $200k–$5M; growth leads and analysts who want to quantify real GMV and AOV from AI assistants." },
  stat_ai_new_customer_share: { zh: "AI 新客占比", en: "AI New Customer Share" },
  stat_ai_aov_vs_overall: { zh: "AI AOV 对比", en: "AI AOV vs Overall" },
  stat_attribution: { zh: "识别口径", en: "Attribution" },
  stat_conservative: { zh: "保守估计", en: "Conservative" },
  getting_started: { zh: "先证明，再扩展", en: "Prove first, then expand" },
  step_1: { zh: "安装应用并回补最近 60 天订单。", en: "Install the app and backfill the last 60 days." },
  step_2: { zh: "打开仪表盘，先看匹配到的来源、AI 订单和 AI GMV。", en: "Open the dashboard to see matched sources, AI orders, and AI GMV." },
  step_3: { zh: "先把证明做出来，再按需开启标签写回、导出或可选增长工具。", en: "Only then turn on tags, exports, or optional growth tools if you want to grow visibility." },
  
  // ============================================================================
  // 设置页面
  // ============================================================================
  invalid_domain_format: { zh: "域名格式不合法，请输入如 chat.openai.com", en: "Invalid domain format, e.g. chat.openai.com" },
  domain_already_exists: { zh: "该域名已存在于列表中。", en: "This domain already exists in the list." },
  custom_domain_added: { zh: "已添加自定义 AI 域名，点击保存后生效", en: "Custom AI domain added. Click Save to apply." },
  invalid_utm_source: { zh: "utm_source 仅支持字母/数字/中划线/下划线", en: "utm_source supports letters/numbers/dash/underscore only" },
  utm_source_exists: { zh: "该 utm_source 值已存在于列表中。", en: "This utm_source value already exists in the list." },
  utm_source_added: { zh: "新增 utm_source 规则，保存后应用到识别逻辑", en: "utm_source rule added. Save to apply to detection." },
  rules_reset: { zh: "已恢复默认规则，点击保存后生效", en: "Rules reset to defaults. Click Save to apply." },
  upgrade_to_export: { zh: "升级到 Pro 或 Growth 版以导出数据。", en: "Upgrade to Pro or Growth to export data." },
  download_failed: { zh: "下载失败，请重试。", en: "Download failed. Please try again." },
  tag_writeback_triggered: { zh: "标签写回已触发（基于最近 60 天 AI 订单）", en: "Tag write-back triggered (based on last 60 days AI orders)" },
  
  // ============================================================================
  // 数据相关
  // ============================================================================
  data_truncated_sample: { zh: "数据为截断样本，建议缩短时间范围", en: "Data is a truncated sample; consider shortening the time range." },
  
  // ============================================================================
  // llms.txt 相关
  // ============================================================================
  llms_no_content: { zh: "# llms.txt · AI 爬取偏好\n# 此店铺尚未启用任何 AI 爬取内容。\n# 如需了解更多，请联系店铺管理员。", en: "# llms.txt · AI crawling preferences\n# This store has not enabled any content for AI crawling.\n# Contact the store owner for more information." },
};

// 导出词典键类型，用于类型安全检查
export type TranslationKey = keyof typeof dict;

/**
 * 获取翻译文本
 * @param language 语言 ("中文" | "English")
 * @param key 翻译键
 * @returns 翻译后的文本，如果键不存在则返回键名
 */
export const t = (language: Lang, key: TranslationKey): string => {
  const item = dict[key];
  if (!item) return key as string;
  return language === "English" ? item.en : item.zh;
};

/**
 * 带参数的翻译函数
 * 支持 {param} 格式的占位符
 * @param language 语言
 * @param key 翻译键
 * @param params 参数对象
 * @returns 替换参数后的文本
 * 
 * @example
 * ```ts
 * tp(language, "trial_days_left", { n: 7 }); // "试用剩余 7 天"
 * ```
 */
export const tp = (language: Lang, key: TranslationKey, params: Record<string, string | number>): string => {
  let text = t(language, key);
  for (const [param, value] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), String(value));
  }
  return text;
};

/**
 * 检查语言是否为英文
 * @param language 语言
 * @returns true 如果语言是英文
 */
export const isEnglish = (language: Lang | string): boolean => {
  return language === "English";
};

/**
 * 获取当前语言的 locale 字符串
 * @param language 语言
 * @returns locale 字符串 (如 "en-US" 或 "zh-CN")
 */
export const getLocale = (language: Lang | string): string => {
  return language === "English" ? "en-US" : "zh-CN";
};

// 为服务端使用导出词典（用于同步 i18n.server.ts）
export { dict as translationDict };
