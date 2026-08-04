// Tests for the /api/run endpoint — code execution sandbox.
// These tests make real HTTP requests to the running dev server.

import { describe, expect, test } from 'bun:test'

const API_URL = 'http://localhost:3000/api/run'

async function runCode(language: string, code: string): Promise<{
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
  ms: number
  timedOut: boolean
  language: string
}> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, code }),
  })
  return await res.json() as any
}

// Check if the dev server is running
let isDevServerRunning = false
try {
  await fetch('http://localhost:3000')
  isDevServerRunning = true
} catch {
  isDevServerRunning = false
}

describe('POST /api/run — code execution sandbox', () => {
  const maybeTest = isDevServerRunning ? test : test.skip

  maybeTest('executes Python print', async () => {
    const result = await runCode('python', 'print("Hello from Python!")')
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Hello from Python!')
    expect(result.language).toBe('python')
  }, 15000)

  maybeTest('executes Python math', async () => {
    const result = await runCode('python', 'print(2 + 2)\nprint(10 * 5)')
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('4')
    expect(result.stdout).toContain('50')
  }, 15000)

  maybeTest('captures Python errors', async () => {
    const result = await runCode('python', 'print(undefined_var)')
    expect(result.ok).toBe(false)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('NameError')
  }, 15000)

  maybeTest('executes JavaScript console.log', async () => {
    const result = await runCode('javascript', 'console.log("Hello from Node!")')
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Hello from Node!')
    expect(result.language).toBe('javascript')
  }, 15000)

  maybeTest('executes Bash echo', async () => {
    const result = await runCode('bash', 'echo "Hello from Bash!"')
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Hello from Bash!')
    expect(result.language).toBe('bash')
  }, 15000)

  maybeTest('rejects missing language', async () => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'print("hi")' }),
    })
    expect(res.status).toBe(400)
  }, 10000)

  maybeTest('rejects missing code', async () => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'python' }),
    })
    expect(res.status).toBe(400)
  }, 10000)

  maybeTest('rejects unsupported language', async () => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'cobol', code: 'PROGRAM' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('not executable')
  }, 10000)
})
