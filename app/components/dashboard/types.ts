/**
 * Dashboard 组件共享类型定义
 */

import type { AIChannel } from "../../lib/aiData";

export type Lang = "English" | "中文";

export type TrendScope = "overall" | "ai" | AIChannel;

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface JobSnapshot {
  ok: boolean;
  backfills: {
    recent: {
      id: number;
      range: string;
      status: JobStatus;
      error?: string | null;
      ordersFetched: number;
      createdAt: string;
      startedAt?: string | null;
      finishedAt?: string | null;
    }[];
    counts: Partial<Record<JobStatus, number>>;
  };
  webhooks: {
    recent: {
      id: number;
      topic: string;
      intent: string;
      status: JobStatus;
      error?: string | null;
      createdAt: string;
      startedAt?: string | null;
      finishedAt?: string | null;
    }[];
    counts: Partial<Record<JobStatus, number>>;
  };
}

export interface ChannelData {
  channel: string;
  color: string;
  gmv: number;
  orders: number;
  newCustomers: number;
}

export interface ComparisonRow {
  channel: string;
  aov: number;
  newCustomerRate: number;
  repeatRate: number;
  sampleSize: number;
  isLowSample?: boolean;
}

export interface TrendPoint {
  label: string;
  overallGMV: number;
  overallOrders: number;
  aiGMV: number;
  aiOrders: number;
  byChannel: Record<string, { gmv: number; orders: number }>;
}

export interface TopProduct {
  id: string;
  title: string;
  handle: string;
  url: string;
  aiOrders: number;
  aiGMV: number;
  aiShare: number;
  topChannel: string | null;
}

export interface TopCustomer {
  customerId: string;
  ltv: number;
  orders: number;
  ai: boolean;
  firstAIAcquired: boolean;
  repeatCount: number;
}

export interface RecentOrder {
  id: string;
  name: string;
  createdAt: string;
  totalPrice: number;
  aiSource: string | null;
  referrer: string | null;
  sourceName: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  detection: string | null;
  signals: string[] | null;
}

export interface DashboardOverview {
  totalGMV: number;
  aiGMV: number;
  netGMV: number;
  netAiGMV: number;
  aiShare: number;
  totalOrders: number;
  aiOrders: number;
  aiOrderShare: number;
  totalNewCustomers: number;
  aiNewCustomers: number;
  aiNewCustomerRate: number;
  lastSyncedAt: string;
}

export interface FormatHelpers {
  fmtCurrency: (value: number) => string;
  fmtNumber: (value: number) => string;
  fmtPercent: (value: number, fractionDigits?: number) => string;
  fmtTime: (iso?: string | null) => string;
}
