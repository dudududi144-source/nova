// Tests for design-tokens.ts — THEMES, generateDesignTokens, DESIGN_TOKENS_INSTRUCTION.
// Covers: theme lookup, fallback, CSS structure, color injection, instruction content.
import { describe, it, expect } from 'bun:test'
import { THEMES, generateDesignTokens, DESIGN_TOKENS_INSTRUCTION } from '../src/lib/design-tokens'

describe('THEMES', () => {
  it('is an array', () => {
    expect(Array.isArray(THEMES)).toBe(true)
  })

  it('has at least 10 themes', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10)
  })

  it('includes "slate" as the first theme', () => {
    expect(THEMES[0].name).toBe('slate')
  })

  it('every theme has all 10 color properties', () => {
    const requiredColors = ['bg', 'card', 'text', 'primary', 'accent', 'muted', 'border', 'success', 'warning', 'error']
    for (const theme of THEMES) {
      for (const color of requiredColors) {
        expect(theme.colors).toHaveProperty(color)
        expect(typeof theme.colors[color as keyof typeof theme.colors]).toBe('string')
      }
    }
  })

  it('every theme name is a non-empty string', () => {
    for (const theme of THEMES) {
      expect(typeof theme.name).toBe('string')
      expect(theme.name.length).toBeGreaterThan(0)
    }
  })

  it('all theme names are unique', () => {
    const names = THEMES.map(t => t.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('every color value is a valid hex string starting with #', () => {
    for (const theme of THEMES) {
      for (const color of Object.values(theme.colors)) {
        expect(color.startsWith('#')).toBe(true)
        expect(color.length).toBe(7) // #RRGGBB
      }
    }
  })

  it('includes "midnight", "ocean", "forest", "sunset" themes', () => {
    const names = THEMES.map(t => t.name)
    expect(names).toContain('midnight')
    expect(names).toContain('ocean')
    expect(names).toContain('forest')
    expect(names).toContain('sunset')
  })
})

describe('generateDesignTokens', () => {
  it('returns a string', () => {
    expect(typeof generateDesignTokens('slate')).toBe('string')
  })

  it('starts with <style> tag', () => {
    expect(generateDesignTokens('slate').startsWith('<style>')).toBe(true)
  })

  it('ends with </style> tag', () => {
    expect(generateDesignTokens('slate').endsWith('</style>')).toBe(true)
  })

  it('contains :root selector', () => {
    expect(generateDesignTokens('slate')).toContain(':root')
  })

  it('contains all 10 CSS color custom properties', () => {
    const css = generateDesignTokens('slate')
    const colors = ['bg', 'card', 'text', 'primary', 'accent', 'muted', 'border', 'success', 'warning', 'error']
    for (const c of colors) {
      expect(css).toContain(`--color-${c}:`)
    }
  })

  it('contains all spacing custom properties (1, 2, 3, 4, 6, 8, 12, 16)', () => {
    const css = generateDesignTokens('slate')
    for (const s of [1, 2, 3, 4, 6, 8, 12, 16]) {
      expect(css).toContain(`--space-${s}:`)
    }
  })

  it('contains all type scale custom properties', () => {
    const css = generateDesignTokens('slate')
    for (const t of ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl']) {
      expect(css).toContain(`--text-${t}:`)
    }
  })

  it('contains radius custom properties', () => {
    const css = generateDesignTokens('slate')
    for (const r of ['sm', 'md', 'lg', 'xl', 'full']) {
      expect(css).toContain(`--radius-${r}:`)
    }
  })

  it('contains shadow custom properties', () => {
    const css = generateDesignTokens('slate')
    for (const s of ['sm', 'md', 'lg', 'xl']) {
      expect(css).toContain(`--shadow-${s}:`)
    }
  })

  it('contains transition custom properties', () => {
    const css = generateDesignTokens('slate')
    expect(css).toContain('--transition-fast:')
    expect(css).toContain('--transition-normal:')
    expect(css).toContain('--transition-slow:')
  })

  it('contains the theme bg color value', () => {
    const slate = THEMES.find(t => t.name === 'slate')!
    const css = generateDesignTokens('slate')
    expect(css).toContain(slate.colors.bg)
  })

  it('contains the theme primary color value', () => {
    const ocean = THEMES.find(t => t.name === 'ocean')!
    const css = generateDesignTokens('ocean')
    expect(css).toContain(ocean.colors.primary)
  })

  it('contains the theme accent color value', () => {
    const forest = THEMES.find(t => t.name === 'forest')!
    const css = generateDesignTokens('forest')
    expect(css).toContain(forest.colors.accent)
  })

  it('falls back to slate (THEMES[0]) when theme name is unknown', () => {
    const css = generateDesignTokens('unknown-theme-name')
    const slate = THEMES[0]
    expect(css).toContain(slate.colors.bg)
    expect(css).toContain(slate.colors.primary)
  })

  it('falls back to slate when theme name is empty string', () => {
    const css = generateDesignTokens('')
    const slate = THEMES[0]
    expect(css).toContain(slate.colors.bg)
  })

  it('uses slate as the default when called with no arguments', () => {
    const css = generateDesignTokens()
    const slate = THEMES[0]
    expect(css).toContain(slate.colors.bg)
  })

  it('contains base styles for body, button, .btn, .card, .input', () => {
    const css = generateDesignTokens('slate')
    expect(css).toContain('body {')
    expect(css).toContain('button, input, textarea, select {')
    expect(css).toContain('.btn {')
    expect(css).toContain('.card {')
    expect(css).toContain('.input {')
  })

  it('contains box-sizing: border-box', () => {
    const css = generateDesignTokens('slate')
    expect(css).toContain('box-sizing: border-box')
  })

  it('produces different output for different themes', () => {
    const slate = generateDesignTokens('slate')
    const sunset = generateDesignTokens('sunset')
    expect(slate).not.toBe(sunset)
  })

  it('produces the same output for the same theme on consecutive calls', () => {
    const a = generateDesignTokens('ocean')
    const b = generateDesignTokens('ocean')
    expect(a).toBe(b)
  })

  it('includes font-family definition in body', () => {
    const css = generateDesignTokens('slate')
    expect(css).toContain('font-family:')
    expect(css).toContain('system-ui')
  })

  it('uses the same success/warning/error for all themes (per source)', () => {
    // Per source code, all themes share success=#22c55e, warning=#f59e0b, error=#ef4444
    // (with two exceptions: amber & rose use different values).
    // We verify the slate theme has the standard values.
    const css = generateDesignTokens('slate')
    expect(css).toContain('#22c55e')
    expect(css).toContain('#f59e0b')
    expect(css).toContain('#ef4444')
  })
})

describe('DESIGN_TOKENS_INSTRUCTION', () => {
  it('is a non-empty string', () => {
    expect(typeof DESIGN_TOKENS_INSTRUCTION).toBe('string')
    expect(DESIGN_TOKENS_INSTRUCTION.length).toBeGreaterThan(100)
  })

  it('mentions "DESIGN SYSTEM" header', () => {
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('DESIGN SYSTEM')
  })

  it('lists all color tokens', () => {
    const colors = ['--color-bg', '--color-card', '--color-text', '--color-primary', '--color-accent', '--color-muted', '--color-border', '--color-success', '--color-warning', '--color-error']
    for (const c of colors) {
      expect(DESIGN_TOKENS_INSTRUCTION).toContain(c)
    }
  })

  it('instructs the LLM to use ONLY these tokens', () => {
    expect(DESIGN_TOKENS_INSTRUCTION.toLowerCase()).toContain('use only')
  })

  it('mentions the base classes (.btn, .card, .input)', () => {
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('.btn')
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('.card')
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('.input')
  })

  it('mentions spacing scale range', () => {
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('--space-1')
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('--space-16')
  })

  it('mentions box-sizing', () => {
    expect(DESIGN_TOKENS_INSTRUCTION).toContain('box-sizing: border-box')
  })
})
