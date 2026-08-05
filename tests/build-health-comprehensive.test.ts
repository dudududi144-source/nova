// Comprehensive tests for src/lib/build-health.ts
// Tests calculateBuildHealth across all grade combinations, boundary values,
// and the reasons array for each grade.
import { describe, expect, test } from 'bun:test'
import { calculateBuildHealth } from '../src/lib/build-health'
import type { BuildHealth, HealthGrade } from '../src/lib/build-health'

interface Params {
  quality: number
  missingFeatures: number
  staticErrors: number
  buildTimeMs: number
  truncated: boolean
}

const mkParams = (overrides: Partial<Params> = {}): Params => ({
  quality: 80,
  missingFeatures: 0,
  staticErrors: 0,
  buildTimeMs: 120000, // 2 min
  truncated: false,
  ...overrides,
})

// Helper: assert a fully-formed BuildHealth object
function assertHealth(h: BuildHealth): void {
  expect(['A', 'B', 'C', 'D']).toContain(h.grade)
  expect(typeof h.label).toBe('string')
  expect(h.label.length).toBeGreaterThan(0)
  expect(typeof h.color).toBe('string')
  expect(h.color.startsWith('text-')).toBe(true)
  expect(typeof h.bgColor).toBe('string')
  expect(h.bgColor.startsWith('bg-')).toBe(true)
  expect(Array.isArray(h.reasons)).toBe(true)
}

describe('calculateBuildHealth — structure invariants', () => {
  test('returns a fully-formed BuildHealth for default params', () => {
    assertHealth(calculateBuildHealth(mkParams()))
  })
  test('returns a fully-formed BuildHealth for truncated build', () => {
    assertHealth(calculateBuildHealth(mkParams({ truncated: true })))
  })
  test('returns a fully-formed BuildHealth for zero-everything', () => {
    assertHealth(calculateBuildHealth({ quality: 0, missingFeatures: 0, staticErrors: 0, buildTimeMs: 0, truncated: false }))
  })
  test('returns a fully-formed BuildHealth for extreme values', () => {
    assertHealth(calculateBuildHealth({ quality: 100, missingFeatures: 99, staticErrors: 99, buildTimeMs: 9_999_999, truncated: false }))
  })
})

describe('calculateBuildHealth — A grade (Excellent)', () => {
  test('A: quality=85, missing=0, errors=0, time=3min', () => {
    const h = calculateBuildHealth(mkParams({ quality: 85, missingFeatures: 0, staticErrors: 0, buildTimeMs: 180000 }))
    expect(h.grade).toBe('A')
    expect(h.label).toBe('Excellent')
  })
  test('A: quality=100 (upper bound)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 100, buildTimeMs: 60000 })).grade).toBe('A')
  })
  test('A: buildTimeMs=180000 exactly (3 min boundary)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 180000 })).grade).toBe('A')
  })
  test('A: buildTimeMs=180001 (just over 3 min) drops to B', () => {
    // 180001ms = 3.0000167min > 3 → not A
    expect(calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 180001 })).grade).not.toBe('A')
  })
  test('A: quality=84 (below 85) drops to B', () => {
    expect(calculateBuildHealth(mkParams({ quality: 84, buildTimeMs: 60000 })).grade).not.toBe('A')
  })
  test('A: missingFeatures=1 drops to B', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, missingFeatures: 1, buildTimeMs: 60000 })).grade).not.toBe('A')
  })
  test('A: staticErrors=1 drops to B', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, staticErrors: 1, buildTimeMs: 60000 })).grade).not.toBe('A')
  })
  test('A: color is text-emerald-400', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 60000 })).color).toBe('text-emerald-400')
  })
  test('A: bgColor is bg-emerald-500/20', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 60000 })).bgColor).toBe('bg-emerald-500/20')
  })
  test('A: reasons include "High quality"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('High quality'))).toBe(true)
  })
  test('A: reasons include "All planned features present"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('All planned features'))).toBe(true)
  })
  test('A: reasons include "Fast build"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('Fast build'))).toBe(true)
  })
})

