// REST API backed by MongoDB: admin auth, contact messages, chat logs and portfolio content CRUD.
import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { isValidObjectId } from 'mongoose'
import { login, requireAdmin, updateCredentials, type AuthedRequest } from './auth.ts'
import { ChatLogModel, isDbConnected, MessageModel } from './db.ts'
import {
  deleteItem,
  getItem,
  getPortfolio,
  getSiteValue,
  isCollection,
  listItems,
  reorderItems,
  replacePortfolio,
  saveItem,
  setSiteValue,
  SITE_KEYS,
  type CollectionName,
} from './portfolioStore.ts'

export const api = Router()

const requireDb = (_req: unknown, res: Response, next: () => void) => {
  if (isDbConnected()) next()
  else res.status(503).json({ error: 'database_unavailable' })
}

const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

// --- Auth ---
api.post('/auth/login', requireDb, async (req, res) => {
  const token = await login(text(req.body?.username, 100), String(req.body?.password ?? ''))
  if (!token) return void res.status(401).json({ error: 'invalid_credentials' })
  res.json({ token })
})

api.get('/auth/me', requireAdmin, (req: AuthedRequest, res) => res.json({ username: req.admin?.username }))

api.put('/auth/credentials', requireDb, requireAdmin, async (req: AuthedRequest, res) => {
  const username = text(req.body?.username, 100)
  const password = String(req.body?.password ?? '')
  if (!username || password.length < 6) return void res.status(400).json({ error: 'invalid' })
  await updateCredentials(req.admin!.sub, username, password)
  res.status(204).end()
})

// --- Contact messages ---
api.post('/messages', requireDb, async (req, res) => {
  const message = {
    name: text(req.body?.name, 120),
    email: text(req.body?.email, 200),
    subject: text(req.body?.subject, 200),
    message: text(req.body?.message, 5000),
  }
  if (!message.name || !isEmail(message.email) || !message.message) return void res.status(400).json({ error: 'invalid' })
  const doc = await MessageModel.create(message)
  res.status(201).json({ id: doc.id })
})

api.get('/messages', requireDb, requireAdmin, async (_req, res) => {
  const items = await MessageModel.find().sort({ createdAt: -1 }).limit(500).lean()
  res.json(items.map(({ _id, createdAt, name, email, subject, message, read }) => ({ id: String(_id), createdAt, name, email, subject, message, read })))
})

api.patch('/messages/:id', requireDb, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return void res.status(400).json({ error: 'invalid_id' })
  await MessageModel.findByIdAndUpdate(req.params.id, { read: Boolean(req.body?.read) })
  res.status(204).end()
})

api.delete('/messages/:id', requireDb, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return void res.status(400).json({ error: 'invalid_id' })
  await MessageModel.findByIdAndDelete(req.params.id)
  res.status(204).end()
})

// --- Visitor chat logs ---
api.get('/chat-logs', requireDb, requireAdmin, async (_req, res) => {
  res.json(await ChatLogModel.find().sort({ createdAt: -1 }).limit(500).lean())
})

// --- Portfolio content ---
// Whole portfolio in one request (used by the site on page load).
api.get('/portfolio', requireDb, async (_req, res) => res.json(await getPortfolio()))

// Replace everything: JSON import and "reset to CV" in admin → Settings.
api.post('/portfolio/import', requireDb, requireAdmin, async (req, res) => {
  const data = req.body?.data
  if (!data || typeof data !== 'object' || !data.profile) return void res.status(400).json({ error: 'invalid' })
  await replacePortfolio(data)
  res.json(await getPortfolio())
})

// Single values: GET/PUT /api/profile, /api/softSkills, /api/sections
for (const key of SITE_KEYS) {
  api.get(`/${key}`, requireDb, async (_req, res) => res.json(await getSiteValue(key)))
  api.put(`/${key}`, requireDb, requireAdmin, async (req, res) => {
    if (req.body === undefined || req.body === null) return void res.status(400).json({ error: 'invalid' })
    await setSiteValue(key, req.body)
    res.json(req.body)
  })
}

// Lists: CRUD on /api/:collection (experiences, projects, skillGroups, education, certificates, languages, blog, faqs)
const collectionParam = (req: Request, res: Response): CollectionName | null => {
  const collection = String(req.params.collection)
  if (isCollection(collection)) return collection
  res.status(404).json({ error: 'unknown_collection' })
  return null
}

api.get('/:collection', requireDb, async (req, res) => {
  const collection = collectionParam(req, res)
  if (collection) res.json(await listItems(collection))
})

api.put('/:collection/order', requireDb, requireAdmin, async (req, res) => {
  const collection = collectionParam(req, res)
  if (!collection) return
  const ids = req.body?.ids
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return void res.status(400).json({ error: 'invalid' })
  await reorderItems(collection, ids)
  res.status(204).end()
})

api.get('/:collection/:id', requireDb, async (req, res) => {
  const collection = collectionParam(req, res)
  if (!collection) return
  const item = await getItem(collection, String(req.params.id))
  if (item) res.json(item)
  else res.status(404).json({ error: 'not_found' })
})

api.post('/:collection', requireDb, requireAdmin, async (req, res) => {
  const collection = collectionParam(req, res)
  if (!collection) return
  if (!req.body || typeof req.body !== 'object') return void res.status(400).json({ error: 'invalid' })
  const id = typeof req.body.id === 'string' && req.body.id ? req.body.id : `${collection}-${randomUUID()}`
  if (await getItem(collection, id)) return void res.status(409).json({ error: 'exists' })
  res.status(201).json(await saveItem(collection, id, req.body))
})

api.put('/:collection/:id', requireDb, requireAdmin, async (req, res) => {
  const collection = collectionParam(req, res)
  if (!collection) return
  if (!req.body || typeof req.body !== 'object') return void res.status(400).json({ error: 'invalid' })
  res.json(await saveItem(collection, String(req.params.id), req.body))
})

api.delete('/:collection/:id', requireDb, requireAdmin, async (req, res) => {
  const collection = collectionParam(req, res)
  if (!collection) return
  if (await deleteItem(collection, String(req.params.id))) res.status(204).end()
  else res.status(404).json({ error: 'not_found' })
})

export async function saveChatLog(entry: { sessionId: string; lang: string; question: string; answer: string; source: string }) {
  if (isDbConnected()) await ChatLogModel.create(entry)
}
