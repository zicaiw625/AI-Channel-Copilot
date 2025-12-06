import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as llms from '../app/lib/llms.server'

vi.mock('../app/db.server', () => ({
  default: {
    orderProduct: {
      findMany: vi.fn().mockResolvedValue([
        { url: 'https://shop.example.com/products/a', price: 100, quantity: 2 },
        { url: 'https://shop.example.com/products/b', price: 50, quantity: 1 },
      ]),
    },
  },
}))

// Mock logger to avoid console output in tests
vi.mock('../app/lib/logger.server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('llms.server buildLlmsTxt', () => {
  // Mock Date to ensure consistent timestamps in snapshots
  const FIXED_DATE = new Date('2025-01-01T00:00:00.000Z')
  
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_DATE)
  })
  
  afterAll(() => {
    vi.useRealTimers()
  })
  const baseSettings = { exposurePreferences: { exposeProducts: true, exposeCollections: false, exposeBlogs: false }, primaryCurrency: 'USD', languages: ['中文'] }

  it('generates Chinese text with product list', async () => {
    const text = await llms.buildLlmsTxt('shop.example.com', baseSettings, { range: '30d', topN: 2 })
    expect(text).toMatchSnapshot()
    expect(text).toContain('products:')
    expect(text).toContain('https://shop.example.com/products/a')
  })

  it('generates English text and respects exposure toggles without admin', async () => {
    const text = await llms.buildLlmsTxt('shop.example.com', { 
      ...baseSettings, 
      languages: ['English'], 
      exposurePreferences: { exposeProducts: false, exposeCollections: true, exposeBlogs: true } 
    }, { range: '7d', topN: 1 })
    expect(text).toMatchSnapshot()
    expect(text).toContain('# llms.txt · AI crawling preferences (experimental)')
    // Without admin, it should show "require API access" message
    expect(text).toContain('# Collections require API access')
    expect(text).toContain('# Blog articles require API access')
  })

  it('shows disabled messages when exposure is off', async () => {
    const text = await llms.buildLlmsTxt('shop.example.com', {
      ...baseSettings,
      languages: ['English'],
      exposurePreferences: { exposeProducts: false, exposeCollections: false, exposeBlogs: false }
    }, { range: '30d' })
    expect(text).toContain('# Product exposure is disabled')
    expect(text).toContain('# Collections exposure is disabled')
    expect(text).toContain('# Blog exposure is disabled')
  })
})