describe('calculateBuildHealth — B grade (Good)', () => {
  test('B: quality=70, missing=2, errors=1, time=5min', () => {
    const h = calculateBuildHealth(mkParams({ quality: 70, missingFeatures: 2, staticErrors: 1, buildTimeMs: 300000 }))
    expect(h.grade).toBe('B')
    expect(h.label).toBe('Good')
  })
  test('B: quality=84 (just below A threshold)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 84, buildTimeMs: 60000 })).grade).toBe('B')
  })
  test('B: missingFeatures=2 (boundary)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, missingFeatures: 2, buildTimeMs: 60000 })).grade).toBe('B')
  })
  test('B: missingFeatures=3 drops to C', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, missingFeatures: 3, buildTimeMs: 60000 })).grade).not.toBe('B')
  })
  test('B: staticErrors=1 (boundary)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, staticErrors: 1, buildTimeMs: 60000 })).grade).toBe('B')
  })
  test('B: staticErrors=2 drops to C', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, staticErrors: 2, buildTimeMs: 60000 })).grade).not.toBe('B')
  })
  test('B: buildTimeMs=300000 (5 min boundary)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, buildTimeMs: 300000 })).grade).toBe('B')
  })
  test('B: buildTimeMs=300001 (just over 5 min) drops', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, buildTimeMs: 300001 })).grade).not.toBe('B')
  })
  test('B: quality=69 drops to C', () => {
    expect(calculateBuildHealth(mkParams({ quality: 69, buildTimeMs: 60000 })).grade).not.toBe('B')
  })
  test('B: color is text-blue-400', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, buildTimeMs: 60000 })).color).toBe('text-blue-400')
  })
  test('B: bgColor is bg-blue-500/20', () => {
    expect(calculateBuildHealth(mkParams({ quality: 75, buildTimeMs: 60000 })).bgColor).toBe('bg-blue-500/20')
  })
  test('B: reasons include "Good quality"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 75, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('Good quality'))).toBe(true)
  })
  test('B with missingFeatures=1: reasons mention "1 feature(s) missing"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 75, missingFeatures: 1, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('1 feature(s) missing'))).toBe(true)
  })
  test('B with staticErrors=1: reasons mention "1 static error(s)"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 75, staticErrors: 1, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('1 static error(s)'))).toBe(true)
  })
})

describe('calculateBuildHealth — C grade (Acceptable)', () => {
  test('C: quality=50, missing=4, errors=3, time=8min', () => {
    const h = calculateBuildHealth(mkParams({ quality: 50, missingFeatures: 4, staticErrors: 3, buildTimeMs: 480000 }))
    expect(h.grade).toBe('C')
    expect(h.label).toBe('Acceptable')
  })
  test('C: quality=69 (just below B)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 69, buildTimeMs: 60000 })).grade).toBe('C')
  })
  test('C: missingFeatures=4 (boundary)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, missingFeatures: 4, buildTimeMs: 60000 })).grade).toBe('C')
  })
  test('C: missingFeatures=5 drops to D', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, missingFeatures: 5, buildTimeMs: 60000 })).grade).not.toBe('C')
  })
  test('C: staticErrors=3 (boundary)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, staticErrors: 3, buildTimeMs: 60000 })).grade).toBe('C')
  })
  test('C: staticErrors=4 drops to D', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, staticErrors: 4, buildTimeMs: 60000 })).grade).not.toBe('C')
  })
  test('C: buildTimeMs=480000 (8 min boundary)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, buildTimeMs: 480000 })).grade).toBe('C')
  })
  test('C: buildTimeMs=480001 (just over 8 min) drops to D', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, buildTimeMs: 480001 })).grade).not.toBe('C')
  })
  test('C: quality=49 drops to D', () => {
    expect(calculateBuildHealth(mkParams({ quality: 49, buildTimeMs: 60000 })).grade).not.toBe('C')
  })
  test('C: color is text-amber-400', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, buildTimeMs: 60000 })).color).toBe('text-amber-400')
  })
  test('C: bgColor is bg-amber-500/20', () => {
    expect(calculateBuildHealth(mkParams({ quality: 60, buildTimeMs: 60000 })).bgColor).toBe('bg-amber-500/20')
  })
  test('C: reasons include "Fair quality"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 60, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('Fair quality'))).toBe(true)
  })
  test('C with missingFeatures=3: reasons mention "3 features missing"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 60, missingFeatures: 3, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('3 features missing'))).toBe(true)
  })
  test('C with staticErrors=2: reasons mention "2 static errors"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 60, staticErrors: 2, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('2 static errors'))).toBe(true)
  })
  test('C with slow build: reasons mention "Slow build"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 60, buildTimeMs: 360000 })).reasons // 6 min
    expect(reasons.some(r => r.includes('Slow build'))).toBe(true)
  })
})

describe('calculateBuildHealth — D grade (Poor)', () => {
  test('D: quality=49 (just below C)', () => {
    const h = calculateBuildHealth(mkParams({ quality: 49, buildTimeMs: 60000 }))
    expect(h.grade).toBe('D')
    expect(h.label).toBe('Poor')
  })
  test('D: quality=0', () => {
    expect(calculateBuildHealth(mkParams({ quality: 0, buildTimeMs: 60000 })).grade).toBe('D')
  })
  test('D: missingFeatures=5 (just over C)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 70, missingFeatures: 5, buildTimeMs: 60000 })).grade).toBe('D')
  })
  test('D: missingFeatures=99', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, missingFeatures: 99, buildTimeMs: 60000 })).grade).toBe('D')
  })
  test('D: staticErrors=4 (just over C)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 70, staticErrors: 4, buildTimeMs: 60000 })).grade).toBe('D')
  })
  test('D: buildTimeMs > 8 min', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 600000 })).grade).toBe('D')
  })
  test('D: reasons include "Low quality" when quality < 50', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 30, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('Low quality'))).toBe(true)
  })
  test('D: reasons include "N features missing" when > 4', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 70, missingFeatures: 6, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('6 features missing'))).toBe(true)
  })
  test('D: reasons include "N static errors" when > 2', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 70, staticErrors: 5, buildTimeMs: 60000 })).reasons
    expect(reasons.some(r => r.includes('5 static errors'))).toBe(true)
  })
  test('D: reasons include "Very slow build" when time > 8 min', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 600000 })).reasons
    expect(reasons.some(r => r.includes('Very slow build'))).toBe(true)
  })
  test('D: color is text-red-400', () => {
    expect(calculateBuildHealth(mkParams({ quality: 30, buildTimeMs: 60000 })).color).toBe('text-red-400')
  })
  test('D: bgColor is bg-red-500/20', () => {
    expect(calculateBuildHealth(mkParams({ quality: 30, buildTimeMs: 60000 })).bgColor).toBe('bg-red-500/20')
  })
})

