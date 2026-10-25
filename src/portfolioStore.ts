// Portfolio content in MongoDB. Each list (experiences, projects, blog, ...) is its own collection,
// and the single-value parts (profile, soft skills, section visibility) live in the `site` collection.
import { readFile } from 'node:fs/promises'
import mongoose, { Schema } from 'mongoose'

export const COLLECTIONS = ['experiences', 'projects', 'skillGroups', 'education', 'certificates', 'languages', 'blog', 'faqs'] as const
export type CollectionName = (typeof COLLECTIONS)[number]
export const SITE_KEYS = ['profile', 'softSkills', 'sections'] as const
export type SiteKey = (typeof SITE_KEYS)[number]

type Item = Record<string, unknown> & { id: string }
type Portfolio = Record<CollectionName, Item[]> & Record<SiteKey, unknown>

export const isCollection = (name: string): name is CollectionName => (COLLECTIONS as readonly string[]).includes(name)

// Item documents keep the client id as `_id` and their position as `order`; other fields are stored as sent.
const itemSchema = new Schema({ _id: String, order: { type: Number, index: true } }, { strict: false, versionKey: false, timestamps: true })
const models = Object.fromEntries(
  COLLECTIONS.map((name) => [name, mongoose.model(`portfolio_${name}`, itemSchema, name.toLowerCase())]),
) as unknown as Record<CollectionName, mongoose.Model<Record<string, unknown>>>

const SiteModel = mongoose.model('Site', new Schema({ _id: String, value: Schema.Types.Mixed }, { versionKey: false, minimize: false }), 'site')

function toItem(doc: Record<string, unknown>): Item {
  const { _id, order: _order, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = doc
  return { id: String(_id), ...fields }
}

// --- Lists ---
export async function listItems(collection: CollectionName) {
  const docs = await models[collection].find().sort({ order: 1 }).lean()
  return docs.map(toItem)
}

export async function getItem(collection: CollectionName, id: string) {
  const doc = await models[collection].findById(id).lean()
  return doc ? toItem(doc) : null
}

/** Creates or replaces an item. New items are appended to the end of the list. */
export async function saveItem(collection: CollectionName, id: string, fields: Record<string, unknown>) {
  const model = models[collection]
  const { id: _ignored, _id, order: _order, ...data } = fields
  const existing = await model.findById(id, { order: 1 }).lean()
  const order = existing?.order ?? (await model.countDocuments())
  await model.replaceOne({ _id: id }, { ...data, order }, { upsert: true })
  return getItem(collection, id)
}

export async function deleteItem(collection: CollectionName, id: string) {
  const result = await models[collection].deleteOne({ _id: id })
  return result.deletedCount > 0
}

export async function reorderItems(collection: CollectionName, ids: string[]) {
  await models[collection].bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { _id: id }, update: { $set: { order } } } })))
}

// --- Single values ---
export async function getSiteValue(key: SiteKey) {
  return (await SiteModel.findById(key).lean())?.value ?? null
}

export async function setSiteValue(key: SiteKey, value: unknown) {
  await SiteModel.replaceOne({ _id: key }, { value }, { upsert: true })
}

// --- Whole portfolio ---
export async function getPortfolio() {
  const entries = await Promise.all([
    ...COLLECTIONS.map(async (name) => [name, await listItems(name)] as const),
    ...SITE_KEYS.map(async (key) => [key, await getSiteValue(key)] as const),
  ])
  return Object.fromEntries(entries) as Portfolio
}

/** Replaces all portfolio content (used for seeding, JSON import and "reset to CV"). */
export async function replacePortfolio(portfolio: Partial<Portfolio>) {
  await Promise.all([
    ...COLLECTIONS.map(async (name) => {
      const items = portfolio[name] ?? []
      await models[name].deleteMany({})
      if (items.length) {
        await models[name].insertMany(items.map(({ id, ...fields }, order) => ({ ...fields, _id: id, order })))
      }
    }),
    ...SITE_KEYS.map((key) => (portfolio[key] === undefined ? null : setSiteValue(key, portfolio[key]))),
  ])
}

/** Fills an empty database with the CV content in seed/portfolio.json. */
export async function seedPortfolioIfEmpty() {
  if (await SiteModel.exists({ _id: 'profile' })) return
  const seed = JSON.parse(await readFile(new URL('../seed/portfolio.json', import.meta.url), 'utf8')) as Portfolio
  await replacePortfolio(seed)
  console.log('Seeded MongoDB with the CV portfolio content')
}
