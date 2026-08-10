// Characterization tests for route sources
import { describe, it, expect } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

const architectSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/build/architect/route.ts'), 'utf-8'
)
const codeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/build/code/route.ts'), 'utf-8'
)
const refineSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/refine/route.ts'), 'utf-8'
)

describe('Architect route characterization', () => {
  it('has ARCHITECT_PROMPT with JSON format', () => {
    expect(architectSource).toContain('ARCHITECT_PROMPT')
    expect(architectSource).toContain('JSON')
  })

  it('has maxDuration of 60', () => {
    expect(architectSource).toContain('maxDuration = 60')
  })

  it('has rate limiter', () => {
    expect(architectSource).toContain('RateLimiter')
  })

  it('has structured logging', () => {
    expect(architectSource).toContain('architect.started')
    expect(architectSource).toContain('architect.completed')
  })

  it('validates mission before rate limiting', () => {
    const v = architectSource.indexOf('validateMission')
    const r = architectSource.indexOf('architectLimiter.check')
    expect(v).toBeGreaterThan(-1)
    expect(r).toBeGreaterThan(-1)
    expect(v).toBeLessThan(r)
  })
})

describe('Code route characterization (SSE)', () => {
  it('has buildPrompt with quality requirements (v29: replaced CODER_PROMPT)', () => {
    // v29: CODER_PROMPT was replaced with buildPrompt() function
    expect(codeSource).toContain('buildPrompt')
    expect(codeSource).toContain('elite software engineer')
    expect(codeSource).toContain('production-quality')
  })

  it('returns SSE stream (text/event-stream)', () => {
    expect(codeSource).toContain('text/event-stream')
    expect(codeSource).toContain('ReadableStream')
  })

  it('has keepalive progress events', () => {
    expect(codeSource).toContain('keepAliveInterval')
    expect(codeSource).toContain('setInterval')
    expect(codeSource).toContain('progress')
  })

  it('has truncation detection + continuation retry', () => {
    expect(codeSource).toContain('</html>')
    expect(codeSource).toContain('truncated')
  })

  it('has no arbitrary maxTokens limit (32000 = generous)', () => {
    expect(codeSource).toContain('estimateTokenBudget')
  })

  it('has maxDuration of 180', () => {
    expect(codeSource).toContain('maxDuration = 180')
  })

  it('sends result and error event types', () => {
    expect(codeSource).toContain("type: 'result'")
    expect(codeSource).toContain("type: 'error'")
  })

  it('has CSP injection after HTML validation', () => {
    const looks = codeSource.indexOf('looksLikeHtml')
    const csp = codeSource.indexOf('injectCsp')
    expect(looks).toBeGreaterThan(-1)
    expect(csp).toBeGreaterThan(-1)
    expect(looks).toBeLessThan(csp)
  })

  it('clears keepalive on success, error, and exception', () => {
    expect(codeSource).toContain('clearInterval(keepAliveInterval)')
  })

  it('has structured logging', () => {
    expect(codeSource).toContain('code.started')
    expect(codeSource).toContain('code.completed')
  })
})

describe('Refine route characterization (SSE)', () => {
  it('has REFINE_PROMPT with refinement rules', () => {
    expect(refineSource).toContain('REFINE_PROMPT')
    expect(refineSource).toContain('localStorage')
    expect(refineSource).toContain('in-memory')
  })

  it('returns SSE stream', () => {
    expect(refineSource).toContain('text/event-stream')
    expect(refineSource).toContain('ReadableStream')
  })

  it('has keepalive progress events', () => {
    expect(refineSource).toContain('keepAliveInterval')
    expect(refineSource).toContain('progress')
  })

  it('has maxDuration of 180', () => {
    expect(refineSource).toContain('maxDuration = 180')
  })

  it('has no arbitrary maxTokens limit (uses adaptive tokenBudget)', () => {
    // Refine uses an adaptive budget: Math.max(16000, Math.min(32000, estimatedInputTokens + 4000))
    // (code route uses estimateTokenBudget(plan) instead — different mechanism, same goal)
    expect(refineSource).toContain('tokenBudget')
    expect(refineSource).toContain('Math.max(16000')
    expect(refineSource).toContain('Math.min(32000')
  })

  it('has truncation detection', () => {
    expect(refineSource).toContain('</html>')
    expect(refineSource).toContain('truncated')
  })

  it('has structured logging', () => {
    expect(refineSource).toContain('refine.started')
    expect(refineSource).toContain('refine.completed')
  })
})
