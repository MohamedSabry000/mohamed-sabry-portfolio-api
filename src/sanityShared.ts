// Shared by the API server and the static (GitHub Pages) build. Keep this file free of imports.
export interface SanityLocalized {
  en: string
  ar: string
}

export interface SanityKnowledgeItem {
  id: string
  question: SanityLocalized
  answer: SanityLocalized
  keywords: string[]
}

export interface SanitySettings {
  enabled?: boolean
  mode?: 'auto' | 'local' | 'remote'
  name?: SanityLocalized
  greeting?: SanityLocalized
  instructions?: string
  suggestions?: SanityLocalized[]
}

export const ASSISTANT_QUERY = `{
  "settings": *[_id == "aiAssistant"][0]{ enabled, mode, name, greeting, instructions, suggestions[]{ en, ar } },
  "knowledge": *[_type in ["aiKnowledge", "faq"] && active != false] | order(coalesce(priority, 0) desc, _createdAt asc){
    "id": _id, question, answer, "keywords": coalesce(keywords, [])
  }
}`

// Accepts both localized objects ({ en, ar }) and plain strings (e.g. the existing `faq` documents).
const cleanLocalized = (value: unknown): SanityLocalized => {
  if (typeof value === 'string') return { en: value.trim(), ar: '' }
  const v = (value ?? {}) as Partial<SanityLocalized>
  return { en: String(v.en ?? '').trim(), ar: String(v.ar ?? '').trim() }
}

export function normalizeContent(raw: { settings?: unknown; knowledge?: unknown } | null): {
  settings: SanitySettings | null
  knowledge: SanityKnowledgeItem[]
} {
  const s = (raw?.settings ?? null) as Record<string, unknown> | null
  const settings: SanitySettings | null = s
    ? {
        ...(typeof s.enabled === 'boolean' ? { enabled: s.enabled } : {}),
        ...(s.mode === 'auto' || s.mode === 'local' || s.mode === 'remote' ? { mode: s.mode } : {}),
        ...(s.name ? { name: cleanLocalized(s.name) } : {}),
        ...(s.greeting ? { greeting: cleanLocalized(s.greeting) } : {}),
        ...(typeof s.instructions === 'string' ? { instructions: s.instructions } : {}),
        ...(Array.isArray(s.suggestions)
          ? { suggestions: s.suggestions.map(cleanLocalized).filter((item) => item.en || item.ar) }
          : {}),
      }
    : null
  const knowledge = (Array.isArray(raw?.knowledge) ? raw.knowledge : [])
    .map((item: Record<string, unknown>) => ({
      id: String(item.id ?? ''),
      question: cleanLocalized(item.question),
      answer: cleanLocalized(item.answer),
      keywords: Array.isArray(item.keywords) ? item.keywords.map(String).filter(Boolean) : [],
    }))
    .filter((item) => item.id && (item.answer.en || item.answer.ar))
  return { settings, knowledge }
}
