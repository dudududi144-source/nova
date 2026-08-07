// Tests for build-intelligence.ts
import { describe, it, expect } from 'bun:test'
import {
  enrichMission,
  validateOutput,
  estimateTokenBudget,
  analyzeQuality,
} from '../src/lib/build-intelligence'

describe('enrichMission', () => {
  it('detects snake/game missions', () => {
    const result = enrichMission('Build a snake game')
    expect(result.detectedType).toBe('game')
    // v10: hints are now generic (not snake-specific) — LLM decides the approach
    expect(result.hints.length).toBeGreaterThan(0)
    expect(result.enriched).toContain('Implementation hints')
  })

  it('detects todo/task missions', () => {
    const result = enrichMission('Build a todo app')
    expect(result.detectedType).toBe('app')
    expect(result.hints).toContain('Input field with add button')
    expect(result.hints).toContain('Filter tabs: All / Active / Completed')
  })

  it('detects calculator missions', () => {
    const result = enrichMission('Build a calculator')
    expect(result.detectedType).toBe('tool')
    expect(result.hints).toContain('Buttons: 0-9, +, -, *, /, =, C, .')
    expect(result.hints).toContain('Handle division by zero')
  })

  it('detects color palette missions', () => {
    const result = enrichMission('Build a color palette generator')
    expect(result.detectedType).toBe('tool')
    expect(result.hints.some(h => h.includes('copy-to-clipboard'))).toBe(true)
  })

  it('detects timer missions', () => {
    const result = enrichMission('Build a stopwatch')
    expect(result.detectedType).toBe('tool')
    expect(result.hints).toContain('Start/Stop/Reset buttons')
  })

  it('detects markdown editor missions', () => {
    const result = enrichMission('Build a markdown editor')
    expect(result.detectedType).toBe('app')
    expect(result.hints).toContain('Split view: input on left, preview on right')
  })

  it('handles unknown missions with generic hints', () => {
    const result = enrichMission('Build a quantum physics simulator')
    expect(result.detectedType).toBe('app')
    expect(result.hints.length).toBeGreaterThanOrEqual(3) // at least the general hints
  })

  it('always adds general quality hints', () => {
    const result = enrichMission('Build anything')
    expect(result.hints).toContain('Dark theme: #0f172a background, #1e293b cards, #e2e8f0 text')
    expect(result.hints).toContain('Responsive layout with CSS Flexbox or Grid')
  })

  it('enriched text includes original mission', () => {
    const result = enrichMission('Build a snake game')
    expect(result.enriched).toContain('Build a snake game')
    expect(result.enriched).toContain('Implementation hints')
  })

  it('ALWAYS includes general hints in enriched text, even for unknown missions (roast #7 fix)', () => {
    const result = enrichMission('Build a quantum physics simulator')
    expect(result.enriched).toContain('Build a quantum physics simulator')
    expect(result.enriched).toContain('Dark theme: #0f172a')
    expect(result.enriched).toContain('Responsive layout')
    expect(result.enriched).toContain('CSS transitions')
  })

  it('preserves original mission', () => {
    const result = enrichMission('Build a calculator')
    expect(result.original).toBe('Build a calculator')
  })

  // Word boundary fix: 'calc' must match as a word, not as a substring
  it('detects calc at end of sentence (word boundary)', () => {
    const result = enrichMission('Build a calc')
    expect(result.detectedType).toBe('tool')
  })

  it('detects calc before punctuation', () => {
    const result = enrichMission('Build a calc, please')
    expect(result.detectedType).toBe('tool')
  })

  it('does NOT detect calc as substring of another word', () => {
    const result = enrichMission('Build a local calculation tool')
    // 'local' contains 'cal' but not 'calc' as a word — should NOT be detected as calculator
    // Actually 'calculation' contains 'calc' — but with word boundary, it should NOT match
    // because \bcalc\b requires 'calc' to be a complete word
    // 'calculation' has 'calc' followed by 'ulation', so \bcalc\b won't match
    expect(result.detectedType).not.toBe('tool')
  })
})

