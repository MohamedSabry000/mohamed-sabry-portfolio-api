// End-to-end API tests against an in-memory MongoDB: auth, rate limits and portfolio CRUD.
import type { Express } from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const USERNAME = 'admin'
const PASSWORD = 'correct-horse-battery'

let mongod: MongoMemoryServer
let app: Express
let ensureAdmin: () => Promise<void>
let AdminModel: mongoose.Model<{ username: string; passwordHash: string }>

// Each test uses its own client IP so rate-limit counters don't leak between tests.
let ipCounter = 0
const nextIp = () => `203.0.113.${++ipCounter}`

async function signIn(ip = nextIp()) {
  const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username: USERNAME, password: PASSWORD })
  expect(res.status).toBe(200)
  return res.body.token as string
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongod.getUri('portfolio-test')
  process.env.JWT_SECRET = 'test-secret'
  process.env.ADMIN_USERNAME = USERNAME
  process.env.ADMIN_PASSWORD = PASSWORD
  app = (await import('./app.js')).app
  const db = await import('./db.js')
  ensureAdmin = db.ensureAdmin
  AdminModel = db.AdminModel as never
  // The first request connects, creates the admin account and seeds the portfolio.
  await request(app).get('/api/health')
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

describe('admin auth', () => {
  it('rejects a wrong password and accepts the right one', async () => {
    const ip = nextIp()
    const wrong = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username: USERNAME, password: 'nope' })
    expect(wrong.status).toBe(401)
    const token = await signIn(ip)
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(me.body).toEqual({ username: USERNAME })
  })

  it('rejects requests without a valid token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401)
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer forged')).status).toBe(401)
    expect((await request(app).get('/api/messages')).status).toBe(401)
  })

  it('blocks login after 10 attempts from one IP', async () => {
    const ip = nextIp()
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username: USERNAME, password: 'guess' })
      expect(res.status).toBe(401)
    }
    const blocked = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username: USERNAME, password: PASSWORD })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    // Other clients are unaffected.
    await signIn()
  })

  it('requires new passwords of at least 12 characters', async () => {
    const token = await signIn()
    const res = await request(app)
      .put('/api/auth/credentials')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: USERNAME, password: 'short-pass' })
    expect(res.status).toBe(400)
  })
})

describe('first admin account', () => {
  it('is only created from a strong ADMIN_PASSWORD, never a default', async () => {
    const saved = await AdminModel.find().lean()
    await AdminModel.deleteMany({})
    try {
      delete process.env.ADMIN_PASSWORD
      await ensureAdmin()
      expect(await AdminModel.countDocuments()).toBe(0)

      process.env.ADMIN_PASSWORD = 'admin123'
      await ensureAdmin()
      expect(await AdminModel.countDocuments()).toBe(0)

      process.env.ADMIN_PASSWORD = PASSWORD
      await ensureAdmin()
      expect(await AdminModel.countDocuments()).toBe(1)
    } finally {
      await AdminModel.deleteMany({})
      await AdminModel.insertMany(saved)
    }
  })
})

describe('contact messages', () => {
  it('validates input and limits each IP to 5 messages per hour', async () => {
    const ip = nextIp()
    const message = { name: 'Visitor', email: 'visitor@example.com', message: 'Hello' }
    expect((await request(app).post('/api/messages').set('X-Forwarded-For', nextIp()).send({ ...message, email: 'bad' })).status).toBe(400)
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/messages').set('X-Forwarded-For', ip).send(message)).status).toBe(201)
    }
    expect((await request(app).post('/api/messages').set('X-Forwarded-For', ip).send(message)).status).toBe(429)
  })
})

describe('portfolio CRUD', () => {
  it('serves the seeded portfolio publicly', async () => {
    const res = await request(app).get('/api/portfolio')
    expect(res.status).toBe(200)
    expect(res.body.profile).toBeTruthy()
    expect(Array.isArray(res.body.projects)).toBe(true)
  })

  it('creates, reads, updates, reorders and deletes items', async () => {
    const auth = { Authorization: `Bearer ${await signIn()}` }
    const faq = { id: 'faq-test', question: { en: 'Q?', ar: '' }, answer: { en: 'A.', ar: '' } }

    expect((await request(app).post('/api/faqs').send(faq)).status).toBe(401)

    const created = await request(app).post('/api/faqs').set(auth).send(faq)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject(faq)
    expect((await request(app).post('/api/faqs').set(auth).send(faq)).status).toBe(409)

    const updated = await request(app).put('/api/faqs/faq-test').set(auth).send({ ...faq, answer: { en: 'B.', ar: '' } })
    expect(updated.body.answer.en).toBe('B.')
    expect((await request(app).get('/api/faqs/faq-test')).body.answer.en).toBe('B.')

    const ids = ((await request(app).get('/api/faqs')).body as Array<{ id: string }>).map((item) => item.id)
    expect(ids.at(-1)).toBe('faq-test')
    const reordered = ['faq-test', ...ids.filter((id) => id !== 'faq-test')]
    expect((await request(app).put('/api/faqs/order').set(auth).send({ ids: reordered })).status).toBe(204)
    expect(((await request(app).get('/api/faqs')).body as Array<{ id: string }>)[0].id).toBe('faq-test')

    expect((await request(app).delete('/api/faqs/faq-test')).status).toBe(401)
    expect((await request(app).delete('/api/faqs/faq-test').set(auth)).status).toBe(204)
    expect((await request(app).get('/api/faqs/faq-test')).status).toBe(404)
  })

  it('rejects unknown collections', async () => {
    expect((await request(app).get('/api/nope')).status).toBe(404)
  })

  it('updates single values like the profile', async () => {
    const auth = { Authorization: `Bearer ${await signIn()}` }
    const profile = (await request(app).get('/api/profile')).body
    expect((await request(app).put('/api/profile').send(profile)).status).toBe(401)
    const res = await request(app).put('/api/profile').set(auth).send({ ...profile, title: 'Changed' })
    expect(res.status).toBe(200)
    expect((await request(app).get('/api/profile')).body.title).toBe('Changed')
  })
})
