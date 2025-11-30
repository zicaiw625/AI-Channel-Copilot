export type AIChannel = "ChatGPT" | "Perplexity" | "Gemini" | "Copilot" | "Other-AI";

export type AiDomainRule = {
  domain: string;
  channel: AIChannel | "Other-AI";
  source: "default" | "custom";
};

export type UtmSourceRule = {
  value: string;
  channel: AIChannel | "Other-AI";
};

export type DetectionConfig = {
  aiDomains: AiDomainRule[];
  utmSources: UtmSourceRule[];
  utmMediumKeywords: string[];
  tagPrefix?: string;
};

