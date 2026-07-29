// Tests for cycle 8: viewport, logger, injectCsp case-insensitivity, filename sanitization
import { describe, it, expect, spyOn } from 'bun:test'
import { injectCsp } from '../src/lib/llm'
import { logger } from '../src/lib/logger'

describe('injectCsp — case-insensitive existing CSP', () => {
  it('detects existing CSP with uppercase Content-Security-Policy', () => {
    const html = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head></html>'
    const result = injectCsp(html)
    const cspCount = (result.match(/Content-Security-Policy/gi) || []).length
    expect(cspCount).toBe(1)
  })

  it('detects existing CSP with mixed case', () => {
    const html = '<!DOCTYPE html><html><head><meta http-equiv="CoNtEnT-SeCuRiTy-PoLiCy" content="default-src \'self\'"></head></html>'
    const result = injectCsp(html)
    const cspCount = (result.match(/Content-Security-Policy/gi) || []).length
    expect(cspCount).toBe(1)
  })

  it('detects existing CSP with no quotes on http-equiv', () => {
    const html = '<!DOCTYPE html><html><head><meta http-equiv=content-security-policy content="default-src \'self\'"></head></html>'
    const result = injectCsp(html)
    const cspCount = (result.match(/Content-Security-Policy/gi) || []).length
    expect(cspCount).toBe(1)
  })

  it('detects existing CSP with single quotes', () => {
    const html = "<!DOCTYPE html><html><head><meta http-equiv='Content-Security-Policy' content=\"default-src 'self'\"></head></html>"
    const result = injectCsp(html)
    const cspCount = (result.match(/Content-Security-Policy/gi) || []).length
    expect(cspCount).toBe(1)
  })
})

describe('logger', () => {
  it('logger.info outputs JSON with level and event', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    logger.info('test.event', { key: 'value' })
    expect(spy).toHaveBeenCalledTimes(1)
    const output = spy.mock.calls[0][0]
    const parsed = JSON.parse(output)
    expect(parsed.level).toBe('info')
    expect(parsed.event).toBe('test.event')
    expect(parsed.key).toBe('value')
    expect(parsed.ts).toBeTruthy()
    spy.mockRestore()
  })

  it('logger.warn outputs to console.warn', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {})
    logger.warn('test.warn', { num: 42 })
    expect(spy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('warn')
    expect(parsed.num).toBe(42)
    spy.mockRestore()
  })

  it('logger.error outputs to console.error', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    logger.error('test.error', { msg: 'failed' })
    expect(spy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('error')
    expect(parsed.msg).toBe('failed')
    spy.mockRestore()
  })

  it('logger handles empty context', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    logger.info('test.empty')
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.level).toBe('info')
    expect(parsed.event).toBe('test.empty')
    expect(parsed.ts).toBeTruthy()
    spy.mockRestore()
  })

  it('logger handles complex nested context', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    logger.info('test.complex', { nested: { a: 1, b: [2, 3] }, arr: ['x', 'y'] })
    const parsed = JSON.parse(spy.mock.calls[0][0])
    expect(parsed.nested.a).toBe(1)
    expect(parsed.nested.b).toEqual([2, 3])
    expect(parsed.arr).toEqual(['x', 'y'])
    spy.mockRestore()
  })
})

describe('filename sanitization (download)', () => {
  // Replicate the download filename logic to test it
  function sanitizeFilename(mission: string): string {
    const rawName = mission.slice(0, 30)
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
    return `${rawName || 'app'}.html`
  }

  it('handles normal mission', () => {
    expect(sanitizeFilename('Build a snake game')).toBe('build-a-snake-game.html')
  })

  it('collapses consecutive non-alphanumeric chars', () => {
    expect(sanitizeFilename('Build --- a --- game')).toBe('build-a-game.html')
  })

  it('trims leading and trailing dashes', () => {
    expect(sanitizeFilename('---hello---')).toBe('hello.html')
  })

  it('falls back to app.html when mission is all non-alphanumeric', () => {
    expect(sanitizeFilename('---!!!???')).toBe('app.html')
  })

  it('handles empty mission', () => {
    expect(sanitizeFilename('')).toBe('app.html')
  })

  it('handles unicode mission (non-alphanumeric stripped)', () => {
    expect(sanitizeFilename('Build a 日本語 app')).toBe('build-a-app.html')
  })

  it('truncates to 30 chars before sanitizing', () => {
    const long = 'a'.repeat(50)
    const result = sanitizeFilename(long)
    expect(result).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html') // 30 a's
  })
})
