// Tests for json-extract.ts — extractBalancedJson.
//
// Strategy: extractBalancedJson is a pure function — given a string, returns
// a parsed object or throws. We cover code-fence handling, brace balancing,
// string-literal escapes, prose around JSON, multiple JSON objects, edge cases
// (empty/whitespace/no-brace), and valid value types.
import { describe, it, expect } from 'bun:test'
import { extractBalancedJson } from '../src/lib/json-extract'

describe('extractBalancedJson — function shape', () => {
  it('is a function', () => {
    expect(typeof extractBalancedJson).toBe('function')
  })
})

describe('extractBalancedJson — error cases', () => {
  it('returns null on empty string', () => {
    expect(extractBalancedJson('')).toBeNull()
  })

  it('returns null on whitespace-only input', () => {
    expect(extractBalancedJson('   \n\t  ')).toBeNull()
  })

  it('returns null when no opening brace is present', () => {
    expect(extractBalancedJson('Hello, world!')).toBeNull()
  })

  it('throws when opening brace has no matching close', () => {
    expect(() => extractBalancedJson('{ "a": 1')).toThrow(/closing brace/)
  })

  it('throws on malformed JSON inside braces', () => {
    expect(() => extractBalancedJson('{ a: 1 }')).toThrow()
  })

  it('throws when JSON has trailing comma (invalid JSON)', () => {
    expect(() => extractBalancedJson('{"a":1,}')).toThrow()
  })

  it('returns null when string contains only a closing brace', () => {
    expect(extractBalancedJson('}')).toBeNull()
  })
})

