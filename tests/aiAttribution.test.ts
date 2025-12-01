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
    const { aiSource, detection } = detectAiFromFields('https://copilot.microsoft.com/chat', 'https://example.com/?utm_source=chatgpt', 'chatgpt', undefined, [], undefined, cfg)
    expect(aiSource).toBe('Copilot')
    expect(detection.toLowerCase()).toContain('conflict: utm_source=chatgpt')
  })

  it('covers default domains like Gemini/Perplexity', () => {
    const gem = detectAiFromFields('https://gemini.google.com/app', '', undefined, undefined, [], undefined, cfg)
    expect(gem.aiSource).toBe('Gemini')
    const perp = detectAiFromFields('https://www.perplexity.ai/search', '', undefined, undefined, [], undefined, cfg)
    expect(perp.aiSource).toBe('Perplexity')
  })
})

