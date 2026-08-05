// Tests for interaction-probe.ts — formatProbeErrors + probeApp shape.
//
// Strategy: `probeApp` is a DOM-dependent function (creates an iframe, listens
// to window messages, calls document.createElement). It cannot be exercised
// in pure Node/Bun without a full DOM env. The task instructions explicitly
// say "test the pure logic functions (not the actual DOM probing)" — so this
// file thoroughly covers `formatProbeErrors` and only verifies the shape /
// contract of `probeApp` (function exists, returns a Promise, rejects in a
// DOM-less env).
import { describe, it, expect } from 'bun:test'
import {
  probeApp,
  formatProbeErrors,
  type ProbeResult,
  type ProbeError,
  type StateChange,
} from '../src/lib/interaction-probe'

// ── Helpers ──

function makeError(over: Partial<ProbeError> = {}): ProbeError {
  return {
    type: 'error',
    msg: 'Something went wrong',
    line: 0,
    col: 0,
    ...over,
  }
}

function makeResult(over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    errors: [],
    interactions: 0,
    buttonsClicked: 0,
    inputsTested: 0,
    gameKeysDispatched: false,
    stateChanges: [],
    functionalScore: 0,
    deadClicks: 0,
    functionalClicks: 0,
    summary: '',
    ...over,
  }
}

// ── Tests ──

describe('probeApp (shape only — DOM probing not testable in Node)', () => {
  it('probeApp is a function', () => {
    expect(typeof probeApp).toBe('function')
  })

  it('probeApp returns a Promise', () => {
    // probeApp's executor accesses `document` synchronously — in Node that
    // throws inside the executor, which rejects the Promise. The Promise
    // itself is still returned.
    const p = probeApp('<html></html>', false)
    expect(p).toBeInstanceOf(Promise)
    // Swallow the rejection so the test runner doesn't see an unhandled rejection.
    p.catch(() => {})
  })

  it('probeApp rejects when no DOM is available (no document global)', async () => {
    // In Node/Bun without jsdom, `document` is undefined. The first line of
    // the executor that touches `document` should throw a ReferenceError.
    let caught: unknown = null
    try {
      await probeApp('<html></html>', false)
    } catch (e) {
      caught = e
    }
    expect(caught).not.toBeNull()
  })

  it('probeApp accepts (string, boolean) signature', () => {
    // Compile-time check: this should type-check and not throw at call time
    // (the throw happens inside the Promise executor).
    const p = probeApp('', true)
    expect(p).toBeInstanceOf(Promise)
    p.catch(() => {})
  })
})

describe('formatProbeErrors — empty / no-op cases', () => {
  it('formatProbeErrors is a function', () => {
    expect(typeof formatProbeErrors).toBe('function')
  })

  it('returns "" when probe.errors is empty', () => {
    expect(formatProbeErrors(makeResult({ errors: [] }))).toBe('')
  })

  it('returns "" when probe has no errors property (default shape)', () => {
    expect(formatProbeErrors(makeResult())).toBe('')
  })
})

describe('formatProbeErrors — single error formatting', () => {
  it('formats a single error with type and message', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ type: 'error', msg: 'boom' })],
      interactions: 5,
    }))
    expect(result).toContain('1.')
    expect(result).toContain('[error]')
    expect(result).toContain('boom')
    expect(result).toContain('Runtime errors found when testing the app')
    expect(result).toContain('5 interactions performed')
  })

  it('includes line:col location when line is non-zero', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ line: 42, col: 7 })],
    }))
    expect(result).toContain('(line 42:7)')
  })

  it('omits location when line is 0 (falsy)', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ line: 0, col: 0 })],
    }))
    expect(result).not.toContain('(line')
    expect(result).not.toContain(':0)')
  })

  it('omits location when line is undefined', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ line: undefined as unknown as number })],
    }))
    expect(result).not.toContain('(line')
  })

  it('includes stack when present, prefixed with "Stack:"', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ stack: 'at foo (bar.js:1:1)\nat baz (qux.js:2:2)' })],
    }))
    expect(result).toContain('Stack:')
    expect(result).toContain('at foo (bar.js:1:1)')
  })

  it('omits Stack section when stack is undefined', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ stack: undefined })],
    }))
    expect(result).not.toContain('Stack:')
  })

  it('omits Stack section when stack is empty string', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ stack: '' })],
    }))
    expect(result).not.toContain('Stack:')
  })

  it('truncates stack to 200 characters', () => {
    const longStack = 'x'.repeat(500)
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ stack: longStack })],
    }))
    // Should contain "Stack: " prefix + exactly 200 chars of the stack.
    const stackLine = result.split('\n').find(l => l.includes('Stack:'))
    expect(stackLine).toBeDefined()
    // 200 chars of stack content after "  Stack: "
    expect(stackLine!.length).toBe('  Stack: '.length + 200)
  })

  it('keeps stack of exactly 200 chars unchanged', () => {
    const exactStack = 'y'.repeat(200)
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ stack: exactStack })],
    }))
    expect(result).toContain(exactStack)
  })

  it('truncates stack of 201 chars to 200', () => {
    const stack201 = 'z'.repeat(201)
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ stack: stack201 })],
    }))
    expect(result).toContain('z'.repeat(200))
    expect(result).not.toContain('z'.repeat(201))
  })

  it('handles empty error message', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ msg: '' })],
    }))
    // Should still produce output with the type label.
    expect(result).toContain('[error]')
    expect(result).toContain('1.')
  })

  it('handles very long error message (no truncation)', () => {
    const longMsg = 'E'.repeat(2000)
    const result = formatProbeErrors(makeResult({
      errors: [makeError({ msg: longMsg })],
    }))
    expect(result).toContain(longMsg)
  })
})

