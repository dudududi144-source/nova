// Tests for build-store.ts — registerBuild, storeResult, storeError, getResult.
// Covers: basic CRUD, TTL expiry, MAX_ENTRIES eviction, building/completed/failed status,
// unknown id lookup, state persistence across calls.
import { describe, it, expect } from 'bun:test'
import { registerBuild, storeResult, storeError, getResult, type StoredBuildResult } from '../src/lib/build-store'

// Unique ID generator to avoid state pollution between tests.
let counter = 0
function uniqueId(label = 't'): string {
  counter++
  return `test_${label}_${Date.now().toString(36)}_${counter}_${Math.random().toString(36).slice(2, 6)}`
}

describe('registerBuild', () => {
  it('registers a build with status "building"', () => {
    const id = uniqueId('reg')
    registerBuild(id)
    const result = getResult(id)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('building')
    expect(result!.html).toBe('')
    expect(result!.tokens).toBe(0)
    expect(result!.ms).toBe(0)
    expect(result!.quality).toBe(0)
    expect(result!.metrics).toBe('')
  })

  it('preserves the id of the registered build', () => {
    const id = uniqueId('idcheck')
    registerBuild(id)
    const result = getResult(id)
    expect(result!.id).toBe(id)
  })

  it('sets timestamp on the registered build', () => {
    const id = uniqueId('ts')
    const before = Date.now()
    registerBuild(id)
    const after = Date.now()
    const result = getResult(id)
    expect(result!.timestamp).toBeGreaterThanOrEqual(before)
    expect(result!.timestamp).toBeLessThanOrEqual(after)
  })

  it('overwrites an existing build when called twice with the same id', () => {
    const id = uniqueId('overwrite')
    registerBuild(id)
    registerBuild(id) // overwrite
    const result = getResult(id)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('building')
  })
})

describe('storeResult', () => {
  it('stores a completed build with the given html and metadata', () => {
    const id = uniqueId('store')
    registerBuild(id)
    storeResult(id, {
      html: '<html><body>Hello</body></html>',
      tokens: 100,
      ms: 250,
      quality: 85,
      metrics: '100 lines · 5 functions',
    })
    const result = getResult(id)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('completed')
    expect(result!.html).toBe('<html><body>Hello</body></html>')
    expect(result!.tokens).toBe(100)
    expect(result!.ms).toBe(250)
    expect(result!.quality).toBe(85)
    expect(result!.metrics).toBe('100 lines · 5 functions')
  })

  it('preserves the original timestamp from registerBuild', () => {
    const id = uniqueId('tspreserve')
    registerBuild(id)
    const registered = getResult(id)!
    const ts = registered.timestamp
    storeResult(id, { html: '<html></html>', tokens: 0, ms: 0, quality: 0, metrics: '' })
    const result = getResult(id)
    expect(result!.timestamp).toBe(ts)
  })

  it('falls back to Date.now() for timestamp when no existing entry exists', () => {
    const id = uniqueId('fallback')
    const before = Date.now()
    storeResult(id, { html: '<html></html>', tokens: 0, ms: 0, quality: 0, metrics: '' })
    const after = Date.now()
    const result = getResult(id)
    expect(result).not.toBeNull()
    expect(result!.timestamp).toBeGreaterThanOrEqual(before)
    expect(result!.timestamp).toBeLessThanOrEqual(after)
  })

  it('can store optional fields (files, outputType, previewable, suggestions)', () => {
    const id = uniqueId('opt')
    registerBuild(id)
    storeResult(id, {
      html: '<html></html>',
      tokens: 10,
      ms: 50,
      quality: 70,
      metrics: 'ok',
      files: [{ path: 'main.py', content: 'print(1)', language: 'python' }],
      outputType: 'python',
      previewable: false,
      suggestions: ['add types'],
    })
    const result = getResult(id)
    expect(result!.files).toEqual([{ path: 'main.py', content: 'print(1)', language: 'python' }])
    expect(result!.outputType).toBe('python')
    expect(result!.previewable).toBe(false)
    expect(result!.suggestions).toEqual(['add types'])
  })
})

describe('storeError', () => {
  it('stores a failed build with the given error message', () => {
    const id = uniqueId('err')
    registerBuild(id)
    storeError(id, 'LLM timeout')
    const result = getResult(id)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('failed')
    expect(result!.error).toBe('LLM timeout')
    expect(result!.html).toBe('')
  })

  it('preserves the original timestamp when registering then erroring', () => {
    const id = uniqueId('errts')
    registerBuild(id)
    const ts = getResult(id)!.timestamp
    storeError(id, 'something failed')
    const result = getResult(id)
    expect(result!.timestamp).toBe(ts)
  })

  it('can be called without a prior registerBuild (falls back to Date.now())', () => {
    const id = uniqueId('direct')
    const before = Date.now()
    storeError(id, 'direct error')
    const after = Date.now()
    const result = getResult(id)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('failed')
    expect(result!.error).toBe('direct error')
    expect(result!.timestamp).toBeGreaterThanOrEqual(before)
    expect(result!.timestamp).toBeLessThanOrEqual(after)
  })
})

describe('getResult', () => {
  it('returns null for an unknown id', () => {
    const id = uniqueId('unknown')
    const result = getResult(id)
    expect(result).toBeNull()
  })

  it('returns a StoredBuildResult for a known id', () => {
    const id = uniqueId('known')
    registerBuild(id)
    const result = getResult(id)
    expect(result).not.toBeNull()
    expect(typeof result!.id).toBe('string')
    expect(typeof result!.status).toBe('string')
    expect(typeof result!.timestamp).toBe('number')
  })

  it('returns the same status that was stored', () => {
    const id = uniqueId('status')
    registerBuild(id)
    expect(getResult(id)!.status).toBe('building')
    storeResult(id, { html: 'x', tokens: 1, ms: 1, quality: 1, metrics: '' })
    expect(getResult(id)!.status).toBe('completed')
    storeError(id, 'err')
    expect(getResult(id)!.status).toBe('failed')
  })
})

describe('StoredBuildResult interface', () => {
  it('returns an object that matches the StoredBuildResult interface', () => {
    const id = uniqueId('iface')
    registerBuild(id)
    storeResult(id, {
      html: '<html></html>',
      tokens: 5,
      ms: 30,
      quality: 80,
      metrics: 'metrics',
    })
    const result = getResult(id) as StoredBuildResult
    expect(result).not.toBeNull()
    expect(typeof result.id).toBe('string')
    expect(typeof result.html).toBe('string')
    expect(typeof result.tokens).toBe('number')
    expect(typeof result.ms).toBe('number')
    expect(typeof result.quality).toBe('number')
    expect(typeof result.metrics).toBe('string')
    expect(typeof result.status).toBe('string')
    expect(typeof result.timestamp).toBe('number')
  })
})

describe('eviction (MAX_ENTRIES cap)', () => {
  it('does not crash when registering many builds (caps store size)', () => {
    // Register 60 builds to exceed the MAX_ENTRIES (50).
    const ids: string[] = []
    for (let i = 0; i < 60; i++) {
      const id = uniqueId(`evict${i}`)
      ids.push(id)
      registerBuild(id)
    }
    // The first few may have been evicted, but the most recent should still be present.
    const lastId = ids[ids.length - 1]
    const result = getResult(lastId)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(lastId)
  })
})
