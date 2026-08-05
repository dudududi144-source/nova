// Tests for build health grade calculation
import { describe, it, expect } from 'bun:test'
import { calculateBuildHealth } from '../src/lib/build-health'

describe('calculateBuildHealth', () => {
  it('returns A for excellent builds', () => {
    const result = calculateBuildHealth({
      quality: 90, missingFeatures: 0, staticErrors: 0, buildTimeMs: 120000, truncated: false
    })
    expect(result.grade).toBe('A')
    expect(result.label).toBe('Excellent')
    expect(result.color).toBe('text-emerald-400')
  })

  it('returns B for good builds', () => {
    const result = calculateBuildHealth({
      quality: 75, missingFeatures: 1, staticErrors: 0, buildTimeMs: 240000, truncated: false
    })
    expect(result.grade).toBe('B')
    expect(result.label).toBe('Good')
  })

  it('returns C for acceptable builds', () => {
    const result = calculateBuildHealth({
      quality: 60, missingFeatures: 3, staticErrors: 2, buildTimeMs: 360000, truncated: false
    })
    expect(result.grade).toBe('C')
    expect(result.label).toBe('Acceptable')
  })

  it('returns D for poor builds (low quality)', () => {
    const result = calculateBuildHealth({
      quality: 40, missingFeatures: 0, staticErrors: 0, buildTimeMs: 120000, truncated: false
    })
    expect(result.grade).toBe('D')
    expect(result.label).toBe('Poor')
  })

  it('returns D for truncated builds regardless of quality', () => {
    const result = calculateBuildHealth({
      quality: 95, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60000, truncated: true
    })
    expect(result.grade).toBe('D')
    expect(result.reasons).toContain('Output was truncated')
  })

  it('returns D for very slow builds', () => {
    const result = calculateBuildHealth({
      quality: 80, missingFeatures: 0, staticErrors: 0, buildTimeMs: 600000, truncated: false
    })
    expect(result.grade).toBe('D')
  })

  it('returns D for many missing features', () => {
    const result = calculateBuildHealth({
      quality: 70, missingFeatures: 6, staticErrors: 0, buildTimeMs: 120000, truncated: false
    })
    expect(result.grade).toBe('D')
  })

  it('returns D for many static errors', () => {
    const result = calculateBuildHealth({
      quality: 70, missingFeatures: 0, staticErrors: 5, buildTimeMs: 120000, truncated: false
    })
    expect(result.grade).toBe('D')
  })

  it('provides reasons for the grade', () => {
    const result = calculateBuildHealth({
      quality: 60, missingFeatures: 2, staticErrors: 1, buildTimeMs: 360000, truncated: false
    })
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons.some(r => r.includes('quality'))).toBe(true)
  })

  it('A grade requires fast build (<3min)', () => {
    const slow = calculateBuildHealth({
      quality: 90, missingFeatures: 0, staticErrors: 0, buildTimeMs: 300000, truncated: false
    })
    expect(slow.grade).not.toBe('A')
  })

  it('provides correct color classes', () => {
    const a = calculateBuildHealth({ quality: 95, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60000, truncated: false })
    const d = calculateBuildHealth({ quality: 30, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60000, truncated: false })
    expect(a.color).toBe('text-emerald-400')
    expect(d.color).toBe('text-red-400')
    expect(a.bgColor).toBe('bg-emerald-500/20')
    expect(d.bgColor).toBe('bg-red-500/20')
  })
})