describe('extractBalancedJson — simple valid cases', () => {
  it('parses a minimal empty object', () => {
    expect(extractBalancedJson('{}')).toEqual({})
  })

  it('parses a single-key object with number value', () => {
    expect(extractBalancedJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses a single-key object with string value', () => {
    expect(extractBalancedJson('{"a":"hello"}')).toEqual({ a: 'hello' })
  })

  it('parses a multi-key object', () => {
    expect(extractBalancedJson('{"a":1,"b":2,"c":3}')).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('parses boolean values', () => {
    expect(extractBalancedJson('{"a":true,"b":false}')).toEqual({ a: true, b: false })
  })

  it('parses null value', () => {
    expect(extractBalancedJson('{"a":null}')).toEqual({ a: null })
  })

  it('parses nested arrays', () => {
    expect(extractBalancedJson('{"a":[1,2,3]}')).toEqual({ a: [1, 2, 3] })
  })

  it('parses nested objects', () => {
    expect(extractBalancedJson('{"a":{"b":{"c":1}}}')).toEqual({ a: { b: { c: 1 } } })
  })

  it('parses object with whitespace inside', () => {
    expect(extractBalancedJson('{  "a" : 1  }')).toEqual({ a: 1 })
  })

  it('parses object with newlines inside', () => {
    expect(extractBalancedJson('{\n  "a": 1,\n  "b": 2\n}')).toEqual({ a: 1, b: 2 })
  })
})

describe('extractBalancedJson — string literal edge cases', () => {
  it('handles a closing brace inside a string literal', () => {
    expect(extractBalancedJson('{"a":"}"}')).toEqual({ a: '}' })
  })

  it('handles an opening brace inside a string literal', () => {
    expect(extractBalancedJson('{"a":"{"}')).toEqual({ a: '{' })
  })

  it('handles escaped double-quote inside a string', () => {
    expect(extractBalancedJson('{"a":"he said \\"hi\\""}')).toEqual({ a: 'he said "hi"' })
  })

  it('handles escaped backslash inside a string', () => {
    expect(extractBalancedJson('{"a":"C:\\\\Users"}')).toEqual({ a: 'C:\\Users' })
  })

  it('does not treat backslash outside strings as escape', () => {
    // Backslash outside a string is just a regular char; should not affect brace counting.
    expect(() => extractBalancedJson('{\\}')).toThrow() // v29: changed to return null // invalid JSON anyway
  })

  it('handles strings with newlines escaped as \\n', () => {
    expect(extractBalancedJson('{"a":"line1\\nline2"}')).toEqual({ a: 'line1\nline2' })
  })

  it('handles strings with many braces inside', () => {
    const inner = '{{{{{}}}}}'
    expect(extractBalancedJson(`{"a":"${inner}"}`)).toEqual({ a: inner })
  })
})

describe('extractBalancedJson — prose / mixed content', () => {
  it('skips leading prose before JSON', () => {
    expect(extractBalancedJson('Here is your data: {"a":1}')).toEqual({ a: 1 })
  })

  it('ignores trailing prose after closing brace', () => {
    expect(extractBalancedJson('{"a":1}\n\nHope this helps!')).toEqual({ a: 1 })
  })

  it('ignores trailing prose that ends with a brace', () => {
    // This is the killer case the module docstring mentions:
    //   {"a":1}\n\nHope this helps!}
    // A naive lastIndexOf('}') would include "Hope this helps!}" in the slice.
    expect(extractBalancedJson('{"a":1}\n\nHope this helps!}')).toEqual({ a: 1 })
  })

  it('returns only the FIRST balanced object when multiple are present', () => {
    expect(extractBalancedJson('{"a":1} {"b":2}')).toEqual({ a: 1 })
  })

  it('returns first balanced object even when second is malformed', () => {
    expect(extractBalancedJson('{"a":1} {bad}')).toEqual({ a: 1 })
  })
})

describe('extractBalancedJson — code fence handling', () => {
  it('extracts JSON from a ```json fenced block', () => {
    const text = '```json\n{"a":1,"b":2}\n```'
    expect(extractBalancedJson(text)).toEqual({ a: 1, b: 2 })
  })

  it('extracts JSON from a ``` (no language) fenced block', () => {
    const text = '```\n{"a":1}\n```'
    expect(extractBalancedJson(text)).toEqual({ a: 1 })
  })

  it('handles JSON inside code fence with prose around it', () => {
    const text = 'Here you go:\n```json\n{"a":1}\n```\nEnjoy!'
    expect(extractBalancedJson(text)).toEqual({ a: 1 })
  })

  it('falls back to raw text if fence regex does not match', () => {
    // Fence without trailing ``` — regex won't match, should still find the brace.
    const text = '```json\n{"a":1}'
    expect(extractBalancedJson(text)).toEqual({ a: 1 })
  })

  it('case-insensitive fence language label', () => {
    const text = '```JSON\n{"a":1}\n```'
    expect(extractBalancedJson(text)).toEqual({ a: 1 })
  })
})

describe('extractBalancedJson — large / nested structures', () => {
  it('parses a deeply nested object (depth 50)', () => {
    let json = '{"v":0}'
    for (let i = 0; i < 50; i++) {
      json = `{"v":${json}}`
    }
    let expected: unknown = { v: 0 }
    for (let i = 0; i < 50; i++) {
      expected = { v: expected }
    }
    expect(extractBalancedJson(json)).toEqual(expected)
  })

  it('parses an object with a large array', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i)
    const json = `{"data":[${arr.join(',')}]}`
    expect(extractBalancedJson(json)).toEqual({ data: arr })
  })

  it('parses an object with many keys', () => {
    const obj: Record<string, number> = {}
    const parts: string[] = []
    for (let i = 0; i < 100; i++) {
      obj[`key${i}`] = i
      parts.push(`"key${i}":${i}`)
    }
    const json = `{${parts.join(',')}}`
    expect(extractBalancedJson(json)).toEqual(obj)
  })
})

describe('extractBalancedJson — unicode / special characters', () => {
  it('handles unicode in string values', () => {
    expect(extractBalancedJson('{"a":"héllo wörld"}')).toEqual({ a: 'héllo wörld' })
  })

  it('handles emoji in string values', () => {
    expect(extractBalancedJson('{"a":"🚀🔥"}')).toEqual({ a: '🚀🔥' })
  })

  it('handles unicode escape sequences', () => {
    expect(extractBalancedJson('{"a":"\\u0041"}')).toEqual({ a: 'A' })
  })

  it('handles JSON with unicode in keys', () => {
    expect(extractBalancedJson('{"héllo":1}')).toEqual({ héllo: 1 })
  })
})
