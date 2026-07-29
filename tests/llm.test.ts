// Unit tests for src/lib/llm.ts
// Run with: bun test
//
// These test the pure functions only (validateMission, stripCodeFences, looksLikeHtml).
// llmChat is an I/O function (calls the LLM SDK) and is not unit-tested here —
// it would require mocking the SDK, which adds complexity without much value.
// The integration of llmChat is verified via the /api/build endpoint E2E.

import { describe, it, expect } from 'bun:test'
import { validateMission, stripCodeFences, looksLikeHtml } from '../src/lib/llm'

// ── validateMission ──

describe('validateMission', () => {
  it('rejects empty string', () => {
    expect(validateMission('').ok).toBe(false)
    expect(validateMission('').error).toBe('Mission is empty')
  })

  it('rejects whitespace-only string', () => {
    expect(validateMission('   ').ok).toBe(false)
    expect(validateMission('   ').error).toBe('Mission is empty')
  })

  it('rejects string shorter than 3 chars after trim', () => {
    expect(validateMission('ab').ok).toBe(false)
    expect(validateMission('ab').error).toContain('too short')
    expect(validateMission('  a  ').ok).toBe(false)
  })

  it('accepts exactly 3 chars', () => {
    expect(validateMission('abc').ok).toBe(true)
  })

  it('accepts exactly 500 chars', () => {
    const m = 'a'.repeat(500)
    expect(validateMission(m).ok).toBe(true)
  })

  it('rejects 501 chars', () => {
    const m = 'a'.repeat(501)
    expect(validateMission(m).ok).toBe(false)
    expect(validateMission(m).error).toContain('too long')
  })

  it('rejects control characters', () => {
    expect(validateMission('hello\x00world').ok).toBe(false)
    expect(validateMission('hello\x01world').ok).toBe(false)
    expect(validateMission('hello\x1Fworld').ok).toBe(false)
  })

  it('accepts normal missions', () => {
    expect(validateMission('Build a snake game').ok).toBe(true)
    expect(validateMission('Build a todo app with add, complete, and delete').ok).toBe(true)
  })

  it('trims before validating', () => {
    expect(validateMission('  Build a calculator  ').ok).toBe(true)
  })

  it('accepts unicode', () => {
    expect(validateMission('Build a 日本語 app').ok).toBe(true)
    expect(validateMission('Build a emoji 🎮 game').ok).toBe(true)
  })

  it('accepts newlines and tabs (not control chars in the rejected range)', () => {
    expect(validateMission('Build a snake game\nwith multiple\nlines').ok).toBe(true)
    expect(validateMission('Build a\ttabbed\tapp').ok).toBe(true)
  })

  it('does not mutate input', () => {
    const input = '  Build a snake game  '
    validateMission(input)
    expect(input).toBe('  Build a snake game  ')
  })
})

// ── stripCodeFences ──

describe('stripCodeFences', () => {
  it('strips ```html fences', () => {
    const input = '```html\n<!DOCTYPE html>\n<html></html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>\n<html></html>')
  })

  it('strips ``` fences without language', () => {
    const input = '```\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('strips ```htm fences', () => {
    const input = '```htm\n<html></html>\n```'
    expect(stripCodeFences(input)).toBe('<html></html>')
  })

  it('returns text as-is when no fences (trimmed)', () => {
    expect(stripCodeFences('  <!DOCTYPE html>  ')).toBe('<!DOCTYPE html>')
  })

  it('handles empty string', () => {
    expect(stripCodeFences('')).toBe('')
  })

  it('only strips the first fence block', () => {
    const input = '```html\nfirst\n```\nmore text\n```html\nsecond\n```'
    expect(stripCodeFences(input)).toBe('first')
  })

  it('does not strip unclosed fences', () => {
    // If there's no closing ```, the regex doesn't match, so it returns the trimmed input
    const input = '```html\n<!DOCTYPE html>'
    expect(stripCodeFences(input)).toBe('```html\n<!DOCTYPE html>')
  })
})

// ── looksLikeHtml ──

describe('looksLikeHtml', () => {
  it('accepts complete HTML document with doctype', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html><body></body></html>')).toBe(true)
  })

  it('accepts complete HTML document with <html> tag', () => {
    expect(looksLikeHtml('<html><body></body></html>')).toBe(true)
  })

  it('accepts with leading whitespace', () => {
    expect(looksLikeHtml('  \n<!DOCTYPE html>')).toBe(true)
    expect(looksLikeHtml('\t<html>')).toBe(true)
  })

  it('accepts uppercase DOCTYPE', () => {
    expect(looksLikeHtml('<!DOCTYPE HTML>')).toBe(true)
  })

  it('rejects HTML fragment starting with <div>', () => {
    // This is the key fix — v2 accepted this, v3+ rejects it
    expect(looksLikeHtml('<div>hello</div>')).toBe(false)
  })

  it('rejects HTML fragment with <body> but no <html> or doctype', () => {
    expect(looksLikeHtml('<body>hello</body>')).toBe(false)
  })

  it('rejects LLM conversational output', () => {
    expect(looksLikeHtml("Here's your app:\n<div>hello</div>\nLet me know!")).toBe(false)
    expect(looksLikeHtml('I built a snake game for you. The code is below.')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(looksLikeHtml('')).toBe(false)
  })

  it('rejects whitespace-only', () => {
    expect(looksLikeHtml('   \n\t  ')).toBe(false)
  })

  it('rejects plain text', () => {
    expect(looksLikeHtml('hello world')).toBe(false)
  })

  it('rejects JSON', () => {
    expect(looksLikeHtml('{"html": "<!DOCTYPE html>"}')).toBe(false)
  })

  it('rejects markdown', () => {
    expect(looksLikeHtml('# My App\n\nThis is a snake game.')).toBe(false)
  })

  it('rejects <html> not at start (conversational prefix)', () => {
    expect(looksLikeHtml('Sure! Here you go:\n<html></html>')).toBe(false)
  })
})
