// Tests for /api/run endpoint — multi-file execution.
// Tests that multi-file Python projects work with imports.

import { describe, expect, test } from 'bun:test'

const API_URL = 'http://localhost:3000/api/run'

async function runCode(language: string, code: string, files?: unknown): Promise<any> {
  const body: Record<string, unknown> = { language, code }
  if (files) body.files = files
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await res.json()
}

// Check if the dev server is running
let isDevServerRunning = false
try {
  await fetch('http://localhost:3000')
  isDevServerRunning = true
} catch {
  isDevServerRunning = false
}

describe('POST /api/run — multi-file execution', () => {
  const maybeTest = isDevServerRunning ? test : test.skip

  maybeTest('executes multi-file Python with imports', async () => {
    const result = await runCode('python', undefined, [
      { path: 'utils.py', content: 'def greet(name):\n    return f"Hello, {name}!"\n\ndef add(a, b):\n    return a + b' },
      { path: 'main.py', content: 'from utils import greet, add\n\nprint(greet("World"))\nprint(f"2 + 3 = {add(2, 3)}")\nprint("Multi-file works!")' },
    ])
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('Hello, World!')
    expect(result.stdout).toContain('2 + 3 = 5')
    expect(result.stdout).toContain('Multi-file works!')
  }, 15000)

  maybeTest('detects primary file from multiple files', async () => {
    const result = await runCode('python', undefined, [
      { path: 'helper.py', content: 'def double(x):\n    return x * 2' },
      { path: 'main.py', content: 'from helper import double\nprint(double(21))' },
    ])
    expect(result.ok).toBe(true)
    expect(result.stdout.trim()).toBe('42')
  }, 15000)

  maybeTest('handles 3-file Python project', async () => {
    const result = await runCode('python', undefined, [
      { path: 'math_ops.py', content: 'def add(a, b): return a + b\ndef sub(a, b): return a - b' },
      { path: 'string_ops.py', content: 'def upper(s): return s.upper()\ndef lower(s): return s.lower()' },
      { path: 'main.py', content: 'from math_ops import add, sub\nfrom string_ops import upper, lower\n\nprint(add(5, 3))\nprint(sub(10, 4))\nprint(upper("hello"))\nprint(lower("WORLD"))' },
    ])
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('8')
    expect(result.stdout).toContain('6')
    expect(result.stdout).toContain('HELLO')
    expect(result.stdout).toContain('world')
  }, 15000)

  maybeTest('handles subdirectory imports', async () => {
    const result = await runCode('python', undefined, [
      { path: 'src/utils.py', content: 'def factorial(n):\n    if n <= 1: return 1\n    return n * factorial(n - 1)' },
      { path: 'main.py', content: 'import sys\nsys.path.insert(0, "src")\nfrom utils import factorial\nprint(factorial(5))' },
    ])
    expect(result.ok).toBe(true)
    expect(result.stdout.trim()).toBe('120')
  }, 15000)

  maybeTest('rejects empty files array', async () => {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'python', files: [] }),
    })
    expect(res.status).toBe(400)
  }, 10000)
})
