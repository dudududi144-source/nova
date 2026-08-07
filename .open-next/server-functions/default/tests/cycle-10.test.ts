// Tests for cycle 10 nitpick fixes
import { describe, it, expect } from 'bun:test'
import { stripCodeFences } from '../src/lib/html-utils'
import { validateMission } from '../src/lib/mission'

describe('stripCodeFences — non-html language identifiers', () => {
  it('handles ```javascript fence', () => {
    const input = '```javascript\n<!DOCTYPE html><html></html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html><html></html>')
  })

  it('handles ```css fence', () => {
    const input = '```css\nbody { color: red; }\n```'
    expect(stripCodeFences(input)).toBe('body { color: red; }')
  })

  it('handles ```js fence', () => {
    const input = '```js\nconsole.log("hello")\n```'
    expect(stripCodeFences(input)).toBe('console.log("hello")')
  })

  it('handles ```python fence', () => {
    const input = '```python\nprint("hello")\n```'
    expect(stripCodeFences(input)).toBe('print("hello")')
  })

  it('handles fence with underscores in language (text_html)', () => {
    const input = '```text_html\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('handles fence with hyphens in language (html-5)', () => {
    const input = '```html-5\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('handles fence with numbers in language (html5)', () => {
    const input = '```html5\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('still handles html fence (regression)', () => {
    const input = '```html\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  it('still handles no-language fence (regression)', () => {
    const input = '```\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })
})

describe('validateMission — extended control characters', () => {
  it('rejects DEL character (\\x7F)', () => {
    expect(validateMission('hello\x7Fworld').ok).toBe(false)
  })

  it('rejects C1 extended control chars (\\x80-\\x9F)', () => {
    expect(validateMission('hello\x80world').ok).toBe(false)
    expect(validateMission('hello\x9Fworld').ok).toBe(false)
    expect(validateMission('hello\x85world').ok).toBe(false) // NEL
  })

  it('still accepts tab character (\\x09)', () => {
    expect(validateMission('Build a\ttabbed\tapp').ok).toBe(true)
  })

  it('still accepts newline character (\\x0A)', () => {
    expect(validateMission('Build a\nmulti-line\napp').ok).toBe(true)
  })

  it('still accepts carriage return (\\x0D)', () => {
    expect(validateMission('Build a\r\nWindows app').ok).toBe(true)
  })

  it('still rejects C0 control chars (regression)', () => {
    expect(validateMission('hello\x00world').ok).toBe(false)
    expect(validateMission('hello\x01world').ok).toBe(false)
    expect(validateMission('hello\x1Fworld').ok).toBe(false)
  })

  it('accepts normal text (regression)', () => {
    expect(validateMission('Build a snake game').ok).toBe(true)
  })

  it('accepts unicode (regression)', () => {
    expect(validateMission('Build a 日本語 app').ok).toBe(true)
    expect(validateMission('Build a 🎮 game').ok).toBe(true)
  })
})
