// E2E proof tests — PROVE that NOVA generates working apps.
// Simplified: uses polling only (no SSE reading).
// Run with: bun test tests/e2e-proof.test.ts
// Note: These tests require the dev server running on localhost:3000.
// They are skipped automatically if the server is not available.

import { describe, it, expect } from 'bun:test'

const API_BASE = 'http://localhost:3000'

// Check if server is running — skip tests if not
let serverAvailable = false
try {
  const check = await fetch(API_BASE, { signal: AbortSignal.timeout(2000) })
  serverAvailable = check.ok
} catch {
  serverAvailable = false
}

const maybeIt = serverAvailable ? it : it.skip

// Helper: build an app via API using polling only
async function buildApp(mission: string): Promise<{ html: string; quality: number; error: string | null }> {
  try {
    // Step 1: Get architect plan
    const archRes = await fetch(`${API_BASE}/api/build/architect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission }),
    })
    const archData = await archRes.json()
    const plan = archData?.ok ? archData.plan : null

    // Step 2: Start code build and read SSE until we get buildId or result
    const codeRes = await fetch(`${API_BASE}/api/build/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ mission, plan, quickMode: true }),
    })

    const reader = codeRes.body?.getReader()
    if (!reader) return { html: '', quality: 0, error: 'No response body' }

    const decoder = new TextDecoder()
    let buffer = ''
    let html = ''
    let quality = 0
    let buildId = ''

    // Read SSE stream until we get result or error
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.trim()
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'buildId') buildId = evt.buildId
            if (evt.type === 'result') {
              html = evt.html ?? ''
              quality = evt.quality ?? 0
            }
            if (evt.type === 'error') {
              return { html: '', quality: 0, error: evt.error }
            }
          } catch {}
        }
      }
      if (html) break // got result
    }

    if (!html) return { html: '', quality: 0, error: 'No HTML received' }
    return { html, quality, error: null }
  } catch (err) {
    return { html: '', quality: 0, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Helper: extract all onclick handlers from HTML
function extractOnclickHandlers(html: string): string[] {
  const matches = html.match(/onclick="([^"]+)"/g) || []
  return matches.map(m => m.replace(/onclick="([^"]+)"/, '$1'))
}

// Helper: check if a function is defined
function isFunctionDefined(fnName: string, html: string): boolean {
  return new RegExp(`function\\s+${fnName}\\s*\\(`).test(html) ||
         new RegExp(`(?:const|let|var)\\s+${fnName}\\s*=`).test(html)
}

// Helper: check for blocked APIs (but allow if polyfill is present)
function checkBlockedAPIs(html: string): string[] {
  const issues: string[] = []
  const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []
  const scriptText = scriptMatch.map(s => s.replace(/<\/?script[^>]*>/gi, '')).join('\n')

  // v26: If polyfill is present, localStorage is OK (it's shimmed)
  const hasPolyfill = /In-memory polyfill for localStorage/.test(html)

  if (/\bprompt\s*\(/.test(scriptText)) issues.push('prompt()')
  if (/\bconfirm\s*\(/.test(scriptText)) issues.push('confirm()')
  if (!hasPolyfill && /\blocalStorage\b/.test(scriptText)) issues.push('localStorage')
  if (!hasPolyfill && /\bsessionStorage\b/.test(scriptText)) issues.push('sessionStorage')
  return issues
}

// Helper: extract all addEventListener function names
function extractEventListenerFunctions(html: string): string[] {
  const matches = html.match(/addEventListener\([^,]+,\s*(\w+)\)/g) || []
  return matches.map(m => {
    const fnMatch = m.match(/,\s*(\w+)\)/)
    return fnMatch ? fnMatch[1] : ''
  }).filter(Boolean)
}

// Helper: check if HTML has any event handling (onclick OR addEventListener)
function hasEventHandling(html: string): boolean {
  return /onclick="/i.test(html) || /addEventListener\(/i.test(html)
}

// ═══ COUNTER PROOF ═══
describe('E2E Proof 1: Counter app', () => {
  maybeIt('should have increment button with defined handler and no blocked APIs', async () => {
    const { html, error } = await buildApp('simple counter with increment button')
    expect(error).toBeNull()
    expect(html.length).toBeGreaterThan(500)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toMatch(/<button[^>]*>/i)

    // Must have event handling (onclick OR addEventListener)
    expect(hasEventHandling(html)).toBe(true)

    // Extract handlers
    const onclickHandlers = extractOnclickHandlers(html)
    const listenerFuncs = extractEventListenerFunctions(html)

    // All onclick functions must be defined
    for (const handler of onclickHandlers) {
      const fnMatch = handler.match(/(\w+)\s*\(/)
      if (fnMatch) {
        const defined = isFunctionDefined(fnMatch[1], html)
        expect(defined).toBe(true)
        if (!defined) console.error(`FAIL: onclick ${fnMatch[1]}() not defined`)
      }
    }

    // All addEventListener functions must be defined
    for (const fnName of listenerFuncs) {
      const defined = isFunctionDefined(fnName, html)
      expect(defined).toBe(true)
      if (!defined) console.error(`FAIL: addEventListener ${fnName} not defined`)
    }

    // No blocked APIs
    const blocked = checkBlockedAPIs(html)
    expect(blocked).toEqual([])
    if (blocked.length > 0) console.error(`FAIL: blocked APIs: ${blocked.join(', ')}`)

    console.log(`✅ PROOF 1 PASSED: ${onclickHandlers.length} onclick + ${listenerFuncs.length} listeners, all defined, no blocked APIs`)
  }, 300000)
})

// ═══ TODO PROOF ═══
describe('E2E Proof 2: Todo app', () => {
  maybeIt('should have add button + input + list with defined handlers', async () => {
    const { html, error } = await buildApp('todo list with add task')
    expect(error).toBeNull()
    expect(html).toMatch(/<button[^>]*>/i)
    expect(html).toMatch(/<(input|textarea)[^>]*>/i)
    expect(/<(ul|ol)[^>]*>/i.test(html) || /class="[^"]*(task|list|todo)[^"]*"/i.test(html)).toBe(true)

    // Must have event handling
    expect(hasEventHandling(html)).toBe(true)

    // All onclick functions must be defined
    for (const handler of extractOnclickHandlers(html)) {
      const fnMatch = handler.match(/(\w+)\s*\(/)
      if (fnMatch) expect(isFunctionDefined(fnMatch[1], html)).toBe(true)
    }

    // All addEventListener functions must be defined
    for (const fnName of extractEventListenerFunctions(html)) {
      expect(isFunctionDefined(fnName, html)).toBe(true)
    }

    expect(checkBlockedAPIs(html)).toEqual([])
    console.log('✅ PROOF 2 PASSED: Todo has button + input + list, handlers defined')
  }, 300000)
})

// ═══ HTML STRUCTURE PROOF ═══
describe('E2E Proof 3: HTML structure', () => {
  maybeIt('should generate valid complete HTML', async () => {
    const { html, error } = await buildApp('simple counter')
    expect(error).toBeNull()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('</html>')
    expect(html).toMatch(/<script[^>]*>/i)
    expect(html).toMatch(/<style[^>]*>/i)
    expect(html).toMatch(/<button[^>]*>/i)
    console.log('✅ PROOF 3 PASSED: Valid HTML structure')
  }, 300000)
})
