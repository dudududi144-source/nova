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

// POST /api/backup — Create a new backup ZIP of all source files.
// Saves to download/ directory with timestamp.
export async function POST(): Promise<Response> {
  try {
    const { createZip } = await import('@/lib/zip')
    const { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } = await import('fs')

    // Ensure download directory exists
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true })
    }

    // Collect all source files
    const files: { name: string; content: string }[] = []
    const srcDir = join(process.cwd(), 'src')
    const testsDir = join(process.cwd(), 'tests')
    const rootFiles = ['package.json', 'tsconfig.json', 'next.config.ts', 'README.md', 'worklog.md']

    // Add src/ files
    if (existsSync(srcDir)) {
      const collectFromDir = (dir: string, base: string = '') => {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = join(dir, entry.name)
          const relPath = base ? `${base}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            collectFromDir(fullPath, relPath)
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
            try {
              files.push({ name: `src/${relPath}`, content: readFileSync(fullPath, 'utf-8') })
            } catch {}
          }
        }
      }
      collectFromDir(srcDir)
    }

    // Add tests/ files
    if (existsSync(testsDir)) {
      const entries = readdirSync(testsDir)
      for (const entry of entries) {
        if (entry.endsWith('.test.ts')) {
          try {
            files.push({ name: `tests/${entry}`, content: readFileSync(join(testsDir, entry), 'utf-8') })
          } catch {}
        }
      }
    }

    // Add root files
    for (const file of rootFiles) {
      const filePath = join(process.cwd(), file)
      if (existsSync(filePath)) {
        try {
          files.push({ name: file, content: readFileSync(filePath, 'utf-8') })
        } catch {}
      }
    }

    if (files.length === 0) {
      return Response.json({ ok: false, error: 'No files found to backup' }, { status: 500 })
    }

    // Create ZIP
    const zipBytes = createZip(files)
    const date = new Date()
    const dateStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `nova-backup-${dateStr}.zip`
    const zipPath = join(BACKUP_DIR, fileName)

    writeFileSync(zipPath, Buffer.from(zipBytes))

    const stat = statSync(zipPath)
    return Response.json({
      ok: true,
      fileName,
      fileCount: files.length,
      size: stat.size,
      sizeFormatted: formatBytes(stat.size),
      url: `/api/backup?file=${encodeURIComponent(fileName)}`,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: errorMsg }, { status: 500 })
  }
}

// DELETE /api/backup?file=name.zip — Delete a backup file.
export async function DELETE(request: NextRequest): Promise<Response> {
  const fileName = request.nextUrl.searchParams.get('file')
  if (!fileName) {
    return Response.json({ ok: false, error: 'Missing file parameter' }, { status: 400 })
  }

  // Security: prevent path traversal
  const safeName = fileName.replace(/\.\./g, '').replace(/[\/\\]/g, '')
  const filePath = join(BACKUP_DIR, safeName)

  try {
    if (!existsSync(filePath)) {
      return Response.json({ ok: false, error: 'File not found' }, { status: 404 })
    }

    const { unlinkSync } = await import('fs')
    unlinkSync(filePath)

    return Response.json({ ok: true, deleted: safeName })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: errorMsg }, { status: 500 })
  }
}
