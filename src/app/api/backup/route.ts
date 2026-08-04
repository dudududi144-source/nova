// GET /api/backup — List and download backup ZIP files.
// Allows users to download NOVA backups through the preview panel.
//
// Usage:
//   GET /api/backup              → List all backup files (JSON)
//   GET /api/backup?file=name.zip → Download a specific backup file

import type { NextRequest } from 'next/server'
import { readdirSync, statSync, createReadStream, existsSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BACKUP_DIR = join(process.cwd(), 'download')

export async function GET(request: NextRequest): Promise<Response> {
  const fileName = request.nextUrl.searchParams.get('file')

  // If no file specified, list all backups
  if (!fileName) {
    try {
      if (!existsSync(BACKUP_DIR)) {
        return Response.json({ files: [] })
      }
      const files = readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.zip') || f.endsWith('.bundle'))
        .map(f => {
          const stat = statSync(join(BACKUP_DIR, f))
          return {
            name: f,
            size: stat.size,
            sizeFormatted: formatBytes(stat.size),
            modified: stat.mtime.toISOString(),
            url: `/api/backup?file=${encodeURIComponent(f)}`,
          }
        })
        .sort((a, b) => b.modified.localeCompare(a.modified))

      return Response.json({ files, count: files.length })
    } catch (err) {
      return Response.json({ error: 'Failed to list backups', files: [] }, { status: 500 })
    }
  }

  // Download a specific file
  // Security: prevent path traversal
  const safeName = fileName.replace(/\.\./g, '').replace(/[\/\\]/g, '')
  const filePath = join(BACKUP_DIR, safeName)

  if (!existsSync(filePath)) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  try {
    const stat = statSync(filePath)
    const isZip = safeName.endsWith('.zip')
    const isBundle = safeName.endsWith('.bundle')

    const stream = Readable.from(createReadStream(filePath))

    return new Response(stream as ReadableStream, {
      headers: {
        'Content-Type': isZip ? 'application/zip' : isBundle ? 'application/octet-stream' : 'application/octet-stream',
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err) {
    return Response.json({ error: 'Failed to read file' }, { status: 500 })
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
