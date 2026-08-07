// Tests for pipeline-progress.tsx — stageFromProgressStep mapping.
//
// The component itself is a 'use client' React component, but the stage-mapping
// function is a pure exported function that we can test directly.
import { describe, it, expect } from 'bun:test'
import {
  stageFromProgressStep,
  PIPELINE_STAGES,
  type StageKey,
} from '../src/components/pipeline-progress'

describe('PIPELINE_STAGES', () => {
  it('has exactly 5 stages', () => {
    expect(PIPELINE_STAGES).toHaveLength(5)
  })

  it('has stages in correct order: plan → code → analyze → validate → done', () => {
    const keys = PIPELINE_STAGES.map(s => s.key)
    expect(keys).toEqual(['plan', 'code', 'analyze', 'validate', 'done'])
  })

  it('each stage has a non-empty label', () => {
    for (const s of PIPELINE_STAGES) {
      expect(s.label.length).toBeGreaterThan(0)
    }
  })

  it('each stage has a non-empty shortLabel', () => {
    for (const s of PIPELINE_STAGES) {
      expect(s.shortLabel.length).toBeGreaterThan(0)
    }
  })

  it('each stage has a non-empty description', () => {
    for (const s of PIPELINE_STAGES) {
      expect(s.description.length).toBeGreaterThan(0)
    }
  })

  it('each stage has an icon component', () => {
    for (const s of PIPELINE_STAGES) {
      expect(s.icon).toBeDefined()
    }
  })
})

describe('stageFromProgressStep — code route steps', () => {
  it('maps "Writing HTML structure..." → code', () => {
    expect(stageFromProgressStep('Writing HTML structure...')).toBe<StageKey>('code')
  })

  it('maps "Adding CSS styles..." → code', () => {
    expect(stageFromProgressStep('Adding CSS styles...')).toBe<StageKey>('code')
  })

  it('maps "Implementing JavaScript logic..." → code', () => {
    expect(stageFromProgressStep('Implementing JavaScript logic...')).toBe<StageKey>('code')
  })

  it('maps "Adding interactivity..." → code', () => {
    expect(stageFromProgressStep('Adding interactivity...')).toBe<StageKey>('code')
  })

  it('maps "Polishing the UI..." → code', () => {
    expect(stageFromProgressStep('Polishing the UI...')).toBe<StageKey>('code')
  })

  it('maps "Finalizing the code..." → validate', () => {
    expect(stageFromProgressStep('Finalizing the code...')).toBe<StageKey>('validate')
  })

  it('maps "Completing truncated output..." → code', () => {
    expect(stageFromProgressStep('Completing truncated output...')).toBe<StageKey>('code')
  })

  it('maps "Fixing bugs found by analysis..." → analyze', () => {
    expect(stageFromProgressStep('Fixing bugs found by analysis...')).toBe<StageKey>('analyze')
  })
})

describe('stageFromProgressStep — refine route steps', () => {
  it('maps "Analyzing current code..." → analyze', () => {
    expect(stageFromProgressStep('Analyzing current code...')).toBe<StageKey>('analyze')
  })

  it('maps "Understanding your request..." → plan', () => {
    expect(stageFromProgressStep('Understanding your request...')).toBe<StageKey>('plan')
  })

  it('maps "Planning the changes..." → plan', () => {
    expect(stageFromProgressStep('Planning the changes...')).toBe<StageKey>('plan')
  })

  it('maps "Applying modifications..." → code', () => {
    expect(stageFromProgressStep('Applying modifications...')).toBe<StageKey>('code')
  })

  it('maps "Verifying everything still works..." → validate', () => {
    expect(stageFromProgressStep('Verifying everything still works...')).toBe<StageKey>('validate')
  })

  it('maps "Finalizing the update..." → validate', () => {
    expect(stageFromProgressStep('Finalizing the update...')).toBe<StageKey>('validate')
  })
})

