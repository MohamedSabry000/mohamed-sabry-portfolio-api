import { createClient, type SanityClient } from '@sanity/client'

import { ASSISTANT_QUERY, normalizeContent, type SanityKnowledgeItem, type SanitySettings } from './sanityShared.js'

export { normalizeContent }
export type SanityKnowledge = SanityKnowledgeItem
export type SanityAssistantSettings = SanitySettings

export interface AssistantContent {
  configured: boolean
  logging: boolean
  settings: SanityAssistantSettings | null
  knowledge: SanityKnowledge[]
}

const CACHE_MS = Number(process.env.SANITY_CACHE_SECONDS ?? 60) * 1000

const projectId = process.env.SANITY_PROJECT_ID ?? ''
const dataset = process.env.SANITY_DATASET ?? 'production'
const apiVersion = process.env.SANITY_API_VERSION ?? '2025-02-19'
const readToken = process.env.SANITY_READ_TOKEN || undefined
const writeToken = process.env.SANITY_WRITE_TOKEN || undefined

const readClient: SanityClient | null = projectId
  ? createClient({ projectId, dataset, apiVersion, useCdn: !readToken, token: readToken, perspective: 'published' })
  : null
const writeClient: SanityClient | null =
  projectId && writeToken ? createClient({ projectId, dataset, apiVersion, useCdn: false, token: writeToken }) : null

export const sanityStatus = () => ({ configured: Boolean(readClient), logging: Boolean(writeClient), dataset })

let cache: { at: number; value: AssistantContent } | null = null

export async function getAssistantContent(): Promise<AssistantContent> {
  const status = sanityStatus()
  if (!readClient) return { ...status, settings: null, knowledge: [] }
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  try {
    const raw = await readClient.fetch(ASSISTANT_QUERY)
    const value = { ...status, ...normalizeContent(raw) }
    cache = { at: Date.now(), value }
    return value
  } catch (error) {
    console.error('sanity fetch failed', error instanceof Error ? error.message : error)
    return cache?.value ?? { ...status, settings: null, knowledge: [] }
  }
}

/** Extra system-prompt section with knowledge managed in Sanity. */
export function buildSanityPrompt(content: Pick<AssistantContent, 'knowledge'>) {
  if (!content.knowledge.length) return ''
  return [
    '',
    '=== ADDITIONAL KNOWLEDGE (managed in Sanity CMS — treat as facts about Mohamed) ===',
    'Some answers are written in Mohamed\'s own voice ("I …"); when using them, refer to him in the third person.',
    ...content.knowledge.map((k) => `- Q: ${k.question.en || k.question.ar} A: ${k.answer.en || k.answer.ar}`),
  ].join('\n')
}

export interface ChatLogEntry {
  sessionId: string
  lang: string
  question: string
  answer: string
  source: string
}

export async function logConversation(entry: ChatLogEntry) {
  if (!writeClient) return false
  const sessionId = entry.sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  if (!sessionId) return false
  const now = new Date().toISOString()
  const id = `aiConversation.${sessionId}`
  const message = (role: string, content: string, source?: string) => ({
    _type: 'chatMessage',
    _key: Math.random().toString(36).slice(2, 12),
    role,
    content: content.slice(0, 4000),
    ...(source ? { source } : {}),
    createdAt: now,
  })
  await writeClient
    .transaction()
    .createIfNotExists({ _id: id, _type: 'aiConversation', sessionId, lang: entry.lang, startedAt: now, messages: [] })
    .patch(id, (patch) =>
      patch
        .setIfMissing({ messages: [] })
        .append('messages', [message('user', entry.question), message('assistant', entry.answer, entry.source)])
        .set({ updatedAt: now, lang: entry.lang }),
    )
    .commit({ visibility: 'async' })
  return true
}
