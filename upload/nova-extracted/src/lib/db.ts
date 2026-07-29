import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'

// Ensure DATABASE_URL is set (relative path for APK portability)
function ensureDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  // Default: relative to cwd (portable for APK)
  const dbDir = path.join(process.cwd(), 'db')

  // Ensure db directory exists
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
      console.log('[DB] Created db/ directory')
    }
  } catch (err) {
    console.warn('[DB] Failed to create db/ directory:', err)
  }

  const url = `file:${path.join(dbDir, 'custom.db')}`
  process.env.DATABASE_URL = url
  console.log('[DB] Set DATABASE_URL to', url)
  return url
}

// Initialize before PrismaClient
ensureDatabaseUrl()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
