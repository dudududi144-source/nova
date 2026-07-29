'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Play, Loader2, Download, RotateCcw, AlertCircle, Zap, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

interface BuildResult {
  id: string          // unique per build (not per mission)
  html: string
  tokens: number
  ms: number
  mission: string
}

interface BuildResponse {
  ok: boolean
  html?: string
  tokens?: number
  ms?: number
  error?: string
}

const EXAMPLES: readonly string[] = [
  'Build a snake game with score and game-over',
  'Build a todo app with add, complete, and delete',
  'Build a markdown editor with live preview',
  'Build a calculator with keyboard support',
]

export function newBuildId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export default function Home() {
  const [mission, setMission] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedMission, setFailedMission] = useState<string | null>(null) // what to retry
  const [result, setResult] = useState<BuildResult | null>(null)
  const [history, setHistory] = useState<BuildResult[]>([])
  const abortRef = useRef<AbortController | null>(null)
  // Ref mirror of `result` so build() doesn't need it in useCallback deps.
  // This prevents build from being re-created on every result change (every build).
  // Updated in a useEffect (not during render — that's a side effect).
  const resultRef = useRef<BuildResult | null>(null)
  useEffect(() => {
    resultRef.current = result
  }, [result])

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_history') ?? '[]')
      if (!Array.isArray(stored)) return
      // Validate each item has the required fields — defend against corrupted/partial data
      const valid = stored.filter((h: unknown): h is BuildResult => {
        if (typeof h !== 'object' || h === null) return false
        const item = h as Record<string, unknown>
        return (
          typeof item.id === 'string' &&
          typeof item.html === 'string' &&
          typeof item.tokens === 'number' &&
          typeof item.ms === 'number' &&
          typeof item.mission === 'string'
        )
      })
      setHistory(valid.slice(0, 10))
    } catch {
      // ignore — localStorage isn't critical
    }
  }, [])

  // Abort any in-flight build on unmount
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Centralized build function. Aborts any in-flight build first.
  // Accepts an optional explicit mission to avoid stale-closure bugs (e.g., retry).
  // Uses resultRef instead of result state to avoid being re-created on every build.
  const build = useCallback(async (explicitMission?: string) => {
    const m = (explicitMission ?? mission).trim()
    if (!m) {
      toast.error('Describe what to build first')
      return
    }

    // If an explicit mission was passed, sync the textarea state
    if (explicitMission && explicitMission !== mission) {
      setMission(explicitMission)
    }

    // Abort any in-flight build (covers: rebuild, history-click-during-build, reset-during-build)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setFailedMission(null)

    try {
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: m }),
        signal: controller.signal,
      })

      // Parse JSON safely — server might return non-JSON (e.g., 500 HTML error page)
      let data: BuildResponse
      try {
        data = (await res.json()) as BuildResponse
      } catch {
        const msg = `Server error (${res.status})`
        setError(msg)
        setFailedMission(m)
        if (!resultRef.current) toast.error(msg)
        return
      }

      if (!res.ok || !data.ok) {
        const msg = typeof data?.error === 'string' ? data.error : `Server error (${res.status})`
        setError(msg)
        setFailedMission(m)
        // Only toast if no result is showing (avoid double notification with banner)
        if (!resultRef.current) toast.error(msg)
        return
      }

      // Safe destructuring — we've verified data.ok is true, so html/tokens/ms must exist
      const { html = '', tokens = 0, ms = 0 } = data
      if (!html) {
        const msg = 'Server returned empty HTML'
        setError(msg)
        setFailedMission(m)
        if (!resultRef.current) toast.error(msg)
        return
      }

      const buildResult: BuildResult = {
        id: newBuildId(),
        html,
        tokens,
        ms,
        mission: m,
      }

      setResult(buildResult)

      // Functional setState — avoids stale closure on rapid successive builds
      setHistory(prev => {
        // Dedupe by mission (keep only the latest build per mission)
        const next = [buildResult, ...prev.filter(h => h.mission !== m)].slice(0, 10)
        // Best-effort localStorage; shrink if quota exceeded
        let savedCount = next.length
        try {
          localStorage.setItem('nova_history', JSON.stringify(next))
        } catch {
          savedCount = 0
          for (let i = next.length - 1; i >= 0; i--) {
            try {
              localStorage.setItem('nova_history', JSON.stringify(next.slice(0, i + 1)))
              savedCount = i + 1
              break
            } catch {
              // keep trying smaller
            }
          }
        }
        // Warn if we couldn't save everything
        if (savedCount < next.length) {
          toast.error(`localStorage full — only ${savedCount} of ${next.length} builds saved to history`)
        }
        return next
      })

      toast.success(`Built in ${(ms / 1000).toFixed(1)}s · ${tokens} tokens`)
    } catch (err: unknown) {
      // AbortError = user started a new build, loaded history, or navigated away; silently ignore
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Network error'
      setError(msg)
      setFailedMission(m)
      if (!resultRef.current) toast.error(msg)
    } finally {
      // Only clear loading if this controller is still the active one
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }, [mission])

  const loadFromHistory = useCallback((h: BuildResult) => {
    // Abort any in-flight build so it doesn't overwrite the history item we're loading
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setResult(h)
    setMission(h.mission)
    setError(null)
    setFailedMission(null)
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setResult(null)
    setError(null)
    setFailedMission(null)
    setMission('')
  }, [])

  const retryFailed = useCallback(() => {
    if (failedMission) {
      // Pass the failed mission explicitly — avoids stale-closure bug where
      // build() would read the current `mission` state (which the user may have edited)
      build(failedMission)
    }
  }, [failedMission, build])

  const download = useCallback(() => {
    if (!result?.html) return
    const blob = new Blob([result.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Sanitize filename: alphanumeric only, collapse consecutive dashes, trim
    const rawName = result.mission.slice(0, 30).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
    a.download = `${rawName || 'app'}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Downloaded')
  }, [result])

  // Keyboard shortcuts: Esc=cancel build, ⌘S/Ctrl+S=download
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc cancels a build
      if (e.key === 'Escape' && loading) {
        e.preventDefault()
        abortRef.current?.abort()
        toast.info('Build cancelled')
        return
      }
      // ⌘S / Ctrl+S downloads the current result
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (result) {
          e.preventDefault()
          download()
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, result, download])

  // Whether to show examples (only when no result, no error, not loading)
  const showExamples = !result && !loading && !error
  // Whether to show first-build error panel (no result, has error, not loading)
  const showFirstError = !result && !!error && !loading

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground" aria-busy={loading}>
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">NOVA</h1>
            <p className="text-[10px] text-muted-foreground">Describe it. Build it.</p>
          </div>
        </div>
        {(result || loading) && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {loading || !result ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Building...</span>
              </>
            ) : (
              <>
                <Zap className="h-3 w-3" />
                <span>{(result.ms / 1000).toFixed(1)}s · {result.tokens} tokens</span>
              </>
            )}
          </div>
        )}
      </header>

      {/* Main */}
      <main className={`flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row ${result ? '' : 'md:justify-center'}`}>
        {/* Left panel: prompt + examples + history */}
        <section className={`min-h-0 overflow-y-auto border-b border-border/40 p-4 md:border-b-0 md:border-r ${
          result ? 'shrink-0 md:w-80' : 'flex-1 md:max-w-2xl'
        }`}>
          <label htmlFor="mission-input" className="mb-2 block text-xs font-medium text-muted-foreground">
            What do you want to build?
          </label>
          <Textarea
            id="mission-input"
            autoFocus
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                build()
              }
            }}
            placeholder="Build a snake game with score and game-over..."
            className="min-h-[120px] resize-none font-mono text-sm"
          />
          <Button
            onClick={() => build()}
            disabled={loading || !mission.trim()}
            className="mt-3 w-full gap-2"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Building...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Build
              </>
            )}
          </Button>

          {/* First-build loading (no prior result) */}
          {loading && !result && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              <span>The model is writing your app. This usually takes 20-60 seconds.</span>
            </div>
          )}

          {/* First-build error (no prior result) */}
          {showFirstError && (
            <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="text-xs text-destructive">{error}</p>
                  <Button
                    onClick={retryFailed}
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 gap-1.5 text-xs"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Try again
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Examples (only when no result, no error, not loading) */}
          {showExamples && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Try one
              </p>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setMission(ex)}
                  className="block w-full rounded-md border border-border/40 bg-card/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Recent
              </p>
              {history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  title={h.mission}
                  onClick={() => loadFromHistory(h)}
                  disabled={loading}
                  className="block w-full truncate rounded-md border border-border/40 bg-card/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  {h.mission}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setHistory([])
                  try { localStorage.removeItem('nova_history') } catch {}
                }}
                disabled={loading}
                className="block w-full px-3 py-1 text-left text-[10px] text-muted-foreground/50 hover:text-destructive disabled:opacity-50"
              >
                Clear history
              </button>
            </div>
          )}
        </section>

        {/* Right panel: preview (only when result) */}
        {result && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Error banner (rebuild failed, but keep old preview visible) */}
            {error && (
              <div role="alert" className="flex shrink-0 items-center justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span className="truncate text-xs text-destructive">Rebuild failed: {error}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px] text-destructive" onClick={retryFailed}>
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </Button>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-destructive/60 transition-colors hover:text-destructive"
                    aria-label="Dismiss error"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Toolbar */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                <p className="truncate text-xs text-muted-foreground">
                  {loading ? 'Rebuilding...' : result.mission}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={download} disabled={loading}>
                  <Download className="h-3.5 w-3.5" />
                  HTML
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => build()} disabled={loading}>
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Rebuild
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={reset}>
                  {loading ? <X className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  {loading ? 'Cancel' : 'New'}
                </Button>
              </div>
            </div>

            {/* Preview iframe — srcDoc avoids blob URL lifecycle complexity.
                bg-neutral-950 prevents white flash before the LLM's CSS loads.
                During rebuild, show a loading overlay so the user doesn't think
                the old preview is the new one. */}
            <div className="relative min-h-0 flex-1 bg-neutral-950">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-2 text-neutral-400">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-xs">Rebuilding...</p>
                  </div>
                </div>
              )}
              <iframe
                key={result.id}
                srcDoc={result.html}
                title="Preview"
                sandbox="allow-scripts"
                loading="lazy"
                className="h-full w-full border-0 bg-neutral-950"
              />
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto shrink-0 border-t border-border/40 px-4 py-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>NOVA · prompt-to-app</span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border/40 px-1">⌘+Enter</kbd> build ·
            <kbd className="ml-1 rounded border border-border/40 px-1">⌘+S</kbd> download ·
            <kbd className="ml-1 rounded border border-border/40 px-1">Esc</kbd> cancel
          </span>
          <span className="sm:hidden">⌘+Enter to build</span>
        </div>
      </footer>
    </div>
  )
}
