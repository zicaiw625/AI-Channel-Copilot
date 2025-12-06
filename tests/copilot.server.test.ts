import { describe, it, expect } from 'vitest'
import * as intent from '../app/lib/copilot.intent'

describe('copilot.parseIntent', () => {
  // ========== 基本意图识别 ==========
  describe('basic intent mapping', () => {
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

  // ========== 混合语言意图识别 ==========
  // 注意：纯中文关键词由于 JS 正则 \b 限制，需要与英文关键词组合才能有效匹配
  describe('mixed language intent mapping', () => {
    it('recognizes performance keywords with English terms', () => {
      expect(intent.parseIntent('performance 表现')).toBe('ai_performance')
      expect(intent.parseIntent('GMV revenue')).toBe('ai_performance')
      expect(intent.parseIntent('order trend')).toBe('ai_performance')
    })

    it('recognizes AOV comparison keywords with English terms', () => {
      expect(intent.parseIntent('AOV compare')).toBe('ai_vs_all_aov')
      expect(intent.parseIntent('aov vs channel')).toBe('ai_vs_all_aov')
      expect(intent.parseIntent('compare versus')).toBe('ai_vs_all_aov')
    })

    it('recognizes top products keywords with English terms', () => {
      expect(intent.parseIntent('top product')).toBe('ai_top_products')
      expect(intent.parseIntent('best seller ranking')).toBe('ai_top_products')
      expect(intent.parseIntent('top 5 items')).toBe('ai_top_products')
    })
  })

  // ========== 否定表达排除 ==========
  describe('negative expression exclusion', () => {
    it('returns undefined for negative expressions', () => {
      expect(intent.parseIntent('不想看 performance')).toBeUndefined()
      expect(intent.parseIntent('关闭 trend 功能')).toBeUndefined()
      expect(intent.parseIntent('取消订单')).toBeUndefined()
      expect(intent.parseIntent("I don't want to see trends")).toBeUndefined()
      expect(intent.parseIntent('stop showing performance')).toBeUndefined()
      expect(intent.parseIntent('disable this feature')).toBeUndefined()
    })
  })

  // ========== 帮助问题排除 ==========
  describe('help question exclusion', () => {
    it('returns undefined for help/how-to questions', () => {
      expect(intent.parseIntent('怎么设置 AOV')).toBeUndefined()
      expect(intent.parseIntent('如何配置表现')).toBeUndefined()
      expect(intent.parseIntent('how to see performance')).toBeUndefined()
      expect(intent.parseIntent('where is the trend setting')).toBeUndefined()
      expect(intent.parseIntent('can I change the aov metric')).toBeUndefined()
    })
  })

  // ========== 边界情况 ==========
  describe('edge cases', () => {
    it('returns undefined for empty or null input', () => {
      expect(intent.parseIntent(null)).toBeUndefined()
      expect(intent.parseIntent(undefined)).toBeUndefined()
      expect(intent.parseIntent('')).toBeUndefined()
      expect(intent.parseIntent('   ')).toBeUndefined()
    })

    it('returns undefined for very short input', () => {
      expect(intent.parseIntent('a')).toBeUndefined()
      expect(intent.parseIntent('hi')).toBeUndefined()
    })

    it('returns undefined for low-confidence matches (below threshold)', () => {
      // 单个低权重关键词不应该触发意图
      expect(intent.parseIntent('sell')).toBeUndefined()
      expect(intent.parseIntent('recent')).toBeUndefined()
    })

    it('handles mixed language input', () => {
      expect(intent.parseIntent('show me the GMV 表现')).toBe('ai_performance')
      expect(intent.parseIntent('top 产品 list')).toBe('ai_top_products')
    })
  })

  // ========== 置信度评估 ==========
  describe('getIntentConfidence', () => {
    it('returns high confidence for cross-category keyword matches', () => {
      // 需要匹配多个类别的关键词才能得到 high confidence
      const result = intent.getIntentConfidence('compare aov top products')
      expect(result.intent).toBeDefined()
      expect(result.confidence).toBe('high')
    })

    it('returns medium confidence for single-category matches', () => {
      const result = intent.getIntentConfidence('performance')
      expect(result.intent).toBe('ai_performance')
      expect(result.confidence).toBe('medium')
    })

    it('returns none confidence for unrecognized input', () => {
      const result = intent.getIntentConfidence('hello world')
      expect(result.intent).toBeUndefined()
      expect(result.confidence).toBe('none')
    })
  })
})
