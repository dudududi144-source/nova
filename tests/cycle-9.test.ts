// Tests for cycle 9 nitpick fixes
import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test'
import { stripCodeFences, injectCsp } from '../src/lib/llm'
import { logger } from '../src/lib/logger'

describe('stripCodeFences — 4+ backtick fences', () => {
  it('handles 4-backtick fences', () => {
    const input = '````html\n<!DOCTYPE html><html></html>\n````'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html><html></html>')
  })

  it('handles 5-backtick fences', () => {
    const input = '`````html\n<!DOCTYPE html>\n`````'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('handles 4-backtick fences without language', () => {
    const input = '````\n<!DOCTYPE html>\n````'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('handles mixed 3 and 4 backtick fences (returns first non-empty)', () => {
    const input = '````\n````\n```html\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('still handles 3-backtick fences (regression)', () => {
    const input = '```html\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })
})

describe('logger — level filtering', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv }
  })

  it('respects LOG_LEVEL=warn (filters out info and debug)', () => {
    process.env.LOG_LEVEL = 'warn'
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    logger.info('test.info', { x: 1 })
    logger.debug('test.debug', { x: 1 })
    logger.warn('test.warn', { x: 1 })
    logger.error('test.error', { x: 1 })

    expect(logSpy).not.toHaveBeenCalled() // info and debug filtered
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('respects LOG_LEVEL=error (filters out info, debug, warn)', () => {
    process.env.LOG_LEVEL = 'error'
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    logger.info('test.info')
    logger.warn('test.warn')
    logger.error('test.error')

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('defaults to info level when LOG_LEVEL not set', () => {
    delete process.env.LOG_LEVEL
    process.env.NODE_ENV = 'development'
    expect(logger.getLevel()).toBe('info')
  })

  it('defaults to warn level in production', () => {
    delete process.env.LOG_LEVEL
    process.env.NODE_ENV = 'production'
    expect(logger.getLevel()).toBe('warn')
  })

  it('handles invalid LOG_LEVEL gracefully', () => {
    process.env.LOG_LEVEL = 'invalid'
    process.env.NODE_ENV = 'development'
    expect(logger.getLevel()).toBe('info')
  })

  it('debug level logs everything', () => {
    process.env.LOG_LEVEL = 'debug'
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    logger.debug('test.debug')
    logger.info('test.info')
    logger.warn('test.warn')
    logger.error('test.error')

    expect(logSpy).toHaveBeenCalledTimes(2) // debug + info
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)

    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('injectCsp — defensive edge cases', () => {
  it('handles HTML with XML declaration before doctype', () => {
    // XML declaration is not HTML — looksLikeHtml would reject this,
    // but injectCsp should still handle it defensively
    const html = '<?xml version="1.0"?><!DOCTYPE html><html><head></head></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
  })

  it('handles HTML with comment before head', () => {
    const html = '<!DOCTYPE html><!-- comment --><html><head></head></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toContain('<!-- comment -->')
  })

  it('preserves all attributes on html tag', () => {
    const html = '<!DOCTYPE html><html lang="en" dir="ltr" data-theme="dark"><head></head></html>'
    const result = injectCsp(html)
    expect(result).toContain('lang="en"')
    expect(result).toContain('dir="ltr"')
    expect(result).toContain('data-theme="dark"')
    expect(result).toContain('Content-Security-Policy')
  })
})
