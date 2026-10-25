import './env.js'
import express from 'express'
import { connectDb, isDbConnected } from './db.js'
import { api, saveChatLog } from './routes.js'
import { buildSanityPrompt, getAssistantContent, logConversation, sanityStatus } from './sanity.js'

export const app = express()
export default app

export const API_KEY = process.env.OPENAI_API_KEY ?? ''
const BASE_URL = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
export const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

app.set('trust proxy', true)
app.use(express.json({ limit: '2mb' }))

// CORS: the front end runs on a different origin. Entries may use `*`, e.g. https://*.vercel.app
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'https://mohamedsabry000.github.io,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => new RegExp(`^${origin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`))
export const isAllowedOrigin = (origin: string) => ALLOWED_ORIGINS.some((pattern) => pattern.test(origin))

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') return void res.status(204).end()
  next()
})

// Connect lazily so the same app works as a long-running server and as a serverless function.
let dbReady: Promise<boolean> | undefined
export function ensureDb() {
  dbReady ??= connectDb(process.env.MONGODB_URI).then((ok) => {
    if (!ok) dbReady = undefined
    return ok
  })
  return dbReady
}
app.use(async (_req, _res, next) => {
  await ensureDb()
  next()
})

// Basic per-IP rate limit to protect the API key.
const WINDOW_MS = 10 * 60 * 1000
const MAX_REQUESTS = Number(process.env.CHAT_RATE_LIMIT ?? 40)
const hits = new Map<string, number[]>()
function rateLimited(ip: string) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > MAX_REQUESTS
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llm: Boolean(API_KEY), model: API_KEY ? MODEL : null, sanity: sanityStatus(), database: isDbConnected() })
})

// Assistant settings + knowledge managed in Sanity (public, read-only).
app.get('/api/assistant', async (_req, res) => {
  const content = await getAssistantContent()
  res.setHeader('cache-control', 'public, max-age=30')
  res.json({ ...content, logging: content.logging || isDbConnected() })
})

app.post('/api/chat/log', async (req, res) => {
  if (!sanityStatus().logging && !isDbConnected()) {
    res.status(204).end()
    return
  }
  if (rateLimited(`log:${req.ip ?? 'unknown'}`)) {
    res.status(429).json({ error: 'rate_limited' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const entry = {
    sessionId: String(body.sessionId ?? ''),
    lang: body.lang === 'ar' ? 'ar' : 'en',
    question: String(body.question ?? '').slice(0, 2000),
    answer: String(body.answer ?? '').slice(0, 4000),
    source: body.source === 'llm' ? 'llm' : 'local',
  }
  if (!entry.question || !entry.answer) {
    res.status(400).json({ error: 'invalid' })
    return
  }
  try {
    await Promise.all([saveChatLog(entry), sanityStatus().logging ? logConversation(entry) : null])
    res.status(204).end()
  } catch (error) {
    console.error('chat log failed', error instanceof Error ? error.message : error)
    res.status(502).json({ error: 'log_failed' })
  }
})

app.use('/api', api)

interface ChatBody {
  system?: string
  messages?: Array<{ role: string; content: string }>
}

app.post('/api/chat', async (req, res) => {
  if (!API_KEY) {
    res.status(503).json({ error: 'not_configured' })
    return
  }
  if (rateLimited(req.ip ?? 'unknown')) {
    res.status(429).json({ error: 'rate_limited' })
    return
  }
  const { system = '', messages = [] } = (req.body ?? {}) as ChatBody
  const cleaned = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
  if (!cleaned.length) {
    res.status(400).json({ error: 'no_messages' })
    return
  }

  const sanityPrompt = buildSanityPrompt(await getAssistantContent()).slice(0, 12000)

  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        temperature: 0.4,
        max_tokens: 500,
        messages: [{ role: 'system', content: String(system).slice(0, 20000) + sanityPrompt }, ...cleaned],
      }),
    })
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: 'upstream_error', status: upstream.status })
      return
    }

    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.setHeader('cache-control', 'no-cache')
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const data = line.replace(/^data:\s*/, '').trim()
        if (!data || data === '[DONE]') continue
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content
          if (delta) res.write(delta)
        } catch {
          // ignore keep-alive / partial lines
        }
      }
    }
    res.end()
  } catch (error) {
    console.error('chat error', error)
    if (!res.headersSent) res.status(500).json({ error: 'server_error' })
    else res.end()
  }
})

app.get('/', (_req, res) => res.json({ name: 'mohamed-sabry-portfolio-api', health: '/api/health' }))
