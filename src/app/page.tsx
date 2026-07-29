'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, Play, Loader2, Download, RotateCcw, AlertCircle, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

interface BuildResult {
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

export default function Home() {
  const [mission, setMission] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [history, setHistory] = useState<BuildResult[]>([])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_history') ?? '[]')
      if (Array.isArray(stored)) setHistory(stored.slice(0, 10))
    } catch {
      // ignore — localStorage isn't critical
    }
  }, [])

  // Manage the iframe blob URL: create when result changes, revoke previous + on unmount
  useEffect(() => {
    if (!result?.html) {
      setIframeUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }
    const blob = new Blob([result.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setIframeUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [result])

  const build = async (missionText?: string) => {
    const m = (missionText ?? mission).trim()
    if (!m) {
      toast.error('Describe what to build first')
      return
    }
    if (loading) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: m }),
      })

      const data = await res.json()

      if (!res.ok || !data.ok) {
        const msg = data?.error ?? `Server error (${res.status})`
        setError(msg)
        toast.error(msg)
        setLoading(false)
        return
      }

      const buildResult: BuildResult = {
        html: data.html,
        tokens: data.tokens,
        ms: data.ms,
        mission: m,
      }

      setResult(buildResult)
      setMission(m)

      // Save to history (localStorage, last 10)
      const newHistory = [buildResult, ...history.filter(h => h.mission !== m)].slice(0, 10)
      setHistory(newHistory)
      try {
        localStorage.setItem('nova_history', JSON.stringify(newHistory))
      } catch {
        // quota exceeded — drop oldest, try again
        try {
          localStorage.setItem('nova_history', JSON.stringify(newHistory.slice(0, 5)))
        } catch {
          // give up silently
        }
      }

      toast.success(`Built in ${(data.ms / 1000).toFixed(1)}s · ${data.tokens} tokens`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setResult(null)
    setError(null)
    setMission('')
  }

  const download = () => {
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
  }

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
        {result && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span>{(result.ms / 1000).toFixed(1)}s · {result.tokens} tokens</span>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* Left: prompt + history (or full-width when no result) */}
        <section className={`flex shrink-0 flex-col overflow-hidden border-b border-border/40 md:border-b-0 md:border-r ${result ? 'md:w-80' : 'md:w-full md:max-w-2xl md:mx-auto'}`}>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            <label className="text-xs font-medium text-muted-foreground">
              What do you want to build?
            </label>
            <Textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  build()
                }
              }}
              placeholder="Build a snake game with score and game-over..."
              disabled={loading}
              className="min-h-[120px] resize-none font-mono text-sm"
            />
            <Button
              onClick={() => build()}
              disabled={loading || !mission.trim()}
              className="w-full gap-2"
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

            {/* Examples (when no result yet) */}
            {!result && !loading && (
              <div className="mt-2 space-y-1.5">
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
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setResult(h)
                      setMission(h.mission)
                    }}
                    className="block w-full truncate rounded-md border border-border/40 bg-card/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {h.mission}
                  </button>
                ))}
                {history.length > 0 && (
                  <button
                    onClick={() => {
                      setHistory([])
                      try { localStorage.removeItem('nova_history') } catch {}
                    }}
                    className="block w-full px-3 py-1 text-left text-[10px] text-muted-foreground/50 hover:text-destructive"
                  >
                    Clear history
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Right: preview (only when there's a result) */}
        {result && (
          <section className="flex flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-2">
              <p className="truncate text-xs text-muted-foreground">{result.mission}</p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={download}>
                  <Download className="h-3.5 w-3.5" />
                  HTML
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => build()}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Rebuild
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={reset}>
                  New
                </Button>
              </div>
            </div>
            <div className="relative flex-1 bg-neutral-950">
              {iframeUrl && (
                <iframe
                  ref={iframeRef}
                  src={iframeUrl}
                  title="Preview"
                  sandbox="allow-scripts"
                  className="h-full w-full border-0"
                />
              )}
            </div>
          </section>
        )}

        {/* Error state (right side) */}
        {error && !result && (
          <section className="flex flex-1 flex-col items-center justify-center p-6">
            <div className="w-full max-w-md space-y-4 text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
              <h2 className="text-base font-semibold">Build failed</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button onClick={() => build()} variant="outline" size="sm" className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          </section>
        )}

        {/* Loading state (right side, when no prior result) */}
        {loading && !result && (
          <section className="flex flex-1 flex-col items-center justify-center p-6">
            <div className="w-full max-w-md space-y-4 text-center">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
              <h2 className="text-base font-semibold">Building...</h2>
              <p className="text-sm text-muted-foreground">
                The model is writing your app. This usually takes 20-60 seconds.
              </p>
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
