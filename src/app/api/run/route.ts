// POST /api/run — Execute generated code in a sandboxed environment.
//
// This is the "Prompt to Reality" proof: when NOVA generates Python/Node/Bash,
// the user can actually RUN it and see real output — not just read the code.
//
// Security: 10s timeout, 50KB output cap, restricted env, rate limited.

import type { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { logger } from '@/lib/logger'
import { RateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const runLimiter = new RateLimiter(20, 60 * 1000, 5 * 60 * 1000, 1000)
const MAX_BODY_BYTES = 500_000
const EXEC_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 200_000

interface RunBody {
  language?: unknown
  code?: unknown
  stdin?: unknown
  files?: unknown
  primaryFile?: unknown
}

function getRunCommand(language: string): { cmd: string; args: string[]; fileExt: string } | null {
  switch (language) {
    case 'python':
    case 'python3':
    case 'py':
      return { cmd: 'python3', args: ['-B', '-u'], fileExt: '.py' }
    case 'javascript':
    case 'js':
    case 'node':
      return { cmd: 'node', args: [], fileExt: '.js' }
    case 'bash':
    case 'sh':
    case 'shell':
      return { cmd: 'bash', args: [], fileExt: '.sh' }
    default:
      return null
  }
}

function extractFiles(body: RunBody, fileExt: string): { path: string; content: string }[] {
  if (Array.isArray(body.files)) {
    const files: { path: string; content: string }[] = []
    for (const f of body.files) {
      if (f && typeof f === 'object') {
        const fo = f as Record<string, unknown>
        const path = typeof fo.path === 'string' ? fo.path : (typeof fo.name === 'string' ? fo.name : '')
        const content = typeof fo.content === 'string' ? fo.content : ''
        if (path && content) files.push({ path, content })
      }
    }
    if (files.length > 0) return files
  }
  const code = typeof body.code === 'string' ? body.code : ''
  if (!code.trim()) return []
  return [{ path: `script${fileExt}`, content: code }]
}

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: 'Code too large (max 200KB)' }, { status: 413 })
  }

  let body: RunBody
  try {
    body = (await request.json()) as RunBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const language = typeof body?.language === 'string' ? body.language.toLowerCase().trim() : ''
  const stdin = typeof body?.stdin === 'string' ? body.stdin : ''

  if (!language) {
    return Response.json({ ok: false, error: 'Missing language' }, { status: 400 })
  }

  const runConfig = getRunCommand(language)
  if (!runConfig) {
    return Response.json({
      ok: false,
      error: `Language '${language}' is not executable. Supported: python, javascript, bash.`,
    }, { status: 400 })
  }

  const files = extractFiles(body, runConfig.fileExt)
  if (files.length === 0) {
    return Response.json({ ok: false, error: 'Missing code (no code or files provided)' }, { status: 400 })
  }

  // Determine primary file
  const primaryFileName = typeof body?.primaryFile === 'string' ? body.primaryFile : null
  let primaryFile = files[0]!
  if (primaryFileName) {
    const found = files.find(f => f.path === primaryFileName || f.path.endsWith('/' + primaryFileName) || f.path.endsWith(primaryFileName))
    if (found) primaryFile = found
  } else {
    const entryNames = [`main${runConfig.fileExt}`, `app${runConfig.fileExt}`, `index${runConfig.fileExt}`, `script${runConfig.fileExt}`]
    for (const name of entryNames) {
      const found = files.find(f => f.path === name || f.path.endsWith('/' + name))
      if (found) { primaryFile = found; break }
    }
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = runLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ ok: false, error: 'Rate limited — too many runs. Try again in a minute.' }, { status: 429 })
  }

  const execId = randomUUID()
  const execDir = join(tmpdir(), `nova-run-${execId}`)
  try {
    mkdirSync(execDir, { recursive: true })
  } catch (err) {
    logger.error('run.mkdir_failed', { error: String(err) })
    return Response.json({ ok: false, error: 'Failed to create execution directory' }, { status: 500 })
  }

  // Write ALL files to temp dir
  try {
    for (const file of files) {
      const safePath = file.path.replace(/\.\./g, '').replace(/^\/+/, '')
      const fullPath = join(execDir, safePath)
      const dir = fullPath.slice(0, fullPath.lastIndexOf('/'))
      if (dir && dir !== execDir) {
        try { mkdirSync(dir, { recursive: true }) } catch {} // mkdir failure is non-critical
      }
      writeFileSync(fullPath, file.content, { encoding: 'utf-8' })
    }
  } catch (err) {
    try { rmSync(execDir, { recursive: true, force: true }) } catch {}
    logger.error('run.write_failed', { error: String(err) })
    return Response.json({ ok: false, error: 'Failed to write script files' }, { status: 500 })
  }

  const safePrimaryPath = primaryFile.path.replace(/\.\./g, '').replace(/^\/+/, '')
  const scriptPath = join(execDir, safePrimaryPath)

  logger.info('run.started', {
    ip, language, fileCount: files.length, primaryFile: safePrimaryPath,
    codeBytes: files.reduce((sum, f) => sum + f.content.length, 0), execId,
  })

  const startTime = Date.now()

  try {
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>((resolve) => {
      const cleanEnv = {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: execDir,
        LANG: 'en_US.UTF-8',
        TMPDIR: execDir,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv

      const child = spawn(runConfig.cmd, [...runConfig.args, scriptPath], {
        cwd: execDir,
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: EXEC_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      })

      let stdout = ''
      let stderr = ''
      let timedOut = false
      let killed = false

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8')
        if (stdout.length > MAX_OUTPUT_BYTES && !killed) {
          killed = true
          stderr += `\n[NOVA] Output exceeded ${MAX_OUTPUT_BYTES} bytes — process killed.\n`
          child.kill('SIGKILL')
        }
      })
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8')
        if (stderr.length > MAX_OUTPUT_BYTES && !killed) {
          killed = true
          stderr += `\n[NOVA] Stderr exceeded ${MAX_OUTPUT_BYTES} bytes — process killed.\n`
          child.kill('SIGKILL')
        }
      })

      try {
        if (stdin) child.stdin?.write(stdin)
        child.stdin?.end()
      } catch {}

      const timeoutHandle = setTimeout(() => {
        if (!killed) {
          timedOut = true
          killed = true
          stderr += `\n[NOVA] Execution timed out after ${EXEC_TIMEOUT_MS / 1000}s — process killed.\n`
          child.kill('SIGKILL')
        }
      }, EXEC_TIMEOUT_MS)

      child.on('error', (err) => {
        clearTimeout(timeoutHandle)
        resolve({
          stdout: '',
          stderr: `Failed to start process: ${err.message}\n(Make sure '${runConfig.cmd}' is installed.)`,
          exitCode: -1,
          timedOut: false,
        })
      })

      child.on('close', (code) => {
        clearTimeout(timeoutHandle)
        resolve({
          stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
          stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
          exitCode: code ?? -1,
          timedOut,
        })
      })
    })

    const ms = Date.now() - startTime
    try { rmSync(execDir, { recursive: true, force: true }) } catch {}

    logger.info('run.completed', {
      ip, language, execId, ms, exitCode: result.exitCode,
      timedOut: result.timedOut, stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length,
    })

    return Response.json({
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ms,
      timedOut: result.timedOut,
      language,
    })
  } catch (err) {
    try { rmSync(execDir, { recursive: true, force: true }) } catch {}
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    logger.error('run.exception', { ip, language, execId, error: errorMsg })
    return Response.json({ ok: false, error: errorMsg, stderr: '' }, { status: 500 })
  }
}
