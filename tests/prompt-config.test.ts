// Tests for system prompt content, Content-Type behavior, and errorResponse
import { describe, it, expect } from 'bun:test'

// The system prompt is a const in route.ts — we can't import it directly
// (it's not exported), so we test its required properties by reading the file.
// This is a characterization test — if the prompt changes, this test catches it.

import * as fs from 'fs'
import * as path from 'path'

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/build/route.ts'),
  'utf-8'
)

describe('ARCHITECT_PROMPT content (characterization)', () => {
  it('exists and returns JSON plan', () => {
    expect(routeSource).toContain('ARCHITECT_PROMPT')
    expect(routeSource).toContain('JSON')
  })

  it('has brief output format', () => {
    expect(routeSource).toContain('brief')
  })

  it('includes plan structure (type, title, features)', () => {
    expect(routeSource).toContain('type')
    expect(routeSource).toContain('title')
    expect(routeSource).toContain('features')
  })
})

describe('CODER_PROMPT content (characterization)', () => {
  it('forbids localStorage', () => {
    expect(routeSource).toContain('localStorage')
    expect(routeSource).toContain('in-memory')
  })

  it('has output format rules', () => {
    expect(routeSource).toContain('DOCTYPE')
    expect(routeSource).toContain('raw HTML')
  })

  it('mentions accessibility', () => {
    expect(routeSource).toContain('aria-labels')
  })

  it('mentions requestAnimationFrame', () => {
    expect(routeSource).toContain('requestAnimationFrame')
  })

  it('has dark theme default', () => {
    expect(routeSource).toContain('Dark theme')
  })

  it('forbids external resources', () => {
    expect(routeSource).toContain('No external')
  })
})

describe('Route configuration (characterization)', () => {
  it('has force-dynamic', () => {
    expect(routeSource).toContain("dynamic = 'force-dynamic'")
  })

  it('has nodejs runtime', () => {
    expect(routeSource).toContain("runtime = 'nodejs'")
  })

  it('has maxDuration of 120', () => {
    expect(routeSource).toContain('maxDuration = 120')
  })

  it('has body size limit of 10KB', () => {
    expect(routeSource).toContain('10_000')
    expect(routeSource).toContain('MAX_BODY_BYTES')
  })

  it('has rate limit: 10 prod, 100 dev', () => {
    expect(routeSource).toContain("production' ? 10 : 100")
  })

  it('has maxKeys limit of 1000', () => {
    expect(routeSource).toContain('1000')
  })

  it('has timeout of 110s (under 120s maxDuration)', () => {
    expect(routeSource).toContain('110_000')
  })

  it('has Content-Type header check for body size (content-length)', () => {
    expect(routeSource).toContain('content-length')
    expect(routeSource).toContain('MAX_BODY_BYTES')
  })

  it('has errorResponse helper', () => {
    expect(routeSource).toContain('function errorResponse')
  })

  it('has ErrorBody and SuccessBody interfaces', () => {
    expect(routeSource).toContain('interface ErrorBody')
    expect(routeSource).toContain('interface SuccessBody')
  })

  it('validation happens before rate limiting', () => {
    const validationPos = routeSource.indexOf('validateMission')
    const rateLimitPos = routeSource.indexOf('buildLimiter.check')
    expect(validationPos).toBeGreaterThan(-1)
    expect(rateLimitPos).toBeGreaterThan(-1)
    expect(validationPos).toBeLessThan(rateLimitPos)
  })

  it('CSP is injected after HTML validation', () => {
    const looksLikeHtmlPos = routeSource.indexOf('looksLikeHtml')
    const injectCspPos = routeSource.indexOf('injectCsp')
    expect(looksLikeHtmlPos).toBeGreaterThan(-1)
    expect(injectCspPos).toBeGreaterThan(-1)
    expect(looksLikeHtmlPos).toBeLessThan(injectCspPos)
  })

  it('has 2-stage pipeline (architect + coder)', () => {
    expect(routeSource).toContain('STAGE 1: ARCHITECT')
    expect(routeSource).toContain('STAGE 2: CODER')
    expect(routeSource).toContain('architectResult')
    expect(routeSource).toContain('coderResult')
  })

  it('has truncation detection + continuation retry', () => {
    expect(routeSource).toContain('</html>')
    expect(routeSource).toContain('truncated')
    expect(routeSource).toContain('Continue from here')
  })

  it('structured logging for all events', () => {
    expect(routeSource).toContain("build.started")
    expect(routeSource).toContain("build.completed")
    expect(routeSource).toContain("build.architect_started")
    expect(routeSource).toContain("build.architect_completed")
    expect(routeSource).toContain("build.coder_started")
    expect(routeSource).toContain("build.rate_limited")
    expect(routeSource).toContain("build.invalid_mission")
    expect(routeSource).toContain("build.invalid_html")
  })
})

describe('Content-Type behavior (via route tests)', () => {
  it('has body parse error handling', () => {
    expect(routeSource).toContain('Invalid JSON')
  })

  it('has structured error responses (ErrorBody interface)', () => {
    expect(routeSource).toContain('interface ErrorBody')
    expect(routeSource).toContain('ok: false')
    expect(routeSource).toContain('error: string')
  })

  it('has structured success responses (SuccessBody interface)', () => {
    expect(routeSource).toContain('interface SuccessBody')
    expect(routeSource).toContain('ok: true')
    expect(routeSource).toContain('html: string')
  })
})
