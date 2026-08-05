// Tests for plan-adherence.ts — checkPlanAdherence.
// Covers: features array, key_features fallback, keyFunctions, title,
// missing features / hint generation, edge cases, ratio thresholds.
import { describe, it, expect } from 'bun:test'
import { checkPlanAdherence, type PlanAdherenceResult } from '../src/lib/plan-adherence'

describe('checkPlanAdherence', () => {
  it('returns adherent=true with empty features when plan is null', () => {
    const result = checkPlanAdherence('<html></html>', null)
    expect(result.adherent).toBe(true)
    expect(result.features).toEqual([])
    expect(result.missingFeatures).toEqual([])
    expect(result.hint).toBeNull()
  })

  it('returns adherent=true when plan is undefined', () => {
    const result = checkPlanAdherence('<html></html>', undefined)
    expect(result.adherent).toBe(true)
    expect(result.features).toEqual([])
  })

  it('returns adherent=true when plan is not an object', () => {
    const result = checkPlanAdherence('<html></html>', 'string-plan')
    expect(result.adherent).toBe(true)
    expect(result.features).toEqual([])
  })

  it('returns adherent=true when plan has no features array', () => {
    const result = checkPlanAdherence('<html></html>', { foo: 'bar' })
    expect(result.adherent).toBe(true)
    expect(result.features).toEqual([])
  })

  it('returns adherent=true when features array is empty', () => {
    const result = checkPlanAdherence('<html></html>', { features: [] })
    expect(result.adherent).toBe(true)
    expect(result.features).toEqual([])
  })

  it('marks a feature as found when its keywords appear in the HTML', () => {
    const html = '<html><body><h1>Snake Game</h1><div class="score">0</div></body></html>'
    const plan = { features: ['snake game with score tracking'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(1)
    expect(result.features[0].found).toBe(true)
    expect(result.adherent).toBe(true)
  })

  it('marks a feature as missing when its keywords are not in the HTML', () => {
    const html = '<html><body><h1>Snake Game</h1></body></html>'
    const plan = { features: ['interactive chess board with castling'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(1)
    expect(result.features[0].found).toBe(false)
    expect(result.adherent).toBe(false)
  })

  it('skips non-string entries in features array', () => {
    const html = '<html></html>'
    // mixed types
    const plan = { features: [123, null, { foo: 'bar' }, 'real feature'] }
    const result = checkPlanAdherence(html, plan)
    // Only the string entry is checked.
    expect(result.features.length).toBe(1)
  })

  it('uses key_features as a fallback when features is missing', () => {
    const html = '<html><body><h1>Snake</h1><div>game</div></body></html>'
    const plan = { key_features: ['snake game'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(1)
    expect(result.features[0].found).toBe(true)
  })

  it('prefers features over key_features when both are present', () => {
    const html = '<html><body>snake game</body></html>'
    const plan = { features: ['snake game'], key_features: ['chess board'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(1)
    expect(result.features[0].name).toBe('snake game')
  })

  it('checks keyFunctions array with lower threshold (0.4)', () => {
    const html = '<html><body><script>function renderBoard() { }</script></body></html>'
    const plan = { keyFunctions: ['renderBoard'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(1)
    expect(result.features[0].found).toBe(true)
    expect(result.features[0].name).toBe('Function: renderBoard')
  })

  it('marks a function as missing when keywords are not in HTML', () => {
    const html = '<html><body><script>function nothing() { }</script></body></html>'
    const plan = { keyFunctions: ['someRandomFunctionName'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features[0].found).toBe(false)
    expect(result.adherent).toBe(false)
  })

  it('checks title when provided', () => {
    const html = '<html><head><title>Snake Game</title></head></html>'
    const plan = { title: 'Snake Game' }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(1)
    expect(result.features[0].found).toBe(true)
  })

  it('marks title as missing when not in HTML', () => {
    const html = '<html><body>Some content</body></html>'
    const plan = { title: 'Snake Game' }
    const result = checkPlanAdherence(html, plan)
    expect(result.features[0].found).toBe(false)
  })

  it('does not check title when it is too short (<=2 chars)', () => {
    const html = '<html></html>'
    const plan = { title: 'ab' }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(0)
  })

  it('generates a hint listing missing features', () => {
    const html = '<html><body>snake</body></html>'
    const plan = { features: ['interactive chess board with castling'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.hint).not.toBeNull()
    expect(result.hint!).toContain('interactive chess board with castling')
    expect(result.hint!).toContain('Add these features')
  })

  it('returns hint=null when all features are found', () => {
    const html = '<html><body>snake game</body></html>'
    const plan = { features: ['snake game'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.hint).toBeNull()
  })

  it('returns the correct shape (PlanAdherenceResult)', () => {
    const result: PlanAdherenceResult = checkPlanAdherence('<html></html>', { features: [] })
    expect(result).toHaveProperty('adherent')
    expect(result).toHaveProperty('features')
    expect(result).toHaveProperty('missingFeatures')
    expect(result).toHaveProperty('hint')
  })

  it('handles case-insensitive matching (HTML lowercased before search)', () => {
    const html = '<HTML><BODY>SNAKE GAME</BODY></HTML>'
    const plan = { features: ['snake game'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features[0].found).toBe(true)
  })

  it('filters out common words from feature keyword extraction', () => {
    // Feature with only common words like "the feature button" — should still be
    // considered "found" because ratio=1 when no significant words remain.
    const html = '<html><body>anything here</body></html>'
    const plan = { features: ['the feature button'] }
    const result = checkPlanAdherence(html, plan)
    // words.length will be 0 (all filtered as common), so ratio defaults to 1.
    expect(result.features[0].found).toBe(true)
  })

  it('includes the detail field with found/missing counts', () => {
    const html = '<html><body>snake</body></html>'
    const plan = { features: ['snake game interactive'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features[0].detail).toMatch(/\d+\/\d+ keywords/)
  })

  it('combines features, keyFunctions, and title checks', () => {
    const html = `<html><head><title>Snake Game</title></head>
      <body><script>function renderBoard() { }</script></body></html>`
    const plan = {
      features: ['snake game'],
      keyFunctions: ['renderBoard'],
      title: 'Snake Game',
    }
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(3)
    expect(result.adherent).toBe(true)
  })

  it('handles a feature with a single significant keyword', () => {
    const html = '<html><body>tetris</body></html>'
    const plan = { features: ['tetris'] }
    const result = checkPlanAdherence(html, plan)
    expect(result.features[0].found).toBe(true)
  })
})
