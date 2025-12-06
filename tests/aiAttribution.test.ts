import { describe, it, expect } from 'vitest'
import { detectAiFromFields } from '../app/lib/aiAttribution'
import { defaultSettings } from '../app/lib/aiData'

const cfg = {
  aiDomains: defaultSettings.aiDomains,
  utmSources: defaultSettings.utmSources,
  utmMediumKeywords: defaultSettings.utmMediumKeywords,
  tagPrefix: defaultSettings.tagging.orderTagPrefix,
  lang: 'English' as const,
}

describe('aiAttribution detection priority', () => {
  it('referrer-only matches domain rules', () => {
    const { aiSource, detection } = detectAiFromFields('https://chat.openai.com/some', 'https://example.com', undefined, undefined, [], undefined, cfg)
    expect(aiSource).toBe('ChatGPT')
    expect(detection.toLowerCase()).toContain('referrer matched')
  })

  it('utm-only maps to channel when no domain hit', () => {
    const { aiSource, detection } = detectAiFromFields('', 'https://example.com/?utm_source=perplexity', 'perplexity', undefined, [], undefined, cfg)
    expect(aiSource).toBe('Perplexity')
    expect(detection.toLowerCase()).toContain('utm_source=perplexity')
  })

  it('referrer + utm conflict prefers referrer channel', () => {
    // 测试场景1：Copilot 域名直接检测（不触发冲突逻辑，因为 copilot.microsoft.com 是优先检测路径）
    const copilotResult = detectAiFromFields('https://copilot.microsoft.com/chat', 'https://example.com/?utm_source=chatgpt', 'chatgpt', undefined, [], undefined, cfg)
    expect(copilotResult.aiSource).toBe('Copilot')
    expect(copilotResult.detection.toLowerCase()).toContain('copilot domain detected')
    
    // 测试场景2：使用常规域名匹配时，冲突应该被记录
    const chatgptResult = detectAiFromFields('https://chat.openai.com/c/abc', 'https://example.com/?utm_source=perplexity', 'perplexity', undefined, [], undefined, cfg)
    expect(chatgptResult.aiSource).toBe('ChatGPT')
    expect(chatgptResult.detection.toLowerCase()).toContain('conflict: utm_source=perplexity')
  })

  it('covers default domains like Gemini/Perplexity', () => {
    const gem = detectAiFromFields('https://gemini.google.com/app', '', undefined, undefined, [], undefined, cfg)
    expect(gem.aiSource).toBe('Gemini')
    const perp = detectAiFromFields('https://www.perplexity.ai/search', '', undefined, undefined, [], undefined, cfg)
    expect(perp.aiSource).toBe('Perplexity')
  })
})

