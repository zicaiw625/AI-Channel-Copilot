import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  channelList,
  defaultSettings,
  resolveDateRange,
  timeRanges,
  type AIChannel,
  type TimeRangeKey,
  LOW_SAMPLE_THRESHOLD,
} from "../lib/aiData";
import { fetchOrdersForRange } from "../lib/shopifyOrders.server";
import { getSettings, markActivity, syncShopPreferences } from "../lib/settings.server";
import { loadOrdersFromDb, persistOrders } from "../lib/persistence.server";
import { authenticate } from "../shopify.server";
import styles from "./app.dashboard.module.css";
import { allowDemoData } from "../lib/runtime.server";
import { getAiDashboardData } from "../lib/aiQueries.server";

const BACKFILL_COOLDOWN_MINUTES = 30;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const rangeParam = (url.searchParams.get("range") as TimeRangeKey) || "30d";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const shopDomain = session?.shop || "";
  let settings = await getSettings(shopDomain);
  settings = await syncShopPreferences(admin, shopDomain, settings);
  const displayTimezone = settings.timezones[0] || "UTC";
  const language = settings.languages[0] || "中文";
  const currency = settings.primaryCurrency || "USD";
  const calculationTimezone = displayTimezone || "UTC";
  const dateRange = resolveDateRange(rangeParam, new Date(), from, to, calculationTimezone);
  const lastBackfillAt = settings.lastBackfillAt ? new Date(settings.lastBackfillAt) : null;

  let dataSource: "live" | "demo" | "stored" | "empty" = "live";
  let orders = await loadOrdersFromDb(shopDomain, dateRange);
  let clamped = false;
  let backfillSuppressed = false;
  const demoAllowed = allowDemoData();

  if (orders.length > 0) {
    dataSource = "stored";
  } else {
    const now = new Date();
    const withinCooldown =
      lastBackfillAt &&
      now.getTime() - lastBackfillAt.getTime() < BACKFILL_COOLDOWN_MINUTES * 60 * 1000;

    if (withinCooldown) {
      dataSource = "stored";
      backfillSuppressed = true;
    } else {
      try {
        const fetched = await fetchOrdersForRange(admin, dateRange, settings, {
          shopDomain,
          intent: "dashboard-loader",
          rangeLabel: dateRange.label,
        });
        orders = fetched.orders;
        clamped = fetched.clamped;
        if (orders.length > 0) {
          await persistOrders(shopDomain, orders);
          await markActivity(shopDomain, { lastBackfillAt: new Date() });
          dataSource = "live";
        } else {
          dataSource = demoAllowed ? "demo" : "empty";
        }
      } catch (error) {
        console.error("Failed to load Shopify orders", error);
        dataSource = demoAllowed ? "demo" : "empty";
      }
    }
  }

  const useDemoData = demoAllowed && dataSource === "demo";
  const { data } = await getAiDashboardData(shopDomain, dateRange, settings, {
    timezone: displayTimezone,
    allowDemo: useDemoData,
    orders,
  });

  const dataLastUpdated = (() => {
    const timestamps = [settings.lastOrdersWebhookAt, settings.lastBackfillAt].filter(Boolean);
    if (!timestamps.length) return null;
    const latest = timestamps
      .map((value) => new Date(value as string))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return latest.toISOString();
  })();

  return {
    range: dateRange.key,
    dateRange: {
      ...dateRange,
      start: dateRange.start.toISOString(),
      end: dateRange.end.toISOString(),
    },
    data,
    dataSource,
    gmvMetric: settings.gmvMetric,
    currency,
    calculationTimezone,
    timezone: displayTimezone,
    language,
    backfillSuppressed,
    dataLastUpdated,
    pipeline: {
      lastOrdersWebhookAt: settings.lastOrdersWebhookAt || null,
      lastBackfillAt: settings.lastBackfillAt || null,
      lastTaggingAt: settings.lastTaggingAt || null,
      statuses:
        settings.pipelineStatuses && settings.pipelineStatuses.length
          ? settings.pipelineStatuses
          : defaultSettings.pipelineStatuses,
    },
    clamped,
  };
};

const fmtNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const fmtPercent = (value: number, fractionDigits = 1) =>
  `${(value * 100).toFixed(fractionDigits)}%`;

type TrendScope = "overall" | "ai" | AIChannel;

