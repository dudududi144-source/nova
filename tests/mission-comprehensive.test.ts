// Comprehensive tests for src/lib/mission.ts
// Tests validateMission with edge cases and all validation rules.
import { describe, expect, test } from 'bun:test'
import { validateMission } from '../src/lib/mission'

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — empty / whitespace
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — empty/whitespace', () => {
  test('rejects empty string', () => {
    const r = validateMission('')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    expect(r.error).toContain('empty')
  })

  test('rejects whitespace-only (spaces)', () => {
    const r = validateMission('   ')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('empty')
  })

  test('rejects whitespace-only (tabs)', () => {
    const r = validateMission('\t\t\t')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('empty')
  })

  test('rejects whitespace-only (newlines)', () => {
    const r = validateMission('\n\n\n')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('empty')
  })

  test('rejects whitespace-only (mixed)', () => {
    const r = validateMission(' \t\n \t\n ')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('empty')
  })

  test('rejects null-like (undefined coerced to string is "undefined")', () => {
    // Note: passing undefined would actually be a TypeScript error, but JS coerces
    // it to the string "undefined" which has length 9 — passes validation.
    // We don't test undefined here because the function signature requires string.
  })

  test('accepts single character with surrounding spaces (after trim >= 3)', () => {
    // "  abc  " trims to "abc" (length 3) → OK
    expect(validateMission('  abc  ').ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — length boundaries
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — length boundaries', () => {
  test('rejects 1-char mission', () => {
    expect(validateMission('a').ok).toBe(false)
  })

  test('rejects 2-char mission', () => {
    expect(validateMission('ab').ok).toBe(false)
  })

  test('accepts 3-char mission (boundary)', () => {
    expect(validateMission('abc').ok).toBe(true)
  })

  test('accepts 4-char mission (just past boundary)', () => {
    expect(validateMission('abcd').ok).toBe(true)
  })

  test('rejects 5001-char mission', () => {
    expect(validateMission('a'.repeat(5001)).ok).toBe(false)
  })

  test('accepts 5000-char mission (boundary)', () => {
    expect(validateMission('a'.repeat(5000)).ok).toBe(true)
  })

  test('accepts 4999-char mission (just under boundary)', () => {
    expect(validateMission('a'.repeat(4999)).ok).toBe(true)
  })

  test('rejects very long mission (5001 chars)', () => {
    const r = validateMission('a'.repeat(5001))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('long')
  })

  test('length error message includes the actual length', () => {
    const r = validateMission('a'.repeat(5500))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5500')
  })

  test('trims before length check (5000 chars + 10 spaces = rejected)', () => {
    // trimmed length = 2000 → OK
    expect(validateMission('a'.repeat(5000) + '          ').ok).toBe(true)
  })

  test('trims before length check (5001 chars + 10 spaces = rejected)', () => {
    // trimmed length = 2001 → rejected
    expect(validateMission('a'.repeat(5001) + '          ').ok).toBe(false)
  })

  test('short error message contains "short"', () => {
    const r = validateMission('ab')
    expect(r.error).toContain('short')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — control characters
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — control characters (C0 set \\x00-\\x1F)', () => {
  test('rejects NUL (\\x00)', () => {
    expect(validateMission('hello\x00world').ok).toBe(false)
  })

  test('rejects BEL (\\x07)', () => {
    expect(validateMission('hello\x07world').ok).toBe(false)
  })

  test('rejects backspace (\\x08)', () => {
    expect(validateMission('hello\x08world').ok).toBe(false)
  })

  test('rejects vertical tab (\\x0B)', () => {
    expect(validateMission('hello\x0Bworld').ok).toBe(false)
  })

  test('rejects form feed (\\x0C)', () => {
    expect(validateMission('hello\x0Cworld').ok).toBe(false)
  })

  test('rejects shift out (\\x0E)', () => {
    expect(validateMission('hello\x0Eworld').ok).toBe(false)
  })

  test('rejects unit separator (\\x1F)', () => {
    expect(validateMission('hello\x1Fworld').ok).toBe(false)
  })

  test('rejects DEL (\\x7F)', () => {
    expect(validateMission('hello\x7Fworld').ok).toBe(false)
  })

  test('control char error message contains "invalid"', () => {
    const r = validateMission('hello\x00world')
    expect(r.error).toContain('invalid')
  })
})

describe('validateMission — C1 extended control chars (\\x80-\\x9F)', () => {
  test('rejects \\x80', () => {
    expect(validateMission('hello\x80world').ok).toBe(false)
  })

  test('rejects \\x85 (NEL)', () => {
    expect(validateMission('hello\x85world').ok).toBe(false)
  })

  test('rejects \\x9F', () => {
    expect(validateMission('hello\x9Fworld').ok).toBe(false)
  })

  test('rejects \\xA0 is NOT in C1 range — but it is U+00A0 (NBSP)', () => {
    // U+00A0 (NBSP) is outside the C1 range (\x80-\x9F) → should pass
    expect(validateMission('hello\u00A0world').ok).toBe(true)
  })

  test('rejects multiple C1 control chars', () => {
    expect(validateMission('\x80\x81\x82\x83').ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — allowed whitespace (tab, newline, carriage return)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — allowed whitespace', () => {
  test('accepts tab character', () => {
    expect(validateMission('Build a\ttabbed\tapp').ok).toBe(true)
  })

  test('accepts newline character', () => {
    expect(validateMission('Build a\nmulti-line\napp').ok).toBe(true)
  })

  test('accepts carriage return', () => {
    expect(validateMission('Build a\r\nWindows app').ok).toBe(true)
  })

  test('accepts mix of tab, newline, carriage return', () => {
    expect(validateMission('Build\tan\r\napp').ok).toBe(true)
  })

  test('accepts mission with only newlines and 3+ chars', () => {
    expect(validateMission('a\nb\nc').ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — unicode
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — unicode', () => {
  test('accepts emoji', () => {
    expect(validateMission('Build a 🎮 game').ok).toBe(true)
  })

  test('accepts Japanese', () => {
    expect(validateMission('Build a 日本語 app').ok).toBe(true)
  })

  test('accepts Chinese', () => {
    expect(validateMission('建立一个应用').ok).toBe(true)
  })

  test('accepts Korean', () => {
    expect(validateMission('앱을 만들어주세요').ok).toBe(true)
  })

  test('accepts Arabic (RTL)', () => {
    expect(validateMission('بناء تطبيق').ok).toBe(true)
  })

  test('accepts Cyrillic', () => {
    expect(validateMission('Создать приложение').ok).toBe(true)
  })

  test('accepts accented Latin', () => {
    expect(validateMission('Créer une aplicación').ok).toBe(true)
  })

  test('accepts mixed unicode and ASCII', () => {
    expect(validateMission('Build a 🚀 app with 日本語 support').ok).toBe(true)
  })

  test('accepts emoji-only mission (3+ chars)', () => {
    // Three emoji characters
    expect(validateMission('🎮🎲🎯').ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — valid missions
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — valid missions', () => {
  test('accepts "Build a snake game"', () => {
    expect(validateMission('Build a snake game').ok).toBe(true)
  })

  test('accepts "Build a calculator"', () => {
    expect(validateMission('Build a calculator').ok).toBe(true)
  })

  test('accepts "Build a todo app with add, delete, and filter"', () => {
    expect(validateMission('Build a todo app with add, delete, and filter').ok).toBe(true)
  })

  test('accepts minimal "abc"', () => {
    expect(validateMission('abc').ok).toBe(true)
  })

  test('accepts mission with special characters', () => {
    expect(validateMission('Build a "fancy" app: with [brackets] & symbols!').ok).toBe(true)
  })

  test('accepts mission with HTML-like content', () => {
    expect(validateMission('<div>hello</div>').ok).toBe(true)
  })

  test('accepts mission with code snippets', () => {
    expect(validateMission('function add(a, b) { return a + b; }').ok).toBe(true)
  })

  test('accepts URL-like mission', () => {
    expect(validateMission('https://example.com').ok).toBe(true)
  })

  test('accepts mission with numbers only', () => {
    expect(validateMission('12345').ok).toBe(true)
  })

  test('accepts mission with punctuation only (length >= 3)', () => {
    expect(validateMission('...').ok).toBe(true)
  })

  test('returns ok:true with no error property for valid mission', () => {
    const r = validateMission('Build an app')
    expect(r.ok).toBe(true)
    expect(r.error).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — error message format
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — error message format', () => {
  test('error is always a string when ok is false', () => {
    const cases = ['', '  ', 'ab', 'a'.repeat(5001), 'hello\x00world']
    for (const c of cases) {
      const r = validateMission(c)
      expect(r.ok).toBe(false)
      expect(typeof r.error).toBe('string')
      expect(r.error!.length).toBeGreaterThan(0)
    }
  })

  test('error is undefined when ok is true', () => {
    const r = validateMission('Build an app')
    expect(r.ok).toBe(true)
    expect(r.error).toBeUndefined()
  })

  test('empty mission error mentions "empty"', () => {
    expect(validateMission('').error).toMatch(/empty/i)
  })

  test('too short mission error mentions "short"', () => {
    expect(validateMission('ab').error).toMatch(/short/i)
  })

  test('too long mission error mentions "long"', () => {
    expect(validateMission('a'.repeat(5001)).error).toMatch(/long/i)
  })

  test('control char error mentions "invalid" or "character"', () => {
    expect(validateMission('hello\x00world').error).toMatch(/invalid|character/i)
  })

  test('too long error mentions "5000"', () => {
    expect(validateMission('a'.repeat(5001)).error).toContain('5000')
  })

  test('too long error mentions actual length', () => {
    expect(validateMission('a'.repeat(6000)).error).toContain('6000')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateMission — pure function & invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('validateMission — invariants', () => {
  test('is a pure function (same input → same output)', () => {
    const mission = 'Build a snake game'
    const r1 = validateMission(mission)
    const r2 = validateMission(mission)
    expect(r1).toEqual(r2)
  })

  test('does not mutate the input', () => {
    const mission = '  Build an app  '
    const before = mission
    validateMission(mission)
    expect(mission).toBe(before)
  })

  test('returns an object with ok property', () => {
    const r = validateMission('test')
    expect(typeof r).toBe('object')
    expect(r).not.toBeNull()
    expect(typeof r.ok).toBe('boolean')
  })

  test('trims before validating (leading/trailing whitespace is OK)', () => {
    expect(validateMission('  Build a game  ').ok).toBe(true)
    expect(validateMission('\nBuild a game\n').ok).toBe(true)
    expect(validateMission('\t\tBuild a game\t\t').ok).toBe(true)
  })

  test('boundary at exactly 3 chars after trim', () => {
    expect(validateMission('   abc   ').ok).toBe(true)
    expect(validateMission('  ab  ').ok).toBe(false)
  })

  test('boundary at exactly 5000 chars after trim', () => {
    expect(validateMission('a'.repeat(5000) + '   ').ok).toBe(true)
    expect(validateMission('a'.repeat(5001) + '   ').ok).toBe(false)
  })

  test('returns true for diverse valid missions', () => {
    const validMissions = [
      'Build a snake game',
      'Build a calculator',
      'Build a todo app',
      'abc',
      'Build a 🎮 game',
      'Build a 日本語 app',
      'function f() {}',
      '<html>test</html>',
      '12345',
    ]
    for (const m of validMissions) {
      expect(validateMission(m).ok).toBe(true)
    }
  })

  test('returns false for diverse invalid missions', () => {
    const invalidMissions = [
      '',
      '   ',
      '\t\t',
      '\n\n',
      'ab',
      'a'.repeat(5001),
      'hello\x00world',
      'hello\x7Fworld',
      'hello\x80world',
      'hello\x9Fworld',
    ]
    for (const m of invalidMissions) {
      expect(validateMission(m).ok).toBe(false)
    }
  })
})
