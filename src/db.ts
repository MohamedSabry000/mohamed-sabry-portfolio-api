// MongoDB connection and models (Mongoose). Everything is optional: without MONGODB_URI the API
// still runs and the front end falls back to its built-in content.
import bcrypt from 'bcryptjs'
import mongoose, { Schema } from 'mongoose'
import { seedPortfolioIfEmpty } from './portfolioStore.js'

const messageSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    email: { type: String, required: true, maxlength: 200 },
    subject: { type: String, default: '', maxlength: 200 },
    message: { type: String, required: true, maxlength: 5000 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
)

const chatLogSchema = new Schema(
  {
    sessionId: { type: String, index: true },
    lang: String,
    question: { type: String, maxlength: 2000 },
    answer: { type: String, maxlength: 4000 },
    source: String,
  },
  { timestamps: true },
)

const adminSchema = new Schema({
  username: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
})

export const MessageModel = mongoose.model('Message', messageSchema)
export const ChatLogModel = mongoose.model('ChatLog', chatLogSchema)
export const AdminModel = mongoose.model('Admin', adminSchema)

let dbAvailable = false
export const isDbConnected = () => dbAvailable

/**
 * Connects on first call; later calls are no-ops while the connection is up. On serverless hosts a frozen
 * instance loses its sockets, so if the driver reports "disconnected" we ping to make it reconnect.
 */
export async function connectDb(uri: string | undefined) {
  if (!uri) return false
  if (mongoose.connection.readyState === 1) return (dbAvailable = true)
  try {
    if (mongoose.connection.db) {
      try {
        await mongoose.connection.db.admin().ping()
        return (dbAvailable = true)
      } catch {
        await mongoose.disconnect().catch(() => undefined)
      }
    }
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
    await ensureAdmin()
    await seedPortfolioIfEmpty()
    dbAvailable = true
  } catch (error) {
    dbAvailable = false
    console.error('MongoDB connection failed:', error instanceof Error ? error.message : error)
  }
  return dbAvailable
}

/** Creates the first admin account from ADMIN_USERNAME / ADMIN_PASSWORD (default admin / admin123). */
async function ensureAdmin() {
  if (await AdminModel.estimatedDocumentCount()) return
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  await AdminModel.create({ username, passwordHash: await bcrypt.hash(password, 12) })
  console.log(`Created admin user "${username}"${process.env.ADMIN_PASSWORD ? '' : ' with the default password — change it in the admin panel'}`)
}