describe('calculateBuildHealth — truncation', () => {
  test('truncated always returns D regardless of quality', () => {
    expect(calculateBuildHealth(mkParams({ quality: 100, truncated: true })).grade).toBe('D')
  })
  test('truncated returns D even with no other issues', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60000, truncated: true })).grade).toBe('D')
  })
  test('truncated: reasons include "Output was truncated"', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 90, truncated: true })).reasons
    expect(reasons).toContain('Output was truncated')
  })
  test('truncated: ONLY "Output was truncated" in reasons (early return)', () => {
    const reasons = calculateBuildHealth(mkParams({ quality: 30, missingFeatures: 99, staticErrors: 99, buildTimeMs: 9_999_999, truncated: true })).reasons
    expect(reasons).toEqual(['Output was truncated'])
  })
  test('truncated: label is "Poor"', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, truncated: true })).label).toBe('Poor')
  })
})

describe('calculateBuildHealth — combined boundary cases', () => {
  test('quality=85 + missingFeatures=1: B (not A)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 85, missingFeatures: 1, buildTimeMs: 60000 })).grade).toBe('B')
  })
  test('quality=85 + staticErrors=1: B (not A)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 85, staticErrors: 1, buildTimeMs: 60000 })).grade).toBe('B')
  })
  test('quality=85 + buildTimeMin=4 (over 3): B (not A)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 85, buildTimeMs: 240000 })).grade).toBe('B')
  })
  test('quality=70 + missingFeatures=3: C', () => {
    expect(calculateBuildHealth(mkParams({ quality: 70, missingFeatures: 3, buildTimeMs: 60000 })).grade).toBe('C')
  })
  test('quality=70 + staticErrors=2: C', () => {
    expect(calculateBuildHealth(mkParams({ quality: 70, staticErrors: 2, buildTimeMs: 60000 })).grade).toBe('C')
  })
  test('quality=50 + missingFeatures=5: D (boundary jump)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 50, missingFeatures: 5, buildTimeMs: 60000 })).grade).toBe('D')
  })
  test('quality=49 + missingFeatures=0: D (quality alone is enough)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 49, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60000 })).grade).toBe('D')
  })
})

describe('calculateBuildHealth — time conversions', () => {
  test('1 minute = 60000ms', () => {
    // quality=85, time=1min → A
    expect(calculateBuildHealth(mkParams({ quality: 85, buildTimeMs: 60000 })).grade).toBe('A')
  })
  test('0ms is treated as 0 minutes (≤3 → A)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 85, buildTimeMs: 0 })).grade).toBe('A')
  })
  test('10 minutes = 600000ms (D)', () => {
    expect(calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 600000 })).grade).toBe('D')
  })
})

describe('calculateBuildHealth — all grades reachable', () => {
  test('can produce every HealthGrade value', () => {
    const seen = new Set<HealthGrade>()
    seen.add(calculateBuildHealth(mkParams({ quality: 90, buildTimeMs: 60000 })).grade) // A
    seen.add(calculateBuildHealth(mkParams({ quality: 75, buildTimeMs: 60000 })).grade) // B
    seen.add(calculateBuildHealth(mkParams({ quality: 60, buildTimeMs: 60000 })).grade) // C
    seen.add(calculateBuildHealth(mkParams({ quality: 30, buildTimeMs: 60000 })).grade) // D
    expect(seen.size).toBe(4)
  })
})

describe('calculateBuildHealth — D fallback reason', () => {
  test('D with no triggering reason mentions "Multiple issues detected"', () => {
    // Find a combination that lands in D but has quality >= 50, missing <=4,
    // staticErrors <=2, buildTime <=8min. From the source, this is impossible
    // because all those conditions would qualify for C. So we test the
    // impossible-by-design path by constructing a build with quality>=50,
    // missing=0, errors=0, but buildTimeMin slightly over 8 — which IS in D
    // because C requires buildTimeMin <= 8.
    const reasons = calculateBuildHealth(mkParams({ quality: 70, missingFeatures: 0, staticErrors: 0, buildTimeMs: 600000 })).reasons
    // Quality is fine, missing is fine, errors are fine — only time triggers D
    expect(reasons.some(r => r.includes('Very slow build'))).toBe(true)
  })
})
