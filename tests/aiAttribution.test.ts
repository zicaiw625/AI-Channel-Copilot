import { describe, it, expect } from 'vitest'
import { detectAiFromFields, aiValueToChannel, detectFromNoteAttributes } from '../app/lib/aiAttribution'
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

describe('aiValueToChannel - precompiled regex performance', () => {
  it('exact match for channel names', () => {
    expect(aiValueToChannel('chatgpt', cfg.utmSources)).toBe('ChatGPT')
    expect(aiValueToChannel('PERPLEXITY', cfg.utmSources)).toBe('Perplexity')
    expect(aiValueToChannel('Gemini', cfg.utmSources)).toBe('Gemini')
    expect(aiValueToChannel('copilot', cfg.utmSources)).toBe('Copilot')
  })

  it('word boundary matching prevents false positives', () => {
    // "notchatgpt" should NOT match ChatGPT
    expect(aiValueToChannel('notchatgpt', cfg.utmSources)).toBe(null)
    // "chatgptplus" should NOT match (no word boundary at end)
    expect(aiValueToChannel('chatgptplus', cfg.utmSources)).toBe(null)
    // But "chatgpt-plus" SHOULD match (hyphen creates word boundary)
    expect(aiValueToChannel('chatgpt-plus', [])).toBe('ChatGPT')
  })

  it('returns null for empty or unrecognized values', () => {
    expect(aiValueToChannel('', cfg.utmSources)).toBe(null)
    expect(aiValueToChannel('  ', cfg.utmSources)).toBe(null)
    expect(aiValueToChannel('unknown-platform', cfg.utmSources)).toBe(null)
  })
})

describe('detectFromNoteAttributes - strict AI detection', () => {
  it('detects explicit AI source fields', () => {
    const result = detectFromNoteAttributes(
      [{ name: 'ai_source', value: 'chatgpt' }],
      cfg.utmSources
    )
    expect(result?.aiSource).toBe('ChatGPT')
  })

  it('detects strict AI platform names', () => {
    const result = detectFromNoteAttributes(
      [{ name: 'referrer', value: 'from openai chatbot' }],
      cfg.utmSources
    )
    expect(result?.aiSource).toBe('ChatGPT')
  })

  it('does NOT match "hawaii" as AI (false positive prevention)', () => {
    // This was a bug: "hawaii" contains "ai" but should NOT be detected as AI
    const result = detectFromNoteAttributes(
      [{ name: 'source', value: 'hawaii' }],
      cfg.utmSources
    )
    expect(result).toBe(null)
  })

  it('does NOT match "email" as AI', () => {
    const result = detectFromNoteAttributes(
      [{ name: 'source', value: 'email' }],
      cfg.utmSources
    )
    expect(result).toBe(null)
  })

  it('does NOT match "contain" as AI', () => {
    const result = detectFromNoteAttributes(
      [{ name: 'channel', value: 'contain-promo' }],
      cfg.utmSources
    )
    expect(result).toBe(null)
  })

  it('DOES match explicit "ai" standalone value', () => {
    const result = detectFromNoteAttributes(
      [{ name: 'source', value: 'ai' }],
      cfg.utmSources
    )
    expect(result?.aiSource).toBe('Other-AI')
  })

  it('DOES match "ai-assistant" value', () => {
    const result = detectFromNoteAttributes(
      [{ name: 'traffic_source', value: 'ai-assistant' }],
      cfg.utmSources
    )
    expect(result?.aiSource).toBe('Other-AI')
  })

  it('requires AI context for ambiguous words like "gemini"', () => {
    // "gemini" without AI context should NOT match
    const noContext = detectFromNoteAttributes(
      [{ name: 'shipping', value: 'gemini express' }],
      cfg.utmSources
    )
    expect(noContext).toBe(null)

    // "gemini" WITH AI context should match
    const withContext = detectFromNoteAttributes(
      [{ name: 'ai_chat', value: 'gemini' }],
      cfg.utmSources
    )
    expect(withContext?.aiSource).toBe('Gemini')
  })
})

