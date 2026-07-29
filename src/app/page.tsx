'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Play, Loader2, Download, RotateCcw, AlertCircle, Zap, X, RefreshCw, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { newBuildId, sanitizeFilename, validateHistory } from '@/lib/helpers'

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
  'Build a calculator with keyboard support',
  'Build a color palette generator with copy-to-clipboard',
]

export default function Home() {
  const [mission, setMission] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedMission, setFailedMission] = useState<string | null>(null) // what to retry
  const [result, setResult] = useState<BuildResult | null>(null)
  const [history, setHistory] = useState<BuildResult[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [elapsed, setElapsed] = useState(0)
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
      setHistory(validateHistory(stored))
    } catch (err) {
      console.error('[NOVA] Failed to load history:', err)
    }
  }, [])

  // Abort any in-flight build on unmount
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Elapsed time counter during build
  useEffect(() => {
    if (!loading) {
      setElapsed(0)
      return
    }
    const startTime = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [loading])

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

    // Helper: set error state consistently (replaces 6 repeated blocks)
    const fail = (msg: string) => {
      setError(msg)
      setFailedMission(m)
      if (!resultRef.current) toast.error(msg)
    }

    try {
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: m }),
        signal: controller.signal,
      })

      // Check Content-Type BEFORE parsing — if the server returns HTML
      // (e.g., Next.js dev compilation page, 500 error page, proxy error),
      // res.json() would throw a SyntaxError that logs to the console
      // even when caught. Checking the header avoids the parse entirely.
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        fail(`Server error (${res.status})`)
        return
      }

      // Safe to parse as JSON — Content-Type confirmed
      let data: BuildResponse
      try {
        data = (await res.json()) as BuildResponse
      } catch (err) {
        // Fallback: Content-Type said JSON but body was malformed
        console.error('[NOVA] Failed to parse build response:', err)
        fail(`Server error (${res.status})`)
        return
      }

      if (!res.ok || !data.ok) {
        const msg = typeof data?.error === 'string' ? data.error : `Server error (${res.status})`
        fail(msg)
        return
      }

      // Safe destructuring — we've verified data.ok is true, so html/tokens/ms must exist
      const { html = '', tokens = 0, ms = 0 } = data
      if (!html) {
        fail('Server returned empty HTML')
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
        } catch (quotaErr) {
          console.error('[NOVA] localStorage quota exceeded:', quotaErr)
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
      fail(msg)
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

  const cancelBuild = useCallback(() => {
    // Cancel only aborts the in-flight build — does NOT clear mission or result.
    // The user keeps their mission text and the old preview (if any).
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setError(null)
    setFailedMission(null)
  }, [])

  const reset = useCallback(() => {
    // Reset clears everything — used by the "New" button.
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setResult(null)
    setError(null)
    setFailedMission(null)
    setMission('')
  }, [])

  const retryFailed = useCallback(() => {
    // If the user edited the textarea after the failure, use the edited mission.
    // Otherwise, use the original failed mission.
    const currentMission = mission.trim()
    if (currentMission && currentMission !== failedMission) {
      build(currentMission)
    } else if (failedMission) {
      build(failedMission)
    }
  }, [failedMission, build, mission])

  const download = useCallback(() => {
    if (!result?.html) return
    const blob = new Blob([result.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const filename = sanitizeFilename(result.mission)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`Downloaded ${filename}`)
  }, [result])

  // Keyboard shortcuts: Esc=cancel build, ⌘S/Ctrl+S=download
  // These are window-level so they work even when the textarea is focused.
  // ⌘S calls preventDefault() to stop the browser's "Save Page" dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc cancels a build
      if (e.key === 'Escape' && loading) {
        e.preventDefault()
        cancelBuild()
        toast.info('Build cancelled')
        return
      }
      // ⌘S / Ctrl+S downloads the current result (always preventDefault to stop browser save)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (result) {
          download()
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, result, download, cancelBuild])

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
                <span>Building... {elapsed > 0 && `${elapsed}s`}</span>
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
            maxLength={500}
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
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/40">
              ⌘+Enter to build
            </span>
            <span className={`text-[10px] ${mission.length > 500 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
              {mission.length}/500
            </span>
          </div>
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
              <span>
                The model is writing your app.
                {elapsed > 0 && ` ${elapsed}s elapsed.`}
                {' '}This usually takes 20-60 seconds.
                {elapsed > 60 && ' (taking longer than expected — please wait)'}
              </span>
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
                  onClick={() => {
                    setMission(ex)
                    build(ex)
                  }}
                  className="block w-full rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/10"
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
                  className="flex w-full items-center gap-2 rounded-md border border-border/40 bg-card/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  <Zap className="h-3 w-3 shrink-0 text-primary/40" />
                  <span className="truncate">{h.mission}</span>
                </button>
              ))}
              {confirmClear ? (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setHistory([])
                      try { localStorage.removeItem('nova_history') } catch {}
                      setConfirmClear(false)
                      toast.success('History cleared')
                    }}
                    className="flex-1 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/20"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="flex-1 rounded border border-border/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  disabled={loading}
                  className="block w-full px-3 py-1 text-left text-[10px] text-muted-foreground/50 hover:text-destructive disabled:opacity-50"
                >
                  Clear history
                </button>
              )}
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
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={download} disabled={!result}>
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => build()} disabled={loading}>
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Rebuild
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={loading ? cancelBuild : reset}>
                  {loading ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
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
