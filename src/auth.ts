// Admin authentication: bcrypt-hashed passwords in MongoDB and short-lived signed JWTs.
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { AdminModel } from './db.ts'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me'
const TOKEN_TTL = '8h'

if (!process.env.JWT_SECRET) console.warn('JWT_SECRET is not set — using an insecure development secret')

export async function login(username: string, password: string) {
  const admin = await AdminModel.findOne({ username: username.trim() })
  if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) return null
  return jwt.sign({ sub: String(admin._id), username: admin.username }, JWT_SECRET, { expiresIn: TOKEN_TTL })
}

export async function updateCredentials(adminId: string, username: string, password: string) {
  await AdminModel.findByIdAndUpdate(adminId, { username: username.trim(), passwordHash: await bcrypt.hash(password, 12) })
}

export interface AuthedRequest extends Request {
  admin?: { sub: string; username: string }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
  try {
    req.admin = jwt.verify(token ?? '', JWT_SECRET) as AuthedRequest['admin']
    next()
  } catch {
    res.status(401).json({ error: 'unauthorized' })
  }
}
