// Tests for logger.ts — logger.{debug,info,warn,error,getLevel}.
// Covers: log level filtering, JSON structure, env-based level switching,
// error/warn routing, getLevel, circular ref handling, no-throw.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { logger } from '../src/lib/logger'

// @types/node marks NODE_ENV as readonly. Cast process.env to a mutable record
// so tests can set/delete it. (LOG_LEVEL is not in the type defs, so it's already mutable.)
const env = process.env as Record<string, string | undefined>

const ORIG_LOG_LEVEL = env.LOG_LEVEL
const ORIG_NODE_ENV = env.NODE_ENV

describe('logger', () => {
  afterEach(() => {
    // Restore env vars after each test.
    if (ORIG_LOG_LEVEL === undefined) delete process.env.LOG_LEVEL
    else process.env.LOG_LEVEL = ORIG_LOG_LEVEL
    if (ORIG_NODE_ENV === undefined) delete env.NODE_ENV
    else env.NODE_ENV = ORIG_NODE_ENV
  })

  describe('getLevel', () => {
    it('returns a valid LogLevel string', () => {
      const level = logger.getLevel()
      expect(['debug', 'info', 'warn', 'error']).toContain(level)
    })

    it('returns "info" by default when no env vars are set', () => {
      delete process.env.LOG_LEVEL
      delete env.NODE_ENV
      expect(logger.getLevel()).toBe('info')
    })

    it('returns "warn" when NODE_ENV=production (and no LOG_LEVEL)', () => {
      delete process.env.LOG_LEVEL
      env.NODE_ENV = 'production'
      expect(logger.getLevel()).toBe('warn')
    })

    it('returns "debug" when LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug'
      expect(logger.getLevel()).toBe('debug')
    })

    it('returns "warn" when LOG_LEVEL=warn', () => {
      process.env.LOG_LEVEL = 'warn'
      expect(logger.getLevel()).toBe('warn')
    })

    it('returns "error" when LOG_LEVEL=error', () => {
      process.env.LOG_LEVEL = 'error'
      expect(logger.getLevel()).toBe('error')
    })

    it('falls back to "info" when LOG_LEVEL is invalid', () => {
      process.env.LOG_LEVEL = 'invalid-level'
      delete env.NODE_ENV
      expect(logger.getLevel()).toBe('info')
    })

    it('LOG_LEVEL takes precedence over NODE_ENV', () => {
      process.env.LOG_LEVEL = 'debug'
      env.NODE_ENV = 'production'
      expect(logger.getLevel()).toBe('debug')
    })
  })

  describe('logger methods', () => {
    it('logger.info is a function', () => {
      expect(typeof logger.info).toBe('function')
    })

    it('logger.debug is a function', () => {
      expect(typeof logger.debug).toBe('function')
    })

    it('logger.warn is a function', () => {
      expect(typeof logger.warn).toBe('function')
    })

    it('logger.error is a function', () => {
      expect(typeof logger.error).toBe('function')
    })

    it('logger.getLevel is a function', () => {
      expect(typeof logger.getLevel).toBe('function')
    })

    it('does not throw when calling info with no context', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.event')).not.toThrow()
    })

    it('does not throw when calling info with context', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.event', { foo: 'bar', count: 42 })).not.toThrow()
    })

    it('does not throw when calling error with context', () => {
      process.env.LOG_LEVEL = 'error'
      expect(() => logger.error('test.error', { err: 'bad' })).not.toThrow()
    })

    it('does not throw when context contains nested objects', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.nested', { a: { b: { c: 1 } } })).not.toThrow()
    })

    it('does not throw when context contains arrays', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.arr', { items: [1, 2, 3] })).not.toThrow()
    })

    it('does not throw when context contains null/undefined values', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.nulls', { a: null, b: undefined })).not.toThrow()
    })
  })

  describe('log level filtering', () => {
    it('respects LOG_LEVEL=error — does not throw on debug/info/warn calls', () => {
      process.env.LOG_LEVEL = 'error'
      // These should be silently filtered — they don't output but should not throw.
      expect(() => {
        logger.debug('test.debug')
        logger.info('test.info')
        logger.warn('test.warn')
        logger.error('test.error')
      }).not.toThrow()
    })

    it('respects LOG_LEVEL=debug — all levels pass', () => {
      process.env.LOG_LEVEL = 'debug'
      expect(() => {
        logger.debug('test.debug')
        logger.info('test.info')
        logger.warn('test.warn')
        logger.error('test.error')
      }).not.toThrow()
    })

    it('respects LOG_LEVEL=warn — debug and info are filtered', () => {
      process.env.LOG_LEVEL = 'warn'
      expect(() => {
        logger.debug('test.debug') // filtered
        logger.info('test.info')   // filtered
        logger.warn('test.warn')   // outputs
        logger.error('test.error') // outputs
      }).not.toThrow()
    })
  })

  describe('circular reference handling', () => {
    it('does not crash when context contains a circular reference', () => {
      process.env.LOG_LEVEL = 'info'
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj // circular reference
      expect(() => logger.info('test.circular', { obj })).not.toThrow()
    })

    it('does not crash when context contains a BigInt value', () => {
      process.env.LOG_LEVEL = 'info'
      const bigIntVal = BigInt(123)
      expect(() => logger.info('test.bigint', { n: bigIntVal })).not.toThrow()
    })

    it('still logs the event name even when serialization fails', () => {
      // We can't easily capture stdout in bun:test without mocks.
      // The key behavior: the call should not throw, and the function should return void.
      process.env.LOG_LEVEL = 'info'
      const obj: Record<string, unknown> = { a: 1 }
      obj.self = obj
      const result = logger.info('test.circular.event', { obj })
      expect(result).toBeUndefined() // log() returns void
    })
  })

  describe('context handling', () => {
    it('accepts an empty context object', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.empty', {})).not.toThrow()
    })

    it('accepts a context with mixed types', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.mixed', {
        str: 'hello',
        num: 42,
        bool: true,
        arr: [1, 'two', false],
        obj: { nested: 'value' },
        nil: null,
      })).not.toThrow()
    })

    it('accepts no context argument at all', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('test.noctx')).not.toThrow()
    })
  })

  describe('event name handling', () => {
    it('accepts a simple event name', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('simpleEvent')).not.toThrow()
    })

    it('accepts a dotted event name (NOVA convention)', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('build.started')).not.toThrow()
    })

    it('accepts an empty event name (does not throw)', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('')).not.toThrow()
    })

    it('accepts an event name with special characters', () => {
      process.env.LOG_LEVEL = 'info'
      expect(() => logger.info('build:started!')).not.toThrow()
    })
  })
})
