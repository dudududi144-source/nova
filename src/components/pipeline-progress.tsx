'use client'

// PipelineProgress — visual pipeline indicator for NOVA's build process.
//
// Shows the user which stage the build is currently in. NOVA's pipeline has
// 5 stages, derived from the SSE event stream:
//
//   Plan → Code → Analyze → Validate → Done
//
// - Plan:     Architect is analyzing the mission and producing a build plan
// - Code:     LLM is generating HTML/CSS/JS (streaming tokens to the client)
// - Analyze:  Static analysis is checking the generated code for bugs
// - Validate: Output is being validated for HTML correctness and quality score
// - Done:     Build is complete and ready to preview
//
// Two display modes:
// - Full mode:    vertical pipeline with icons, descriptions, live text, elapsed time
// - Compact mode: horizontal dots for narrow panels (mobile, sidebar)
//
// The stageFromProgressStep() function maps SSE progress text to a stage key.
// It's exported so tests can verify the mapping.

import { useState, useEffect, useMemo } from 'react'
import {
  Brain,
  Code2,
  Search,
  ShieldCheck,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react'

// ── Types ──

export type StageKey = 'plan' | 'code' | 'analyze' | 'validate' | 'done'

export interface Stage {
  key: StageKey
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

// Ordered list of stages. The "current stage" is the highest one reached.
export const PIPELINE_STAGES: readonly Stage[] = [
  {
    key: 'plan',
    label: 'Planning',
    shortLabel: 'Plan',
    description: 'Architect is analyzing your request and producing a build plan.',
    icon: Brain,
  },
  {
    key: 'code',
    label: 'Generating code',
    shortLabel: 'Code',
    description: 'The AI is writing HTML, CSS, and JavaScript for your app.',
    icon: Code2,
  },
  {
    key: 'analyze',
    label: 'Analyzing code',
    shortLabel: 'Analyze',
    description: 'Static analysis is checking the code for bugs and improvements.',
    icon: Search,
  },
  {
    key: 'validate',
    label: 'Validating output',
    shortLabel: 'Validate',
    description: 'Output is being validated for correctness and quality score.',
    icon: ShieldCheck,
  },
  {
    key: 'done',
    label: 'Build complete',
    shortLabel: 'Done',
    description: 'Your build is ready to preview.',
    icon: CheckCircle2,
  },
] as const

// ── Stage mapping ──

/**
 * Map an SSE progress step text to a stage key.
 *
 * The build/code and build/refine routes send `type: 'progress'` events with
 * a `step` string (e.g. "Writing HTML structure...", "Analyzing current code...").
 * This function maps that string to one of the 5 pipeline stages.
 *
 * Mapping rules (checked in order, first match wins):
 * - "Analyzing" / "Understanding" / "Planning" → 'plan' (refine route)
 * - "Writing" / "Adding" / "Implementing" / "Applying" / "Polishing" / "Completing truncated" → 'code'
 * - "Analyzing current" / "Fixing bugs found by analysis" / "Analyzing code" → 'analyze'
 * - "Verifying" / "Validating" / "Finalizing" → 'validate'
 * - Empty / unknown → 'plan' (default to the start)
 *
 * The function is case-insensitive. It's exported for unit testing.
 */
export function stageFromProgressStep(step: string): StageKey {
  if (!step || !step.trim()) return 'plan'
  const lower = step.toLowerCase().trim()

  // Validate (check before plan because "Validating" and "Verifying" are
  // distinct enough — but check 'analyzing current code' first to avoid
  // false-positive with plan's "Analyzing")
  if (lower.includes('verifying') ||
      lower.includes('validating') ||
      lower.includes('finalizing the update') ||
      lower.includes('finalizing the code')) {
    return 'validate'
  }

  // Analyze — check before plan because "Analyzing current code" overlaps with
  // refine's "Analyzing current code..." (which is analyze, not plan)
  if (lower.includes('analyzing current') ||
      lower.includes('analyzing code') ||
      lower.includes('fixing bugs found by analysis') ||
      lower.includes('fixing bugs')) {
    return 'analyze'
  }

  // Plan — refine's early steps (analyzing, understanding, planning)
  if (lower.includes('understanding') ||
      lower.includes('planning the changes') ||
      lower.includes('planning the architecture') ||
      lower.includes('planning game') ||
      lower.includes('planning the calculator') ||
      lower.includes('planning the task') ||
      lower.includes('planning the color')) {
    return 'plan'
  }

  // Code — code generation steps
  if (lower.includes('writing') ||
      lower.includes('adding css') ||
      lower.includes('adding interactivity') ||
      lower.includes('implementing') ||
      lower.includes('applying modifications') ||
      lower.includes('polishing') ||
      lower.includes('completing truncated') ||
      lower.includes('building the game') ||
      lower.includes('building the display') ||
      lower.includes('building html') ||
      lower.includes('designing')) {
    return 'code'
  }

  // Default to plan (we haven't started yet, or it's an unknown step)
  return 'plan'
}

// ── Helper: stage order index ──

const STAGE_ORDER: Record<StageKey, number> = {
  plan: 0,
  code: 1,
  analyze: 2,
  validate: 3,
  done: 4,
}

function stageIndex(key: StageKey): number {
  return STAGE_ORDER[key] ?? 0
}

// ── Component ──

interface PipelineProgressProps {
  /** The current stage. If a progress step string is provided instead, it's mapped. */
  currentStage?: StageKey
  /**
   * The latest progress step text from SSE (alternative to currentStage).
   * If both are provided, currentStage wins.
   */
  progressStep?: string
  /** Live text to display under the current stage (e.g. streamed tokens). */
  liveText?: string
  /** Elapsed seconds since the build started. */
  elapsedSeconds?: number
  /** Display mode: 'full' (default) or 'compact'. */
  mode?: 'full' | 'compact'
  /** Optional className for the root container. */
  className?: string
}

export function PipelineProgress({
  currentStage,
  progressStep,
  liveText,
  elapsedSeconds = 0,
  mode = 'full',
  className = '',
}: PipelineProgressProps) {
  // Resolve the current stage from either prop
  const stage = useMemo<StageKey>(() => {
    if (currentStage) return currentStage
    if (progressStep) return stageFromProgressStep(progressStep)
    return 'plan'
  }, [currentStage, progressStep])

  const currentIdx = stageIndex(stage)

  if (mode === 'compact') {
    return <CompactPipeline currentIdx={currentIdx} className={className} />
  }

  return (
    <FullPipeline
      currentIdx={currentIdx}
      liveText={liveText}
      elapsedSeconds={elapsedSeconds}
      className={className}
    />
  )
}

// ── Full pipeline (vertical) ──

interface FullPipelineProps {
  currentIdx: number
  liveText?: string
  elapsedSeconds: number
  className: string
}

function FullPipeline({ currentIdx, liveText, elapsedSeconds, className }: FullPipelineProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {PIPELINE_STAGES.map((stage, idx) => {
        const isComplete = idx < currentIdx
        const isCurrent = idx === currentIdx
        const isPending = idx > currentIdx
        const Icon = stage.icon

        return (
          <div
            key={stage.key}
            className={`flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors ${
              isCurrent ? 'bg-primary/10' : ''
            }`}
          >
            {/* Icon with state ring */}
            <div
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                isComplete
                  ? 'border-green-500/40 bg-green-500/15 text-green-400'
                  : isCurrent
                    ? 'border-primary/60 bg-primary/20 text-primary'
                    : 'border-border/40 bg-muted/30 text-muted-foreground/50'
              }`}
            >
              <Icon className="h-3 w-3" />
            </div>

            {/* Label + description */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-xs font-medium ${
                    isPending ? 'text-muted-foreground/60' : 'text-foreground'
                  }`}
                >
                  {stage.label}
                </span>
                {isCurrent && elapsedSeconds > 0 && (
                  <ElapsedBadge seconds={elapsedSeconds} />
                )}
              </div>
              {isCurrent && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {stage.description}
                </p>
              )}
              {isCurrent && liveText && (
                <p className="mt-1 max-h-12 overflow-hidden font-mono text-[10px] text-muted-foreground/70">
                  {liveText.slice(-200)}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Compact pipeline (horizontal dots) ──

interface CompactPipelineProps {
  currentIdx: number
  className: string
}

function CompactPipeline({ currentIdx, className }: CompactPipelineProps) {
  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      role="progressbar"
      aria-valuenow={currentIdx + 1}
      aria-valuemin={1}
      aria-valuemax={PIPELINE_STAGES.length}
    >
      {PIPELINE_STAGES.map((stage, idx) => {
        const isComplete = idx < currentIdx
        const isCurrent = idx === currentIdx
        const Icon = stage.icon
        return (
          <div key={stage.key} className="flex items-center">
            <div
              className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
                isComplete
                  ? 'bg-green-500/20 text-green-400'
                  : isCurrent
                    ? 'bg-primary/30 text-primary'
                    : 'bg-muted/30 text-muted-foreground/40'
              }`}
              title={stage.label}
            >
              <Icon className="h-2.5 w-2.5" />
            </div>
            {idx < PIPELINE_STAGES.length - 1 && (
              <div
                className={`h-px w-4 ${
                  isComplete ? 'bg-green-500/40' : 'bg-border/40'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Elapsed time badge ──

function ElapsedBadge({ seconds }: { seconds: number }) {
  const [, force] = useState(0)

  // Tick every second so the elapsed time updates live.
  useEffect(() => {
    if (seconds <= 0) return
    const id = setInterval(() => force(v => v + 1), 1000)
    return () => clearInterval(id)
  }, [seconds])

  const display = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  return (
    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
      {display}
    </span>
  )
}
