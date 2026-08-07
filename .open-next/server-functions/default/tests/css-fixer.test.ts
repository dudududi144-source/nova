// Tests for css-fixer.ts — fixCss.
// Covers: modal CSS injection, search handler injection, addTaskBtn position fix,
// no-op cases, edge inputs, multiple feature combinations.
import { describe, it, expect } from 'bun:test'
import { fixCss } from '../src/lib/css-fixer'

describe('fixCss', () => {
  it('returns empty string unchanged', () => {
    expect(fixCss('')).toBe('')
  })

  it('returns HTML unchanged when no modal or search is present', () => {
    const html = `<html><head></head><body><h1>Hello</h1></body></html>`
    expect(fixCss(html)).toBe(html)
  })

  it('injects modal CSS when class="modal" exists and <head> is present', () => {
    const html = `<html><head></head><body><div class="modal">x</div></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected modal fixes')
    expect(fixed).toContain('position: fixed')
    expect(fixed).toContain('z-index: 1000')
  })

  it('injects modal CSS when id="addTaskModal" exists', () => {
    const html = `<html><head></head><body><div id="addTaskModal">x</div></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected modal fixes')
  })

  it('injects modal CSS when data-modal attribute exists', () => {
    const html = `<html><head></head><body><div data-modal>x</div></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected modal fixes')
  })

  it('injects modal CSS when id="editModal" exists', () => {
    const html = `<html><head></head><body><div id="editModal">x</div></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected modal fixes')
  })

  it('does NOT inject modal CSS when no modal-like marker is present', () => {
    const html = `<html><head></head><body><div id="content">x</div></body></html>`
    const fixed = fixCss(html)
    expect(fixed).not.toContain('Auto-injected modal fixes')
  })

  it('injects modal CSS before </head>', () => {
    const html = `<html><head></head><body><div class="modal">x</div></body></html>`
    const fixed = fixCss(html)
    const cssIdx = fixed.indexOf('Auto-injected modal fixes')
    const headCloseIdx = fixed.indexOf('</head>')
    expect(cssIdx).toBeGreaterThan(-1)
    expect(cssIdx).toBeLessThan(headCloseIdx)
  })

  it('does not crash when modal exists but no </head> tag', () => {
    const html = `<html><body><div class="modal">x</div></body></html>`
    const fixed = fixCss(html)
    expect(typeof fixed).toBe('string')
    expect(fixed).not.toContain('Auto-injected modal fixes')
  })

  it('injects search handler when type="search" exists', () => {
    const html = `<html><body><input type="search"></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected search handler')
  })

  it('injects search handler when placeholder contains "search"', () => {
    const html = `<html><body><input type="text" placeholder="Search items"></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected search handler')
  })

  it('injects search handler when placeholder contains "Search" (case-sensitive match too)', () => {
    const html = `<html><body><input type="text" placeholder="Search"></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected search handler')
  })

  it('does NOT inject search handler when no search input is present', () => {
    const html = `<html><body><input type="text" placeholder="Type here"></body></html>`
    const fixed = fixCss(html)
    expect(fixed).not.toContain('Auto-injected search handler')
  })

  it('injects search handler before </body>', () => {
    const html = `<html><body><input type="search"></body></html>`
    const fixed = fixCss(html)
    const handlerIdx = fixed.indexOf('Auto-injected search handler')
    const bodyCloseIdx = fixed.indexOf('</body>')
    expect(handlerIdx).toBeGreaterThan(-1)
    expect(handlerIdx).toBeLessThan(bodyCloseIdx)
  })

  it('fixes addTaskBtn position:fixed → relative', () => {
    const html = `<html><body><button id="addTaskBtn" style="position: fixed; bottom: 20px;">+</button></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('position: relative')
    expect(fixed).not.toContain('position: fixed')
  })

  it('does NOT touch addTaskBtn that does not have position:fixed', () => {
    const html = `<html><body><button id="addTaskBtn" style="position: absolute;">+</button></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('position: absolute')
    expect(fixed).not.toContain('position: relative')
  })

  it('does NOT touch buttons without id="addTaskBtn" even with position:fixed', () => {
    const html = `<html><body><button id="otherBtn" style="position: fixed;">+</button></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('position: fixed')
  })

  it('handles multiple fixes in the same document', () => {
    const html = `<html><head></head><body>
      <div class="modal">x</div>
      <input type="search">
      <button id="addTaskBtn" style="position: fixed;">+</button>
    </body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('Auto-injected modal fixes')
    expect(fixed).toContain('Auto-injected search handler')
    expect(fixed).toContain('position: relative')
  })

  it('preserves existing <style> content in <head>', () => {
    const html = `<html><head><style>body { color: red; }</style></head><body><div class="modal">x</div></body></html>`
    const fixed = fixCss(html)
    expect(fixed).toContain('body { color: red; }')
  })

  it('does not crash when <html> tag is missing entirely', () => {
    const html = `<div class="modal">x</div>`
    const fixed = fixCss(html)
    expect(typeof fixed).toBe('string')
    // Modal CSS only injected when </head> is present.
    expect(fixed).not.toContain('Auto-injected modal fixes')
  })

  it('is idempotent for search handler — running twice still produces valid HTML', () => {
    const html = `<html><body><input type="search"></body></html>`
    const once = fixCss(html)
    const twice = fixCss(once)
    expect(twice).toContain('Auto-injected search handler')
    expect(twice.length).toBeGreaterThanOrEqual(once.length)
  })
})
