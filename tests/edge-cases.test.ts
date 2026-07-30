// Additional unit tests for edge cases found in cycle 6
import { describe, it, expect } from 'bun:test'
import { stripCodeFences, looksLikeHtml } from '../src/lib/html-utils'

describe('stripCodeFences — edge cases (cycle 6)', () => {
  it('handles empty first fence block, returns content from second', () => {
    // LLM returns an empty fence block followed by the real one
    const input = '```\n```\n```html\n<!DOCTYPE html><html></html>\n```'
    const result = stripCodeFences(input)
    expect(result).toBe('<!DOCTYPE html><html></html>')
  })

  it('handles whitespace-only first fence block', () => {
    const input = '```html\n   \n```\n```html\n<!DOCTYPE html>\n```'
    const result = stripCodeFences(input)
    expect(result).toBe('<!DOCTYPE html>')
  })

  it('returns first non-empty fence when multiple blocks exist', () => {
    const input = '```\n```\n```\n\n```\n```html\n<html></html>\n```'
    const result = stripCodeFences(input)
    expect(result).toBe('<html></html>')
  })

  it('returns trimmed text when all fence blocks are empty', () => {
    const input = '```\n```\n```\n```'
    const result = stripCodeFences(input)
    // All blocks empty — returns the original text trimmed
    expect(result).toBe(input.trim())
  })

  it('still handles single fence block correctly (regression)', () => {
    const input = '```html\n<!DOCTYPE html><html></html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html><html></html>')
  })

  it('still handles no fences correctly (regression)', () => {
    const input = '<!DOCTYPE html><html></html>'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html><html></html>')
  })
})

describe('looksLikeHtml — additional edge cases', () => {
  it('accepts HTML with BOM prefix (BOM is whitespace, trimmed by trimStart)', () => {
    // BOM (U+FEFF) is considered whitespace in JS — trimStart() removes it
    const html = '\uFEFF<!DOCTYPE html>'
    expect(looksLikeHtml(html)).toBe(true)
  })

  it('accepts HTML with leading newlines', () => {
    expect(looksLikeHtml('\n\n<!DOCTYPE html>')).toBe(true)
  })

  it('accepts HTML with leading tabs', () => {
    expect(looksLikeHtml('\t\t<html>')).toBe(true)
  })

  it('rejects SVG documents', () => {
    expect(looksLikeHtml('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(false)
  })

  it('rejects XML documents', () => {
    expect(looksLikeHtml('<?xml version="1.0"?><root></root>')).toBe(false)
  })
})