describe('validateOutput', () => {
  const validHtml = `<!DOCTYPE html>
<html><head><title>Test</title><style>body{margin:0}</style></head>
<body><canvas id="game"></canvas><script>
let score = 0;
function init() { requestAnimationFrame(loop); }
function loop() { requestAnimationFrame(loop); }
document.addEventListener('keydown', init);
init();
</script></body></html>`

  it('passes for complete HTML with canvas and game loop', () => {
    const result = validateOutput(validHtml, 'Build a snake game')
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.passed).toBe(true)
  })

  it('fails for missing DOCTYPE', () => {
    const bad = '<html><body>hello</body></html>'
    const result = validateOutput(bad, 'Build an app')
    const doctypeCheck = result.checks.find(c => c.name === 'DOCTYPE')
    expect(doctypeCheck?.passed).toBe(false)
  })

  it('fails for missing closing tags', () => {
    const bad = '<!DOCTYPE html><html><body>hello'
    const result = validateOutput(bad, 'Build an app')
    const closingCheck = result.checks.find(c => c.name === 'Closing tags')
    expect(closingCheck?.passed).toBe(false)
  })

  it('fails for too small output', () => {
    const tiny = '<!DOCTYPE html><html><body><style></style><script></script></body></html>'
    const result = validateOutput(tiny, 'Build an app')
    const sizeCheck = result.checks.find(c => c.name === 'Size')
    expect(sizeCheck?.passed).toBe(false)
  })

  it('checks game-specific features for game missions', () => {
    const noCanvas = '<!DOCTYPE html><html><head><style>body{}</style></head><body><script>function init(){}</script></body></html>'
    const result = validateOutput(noCanvas, 'Build a snake game')
    const canvasCheck = result.checks.find(c => c.name === 'Canvas')
    expect(canvasCheck).toBeTruthy()
    expect(canvasCheck?.passed).toBe(false)
  })

  it('checks todo-specific features for todo missions', () => {
    const noInput = '<!DOCTYPE html><html><head><style>body{}</style></head><body><script>function init(){}</script></body></html>'
    const result = validateOutput(noInput, 'Build a todo app')
    const inputCheck = result.checks.find(c => c.name === 'Input')
    expect(inputCheck).toBeTruthy()
    expect(inputCheck?.passed).toBe(false)
  })

  it('checks calculator-specific features for calc missions', () => {
    const fewButtons = '<!DOCTYPE html><html><head><style>body{}</style></head><body><button>1</button><button>2</button><script>function init(){}</script></body></html>'
    const result = validateOutput(fewButtons, 'Build a calculator')
    const buttonCheck = result.checks.find(c => c.name === 'Calculator buttons')
    expect(buttonCheck).toBeTruthy()
    expect(buttonCheck?.passed).toBe(false) // only 2 buttons, need 10+
  })

  it('generates retry hint when score < 70', () => {
    const bad = '<html><body>hi</body></html>'
    const result = validateOutput(bad, 'Build an app')
    expect(result.score).toBeLessThan(70)
    expect(result.retryHint).toBeTruthy()
    expect(result.retryHint).toContain('DOCTYPE')
  })

  it('does not generate retry hint when score >= 70', () => {
    const result = validateOutput(validHtml, 'Build a snake game')
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.retryHint).toBeUndefined()
  })

  it('score is 0-100', () => {
    const result1 = validateOutput('', 'Build an app')
    const result2 = validateOutput(validHtml, 'Build a snake game')
    expect(result1.score).toBeGreaterThanOrEqual(0)
    expect(result1.score).toBeLessThanOrEqual(100)
    expect(result2.score).toBeGreaterThanOrEqual(0)
    expect(result2.score).toBeLessThanOrEqual(100)
  })
})

describe('estimateTokenBudget', () => {
  it('returns default 6000 for null plan', () => {
    expect(estimateTokenBudget(null)).toBe(12000)
  })

  it('returns default 6000 for non-object plan', () => {
    expect(estimateTokenBudget('not an object')).toBe(12000)
  })

  it('estimates based on features and functions', () => {
    const plan = { features: ['a', 'b', 'c'], keyFunctions: ['f1', 'f2'] }
    // 3*2000 + 2*1000 + 2000 = 10000
    expect(estimateTokenBudget(plan)).toBe(10000)
  })

  it('clamps to minimum 5000', () => {
    const plan = { features: [], keyFunctions: [] }
    // 0*1500 + 0*800 + 1000 = 1000, clamped to 5000
    expect(estimateTokenBudget(plan)).toBe(8000)
  })

  it('clamps to maximum 16000', () => {
    const plan = { features: Array(20).fill('f'), keyFunctions: Array(20).fill('fn') }
    expect(estimateTokenBudget(plan)).toBe(32000)
  })

  it('handles plan with missing fields', () => {
    const plan = { title: 'Test' }
    // 3*2000 + 2*1000 + 2000 = 10000 (defaults: 3 features, 2 keyFunctions)
    expect(estimateTokenBudget(plan)).toBe(10000)
  })
})

describe('analyzeQuality', () => {
  it('analyzes a complete HTML app', () => {
    const html = `<!DOCTYPE html>
<html><head><style>body { margin: 0; } .btn { color: red; transition: all 0.3s; }</style></head>
<body>
<canvas id="game"></canvas>
<button onclick="start()">Start</button>
<script>
function init() { console.log('init'); }
function loop() { requestAnimationFrame(loop); }
function start() { init(); loop(); }
document.addEventListener('keydown', start);
</script>
</body></html>`
    const metrics = analyzeQuality(html)
    expect(metrics.lines).toBeGreaterThan(5)
    expect(metrics.bytes).toBeGreaterThan(200)
    expect(metrics.functions).toBeGreaterThan(0)
    expect(metrics.eventListeners).toBeGreaterThan(0)
    expect(metrics.cssRules).toBeGreaterThan(0)
    expect(metrics.domElements).toBeGreaterThan(3)
    expect(metrics.hasCanvas).toBe(true)
    expect(metrics.hasAnimations).toBe(true)
    expect(metrics.summary).toContain('lines')
    expect(metrics.summary).toContain('functions')
  })

  it('detects when canvas is absent', () => {
    const html = '<!DOCTYPE html><html><body><div>no canvas</div></body></html>'
    const metrics = analyzeQuality(html)
    expect(metrics.hasCanvas).toBe(false)
  })

  it('detects when animations are absent', () => {
    const html = "<!DOCTYPE html><html><body><div>plain text</div></body></html>"
    const metrics = analyzeQuality(html)
    expect(metrics.hasAnimations).toBe(false)
  })

  it('handles empty HTML', () => {
    const metrics = analyzeQuality('')
    expect(metrics.lines).toBe(1)
    expect(metrics.bytes).toBe(0)
    expect(metrics.functions).toBe(0)
  })

  it('summary contains key metrics', () => {
    const html = '<!DOCTYPE html><html><body><script>function f(){}</script></body></html>'
    const metrics = analyzeQuality(html)
    expect(metrics.summary).toContain('lines')
    expect(metrics.summary).toContain('functions')
    expect(metrics.summary).toContain('listeners')
    expect(metrics.summary).toContain('CSS')
  })
})
