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

export const isDbConnected = () => mongoose.connection.readyState === 1

export async function connectDb(uri: string | undefined) {
  if (!uri) return false
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
    await ensureAdmin()
    await seedPortfolioIfEmpty()
    return true
  } catch (error) {
    console.error('MongoDB connection failed:', error instanceof Error ? error.message : error)
    return false
  }
}

/** Creates the first admin account from ADMIN_USERNAME / ADMIN_PASSWORD (default admin / admin123). */
async function ensureAdmin() {
  if (await AdminModel.estimatedDocumentCount()) return
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  await AdminModel.create({ username, passwordHash: await bcrypt.hash(password, 12) })
  console.log(`Created admin user "${username}"${process.env.ADMIN_PASSWORD ? '' : ' with the default password — change it in the admin panel'}`)
}
