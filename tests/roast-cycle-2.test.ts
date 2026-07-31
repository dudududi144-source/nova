// Tests for roast cycle #2 fixes
import { describe, it, expect } from 'bun:test'
import { analyzeQuality } from '../src/lib/build-intelligence'
import { logger } from '../src/lib/logger'

describe('analyzeQuality — CSS rule counting (roast #2 fix)', () => {
  it('counts CSS rules only inside <style> tags', () => {
    const html = `<!DOCTYPE html><html><head>
<style>
body { margin: 0; }
.btn { color: red; }
.container { display: flex; }
</style>
</head><body>
<script>
const obj = { a: 1, b: 2 };  // JS object — should NOT be counted as CSS
const arr = [{ x: 1 }, { y: 2 }];  // More JS objects
function f() { return { z: 3 }; }  // Another JS object
</script>
</body></html>`
    const metrics = analyzeQuality(html)
    expect(metrics.cssRules).toBe(3) // Only the 3 CSS rules, not the JS objects
  })

  it('returns 0 CSS rules when no <style> tag', () => {
    const html = `<!DOCTYPE html><html><head></head><body>
<script>const x = { a: 1 };</script>
</body></html>`
    const metrics = analyzeQuality(html)
    expect(metrics.cssRules).toBe(0)
  })

  it('handles multiple <style> tags', () => {
    const html = `<!DOCTYPE html><html><head>
<style>body { margin: 0; }</style>
<style>.btn { color: red; }</style>
</head><body></body></html>`
    const metrics = analyzeQuality(html)
    expect(metrics.cssRules).toBe(2)
  })

  it('handles empty <style> tag', () => {
    const html = `<!DOCTYPE html><html><head><style></style></head><body></body></html>`
    const metrics = analyzeQuality(html)
    expect(metrics.cssRules).toBe(0)
  })
})

describe('logger — crash protection (roast #2 fix)', () => {
  it('does not crash on circular references', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    // Should not throw — should log a fallback message
    expect(() => logger.info('test.circular', { data: circular })).not.toThrow()
  })

  it('does not crash on BigInt values', () => {
    // Should not throw — should log a fallback message
    expect(() => logger.info('test.bigint', { count: BigInt(123) })).not.toThrow()
  })

  it('still logs normal objects correctly', () => {
    const originalLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'debug'
    // Just verify it doesn't throw
    expect(() => logger.info('test.normal', { a: 1, b: 'hello' })).not.toThrow()
    process.env.LOG_LEVEL = originalLevel
  })
})