export default function Index() {
  const {
    range,
    dateRange,
    data,
    dataSource,
    gmvMetric,
    currency,
    calculationTimezone,
    timezone,
    language,
    pipeline,
    clamped,
    backfillSuppressed,
    dataLastUpdated,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const [metricView, setMetricView] = useState<"gmv" | "orders" | "newCustomers">("gmv");
  const [trendMetric, setTrendMetric] = useState<"gmv" | "orders">("gmv");
  const [trendScope, setTrendScope] = useState<TrendScope>("ai");
  const [customFrom, setCustomFrom] = useState(
    (dateRange.fromParam as string | undefined) || dateRange.start.slice(0, 10),
  );
  const [customTo, setCustomTo] = useState(
    (dateRange.toParam as string | undefined) || dateRange.end.slice(0, 10),
  );
  const locale = language === "English" ? "en-US" : "zh-CN";
  const fmtCurrency = useCallback(
    (value: number) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 0,
      }).format(value),
    [currency, locale],
  );
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale, timezone],
  );
  const fmtTime = useCallback(
    (iso?: string | null) => (iso ? timeFormatter.format(new Date(iso)) : "暂无"),
    [timeFormatter],
  );

  useEffect(() => {
    setCustomFrom((dateRange.fromParam as string | undefined) || dateRange.start.slice(0, 10));
    setCustomTo((dateRange.toParam as string | undefined) || dateRange.end.slice(0, 10));
  }, [dateRange.end, dateRange.fromParam, dateRange.start, dateRange.toParam]);

  const {
    overview,
    channels,
    comparison,
    trend,
    topProducts,
    recentOrders,
    sampleNote,
    exports: exportData,
  } = data;
  const isLowSample = overview.aiOrders < LOW_SAMPLE_THRESHOLD;

  const trendScopes = useMemo(
    () => [
      { key: "overall" as TrendScope, label: "全部订单" },
      { key: "ai" as TrendScope, label: "AI 汇总" },
      ...channelList.map((channel) => ({ key: channel as TrendScope, label: channel })),
    ],
    [],
  );

  const channelMax = useMemo(() => {
    const values = channels.map((channel) => {
      if (metricView === "gmv") return channel.gmv;
      if (metricView === "orders") return channel.orders;
      return channel.newCustomers;
    });
    return Math.max(1, ...values);
  }, [channels, metricView]);

  const getTrendValue = useCallback(
    (point: (typeof trend)[number]) => {
      if (trendScope === "overall") {
        return trendMetric === "gmv" ? point.overallGMV : point.overallOrders;
      }
      if (trendScope === "ai") {
        return trendMetric === "gmv" ? point.aiGMV : point.aiOrders;
      }
      const channelMetrics = point.byChannel[trendScope];
      if (!channelMetrics) return 0;
      return trendMetric === "gmv" ? channelMetrics.gmv : channelMetrics.orders;
    },
    [trendMetric, trendScope],
  );

  const trendScopeLabel =
    trendScopes.find((item) => item.key === trendScope)?.label || "AI 汇总";

  const trendMax = useMemo(
    () => Math.max(1, ...trend.map((point) => getTrendValue(point))),
    [getTrendValue, trend],
  );

  const setRange = (value: TimeRangeKey) => {
    const params = new URLSearchParams(location.search);
    params.set("range", value);
    if (value === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo || customFrom);
    } else {
      params.delete("from");
      params.delete("to");
    }
    navigate({ search: `?${params.toString()}` });
  };

  const applyCustomRange = () => {
    if (!customFrom) return;
    const params = new URLSearchParams(location.search);
    params.set("range", "custom");
    params.set("from", customFrom);
    params.set("to", customTo || customFrom);
    navigate({ search: `?${params.toString()}` });
  };

  return (
    <s-page heading="AI Discovery & Attribution">
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <div className={styles.titleBlock}>
            <div className={styles.badgeRow}>
              <span className={styles.badge}>v0.1 内测 · Referrer + UTM</span>
              <span className={styles.badgeSecondary}>保守识别 · Shopify Orders</span>
              {isLowSample && (
                <span className={styles.badgeSecondary}>
                  样本 < {LOW_SAMPLE_THRESHOLD} · 指标仅供参考
                </span>
              )}
            </div>
            <h1 className={styles.heading}>AI 渠道基础仪表盘</h1>
            <p className={styles.subheading}>
              自动识别来自 ChatGPT / Perplexity / Gemini / Copilot 等 AI 助手的订单，给出保守
              GMV 估计与差异洞察。
            </p>
            <div className={styles.warning}>
              <strong>说明：</strong>AI 渠道识别为保守估计，依赖 referrer / UTM / 标签，部分 AI 会隐藏来源；
              仅统计站外 AI 点击 → 到站 → 完成订单的链路，不含 AI 应用内曝光或自然流量。
            </div>
          <div className={styles.metaRow}>
            <span>同步时间：{timeFormatter.format(new Date(overview.lastSyncedAt))}</span>
            <span>
              数据最近更新：{dataLastUpdated ? timeFormatter.format(new Date(dataLastUpdated)) : "暂无"}
              {backfillSuppressed && "（30 分钟内已补拉，复用缓存数据）"}
            </span>
            <span>区间：{dateRange.label}</span>
            <span>
              数据口径：订单 {gmvMetric} · 新客=首单客户（仅限当前时间范围） · GMV 仅基于订单字段
              </span>
              <span>
                数据源：
                {dataSource === "live"
                  ? "Shopify 实时订单"
                  : dataSource === "stored"
                    ? "已缓存的店铺订单"
                    : dataSource === "demo"
                      ? "Demo 样例（未检索到 AI 订单）"
                      : "暂无数据（未启用演示数据）"}
                （live=实时 API，stored=本地缓存，demo=演示数据）
              </span>
              {clamped && (
                <span>
                  提示：已自动截断为最近 90 天内的订单，避免超长时间窗口导致补拉过慢。
                </span>
              )}
              <span>
                计算时区：{calculationTimezone} · 展示时区：{timezone} · 货币：{currency}
              </span>
            </div>
            <div className={styles.pipelineRow}>
              <span>Webhook：{fmtTime(pipeline.lastOrdersWebhookAt)}</span>
              <span>补拉：{fmtTime(pipeline.lastBackfillAt)}</span>
              <span>标签：{fmtTime(pipeline.lastTaggingAt)}</span>
              <div className={styles.statusChips}>
                {(pipeline.statuses || []).map((item) => (
                  <span
                    key={item.title}
                    className={`${styles.statusChip} ${
                      item.status === "healthy"
                        ? styles.statusHealthy
                        : item.status === "warning"
                          ? styles.statusWarning
                          : styles.statusInfo
                    }`}
                  >
                    {item.title}: {item.status}
                  </span>
                ))}
              </div>
            </div>
            {dataSource === "demo" && (
              <div className={styles.callout}>
                <span>提示</span>
                当前店铺暂无可识别的 AI 渠道订单，以下为演示数据。可检查时间范围、referrer/UTM 规则，或延长观测窗口后再试。
              </div>
            )}
            {dataSource === "empty" && (
              <div className={styles.warning}>
                暂未检索到符合条件的订单，且已关闭演示数据。可等待 webhook/backfill 完成或延长时间范围后重试。
              </div>
            )}
            </div>
            <div className={styles.actions}>
              <div className={styles.rangePills}>
                {(Object.keys(timeRanges) as TimeRangeKey[]).map((key) => (
                  <button
                    key={key}
                    className={`${styles.pill} ${range === key ? styles.pillActive : ""}`}
                    onClick={() => setRange(key)}
                    type="button"
                  >
                    {timeRanges[key].label}
                  </button>
                ))}
              </div>
              <div className={styles.customRange}>
                <input
                  type="date"
                  className={styles.input}
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
                <span className={styles.rangeDivider}>至</span>
                <input
                  type="date"
                  className={styles.input}
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={applyCustomRange}
                >
                  应用自定义
                </button>
              </div>
              <div className={styles.actionButtons}>
                <Link to="/app/additional" className={styles.primaryButton}>
                  设置 / 规则 & 导出
                </Link>
                <a
                className={styles.secondaryButton}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(exportData.ordersCsv)}`}
                download={`ai-orders-${range}.csv`}
              >
                导出 AI 订单 CSV
              </a>
            </div>
          </div>
        </div>

        <div className={styles.kpiGrid}>
          <div className={styles.card}>
            <p className={styles.cardLabel}>总 GMV（所选区间）</p>
            <p className={styles.cardValue}>{fmtCurrency(overview.totalGMV)}</p>
            <p className={styles.cardMeta}>
              订单 {fmtNumber(overview.totalOrders)} · 新客 {fmtNumber(overview.totalNewCustomers)}
            </p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>AI 渠道 GMV</p>
            <p className={styles.cardValue}>{fmtCurrency(overview.aiGMV)}</p>
            <p className={styles.cardMeta}>占比 {fmtPercent(overview.aiShare)}</p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>AI 渠道订单</p>
            <p className={styles.cardValue}>{fmtNumber(overview.aiOrders)}</p>
            <p className={styles.cardMeta}>
              总订单 {fmtNumber(overview.totalOrders)} · {fmtPercent(overview.aiOrderShare)}
            </p>
          </div>
          <div className={styles.card}>
            <p className={styles.cardLabel}>AI 新客</p>
            <p className={styles.cardValue}>{fmtNumber(overview.aiNewCustomers)}</p>
            <p className={styles.cardMeta}>
              AI 新客占比 {fmtPercent(overview.aiNewCustomerRate)} · 全站新客 {fmtNumber(overview.totalNewCustomers)}
            </p>
          </div>
        </div>
        {isLowSample && (
          <div className={styles.lowSampleNotice}>
            样本 < {LOW_SAMPLE_THRESHOLD}，所有指标仅供参考；延长时间范围后可获得更稳定的趋势。
          </div>
        )}

        <div className={styles.twoCol}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>AI 渠道拆分</p>
                <h3 className={styles.sectionTitle}>渠道贡献（GMV / 订单 / 新客）</h3>
              </div>
              <div className={styles.toggleGroup}>
                {[
                  { key: "gmv", label: "GMV" },
                  { key: "orders", label: "订单" },
                  { key: "newCustomers", label: "新客" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    className={`${styles.toggle} ${metricView === key ? styles.toggleActive : ""}`}
                    onClick={() => setMetricView(key as typeof metricView)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.channelList}>
              {channels.map((channel) => {
                const value =
                  metricView === "gmv"
                    ? channel.gmv
                    : metricView === "orders"
                      ? channel.orders
                      : channel.newCustomers;
                const barWidth = `${(value / channelMax) * 100}%`;
                return (
                  <div key={channel.channel} className={styles.channelRow}>
                    <div className={styles.channelLabel}>
                      <span className={styles.channelDot} style={{ background: channel.color }} />
                      <span>{channel.channel}</span>
                    </div>
                    <div className={styles.channelBar}>
                      <div
                        className={styles.channelFill}
                        style={{ width: barWidth, background: channel.color }}
                      />
                    </div>
                    <span className={styles.channelValue}>
                      {metricView === "gmv" ? fmtCurrency(value) : fmtNumber(value)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className={styles.helpText}>
              优先级：referrer > UTM。未带 referrer/UTM 的 AI 流量无法被识别，结果为保守估计。
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>关键指标对比</p>
                <h3 className={styles.sectionTitle}>整体 vs 各 AI 渠道</h3>
              </div>
              {isLowSample ? (
                <span className={styles.smallBadge}>
                  样本 < {LOW_SAMPLE_THRESHOLD} · 解读时请谨慎
                </span>
              ) : (
                <span className={styles.smallBadge}>样本 >= {LOW_SAMPLE_THRESHOLD}</span>
              )}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>渠道</th>
                    <th>AOV</th>
                    <th>新客占比</th>
                    <th>简易复购率</th>
                    <th>样本</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row) => (
                    <tr key={row.channel}>
                      <td className={styles.cellLabel}>
                        {row.channel}
                        {row.isLowSample && <span className={styles.chip}>样本少</span>}
                      </td>
                      <td>{fmtCurrency(row.aov)}</td>
                      <td>{fmtPercent(row.newCustomerRate)}</td>
                      <td>{fmtPercent(row.repeatRate)}</td>
                      <td>{fmtNumber(row.sampleSize)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sampleNote && <p className={styles.warning}>{sampleNote}</p>}
          </div>
        </div>

        <div className={styles.twoCol}>
          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>趋势</p>
                <h3 className={styles.sectionTitle}>GMV / 订单趋势（按渠道过滤）</h3>
              </div>
              <div className={styles.trendControls}>
                <div className={styles.toggleGroup}>
                  {[
                    { key: "gmv", label: "GMV" },
                    { key: "orders", label: "订单" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      className={`${styles.toggle} ${trendMetric === key ? styles.toggleActive : ""}`}
                      onClick={() => setTrendMetric(key as typeof trendMetric)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.trendFilterGroup}>
                  {trendScopes.map((scope) => (
                    <button
                      key={scope.key}
                      className={`${styles.toggle} ${trendScope === scope.key ? styles.toggleActive : ""}`}
                      onClick={() => setTrendScope(scope.key)}
                      type="button"
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.legend}>
              <span className={styles.legendDot} />
              <span>
                {trendScopeLabel} · {trendMetric === "gmv" ? "GMV" : "订单数"}
              </span>
            </div>
            <div className={styles.trendList}>
              {trend.map((point) => {
                const value = getTrendValue(point);
                const secondary =
                  trendScope === "overall"
                    ? trendMetric === "gmv"
                      ? `AI GMV ${fmtCurrency(point.aiGMV)}`
                      : `AI 订单 ${fmtNumber(point.aiOrders)}`
                    : trendMetric === "gmv"
                      ? `总 GMV ${fmtCurrency(point.overallGMV)}`
                      : `总订单 ${fmtNumber(point.overallOrders)}`;

                return (
                  <div key={point.label} className={styles.trendRow}>
                    <div className={styles.trendLabel}>{point.label}</div>
                    <div className={styles.trendBarBlock}>
                      <div className={styles.trendBar}>
                        <div
                          className={styles.trendFill}
                          style={{ width: `${(value / trendMax) * 100}%` }}
                        />
                      </div>
                      <div className={styles.trendMeta}>
                        <span>{trendMetric === "gmv" ? fmtCurrency(value) : fmtNumber(value)}</span>
                        <span>{secondary}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={styles.helpText}>
              可切换 GMV / 订单并按渠道过滤；样本量低时单笔订单会放大波动，解读时需结合渠道详情。
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.sectionLabel}>产品维度</p>
                <h3 className={styles.sectionTitle}>Top Products from AI Channels</h3>
              </div>
              <a
                className={styles.secondaryButton}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(exportData.productsCsv)}`}
                download={`ai-products-${range}.csv`}
              >
                导出产品榜单 CSV
              </a>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>AI 渠道订单</th>
                    <th>AI GMV</th>
                    <th>AI 占比</th>
                    <th>Top 渠道</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product) => (
                    <tr key={product.id}>
                      <td className={styles.cellLabel}>
                        <a href={product.url} target="_blank" rel="noreferrer" className={styles.link}>
                          {product.title}
                        </a>
                      </td>
                      <td>{fmtNumber(product.aiOrders)}</td>
                      <td>{fmtCurrency(product.aiGMV)}</td>
                      <td>{fmtPercent(product.aiShare)}</td>
                      <td>{product.topChannel ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.helpText}>
              统计口径：含 AI 渠道订单中出现过的产品；占比=AI 渠道订单数 / 产品总订单数。
            </p>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionLabel}>调试视图</p>
              <h3 className={styles.sectionTitle}>最近订单来源解析</h3>
            </div>
            <span className={styles.smallBadge}>Referrer + UTM + Tags</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>订单</th>
                  <th>时间</th>
                  <th>AI 渠道</th>
                  <th>GMV</th>
                  <th>Referrer / UTM</th>
                  <th>解析结果</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td className={styles.cellLabel}>{order.name}</td>
                    <td>{timeFormatter.format(new Date(order.createdAt))}</td>
                    <td>{order.aiSource ?? "-"}</td>
                    <td>{fmtCurrency(order.totalPrice)}</td>
                    <td>
                      <div className={styles.debugCol}>
                        <span>referrer: {order.referrer || "—"}</span>
                        <span>source_name: {order.sourceName || "—"}</span>
                        <span>utm_source: {order.utmSource || "—"}</span>
                        <span>utm_medium: {order.utmMedium || "—"}</span>
                      </div>
                    </td>
                    <td>{order.detection}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.helpText}>
            若识别结果与预期不符，可在「设置 / 规则 & 导出」中调整 AI 域名与 UTM 映射；所有结果均为保守估计。
          </p>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
