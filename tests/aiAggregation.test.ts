import { describe, it, expect } from 'vitest'
import { buildOverview, buildChannelBreakdown, buildComparison, buildTrend, buildProducts, buildTopCustomers } from '../app/lib/aiAggregation'
import type { OrderRecord } from '../app/lib/aiData'

const mkOrder = (o: Partial<OrderRecord>): OrderRecord => ({
  id: o.id || 'oid',
  name: o.name || 'O-1',
  createdAt: o.createdAt || new Date().toISOString(),
  totalPrice: o.totalPrice ?? 100,
  subtotalPrice: o.subtotalPrice,
  refundTotal: o.refundTotal || 0,
  aiSource: o.aiSource || null,
  referrer: o.referrer || '',
  landingPage: o.landingPage || '',
  utmSource: o.utmSource || '',
  utmMedium: o.utmMedium || '',
  sourceName: o.sourceName,
  tags: o.tags || [],
  customerId: o.customerId || 'c1',
  isNewCustomer: o.isNewCustomer ?? true,
  products: o.products || [],
  detection: o.detection || '',
  signals: o.signals || [],
  currency: o.currency || 'USD',
})

describe('aiAggregation', () => {
  const orders: OrderRecord[] = [
    mkOrder({ id: 'o1', customerId: 'c1', totalPrice: 120, aiSource: 'ChatGPT', createdAt: new Date('2025-11-01').toISOString(), products: [{ id: 'p1', title: 'P1', handle: 'p1', url: '', price: 60, currency: 'USD', quantity: 2 }] }),
    mkOrder({ id: 'o2', customerId: 'c2', totalPrice: 80, aiSource: null, createdAt: new Date('2025-11-02').toISOString(), products: [{ id: 'p2', title: 'P2', handle: 'p2', url: '', price: 80, currency: 'USD', quantity: 1 }] }),
    mkOrder({ id: 'o3', customerId: 'c1', totalPrice: 50, aiSource: 'Perplexity', createdAt: new Date('2025-11-03').toISOString(), products: [{ id: 'p1', title: 'P1', handle: 'p1', url: '', price: 50, currency: 'USD', quantity: 1 }] }),
  ]
  const range = { key: '7d' as const, label: '最近 7 天', days: 7, start: new Date('2025-11-01'), end: new Date('2025-11-10') }

  it('buildOverview computes totals and shares', () => {
    const ov = buildOverview(orders, 'current_total_price', 'USD')
    expect(ov.totalGMV).toBe(250)
    expect(ov.aiGMV).toBe(170)
    expect(ov.aiOrders).toBe(2)
    expect(ov.totalOrders).toBe(3)
    expect(ov.aiShare).toBeCloseTo(170/250)
  })

  it('buildOverview computes Net GMV by subtracting refunds', () => {
    const withRefunds = [
      mkOrder({ id: 'r1', totalPrice: 100, refundTotal: 20, aiSource: 'ChatGPT' }),
      mkOrder({ id: 'r2', totalPrice: 50, refundTotal: 30, aiSource: null }),
    ]
    const ov = buildOverview(withRefunds, 'current_total_price', 'USD')
    expect(ov.totalGMV).toBe(150)
    expect(ov.netGMV).toBe(100)
    expect(ov.aiGMV).toBe(100)
    expect(ov.netAiGMV).toBe(80)
  })

  it('buildChannelBreakdown aggregates by AI channel', () => {
    const ch = buildChannelBreakdown(orders, 'current_total_price')
    const chat = ch.find(x => x.channel === 'ChatGPT')!
    const perp = ch.find(x => x.channel === 'Perplexity')!
    expect(chat.gmv).toBe(120)
    expect(perp.gmv).toBe(50)
  })

  it('buildComparison returns AOV and flags low samples', () => {
    const cmp = buildComparison(orders, 'current_total_price')
    const overall = cmp.find(x => x.channel === '整体')!
    expect(overall.aov).toBeCloseTo(250/3)
    expect(overall.isLowSample).toBe(true)
  })

  it('buildTrend buckets by day', () => {
    const tr = buildTrend(orders, range, 'current_total_price', 'UTC')
    expect(tr.length).toBeGreaterThanOrEqual(3)
    const d = tr.find(x => x.label.includes('2025-11'))
    expect(d).toBeDefined()
  })

  it('buildProducts allocates AI GMV by line share', () => {
    const pr = buildProducts(orders, 'current_total_price')
    const p1 = pr.find(x => x.handle === 'p1')!
    expect(p1.aiGMV).toBeGreaterThan(0)
    expect(p1.topChannel === 'ChatGPT' || p1.topChannel === 'Perplexity').toBe(true)
  })

  it('buildTopCustomers supports acquiredViaAi map and repeat count', () => {
    const acquired = { c1: true, c2: false }
    const tc = buildTopCustomers(orders, 'current_total_price', 10, acquired)
    const row = tc.find(x => x.customerId === 'c1')!
    expect(row.firstAIAcquired).toBe(true)
    expect(row.repeatCount).toBe(1)
  })
})