describe('formatProbeErrors — multiple errors', () => {
  it('numbers errors starting at 1', () => {
    const result = formatProbeErrors(makeResult({
      errors: [
        makeError({ msg: 'first' }),
        makeError({ msg: 'second' }),
        makeError({ msg: 'third' }),
      ],
    }))
    expect(result).toContain('1.')
    expect(result).toContain('2.')
    expect(result).toContain('3.')
    expect(result).toContain('first')
    expect(result).toContain('second')
    expect(result).toContain('third')
  })

  it('preserves error order', () => {
    const result = formatProbeErrors(makeResult({
      errors: [
        makeError({ type: 'error', msg: 'AAA' }),
        makeError({ type: 'promise', msg: 'BBB' }),
        makeError({ type: 'console.error', msg: 'CCC' }),
      ],
    }))
    const aaaIdx = result.indexOf('AAA')
    const bbbIdx = result.indexOf('BBB')
    const cccIdx = result.indexOf('CCC')
    expect(aaaIdx).toBeGreaterThan(-1)
    expect(bbbIdx).toBeGreaterThan(aaaIdx)
    expect(cccIdx).toBeGreaterThan(bbbIdx)
  })

  it('joins errors with newlines', () => {
    const result = formatProbeErrors(makeResult({
      errors: [
        makeError({ msg: 'one' }),
        makeError({ msg: 'two' }),
      ],
    }))
    expect(result).toContain('\n2.')
  })
})

describe('formatProbeErrors — error type labels', () => {
  const types = [
    'error',
    'promise',
    'console.error',
    'click-error',
    'input-error',
    'key-error',
    'probe-error',
    'iframe-error',
  ]
  for (const type of types) {
    it(`renders [${type}] label`, () => {
      const result = formatProbeErrors(makeResult({
        errors: [makeError({ type, msg: 'msg' })],
      }))
      expect(result).toContain(`[${type}]`)
    })
  }
})

describe('formatProbeErrors — header / interactions count', () => {
  it('includes "Runtime errors found when testing the app" header', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError()],
    }))
    expect(result.startsWith('Runtime errors found when testing the app')).toBe(true)
  })

  it('includes the interactions count in the header', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError()],
      interactions: 42,
    }))
    expect(result).toContain('42 interactions performed')
  })

  it('handles 0 interactions', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError()],
      interactions: 0,
    }))
    expect(result).toContain('0 interactions performed')
  })

  it('handles very large interaction counts', () => {
    const result = formatProbeErrors(makeResult({
      errors: [makeError()],
      interactions: 1_000_000,
    }))
    expect(result).toContain('1000000 interactions performed')
  })
})

describe('formatProbeErrors — type narrowing / defensive', () => {
  it('does not throw when ProbeResult has only required fields', () => {
    const minimal: ProbeResult = {
      errors: [makeError({ msg: 'x' })],
      interactions: 1,
      buttonsClicked: 0,
      inputsTested: 0,
      gameKeysDispatched: false,
      stateChanges: [] as StateChange[],
      functionalScore: 0,
      deadClicks: 0,
      functionalClicks: 0,
      summary: '',
    }
    expect(() => formatProbeErrors(minimal)).not.toThrow()
  })

  it('handles an error with all fields populated', () => {
    const result = formatProbeErrors(makeResult({
      interactions: 12,
      errors: [makeError({
        type: 'error',
        msg: 'Cannot read property x of undefined',
        line: 88,
        col: 12,
        stack: 'TypeError: Cannot read property x of undefined\n    at foo (app.js:88:12)\n    at bar (app.js:91:3)',
      })],
    }))
    expect(result).toContain('[error]')
    expect(result).toContain('(line 88:12)')
    expect(result).toContain('Cannot read property x of undefined')
    expect(result).toContain('Stack:')
    expect(result).toContain('at foo (app.js:88:12)')
    expect(result).toContain('12 interactions performed')
  })
})
