import { describe, expect, it } from 'vitest'
import { buildSanityPrompt, getAssistantContent, normalizeContent } from './sanity.ts'

describe('server Sanity integration', () => {
  it('normalizes and filters GROQ results', () => {
    const { settings, knowledge } = normalizeContent({
      settings: { enabled: false, mode: 'bogus', name: { en: 'Bot' }, suggestions: [{ en: 'Hi' }, {}] },
      knowledge: [
        { id: 'a', question: { en: 'Q' }, answer: { en: 'A' }, keywords: ['k'] },
        { id: 'b', question: { en: 'Empty' }, answer: {} },
      ],
    })
    expect(settings).toEqual({ enabled: false, name: { en: 'Bot', ar: '' }, suggestions: [{ en: 'Hi', ar: '' }] })
    expect(knowledge).toEqual([{ id: 'a', question: { en: 'Q', ar: '' }, answer: { en: 'A', ar: '' }, keywords: ['k'] }])
  })

  it('accepts plain-string faq documents', () => {
    const { knowledge } = normalizeContent({
      knowledge: [{ id: 'faq-1', question: 'Where did you study?', answer: 'Benha University.', keywords: ['study'] }],
    })
    expect(knowledge[0]).toEqual({
      id: 'faq-1',
      question: { en: 'Where did you study?', ar: '' },
      answer: { en: 'Benha University.', ar: '' },
      keywords: ['study'],
    })
  })

  it('builds the extra prompt section only when there is knowledge', () => {
    expect(buildSanityPrompt({ knowledge: [] })).toBe('')
    expect(
      buildSanityPrompt({ knowledge: [{ id: 'a', question: { en: 'Q', ar: '' }, answer: { en: 'A', ar: '' }, keywords: [] }] }),
    ).toContain('- Q: Q A: A')
  })

  it('returns empty content when Sanity is not configured', async () => {
    await expect(getAssistantContent()).resolves.toEqual({
      configured: false,
      logging: false,
      dataset: 'production',
      settings: null,
      knowledge: [],
    })
  })
})
