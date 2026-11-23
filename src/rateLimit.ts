// Fixed-window rate limiting shared by every server instance.
// On serverless hosts each instance has its own memory, so counters live in MongoDB (a TTL index
// deletes expired windows). If the database is down we fall back to a per-instance in-memory counter.
import type { NextFunction, Request, Response } from 'express'
import mongoose, { Schema } from 'mongoose'
import { isDbConnected } from './db.js'

const RateLimitModel = mongoose.model(
  'RateLimit',
  new Schema({ _id: String, count: Number, expiresAt: { type: Date, expires: 0 } }, { versionKey: false }),
  'ratelimits',
)

const memory = new Map<string, { count: number; expiresAt: number }>()

async function increment(key: string, expiresAt: Date): Promise<number> {
  if (isDbConnected()) {
    try {
      const doc = await RateLimitModel.findOneAndUpdate(
        { _id: key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, new: true, lean: true },
      )
      return doc?.count ?? 1
    } catch (error) {
      // Two concurrent first hits can race on the upsert; the second one retries as an update.
      if ((error as { code?: number }).code === 11000) return increment(key, expiresAt)
      console.error('rate limit store failed', error instanceof Error ? error.message : error)
    }
  }
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: expiresAt.getTime() })
    return 1
  }
  entry.count += 1
  return entry.count
}

export interface RateLimitOptions {
  /** Prefix that separates this limit's counters from other limits. */
  name: string
  /** Requests allowed per window and client IP. */
  limit: number
  windowMs: number
}

/** Express middleware that answers 429 once a client IP exceeds `limit` requests in the current window. */
export function rateLimit({ name, limit, windowMs }: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const window = Math.floor(Date.now() / windowMs)
    const resetAt = (window + 1) * windowMs
    const count = await increment(`${name}:${req.ip ?? 'unknown'}:${window}`, new Date(resetAt))
    if (count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)))
      return void res.status(429).json({ error: 'rate_limited' })
    }
    next()
  }
}

const MINUTE = 60 * 1000
const CHAT_LIMIT = Number(process.env.CHAT_RATE_LIMIT ?? 40)

export const limits = {
  /** Password guessing: 10 attempts per 15 minutes per IP. */
  login: rateLimit({ name: 'login', limit: 10, windowMs: 15 * MINUTE }),
  /** Contact form spam: 5 messages per hour per IP. */
  messages: rateLimit({ name: 'messages', limit: 5, windowMs: 60 * MINUTE }),
  /** AI chat and chat logging (protects the OpenAI key). */
  chat: rateLimit({ name: 'chat', limit: CHAT_LIMIT, windowMs: 10 * MINUTE }),
  chatLog: rateLimit({ name: 'chatlog', limit: CHAT_LIMIT, windowMs: 10 * MINUTE }),
}
