// Tests for html-utils.ts — pure functions separated from llm.ts
// These tests verify that stripCodeFences, looksLikeHtml, and injectCsp
// work correctly when imported from their own module (not from llm.ts).
// This is the regression test for the mock.module pollution bug.
import { describe, it, expect } from 'bun:test'
import { stripCodeFences, looksLikeHtml, injectCsp } from '../src/lib/html-utils'

describe('html-utils module isolation', () => {
  it('stripCodeFences is a real function (not undefined from mock)', () => {
    expect(typeof stripCodeFences).toBe('function')
  })

  it('looksLikeHtml is a real function (not undefined from mock)', () => {
    expect(typeof looksLikeHtml).toBe('function')
  })

  it('injectCsp is a real function (not undefined from mock)', () => {
    expect(typeof injectCsp).toBe('function')
  })
})

describe('stripCodeFences — works correctly from html-utils module', () => {
  it('strips ```html fences', () => {
    expect(stripCodeFences('```html\n<!DOCTYPE html>\n```')).toBe('<!DOCTYPE html>')
  })

  it('handles 4-backtick fences', () => {
    expect(stripCodeFences('````html\n<!DOCTYPE html>\n````')).toBe('<!DOCTYPE html>')
  })

  it('handles javascript language identifier', () => {
    expect(stripCodeFences('```javascript\nconsole.log("hi")\n```')).toBe('console.log("hi")')
  })

  it('returns text as-is when no fences', () => {
    expect(stripCodeFences('plain text')).toBe('plain text')
  })
})

describe('looksLikeHtml — works correctly from html-utils module', () => {
  it('accepts complete HTML with doctype', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html></html>')).toBe(true)
  })

  it('accepts HTML with <html> tag', () => {
    expect(looksLikeHtml('<html><body></body></html>')).toBe(true)
  })

  it('rejects HTML fragments', () => {
    expect(looksLikeHtml('<div>hello</div>')).toBe(false)
  })

  it('rejects plain text', () => {
    expect(looksLikeHtml('just text')).toBe(false)
  })
})

describe('injectCsp — works correctly from html-utils module', () => {
  it('injects CSP into <head>', () => {
    const html = '<!DOCTYPE html><html><head></head></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toContain('<head>')
  })

  it('does not override existing CSP', () => {
    const html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head></html>'
    const result = injectCsp(html)
    expect(result).toContain('default-src *')
    expect(result).not.toContain('connect-src')
  })

  it('preserves html tag attributes', () => {
    const html = '<!DOCTYPE html><html lang="en" dir="ltr"><head></head></html>'
    const result = injectCsp(html)
    expect(result).toContain('lang="en"')
    expect(result).toContain('dir="ltr"')
  })
})
