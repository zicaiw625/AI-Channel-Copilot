/**
 * AI来源枚举映射工具
 * 处理AI渠道枚举与数据库枚举之间的转换
 */

import type { AIChannel } from "./aiTypes";
import type { AiSource as PrismaAiSource } from "@prisma/client";

/** 应用层 AIChannel 到 Prisma AiSource 的映射 */
const AI_SOURCE_MAP: Record<AIChannel, PrismaAiSource> = {
  ChatGPT: "ChatGPT",
  Perplexity: "Perplexity",
  Gemini: "Gemini",
  Copilot: "Copilot",
  "Other-AI": "Other_AI",
};

/** Prisma AiSource 到应用层 AIChannel 的映射 */
const REVERSE_AI_SOURCE_MAP: Record<PrismaAiSource, AIChannel> = {
  ChatGPT: "ChatGPT",
  Perplexity: "Perplexity",
  Gemini: "Gemini",
  Copilot: "Copilot",
  Other_AI: "Other-AI",
};

/**
 * 将应用层的AIChannel枚举转换为数据库的AiSource枚举
 */
export const toPrismaAiSource = (source: AIChannel | null): PrismaAiSource | null => {
  if (!source) return null;

  const mapped = AI_SOURCE_MAP[source];
  if (!mapped) {
    throw new Error(`Unknown AI source: ${source}`);
  }

  return mapped;
};

/**
 * 将数据库的AiSource枚举转换为应用层的AIChannel枚举
 */
export const fromPrismaAiSource = (source: PrismaAiSource | null): AIChannel | null => {
  if (!source) return null;

  const mapped = REVERSE_AI_SOURCE_MAP[source];
  if (!mapped) {
    throw new Error(`Unknown Prisma AI source: ${source}`);
  }

  return mapped;
};

/**
 * 获取所有支持的AI来源列表
 */
export const getSupportedAiSources = (): AIChannel[] => {
  return Object.keys(AI_SOURCE_MAP) as AIChannel[];
};

/**
 * 检查是否为有效的AI来源
 */
export const isValidAiSource = (source: string): source is AIChannel => {
  return source in AI_SOURCE_MAP;
};
