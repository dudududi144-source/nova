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

const EXAMPLES = [
  'Build a snake game with score and game-over',
  'Build a todo app with add, complete, and delete',
  'Build a markdown editor with live preview',
  'Build a calculator with keyboard support',
]

function newBuildId(): string {
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

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_history') ?? '[]')
      if (Array.isArray(stored)) setHistory(stored.slice(0, 10))
    } catch {
      // ignore — localStorage isn't critical
    }
  }, [])

  // Abort any in-flight build on unmount
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Centralized build function. Aborts any in-flight build first.
  const build = useCallback(async () => {
    const m = mission.trim()
    if (!m) {
      toast.error('Describe what to build first')
      return
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

      const data = await res.json()

      if (!res.ok || !data.ok) {
        const msg = typeof data?.error === 'string' ? data.error : `Server error (${res.status})`
        setError(msg)
        setFailedMission(m)
        // Only toast if no result is showing (avoid double notification with banner)
        if (!result) toast.error(msg)
        return
      }

      const buildResult: BuildResult = {
        id: newBuildId(),
        html: data.html,
        tokens: data.tokens,
        ms: data.ms,
        mission: m,
      }

      setResult(buildResult)

      // Functional setState — avoids stale closure on rapid successive builds
      setHistory(prev => {
        const next = [buildResult, ...prev.filter(h => h.id !== buildResult.id && h.mission !== m)].slice(0, 10)
        // Best-effort localStorage; shrink if quota exceeded
        try {
          localStorage.setItem('nova_history', JSON.stringify(next))
        } catch {
          for (let i = next.length - 1; i >= 0; i--) {
            try {
              localStorage.setItem('nova_history', JSON.stringify(next.slice(0, i + 1)))
              break
            } catch {
              // keep trying smaller
            }
          }
        }
        return next
      })

      toast.success(`Built in ${(data.ms / 1000).toFixed(1)}s · ${data.tokens} tokens`)
    } catch (err) {
      // AbortError = user started a new build, loaded history, or navigated away; silently ignore
      if (err instanceof DOMException && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Network error'
      setError(msg)
      setFailedMission(m)
      if (!result) toast.error(msg)
    } finally {
      // Only clear loading if this controller is still the active one
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
      }
    }
  }, [mission, result])

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
      setMission(failedMission)
      // Build on next tick so mission state is updated
      setTimeout(() => build(), 0)
    }
  }, [failedMission, build])

  const download = useCallback(() => {
    if (!result?.html) return
    const blob = new Blob([result.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${result.mission.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'app'}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Downloaded')
  }, [result])

  // Whether to show examples (only when no result, no error, not loading)
  const showExamples = !result && !loading && !error
  // Whether to show first-build error panel (no result, has error, not loading)
  const showFirstError = !result && !!error && !loading

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
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
        {result && !loading && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span>{(result.ms / 1000).toFixed(1)}s · {result.tokens} tokens</span>
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Building...</span>
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
            onClick={build}
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
                  onClick={() => loadFromHistory(h)}
                  disabled={loading}
                  className="block w-full truncate rounded-md border border-border/40 bg-card/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                >
                  {h.mission}
                </button>
              ))}
              <button
                onClick={() => {
                  setHistory([])
                  try { localStorage.removeItem('nova_history') } catch {}
                }}
                className="block w-full px-3 py-1 text-left text-[10px] text-muted-foreground/50 hover:text-destructive"
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
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={build} disabled={loading}>
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
                bg-neutral-950 prevents white flash before the LLM's CSS loads. */}
            <div className="relative min-h-0 flex-1 bg-neutral-950">
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
          <span>⌘+Enter to build</span>
        </div>
      </footer>
    </div>
  )
}
