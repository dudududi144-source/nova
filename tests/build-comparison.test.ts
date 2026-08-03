// Tests for build comparison summary
import { describe, it, expect } from 'bun:test'
import { compareBuilds } from '../src/lib/build-comparison'

describe('compareBuilds', () => {
  const mkBuild = (html: string, quality = 80, ms = 60000, mission = 'test') => ({
    html, quality, ms, mission,
  })

  it('detects quality improvement', () => {
    const old = mkBuild('<html></html>', 70)
    const result = mkBuild('<html><body>new</body></html>', 85)
    const cmp = compareBuilds(old, result)
    expect(cmp.qualityChange).toBe(15)
    expect(cmp.isImprovement).toBe(true)
    expect(cmp.summary).toContain('improved by 15')
  })

  it('detects quality drop', () => {
    const old = mkBuild('<html></html>', 85)
    const result = mkBuild('<html></html>', 70)
    const cmp = compareBuilds(old, result)
    expect(cmp.qualityChange).toBe(-15)
    expect(cmp.isImprovement).toBe(false)
    expect(cmp.summary).toContain('dropped by 15')
  })

  it('detects added lines', () => {
    const old = mkBuild('<html>\n<head></head>\n</html>')
    const result = mkBuild('<html>\n<head></head>\n<body>new</body>\n</html>')
    const cmp = compareBuilds(old, result)
    expect(cmp.addedLines).toBeGreaterThan(0)
    expect(cmp.summary).toContain('lines added')
  })

  it('detects removed lines', () => {
    const old = mkBuild('<html>\n<head></head>\n<body>old</body>\n</html>')
    const result = mkBuild('<html>\n<head></head>\n</html>')
    const cmp = compareBuilds(old, result)
    expect(cmp.removedLines).toBeGreaterThan(0)
    expect(cmp.summary).toContain('lines removed')
  })

  it('calculates size change', () => {
    const old = mkBuild('<html></html>')
    const result = mkBuild('<html><body>much longer content here</body></html>')
    const cmp = compareBuilds(old, result)
    expect(cmp.sizeChange).toBeGreaterThan(0)
    expect(cmp.sizeChangePercent).toBeGreaterThan(0)
    expect(cmp.summary).toContain('Size +')
  })

  it('calculates size decrease', () => {
    const old = mkBuild('<html><body>much longer content here</body></html>')
    const result = mkBuild('<html></html>')
    const cmp = compareBuilds(old, result)
    expect(cmp.sizeChange).toBeLessThan(0)
    expect(cmp.sizeChangePercent).toBeLessThan(0)
  })

  it('detects time change', () => {
    const old = mkBuild('<html></html>', 80, 60000)
    const result = mkBuild('<html></html>', 80, 120000)
    const cmp = compareBuilds(old, result)
    expect(cmp.timeChange).toBe(60000)
    expect(cmp.summary).toContain('Build time +')
  })

  it('handles identical builds', () => {
    const build = mkBuild('<html><body>same</body></html>', 80, 60000)
    const cmp = compareBuilds(build, build)
    expect(cmp.qualityChange).toBe(0)
    expect(cmp.sizeChange).toBe(0)
    expect(cmp.summary).toContain('unchanged')
  })

  it('handles missing quality (defaults to 0)', () => {
    const old = { html: '<html></html>', mission: 'test' }
    const result = { html: '<html></html>', mission: 'test', quality: 80 }
    const cmp = compareBuilds(old, result)
    expect(cmp.qualityChange).toBe(80)
    expect(cmp.isImprovement).toBe(true)
  })

  it('is improvement when quality same but size grew', () => {
    const old = mkBuild('<html></html>', 80)
    const result = mkBuild('<html><body>more content</body></html>', 80)
    const cmp = compareBuilds(old, result)
    expect(cmp.isImprovement).toBe(true)
  })

  it('summary includes all changes', () => {
    const old = mkBuild('<html></html>', 70, 60000)
    const result = mkBuild('<html><body>new content</body></html>', 85, 90000)
    const cmp = compareBuilds(old, result)
    expect(cmp.summary).toContain('Quality')
    expect(cmp.summary).toContain('lines')
    expect(cmp.summary).toContain('Size')
    expect(cmp.summary).toContain('Build time')
  })
})