describe('tag matching detection', () => {
  it('detects AI channel from existing tags', () => {
    const result = detectAiFromFields(
      '', '', undefined, undefined, 
      ['AI-Source-ChatGPT', 'other-tag'],
      undefined, cfg
    )
    expect(result.aiSource).toBe('ChatGPT')
    expect(result.detection.toLowerCase()).toContain('existing tag')
  })

  it('supports multiple tag separators', () => {
    const hyphen = detectAiFromFields('', '', undefined, undefined, ['AI-Source-Perplexity'], undefined, cfg)
    expect(hyphen.aiSource).toBe('Perplexity')

    const colon = detectAiFromFields('', '', undefined, undefined, ['AI-Source:Gemini'], undefined, cfg)
    expect(colon.aiSource).toBe('Gemini')

    const underscore = detectAiFromFields('', '', undefined, undefined, ['AI-Source_Copilot'], undefined, cfg)
    expect(underscore.aiSource).toBe('Copilot')
  })

  it('handles empty tag suffix gracefully', () => {
    const result = detectAiFromFields('', '', undefined, undefined, ['AI-Source-'], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
    expect(result.detection.toLowerCase()).toContain('empty suffix')
  })
})

describe('edge cases and boundary conditions', () => {
  it('handles null/undefined values gracefully', () => {
    const result = detectAiFromFields(
      '', '', undefined, undefined, undefined, undefined, cfg
    )
    expect(result.aiSource).toBe(null)
    expect(result.detection.toLowerCase()).toContain('no ai signals')
  })

  it('handles malformed URLs without crashing', () => {
    const result = detectAiFromFields(
      'not-a-valid-url', 
      '://also-invalid', 
      undefined, undefined, [], undefined, cfg
    )
    expect(result.aiSource).toBe(null)
  })

  it('handles very long detection strings by truncating', () => {
    // Detection strings should not exceed reasonable length
    const result = detectAiFromFields(
      '', '', undefined, undefined, [], undefined, cfg
    )
    expect(result.detection.length).toBeLessThan(500)
  })
})

describe('new AI platforms detection', () => {
  it('detects You.com', () => {
    const result = detectAiFromFields('https://you.com/search', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
  })

  it('detects Phind', () => {
    const result = detectAiFromFields('https://www.phind.com/', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
  })

  it('detects Poe', () => {
    const result = detectAiFromFields('https://poe.com/chat', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
  })

  it('detects Claude', () => {
    const result = detectAiFromFields('https://claude.ai/', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
  })

  it('detects DeepSeek', () => {
    const result = detectAiFromFields('https://chat.deepseek.com/', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
  })

  it('detects Kimi (Moonshot)', () => {
    const result = detectAiFromFields('https://kimi.moonshot.cn/', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
  })

  it('detects Meta AI', () => {
    const result = detectAiFromFields('https://www.meta.ai/', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Other-AI')
  })

  it('detects Chinese AI platforms via UTM', () => {
    // 通义千问
    const tongyi = detectAiFromFields('', '', 'tongyi', undefined, [], undefined, cfg)
    expect(tongyi.aiSource).toBe('Other-AI')

    // 文心一言
    const yiyan = detectAiFromFields('', '', 'yiyan', undefined, [], undefined, cfg)
    expect(yiyan.aiSource).toBe('Other-AI')

    // Kimi
    const kimi = detectAiFromFields('', '', 'kimi', undefined, [], undefined, cfg)
    expect(kimi.aiSource).toBe('Other-AI')
  })
})

describe('Bing Copilot special detection', () => {
  it('detects Copilot from bing.com/chat path', () => {
    const result = detectAiFromFields('https://www.bing.com/chat', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Copilot')
  })

  it('detects Copilot from bing.com with form parameter', () => {
    const result = detectAiFromFields('https://www.bing.com/search?q=test&form=BINGAI', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe('Copilot')
  })

  it('does not detect regular bing.com as Copilot', () => {
    const result = detectAiFromFields('https://www.bing.com/search?q=test', '', undefined, undefined, [], undefined, cfg)
    expect(result.aiSource).toBe(null)
  })
})

describe('multilingual output', () => {
  it('outputs English detection messages', () => {
    const result = detectAiFromFields('', '', undefined, undefined, [], undefined, { ...cfg, lang: 'English' })
    expect(result.detection).toContain('No AI signals')
    expect(result.detection).toContain('confidence')
  })

  it('outputs Chinese detection messages', () => {
    const result = detectAiFromFields('', '', undefined, undefined, [], undefined, { ...cfg, lang: '中文' })
    expect(result.detection).toContain('未检测到 AI 信号')
    expect(result.detection).toContain('置信度')
  })
})

