// Tests for math-fixer.ts — fixConversionMath, verifyMath.
// Covers: meter→km inversion, no-op when not a conversion, empty/edge inputs,
// multi-script scanning for verifyMath.
import { describe, it, expect } from 'bun:test'
import { fixConversionMath, verifyMath } from '../src/lib/math-fixer'

describe('fixConversionMath', () => {
  it('fixes meter→km: multiply→divide by 1000', () => {
    const html = `<script>const km = meters * 1000;</script>`
    const fixed = fixConversionMath(html)
    expect(fixed).toContain('meters / 1000')
    expect(fixed).not.toContain('meters * 1000')
  })

  it('fixes meter→km even with spaced operator *  1000', () => {
    const html = `<script>var km = meters  *  1000;</script>`
    const fixed = fixConversionMath(html)
    expect(fixed).toContain('meters / 1000')
  })

  it('does NOT touch multiply-by-1000 when context is not conversion (no meter/km keyword)', () => {
    const html = `<script>const price = total * 1000; // price calculation</script>`
    const fixed = fixConversionMath(html)
    expect(fixed).toContain('total * 1000')
    expect(fixed).not.toContain('total / 1000')
  })

  it('fixes when context has "kilometer" keyword within 200 chars before the match', () => {
    const html = `<script>// convert from kilometer const km = value * 1000;</script>`
    const fixed = fixConversionMath(html)
    expect(fixed).toContain('value / 1000')
  })

  it('fixes when context has "km" keyword after the match', () => {
    const html = `<script>const x = v * 1000; // store in km</script>`
    const fixed = fixConversionMath(html)
    expect(fixed).toContain('v / 1000')
  })

  it('returns empty string unchanged', () => {
    expect(fixConversionMath('')).toBe('')
  })

  it('returns HTML with no script unchanged when no conversion match exists', () => {
    const html = `<html><body><h1>Hello</h1></body></html>`
    expect(fixConversionMath(html)).toBe(html)
  })

  it('handles multiple multiply-by-1000 matches and fixes only those in conversion context', () => {
    // The "price * 1000" is isolated far from any meter/km keyword (>200 chars away).
    const padding = 'x'.repeat(220)
    const html = `<script>const km = meters * 1000;</script>${padding}<script>const total = price * 1000;</script>${padding}<script>const km2 = length * 1000; // km output</script>`
    const fixed = fixConversionMath(html)
    expect(fixed).toContain('meters / 1000')
    expect(fixed).toContain('price * 1000') // price calc untouched (>200 chars from meter/km)
    expect(fixed).toContain('length / 1000')
  })

  it('is idempotent — running twice produces the same output', () => {
    const html = `<script>const km = meters * 1000;</script>`
    const once = fixConversionMath(html)
    const twice = fixConversionMath(once)
    expect(twice).toBe(once)
  })

  it('preserves surrounding content when applying fix', () => {
    const html = `<html><head><title>Conv</title></head><body><script>const km = meters * 1000;</script></body></html>`
    const fixed = fixConversionMath(html)
    expect(fixed.startsWith('<html><head><title>Conv</title></head><body><script>const km = meters / 1000;')).toBe(true)
    expect(fixed.endsWith('</script></body></html>')).toBe(true)
  })

  it('does not crash on plain text with no scripts', () => {
    const html = 'just plain text no script'
    expect(fixConversionMath(html)).toBe(html)
  })

  it('handles multiply-by-1000 in a different variable name', () => {
    const html = `<script>const km = distance * 1000; // meter to km</script>`
    const fixed = fixConversionMath(html)
    expect(fixed).toContain('distance / 1000')
  })

  it('does not modify division-by-1000 (already correct)', () => {
    const html = `<script>const km = meters / 1000;</script>`
    expect(fixConversionMath(html)).toBe(html)
  })
})

describe('verifyMath', () => {
  it('returns ok=true when no inverted formulas are found', () => {
    const html = `<html><body><script>const km = meters / 1000;</script></body></html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('detects meter * 1000 pattern as inverted', () => {
    const html = `<html><body><script>const km = meter * 1000;</script></body></html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issues[0]).toMatch(/meter/i)
  })

  it('detects 1000 * meter pattern as inverted', () => {
    const html = `<html><body><script>const km = 1000 * meter;</script></body></html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('returns ok=true for empty string', () => {
    expect(verifyMath('').ok).toBe(true)
  })

  it('returns ok=true when HTML has no script tags', () => {
    const html = `<html><body><h1>Hello</h1></body></html>`
    expect(verifyMath(html).ok).toBe(true)
  })

  it('scans content across multiple script tags', () => {
    const html = `<html>
      <head><script>var x = 1;</script></head>
      <body><script>const km = meter * 1000;</script></body>
    </html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(false)
  })

  it('does not flag multiply-by-1000 without meter context', () => {
    const html = `<html><body><script>const price = total * 1000;</script></body></html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('properly strips <script> tags before scanning', () => {
    // meter * 1000 appears inside a <style> tag (not a script) — should not trigger
    const html = `<html><head><style>/* meter * 1000 */</style></head></html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(true)
  })

  it('handles uppercase METER in pattern', () => {
    const html = `<html><body><script>const km = METER * 1000;</script></body></html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(false)
  })

  it('returns a string issue description, not a non-string', () => {
    const html = `<html><body><script>const km = meter * 1000;</script></body></html>`
    const result = verifyMath(html)
    for (const issue of result.issues) {
      expect(typeof issue).toBe('string')
      expect(issue.length).toBeGreaterThan(0)
    }
  })

  it('handles script tag with attributes', () => {
    const html = `<html><body><script type="text/javascript">const km = meter * 1000;</script></body></html>`
    const result = verifyMath(html)
    expect(result.ok).toBe(false)
  })
})
