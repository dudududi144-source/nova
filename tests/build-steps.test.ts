// Tests for dynamic build step extraction
import { describe, it, expect } from 'bun:test'
import { extractStepsFromMission, extractStepsFromPlan, getPlanSummary } from '../src/lib/build-steps'

describe('extractStepsFromMission', () => {
  it('extracts snake game steps', () => {
    const steps = extractStepsFromMission('Build a snake game with score')
    expect(steps[0]).toBe('Analyzing your request...')
    expect(steps).toContain('Planning game mechanics...')
    expect(steps).toContain('Building the game loop...')
    expect(steps).toContain('Implementing scoring system...')
    expect(steps[steps.length - 1]).toBe('Finalizing the code...')
  })

  it('extracts todo app steps', () => {
    const steps = extractStepsFromMission('Build a todo app with add and delete')
    expect(steps).toContain('Planning the task structure...')
    expect(steps).toContain('Implementing add/complete/delete...')
    expect(steps).toContain('Adding filters (all/active/completed)...')
  })

  it('extracts calculator steps', () => {
    const steps = extractStepsFromMission('Build a calculator')
    expect(steps).toContain('Planning the calculator logic...')
    expect(steps).toContain('Implementing arithmetic operations...')
    expect(steps).toContain('Adding keyboard support...')
  })

  it('extracts color palette steps', () => {
    const steps = extractStepsFromMission('Build a color palette generator')
    expect(steps).toContain('Planning the color system...')
    expect(steps).toContain('Adding copy-to-clipboard...')
  })

  it('extracts markdown editor steps', () => {
    const steps = extractStepsFromMission('Build a markdown editor')
    expect(steps).toContain('Implementing markdown parsing...')
    expect(steps).toContain('Adding live preview...')
  })

  it('extracts timer steps', () => {
    const steps = extractStepsFromMission('Build a stopwatch timer')
    expect(steps).toContain('Implementing start/stop/reset...')
  })

  it('extracts generic steps for unknown mission', () => {
    const steps = extractStepsFromMission('Build a quantum physics simulator')
    expect(steps).toContain('Planning the architecture...')
    expect(steps).toContain('Designing the UI layout...')
    expect(steps).toContain('Building HTML structure...')
  })

  it('always starts with Analyzing and ends with Finalizing', () => {
    const steps1 = extractStepsFromMission('Build a snake game')
    const steps2 = extractStepsFromMission('Build a calculator')
    const steps3 = extractStepsFromMission('something unknown')
    expect(steps1[0]).toBe('Analyzing your request...')
    expect(steps1[steps1.length - 1]).toBe('Finalizing the code...')
    expect(steps2[0]).toBe('Analyzing your request...')
    expect(steps2[steps2.length - 1]).toBe('Finalizing the code...')
    expect(steps3[0]).toBe('Analyzing your request...')
    expect(steps3[steps3.length - 1]).toBe('Finalizing the code...')
  })

  it('generates different steps for different missions', () => {
    const gameSteps = extractStepsFromMission('Build a snake game')
    const todoSteps = extractStepsFromMission('Build a todo app')
    expect(gameSteps).not.toEqual(todoSteps)
  })
})

describe('extractStepsFromPlan', () => {
  it('uses plan features when available', () => {
    const plan = {
      title: 'Snake Game',
      features: ['game board', 'snake movement', 'scoring'],
      keyFunctions: ['init', 'update'],
    }
    const steps = extractStepsFromPlan(plan, 'Build a snake game')
    expect(steps).toContain('Architect decided: Snake Game')
    expect(steps).toContain('Building: game board...')
    expect(steps).toContain('Building: snake movement...')
    expect(steps).toContain('Implementing: init...')
  })

  it('falls back to mission steps when plan is null', () => {
    const steps = extractStepsFromPlan(null, 'Build a snake game')
    expect(steps).toContain('Planning game mechanics...')
  })

  it('falls back to mission steps when plan has no features', () => {
    const plan = { title: 'Test' }
    const steps = extractStepsFromPlan(plan, 'Build a calculator')
    expect(steps).toContain('Architect decided: Test')
    // Should fall back to mission-based steps (starting from index 2)
    expect(steps).toContain('Building the display & buttons...')
  })

  it('includes layout when available', () => {
    const plan = { title: 'App', layout: 'centered column with header' }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps.some(s => s.includes('centered column'))).toBe(true)
  })
})

describe('getPlanSummary', () => {
  it('returns null for null plan', () => {
    expect(getPlanSummary(null)).toBeNull()
  })

  it('returns summary with title, type, features', () => {
    const plan = { title: 'Snake Game', type: 'game', features: ['a', 'b', 'c'] }
    expect(getPlanSummary(plan)).toBe('Snake Game · game · 3 features')
  })

  it('returns partial summary when some fields missing', () => {
    expect(getPlanSummary({ title: 'Test' })).toBe('Test')
    expect(getPlanSummary({ type: 'tool' })).toBe('tool')
    expect(getPlanSummary({ features: ['a'] })).toBe('1 features')
  })

  it('returns null for empty object', () => {
    expect(getPlanSummary({})).toBeNull()
  })
})
