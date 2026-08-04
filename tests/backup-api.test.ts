// Tests for /api/backup endpoint — backup CRUD operations.
// Tests the backup list, create, download, and delete functionality.

import { describe, expect, test } from 'bun:test'

const API_URL = 'http://localhost:3000/api/backup'

// Check if the dev server is running
let isDevServerRunning = false
try {
  await fetch('http://localhost:3000')
  isDevServerRunning = true
} catch {
  isDevServerRunning = false
}

describe('GET /api/backup — list backups', () => {
  const maybeTest = isDevServerRunning ? test : test.skip

  maybeTest('returns list of backup files', async () => {
    const res = await fetch(API_URL)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveProperty('files')
    expect(data).toHaveProperty('count')
    expect(Array.isArray(data.files)).toBe(true)
    expect(data.count).toBe(data.files.length)
  }, 10000)

  maybeTest('each file has required fields', async () => {
    const res = await fetch(API_URL)
    const data = await res.json()
    if (data.files.length > 0) {
      const file = data.files[0]
      expect(file).toHaveProperty('name')
      expect(file).toHaveProperty('size')
      expect(file).toHaveProperty('sizeFormatted')
      expect(file).toHaveProperty('modified')
      expect(file).toHaveProperty('url')
    }
  }, 10000)
})

describe('POST /api/backup — create backup', () => {
  const maybeTest = isDevServerRunning ? test : test.skip

  maybeTest('creates a new backup ZIP', async () => {
    const res = await fetch(API_URL, { method: 'POST' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data).toHaveProperty('fileName')
    expect(data).toHaveProperty('fileCount')
    expect(data.fileCount).toBeGreaterThan(0)
    expect(data).toHaveProperty('size')
    expect(data).toHaveProperty('url')
  }, 20000)
})

describe('Security', () => {
  const maybeTest = isDevServerRunning ? test : test.skip

  maybeTest('rejects path traversal in download', async () => {
    const res = await fetch(`${API_URL}?file=../../../etc/passwd`)
    expect(res.status).toBe(404)
  }, 10000)

  maybeTest('rejects non-existent file download', async () => {
    const res = await fetch(`${API_URL}?file=nonexistent.zip`)
    expect(res.status).toBe(404)
  }, 10000)

  maybeTest('rejects path traversal in delete', async () => {
    const res = await fetch(`${API_URL}?file=../../../etc/passwd`, { method: 'DELETE' })
    expect(res.status).toBe(404)
  }, 10000)
})
