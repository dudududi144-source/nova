// Tests for the new v3 modules: design-tokens, runtime-errors, plan-adherence
import { describe, it, expect } from 'bun:test'
import { generateDesignTokens, DESIGN_TOKENS_INSTRUCTION, THEMES } from '../src/lib/design-tokens'
import { injectRuntimeErrorCapture, RUNTIME_ERROR_SCRIPT } from '../src/lib/runtime-errors'
import { checkPlanAdherence } from '../src/lib/plan-adherence'

describe('design-tokens', () => {
  it('generates tokens for default theme (slate)', () => {
    const tokens = generateDesignTokens('slate')
    expect(tokens).toContain('--color-bg: #0f172a')
    expect(tokens).toContain('--color-primary: #3b82f6')
    expect(tokens).toContain('--space-1: 4px')
    expect(tokens).toContain('--text-base: 16px')
    expect(tokens).toContain('--radius-md: 8px')
    expect(tokens).toContain('--shadow-md')
    expect(tokens).toContain('--transition-fast: 150ms ease')
  })

  it('generates tokens for all 5 themes', () => {
    for (const theme of THEMES) {
      const tokens = generateDesignTokens(theme.name)
      expect(tokens).toContain(`--color-bg: ${theme.colors.bg}`)
      expect(tokens).toContain(`--color-primary: ${theme.colors.primary}`)
    }
  })

  it('includes base classes (.btn, .card, .input)', () => {
    const tokens = generateDesignTokens('slate')
    expect(tokens).toContain('.btn')
    expect(tokens).toContain('.card')
    expect(tokens).toContain('.input')
    expect(tokens).toContain('box-sizing: border-box')
  })

  it('falls back to slate for unknown theme', () => {
    const tokens = generateDesignTokens('nonexistent')
    expect(tokens).toContain('#0f172a') // slate bg
  })

  it('DESIGN_TOKENS_INSTRUCTION tells LLM to use tokens', () => {
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('var(--color-primary)')
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('var(--space-')
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('never hardcode')
  })
})

describe('runtime-errors', () => {
  it('injects error capture script into HTML with <head>', () => {
    const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>'
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('__novaGetErrors')
    expect(result).toContain('postMessage')
    expect(result).toContain('addEventListener')
    // Should be injected after <head>
    expect(result.indexOf('<head>')).toBeLessThan(result.indexOf('__novaGetErrors'))
  })

  it('does not inject twice', () => {
    const html = '<!DOCTYPE html><html><head></head><body></body></html>'
    const once = injectRuntimeErrorCapture(html)
    const twice = injectRuntimeErrorCapture(once)
    expect(twice).toBe(once)
  })

  it('injects even without <head> tag', () => {
    const html = '<!DOCTYPE html><html><body></body></html>'
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('__novaGetErrors')
  })

  it('RUNTIME_ERROR_SCRIPT captures errors, promises, and console.error', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain("window.addEventListener('error'")
    expect(RUNTIME_ERROR_SCRIPT).toContain("window.addEventListener('unhandledrejection'")
    expect(RUNTIME_ERROR_SCRIPT).toContain('console.error')
    expect(RUNTIME_ERROR_SCRIPT).toContain('MAX_ERRORS')
  })
})

describe('plan-adherence', () => {
  it('returns adherent=true for null plan', () => {
    const result = checkPlanAdherence('<!DOCTYPE html><html></html>', null)
    expect(result.adherent).toBe(true)
    expect(result.features).toEqual([])
    expect(result.hint).toBeNull()
  })

  it('returns adherent=true for undefined plan', () => {
    const result = checkPlanAdherence('<!DOCTYPE html><html></html>', undefined)
    expect(result.adherent).toBe(true)
  })

  it('detects when features are present in HTML', () => {
    const plan = { features: ['score display', 'game over screen', 'restart button'] }
    const html = '<!DOCTYPE html><html><body><div>Score: 0</div><div>Game Over</div><button>Restart</button></body></html>'
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(3)
    expect(result.adherent).toBe(true)
  })

  it('detects when features are missing from HTML', () => {
    const plan = { features: ['score display', 'game over screen', 'restart button'] }
    const html = '<!DOCTYPE html><html><body><div>Hello world</div></body></html>'
    const result = checkPlanAdherence(html, plan)
    expect(result.adherent).toBe(false)
    expect(result.missingFeatures.length).toBeGreaterThan(0)
    expect(result.hint).toContain('missing these features')
  })

  it('checks keyFunctions', () => {
    const plan = { keyFunctions: ['updateScore', 'handleCollision', 'resetGame'] }
    const html = '<!DOCTYPE html><html><body><script>function updateScore(){} function handleCollision(){} function resetGame(){}</script></body></html>'
    const result = checkPlanAdherence(html, plan)
    expect(result.features.length).toBe(3)
    expect(result.adherent).toBe(true)
  })

  it('checks title', () => {
    const plan = { title: 'Snake Game' }
    const html = '<!DOCTYPE html><html><body><h1>Snake Game</h1></body></html>'
    const result = checkPlanAdherence(html, plan)
    expect(result.features.some(f => f.name === 'Title: Snake Game' && f.found)).toBe(true)
  })

  it('generates retry hint with missing features', () => {
    const plan = { features: ['leaderboard ranking system', 'achievement tracking display'] }
    const html = '<!DOCTYPE html><html><body></body></html>'
    const result = checkPlanAdherence(html, plan)
    expect(result.hint).toBeTruthy()
    expect(result.hint).toContain('leaderboard')
    expect(result.hint).toContain('achievement')
  })
})
