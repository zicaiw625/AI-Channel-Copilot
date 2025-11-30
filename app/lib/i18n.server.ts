type Lang = "中文" | "English";

const dict: Record<string, { zh: string; en: string }> = {
  hint_zero_ai: { zh: "选定区间内有订单但未识别到 AI 渠道。建议前往「设置 / 规则 & 导出」补充 AI 域名或 utm_source 规则。", en: "Orders exist in the selected window but no AI channel was detected. Please configure AI domains or utm_source rules in Settings." },
  goto_settings: { zh: "前往设置", en: "Go to Settings" },
};

export const t = (language: Lang, key: keyof typeof dict) => {
  const item = dict[key];
  if (!item) return key;
  return language === "English" ? item.en : item.zh;
};

