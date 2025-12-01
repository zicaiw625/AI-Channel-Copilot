import { describe, it, expect } from 'vitest'
import * as intent from '../app/lib/copilot.intent'

describe('copilot.parseIntent', () => {
  it('maps performance/overview/trend to ai_performance', () => {
    expect(intent.parseIntent('performance this month')).toBe('ai_performance')
    expect(intent.parseIntent('overview stats')).toBe('ai_performance')
    expect(intent.parseIntent('trend lines')).toBe('ai_performance')
  })

  it('maps compare/vs/versus to ai_vs_all_aov', () => {
    expect(intent.parseIntent('compare aov')).toBe('ai_vs_all_aov')
    expect(intent.parseIntent('ai vs all')).toBe('ai_vs_all_aov')
    expect(intent.parseIntent('versus aov')).toBe('ai_vs_all_aov')
  })

  it('maps top/best seller/bestseller to ai_top_products', () => {
    expect(intent.parseIntent('top products')).toBe('ai_top_products')
    expect(intent.parseIntent('best seller list')).toBe('ai_top_products')
    expect(intent.parseIntent('bestseller from ai')).toBe('ai_top_products')
  })
})
