import { describe, it, expect, vi } from 'vitest'
import * as llms from '../app/lib/llms.server'

vi.mock('../app/db.server', () => ({
  default: {
    orderProduct: {
      findMany: vi.fn().mockResolvedValue([
        { url: 'https://shop.example.com/products/a' },
        { url: 'https://shop.example.com/products/b' },
      ]),
    },
  },
}))

describe('llms.server buildLlmsTxt', () => {
  const baseSettings = { exposurePreferences: { exposeProducts: true, exposeCollections: false, exposeBlogs: false }, primaryCurrency: 'USD', languages: ['中文'] }

  it('generates Chinese text with product allow list', async () => {
    const text = await llms.buildLlmsTxt('shop.example.com', baseSettings, { range: '30d', topN: 2 })
    expect(text).toMatchSnapshot()
    expect(text).toContain('allow:')
    expect(text).toContain('https://shop.example.com/products/a')
  })

  it('generates English text and respects exposure toggles', async () => {
    const text = await llms.buildLlmsTxt('shop.example.com', { ...baseSettings, languages: ['English'], exposurePreferences: { exposeProducts: false, exposeCollections: true, exposeBlogs: true } }, { range: '7d', topN: 1 })
    expect(text).toMatchSnapshot()
    expect(text).toContain('# llms.txt · AI crawling preferences (experimental)')
    expect(text).toContain('# Reserved: collections/categories list')
  })
})

