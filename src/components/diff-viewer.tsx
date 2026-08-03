'use client'

// DiffViewer — line-by-line diff display for build comparisons.
//
// Shows what changed between two builds (e.g. before/after a refine, or after
// an auto-fix iteration). The diff is computed server-side via diffStringsCompact
// (from src/lib/diff.ts) — this component just renders it.
//
// Features:
// - Green additions, red deletions, muted unchanged lines
// - "Changes / All" toggle — show only changed regions (default), or all lines
// - Stats bar: additions count, deletions count, change percentage
// - Old/new line numbers in the gutter
//
// Client-only because it uses React state for the toggle.

import { useState, useMemo } from 'react'
import { diffStrings, diffStringsCompact, type DiffResult, type DiffLine } from '@/lib/diff'

interface DiffViewerProps {
  /** Original text (before). */
  oldText: string
  /** New text (after). */
  newText: string
  /** Number of context lines around changes when in "Changes" mode. Default 3. */
  contextLines?: number
  /** Optional title shown above the diff. */
  title?: string
  /** Optional className for the root container. */
  className?: string
}

export function DiffViewer({
  oldText,
  newText,
  contextLines = 3,
  title,
  className = '',
}: DiffViewerProps) {
  const [mode, setMode] = useState<'changes' | 'all'>('changes')

  // Compute both diffs up front — they're cheap (LCS is capped at 1000 lines).
  const compactDiff = useMemo(
    () => diffStringsCompact(oldText, newText, contextLines),
    [oldText, newText, contextLines],
  )
  const fullDiff = useMemo(
    () => diffStrings(oldText, newText),
    [oldText, newText],
  )

  const diff: DiffResult = mode === 'changes' ? compactDiff : fullDiff

  // Calculate change percentage (lines changed / total lines)
  const totalLines = diff.stats.added + diff.stats.removed + diff.stats.unchanged
  const changedLines = diff.stats.added + diff.stats.removed
  const changePct = totalLines > 0 ? Math.round((changedLines / totalLines) * 100) : 0

  return (
    <div className={`flex h-full min-h-[200px] flex-col overflow-hidden rounded-md border border-border/40 bg-card/30 ${className}`}>
      {/* Header: title + toggle + stats */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-card/60 px-3 py-2">
        <div className="flex items-center gap-2">
          {title && (
            <span className="text-xs font-medium text-foreground">{title}</span>
          )}
          <div className="flex overflow-hidden rounded border border-border/40">
            <button
              type="button"
              onClick={() => setMode('changes')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                mode === 'changes'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/40'
              }`}
            >
              Changes
            </button>
            <button
              type="button"
              onClick={() => setMode('all')}
              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                mode === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted/40'
              }`}
            >
              All
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="text-green-400">+{diff.stats.added}</span>
          <span className="text-red-400">−{diff.stats.removed}</span>
          <span className="text-muted-foreground">{changePct}% changed</span>
          {diff.truncated && (
            <span className="text-amber-400" title="Diff truncated — inputs exceeded 1000 lines">
              ⚠ truncated
            </span>
          )}
        </div>
      </div>

      {/* Diff body */}
      <div className="min-h-0 flex-1 overflow-auto bg-background/60 font-mono text-[12px] leading-relaxed">
        {diff.identical ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No changes — texts are identical
          </div>
        ) : diff.lines.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No content to display
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {diff.lines.map((line, idx) => (
                <DiffRow key={idx} line={line} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Diff row ──

function DiffRow({ line }: { line: DiffLine }) {
  // Context separator ("...")
  if (line.type === 'context' && line.content === '...') {
    return (
      <tr className="bg-muted/10">
        <td colSpan={3} className="px-3 py-0.5 text-center text-[10px] text-muted-foreground/60">
          ···
        </td>
      </tr>
    )
  }

  // Style by line type
  let bgClass = ''
  let prefix = ' '
  let textColor = 'text-muted-foreground'

  if (line.type === 'added') {
    bgClass = 'bg-green-500/10'
    prefix = '+'
    textColor = 'text-green-300'
  } else if (line.type === 'removed') {
    bgClass = 'bg-red-500/10'
    prefix = '−'
    textColor = 'text-red-300'
  } else if (line.type === 'context') {
    bgClass = 'bg-transparent'
    prefix = ' '
    textColor = 'text-muted-foreground/70'
  } else {
    // 'unchanged'
    bgClass = 'bg-transparent'
    prefix = ' '
    textColor = 'text-muted-foreground'
  }

  return (
    <tr className={`${bgClass} hover:bg-muted/10`}>
      <td className="select-none border-r border-border/20 px-2 text-right align-top text-[10px] text-muted-foreground/40" style={{ minWidth: 32 }}>
        {line.oldLineNumber ?? ''}
      </td>
      <td className="select-none border-r border-border/20 px-2 text-right align-top text-[10px] text-muted-foreground/40" style={{ minWidth: 32 }}>
        {line.newLineNumber ?? ''}
      </td>
      <td className="whitespace-pre-wrap break-words px-3 align-top">
        <span className={`${textColor}`}>
          <span className="select-none opacity-50">{prefix} </span>
          {line.content || '\u00A0'}
        </span>
      </td>
    </tr>
  )
}
