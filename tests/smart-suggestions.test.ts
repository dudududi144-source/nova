// Tests for smart-suggestions.ts — generateSuggestions.
// Covers: design, functionality, accessibility, app-specific suggestions,
// priority sorting, top-5 cap, edge cases.
import { describe, it, expect } from 'bun:test'
import { generateSuggestions, type Suggestion } from '../src/lib/smart-suggestions'

describe('generateSuggestions', () => {
  it('returns an array', () => {
    const result = generateSuggestions('<html></html>', 'test')
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns at most 5 suggestions', () => {
    const html = '<html><body><button>Click</button></body></html>' // minimal html
    const result = generateSuggestions(html, 'test app')
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('suggests adding box-shadows when none are present', () => {
    const html = '<html><body><div>hello</div></body></html>'
    const result = generateSuggestions(html, 'test')
    const shadowSuggestion = result.find(s => s.id === 'add-shadows')
    expect(shadowSuggestion).toBeDefined()
    expect(shadowSuggestion!.type).toBe('design')
  })

  it('does NOT suggest box-shadows when box-shadow is already in the HTML', () => {
    const html = '<html><body><div style="box-shadow: 0 2px 4px black;">hello</div></body></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-shadows')).toBeUndefined()
  })

  it('suggests adding transitions when none are present', () => {
    const html = '<html><body><div>hello</div></body></html>'
    const result = generateSuggestions(html, 'test')
    const transitionsSuggestion = result.find(s => s.id === 'add-transitions')
    expect(transitionsSuggestion).toBeDefined()
    expect(transitionsSuggestion!.priority).toBe('high')
  })

  it('does NOT suggest transitions when "transition" is already present', () => {
    const html = '<html><head><style>button { transition: all 0.2s; }</style></head></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-transitions')).toBeUndefined()
  })

  it('suggests adding responsive design when no media queries are present', () => {
    const html = '<html><body><div>hello</div></body></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-responsive')).toBeDefined()
  })

  it('does NOT suggest responsive design when @media is present', () => {
    const html = '<html><head><style>@media (max-width: 768px) { body { font-size: 12px; } }</style></head></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-responsive')).toBeUndefined()
  })

  it('flags buttons without handlers when buttonCount > totalHandlers', () => {
    const html = '<html><body><button>Click</button><button>Other</button></body></html>'
    const result = generateSuggestions(html, 'test')
    const deadButtons = result.find(s => s.id === 'fix-dead-buttons')
    expect(deadButtons).toBeDefined()
    expect(deadButtons!.title).toMatch(/2 button/)
  })

  it('does NOT flag dead buttons when each button has a handler', () => {
    const html = '<html><body><button onclick="x()">Click</button></body></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'fix-dead-buttons')).toBeUndefined()
  })

  it('suggests adding aria-labels when none are present', () => {
    const html = '<html><body><button>Click</button></body></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-aria')).toBeDefined()
  })

  it('does NOT suggest aria-labels when aria-label is already present', () => {
    const html = '<html><body><button aria-label="Add">+</button></body></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-aria')).toBeUndefined()
  })

  it('suggests semantic HTML when no semantic tags are present', () => {
    const html = '<html><body><div><div>content</div></div></body></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-semantic')).toBeDefined()
  })

  it('does NOT suggest semantic HTML when <main> is present', () => {
    const html = '<html><body><main>content</main></body></html>'
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'add-semantic')).toBeUndefined()
  })

  it('suggests drag-and-drop for todo apps when not present', () => {
    const html = '<html><body><div>todo</div></body></html>'
    const result = generateSuggestions(html, 'todo app')
    expect(result.find(s => s.id === 'add-drag')).toBeDefined()
  })

  it('does NOT suggest drag-and-drop when "drag" is already in the HTML', () => {
    const html = '<html><body><div draggable="true">todo</div></body></html>'
    const result = generateSuggestions(html, 'todo app')
    expect(result.find(s => s.id === 'add-drag')).toBeUndefined()
  })

  it('suggests categories for todo apps when not present', () => {
    // Pre-add shadows, transitions, responsive, aria, semantic, drag to make room
    // for the low-priority "categories" suggestion within the top-5 cap.
    // Note: must NOT contain "label", "tag", or "categor" anywhere — those
    // suppress the add-categories suggestion.
    const html = `<html><body>
      <style>div { box-shadow: 0 2px 4px black; transition: all 0.2s; }
      @media (max-width: 768px) { div { font-size: 12px; } }</style>
      <main><button role="button" draggable="true">+</button>todo</main>
    </body></html>`
    const result = generateSuggestions(html, 'todo app')
    expect(result.find(s => s.id === 'add-categories')).toBeDefined()
  })

  it('suggests high score tracking for games when not present', () => {
    const html = '<html><body><div>game</div></body></html>'
    const result = generateSuggestions(html, 'snake game')
    expect(result.find(s => s.id === 'add-highscore')).toBeDefined()
  })

  it('suggests sound effects for games when not present', () => {
    // Pre-add the higher-priority suggestions to leave room for "add-sound".
    const html = `<html><body>
      <style>div { box-shadow: 0 2px 4px black; transition: all 0.2s; }
      @media (max-width: 768px) { div { font-size: 12px; } }</style>
      <main><button aria-label="Start">Start</button>game</main>
    </body></html>`
    const result = generateSuggestions(html, 'tetris game')
    expect(result.find(s => s.id === 'add-sound')).toBeDefined()
  })

  it('suggests dark mode toggle for dashboards when not present', () => {
    const html = '<html><body><div>dashboard</div></body></html>'
    const result = generateSuggestions(html, 'analytics dashboard')
    expect(result.find(s => s.id === 'add-dark-mode')).toBeDefined()
  })

  it('sorts suggestions by priority (high → medium → low)', () => {
    const html = '<html><body><button>Click</button></body></html>'
    const result = generateSuggestions(html, 'test')
    const priorities = result.map(s => s.priority)
    const order = { high: 0, medium: 1, low: 2 }
    for (let i = 1; i < priorities.length; i++) {
      expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]])
    }
  })

  it('includes required fields on every Suggestion', () => {
    const html = '<html><body><div>hello</div></body></html>'
    const result = generateSuggestions(html, 'test')
    for (const s of result) {
      const sug: Suggestion = s
      expect(typeof sug.id).toBe('string')
      expect(['design', 'functionality', 'accessibility', 'performance']).toContain(sug.type)
      expect(['high', 'medium', 'low']).toContain(sug.priority)
      expect(typeof sug.title).toBe('string')
      expect(typeof sug.description).toBe('string')
      expect(typeof sug.action).toBe('string')
      expect(typeof sug.icon).toBe('string')
      expect(sug.icon.length).toBeGreaterThan(0)
    }
  })

  it('handles empty HTML gracefully', () => {
    const result = generateSuggestions('', 'test')
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0) // design suggestions apply
  })

  it('handles empty mission gracefully', () => {
    const html = '<html><body><div>hello</div></body></html>'
    const result = generateSuggestions(html, '')
    expect(Array.isArray(result)).toBe(true)
    // No app-specific suggestions should be generated.
    expect(result.find(s => s.id === 'add-drag')).toBeUndefined()
    expect(result.find(s => s.id === 'add-highscore')).toBeUndefined()
    expect(result.find(s => s.id === 'add-dark-mode')).toBeUndefined()
  })

  it('treats addEventListener as a valid button handler', () => {
    const html = `<html><body>
      <button id="b1">Click</button>
      <script>document.getElementById('b1').addEventListener('click', () => {})</script>
    </body></html>`
    const result = generateSuggestions(html, 'test')
    expect(result.find(s => s.id === 'fix-dead-buttons')).toBeUndefined()
  })
})
