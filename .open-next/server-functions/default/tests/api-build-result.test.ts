// Comprehensive tests for /api/build/result route (GET)
// Tests: missing ID, not found, completed/failed/building statuses, rate limiting
import { describe, expect, test, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

// ── Mock RateLimiter (controllable) ──
let rateLimitAllowed = true
const mockCheck = mock((_key: string) => ({
  ok: rateLimitAllowed,
  remaining: rateLimitAllowed ? 199 : 0,
  resetInMs: 60_000,
}))
mock.module('@/lib/rate-limit', () => ({
  RateLimiter: class {
    check(key: string) { return mockCheck(key) }
    reset() {}
    resetAll() {}
    cleanup() {}
    destroy() {}
  },
}))

// ── Use the real build-store (in-memory, persists across tests in this file) ──
// We import registerBuild, storeResult, storeError to set up test data.
const { registerBuild, storeResult, storeError } = await import('../src/lib/build-store')
const { GET } = await import('../src/app/api/build/result/route')

// ── Test helpers ──
interface TestRequest {
  headers: Map<string, string>
  nextUrl: { searchParams: URLSearchParams }
}

let ipCounter = 0
function makeRequest(params: Record<string, string> = {}): TestRequest {
  return {
    headers: new Map([['x-forwarded-for', `70.0.0.${ipCounter++}`]]),
    nextUrl: { searchParams: new URLSearchParams(params) },
  }
}

describe('GET /api/build/result — missing ID', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 400 when id query param is missing', async () => {
    const res = await GET(makeRequest() as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Missing build ID')
  })

  test('returns 400 when id query param is empty string', async () => {
    const res = await GET(makeRequest({ id: '' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/build/result — not found', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 404 for a non-existent ID', async () => {
    const res = await GET(makeRequest({ id: 'nonexistent_id_xyz_123' }) as unknown as NextRequest)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toContain('not found')
    expect(data.status).toBe('not_found')
  })

  test('returns 404 with the requested ID in response', async () => {
    const res = await GET(makeRequest({ id: 'my_missing_id_456' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.requestedId).toBe('my_missing_id_456')
  })

  test('returns 404 for an ID that was never registered', async () => {
    const res = await GET(makeRequest({ id: 'totally_random_id_789' }) as unknown as NextRequest)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/build/result — completed build', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 200 with stored result for a completed build', async () => {
    const id = 'test_completed_001'
    registerBuild(id)
    storeResult(id, {
      html: '<!DOCTYPE html><html><body><p>done</p></body></html>',
      tokens: 500,
      ms: 5000,
      quality: 92,
      metrics: '120 lines',
    })
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('completed')
    expect(data.html).toContain('<!DOCTYPE html>')
    expect(data.tokens).toBe(500)
    expect(data.ms).toBe(5000)
    expect(data.quality).toBe(92)
    expect(data.metrics).toBe('120 lines')
  })

  test('returns undefined html when not present in result', async () => {
    const id = 'test_completed_no_html_002'
    registerBuild(id)
    storeResult(id, {
      html: '',
      tokens: 100,
      ms: 1000,
      quality: 50,
      metrics: '10 lines',
    })
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.status).toBe('completed')
    expect(data.html).toBeUndefined()
  })

  test('returns files, outputType, and previewable when present', async () => {
    const id = 'test_completed_files_003'
    registerBuild(id)
    storeResult(id, {
      html: '<html></html>',
      tokens: 200,
      ms: 2000,
      quality: 80,
      metrics: '50 lines',
      files: [{ path: 'index.html', content: '<html></html>', language: 'html' }],
      outputType: 'html-app',
      previewable: true,
    })
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.files).toHaveLength(1)
    expect(data.files[0].path).toBe('index.html')
    expect(data.outputType).toBe('html-app')
    expect(data.previewable).toBe(true)
  })

  test('returns language and fileName from the first file', async () => {
    const id = 'test_completed_lang_004'
    registerBuild(id)
    storeResult(id, {
      html: 'print("hi")',
      tokens: 50,
      ms: 500,
      quality: 70,
      metrics: '5 lines',
      files: [{ path: 'script.py', content: 'print("hi")', language: 'python' }],
      outputType: 'python',
      previewable: false,
    })
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.language).toBe('python')
    expect(data.fileName).toBe('script.py')
  })

  test('returns suggestions when present', async () => {
    const id = 'test_completed_sugg_005'
    registerBuild(id)
    storeResult(id, {
      html: '<html></html>',
      tokens: 200,
      ms: 2000,
      quality: 80,
      metrics: '50 lines',
      suggestions: ['Add a header', 'Use semantic HTML'],
    })
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.suggestions).toEqual(['Add a header', 'Use semantic HTML'])
  })

  test('sets Cache-Control no-cache header', async () => {
    const id = 'test_completed_cache_006'
    registerBuild(id)
    storeResult(id, {
      html: '<html></html>',
      tokens: 100,
      ms: 1000,
      quality: 80,
      metrics: '10 lines',
    })
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('no-cache')
    expect(cc).toContain('no-store')
    expect(cc).toContain('must-revalidate')
  })
})

describe('GET /api/build/result — failed build', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 200 with failed status and error message', async () => {
    const id = 'test_failed_001'
    registerBuild(id)
    storeError(id, 'LLM service unavailable')
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('failed')
    expect(data.error).toBe('LLM service unavailable')
  })

  test('returns empty html for failed build (html omitted via || undefined)', async () => {
    const id = 'test_failed_002'
    registerBuild(id)
    storeError(id, 'Build crashed')
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.status).toBe('failed')
    expect(data.html).toBeUndefined()
  })

  test('returns zero tokens and ms for failed build', async () => {
    const id = 'test_failed_003'
    registerBuild(id)
    storeError(id, 'Timeout')
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.tokens).toBe(0)
    expect(data.ms).toBe(0)
  })
})

describe('GET /api/build/result — building status', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 200 with building status for a registered-but-not-completed build', async () => {
    const id = 'test_building_001'
    registerBuild(id)
    // Don't call storeResult or storeError — status stays 'building'
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('building')
  })

  test('building status returns empty html (undefined)', async () => {
    const id = 'test_building_002'
    registerBuild(id)
    const res = await GET(makeRequest({ id }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.html).toBeUndefined()
  })
})

describe('GET /api/build/result — rate limiting', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 429 when rate limiter rejects', async () => {
    rateLimitAllowed = false
    const res = await GET(makeRequest({ id: 'any_id' }) as unknown as NextRequest)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.error).toContain('Rate limited')
  })

  test('rate limit check happens before ID validation', async () => {
    // Even with no id, rate limiting should trigger first
    rateLimitAllowed = false
    const res = await GET(makeRequest() as unknown as NextRequest)
    expect(res.status).toBe(429)
  })
})
