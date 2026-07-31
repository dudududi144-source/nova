// Tests for mission.ts — pure validation function separated from llm.ts
// These tests verify that validateMission works correctly when imported
// from its own module (not from llm.ts).
// This is the regression test for the mock.module pollution bug.
import { describe, it, expect } from 'bun:test'
import { validateMission } from '../src/lib/mission'

describe('mission module isolation', () => {
  it('validateMission is a real function (not undefined from mock)', () => {
    expect(typeof validateMission).toBe('function')
  })
})

describe('validateMission — works correctly from mission module', () => {
  it('accepts normal mission', () => {
    expect(validateMission('Build a snake game').ok).toBe(true)
  })

  it('rejects empty string', () => {
    expect(validateMission('').ok).toBe(false)
  })

  it('rejects whitespace-only', () => {
    expect(validateMission('   ').ok).toBe(false)
  })

  it('rejects too short (< 3 chars)', () => {
    expect(validateMission('hi').ok).toBe(false)
  })

  it('accepts exactly 3 chars', () => {
    expect(validateMission('abc').ok).toBe(true)
  })

  it('rejects too long (> 2000 chars)', () => {
    expect(validateMission('a'.repeat(2001)).ok).toBe(false)
  })

  it('accepts exactly 2000 chars', () => {
    expect(validateMission('a'.repeat(2000)).ok).toBe(true)
  })

  it('rejects DEL character (\\x7F)', () => {
    expect(validateMission('hello\x7Fworld').ok).toBe(false)
  })

  it('rejects C1 control chars (\\x80-\\x9F)', () => {
    expect(validateMission('hello\x80world').ok).toBe(false)
    expect(validateMission('hello\x9Fworld').ok).toBe(false)
  })

  it('accepts tab character', () => {
    expect(validateMission('Build a\ttabbed\tapp').ok).toBe(true)
  })

  it('accepts newline character', () => {
    expect(validateMission('Build a\nmulti-line\napp').ok).toBe(true)
  })

  it('accepts unicode', () => {
    expect(validateMission('Build a 🎮 game').ok).toBe(true)
    expect(validateMission('Build a 日本語 app').ok).toBe(true)
  })

  it('trims before validating', () => {
    expect(validateMission('  Build a game  ').ok).toBe(true)
  })

  it('returns error message on failure', () => {
    const result = validateMission('')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(typeof result.error).toBe('string')
  })
})