describe('stageFromProgressStep — edge cases', () => {
  it('returns plan for empty string', () => {
    expect(stageFromProgressStep('')).toBe<StageKey>('plan')
  })

  it('returns plan for whitespace-only string', () => {
    expect(stageFromProgressStep('   ')).toBe<StageKey>('plan')
    expect(stageFromProgressStep('\n\n')).toBe<StageKey>('plan')
  })

  it('returns plan for null/undefined input', () => {
    expect(stageFromProgressStep(null as unknown as string)).toBe<StageKey>('plan')
    expect(stageFromProgressStep(undefined as unknown as string)).toBe<StageKey>('plan')
  })

  it('returns plan for unknown step text', () => {
    expect(stageFromProgressStep('Doing something completely unknown...')).toBe<StageKey>('plan')
  })

  it('is case-insensitive', () => {
    expect(stageFromProgressStep('WRITING HTML STRUCTURE...')).toBe<StageKey>('code')
    expect(stageFromProgressStep('writing html structure...')).toBe<StageKey>('code')
    expect(stageFromProgressStep('Writing Html Structure...')).toBe<StageKey>('code')
  })

  it('trims leading/trailing whitespace', () => {
    expect(stageFromProgressStep('  Writing HTML structure...  ')).toBe<StageKey>('code')
  })

  it('handles "Verifying" without trailing text', () => {
    expect(stageFromProgressStep('Verifying some things')).toBe<StageKey>('validate')
  })

  it('handles "Validating" as validate', () => {
    expect(stageFromProgressStep('Validating output quality')).toBe<StageKey>('validate')
  })

  it('handles "Fixing bugs" as analyze', () => {
    expect(stageFromProgressStep('Fixing bugs in the code')).toBe<StageKey>('analyze')
  })

  it('handles "Analyzing code" as analyze', () => {
    expect(stageFromProgressStep('Analyzing code for issues')).toBe<StageKey>('analyze')
  })

  it('handles "Planning" early steps as plan', () => {
    expect(stageFromProgressStep('Planning the architecture')).toBe<StageKey>('plan')
    expect(stageFromProgressStep('Planning the calculator logic')).toBe<StageKey>('plan')
  })

  it('handles "Building" as code', () => {
    expect(stageFromProgressStep('Building the game loop')).toBe<StageKey>('code')
    expect(stageFromProgressStep('Building HTML structure')).toBe<StageKey>('code')
  })

  it('handles "Designing" as code', () => {
    expect(stageFromProgressStep('Designing the game board')).toBe<StageKey>('code')
  })

  it('returns one of the 5 valid stage keys', () => {
    const inputs = [
      '', 'Writing HTML', 'Analyzing current code', 'Verifying things',
      'Finalizing the code', 'Fixing bugs', 'Planning changes',
      'Unknown step', 'Doing nothing',
    ]
    const validKeys: StageKey[] = ['plan', 'code', 'analyze', 'validate', 'done']
    for (const input of inputs) {
      const result = stageFromProgressStep(input)
      expect(validKeys).toContain(result)
    }
  })

  it('all 5 stages are reachable from some input', () => {
    // Sanity check: each stage key should be reachable
    const reached = new Set<StageKey>()
    const inputs = [
      'Writing HTML structure...',
      'Analyzing current code...',
      'Verifying everything still works...',
      'Planning the changes...',
      'Finalizing the code...',
      'Fixing bugs found by analysis...',
      'Understanding your request...',
      'Applying modifications...',
      'Completing truncated output...',
    ]
    for (const input of inputs) {
      reached.add(stageFromProgressStep(input))
    }
    // Should have reached plan, code, analyze, validate (done is only set
    // externally — not via progress step text)
    expect(reached.has('plan' as StageKey)).toBe(true)
    expect(reached.has('code' as StageKey)).toBe(true)
    expect(reached.has('analyze' as StageKey)).toBe(true)
    expect(reached.has('validate' as StageKey)).toBe(true)
  })
})
