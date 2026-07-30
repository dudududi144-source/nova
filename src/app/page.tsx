'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Play, Loader2, Download, RotateCcw, AlertCircle, Zap, X, RefreshCw, Plus, Send, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { newBuildId, sanitizeFilename, validateHistory, type BuildResult } from '@/lib/helpers'
import { extractStepsFromMission, extractStepsFromPlan, getPlanSummary } from '@/lib/build-steps'

interface BuildResponse {
  ok: boolean
  html?: string
  tokens?: number
  ms?: number
  error?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

const EXAMPLES: readonly string[] = [
  'Build a snake game with score and game-over',
  'Build a todo app with add, complete, and delete',
  'Build a calculator with keyboard support',
  'Build a color palette generator with copy-to-clipboard',
]

const REFINE_THINKING_STEPS: readonly string[] = [
  'Analyzing current code...',
  'Understanding your request...',
  'Planning the changes...',
  'Applying modifications...',
  'Verifying everything still works...',
  'Finalizing the update...',
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
  const [thinkingStep, setThinkingStep] = useState(0)
  const [buildSteps, setBuildSteps] = useState<string[]>(['Building...'])
  const [planSummary, setPlanSummary] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [refining, setRefining] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const refineAbortRef = useRef<AbortController | null>(null)
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

  // Elapsed time counter + dynamic thinking step rotation
  useEffect(() => {
    if (!loading && !refining) {
      setElapsed(0)
      setThinkingStep(0)
      return
    }
    const startTime = Date.now()
    const steps = loading ? buildSteps : REFINE_THINKING_STEPS
    let step = 0
    setThinkingStep(0)

    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(sec)

      // Rotate through steps — timing depends on how many steps we have
      // Allocate ~4 seconds per step, but always keep the last step if we run out
      const stepDuration = loading ? 4 : 5 // 4s for build (more steps), 5s for refine
      const nextStep = Math.min(steps.length - 1, Math.floor(sec / stepDuration))
      if (nextStep !== step) {
        step = nextStep
        setThinkingStep(step)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [loading, refining, buildSteps])

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
    setChatMessages([])

    // Extract dynamic steps from the mission IMMEDIATELY — not pre-canned
    const steps = extractStepsFromMission(m)
    setBuildSteps(steps)
    setPlanSummary(null)

    // Helper: set error state consistently (replaces 6 repeated blocks)
    const fail = (msg: string) => {
      setError(msg)
      setFailedMission(m)
      if (!resultRef.current) toast.error(msg)
    }

    try {
      // ═══ STAGE 1: ARCHITECT — get the plan first ═══
      // This is a separate, fast call (~2-3s). The plan lets us show
      // AUTHENTIC steps to the user before the coder even starts.
      const archRes = await fetch('/api/build/architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: m }),
        signal: controller.signal,
      })

      let archData: { ok: boolean; plan?: unknown; error?: string } | null = null
      const archContentType = archRes.headers.get('content-type') ?? ''
      if (archContentType.includes('application/json')) {
        try { archData = await archRes.json() } catch {}
      }

      // If architect succeeded, update steps with the REAL plan
      if (archData?.ok && archData.plan) {
        const planSteps = extractStepsFromPlan(archData.plan, m)
        const summary = getPlanSummary(archData.plan)
        setBuildSteps(planSteps)
        setPlanSummary(summary)
        console.log('[NOVA] Architect plan:', summary, planSteps.length, 'steps')
      }
      // If architect failed, continue with mission-based steps (already set)

      // ═══ STAGE 2: CODER — generate HTML using the plan ═══
      // Try with plan first. If it fails (502/timeout), retry without plan (simpler, faster).
      let codeRes = await fetch('/api/build/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: m, plan: archData?.plan ?? null }),
        signal: controller.signal,
      })

      // If first attempt failed, retry without the plan (simpler prompt = faster = less likely to timeout)
      if (!codeRes.ok) {
        console.log('[NOVA] Code stage failed, retrying without plan...')
        // Update thinking steps to show retry
        setBuildSteps(['Retrying with simpler approach...', 'Generating code...', 'Finalizing...'])
        codeRes = await fetch('/api/build/code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mission: m, plan: null }),
          signal: controller.signal,
        })
      }

      const contentType = codeRes.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        fail(`Server error (${codeRes.status})`)
        return
      }

      let data: BuildResponse
      try {
        data = (await codeRes.json()) as BuildResponse
      } catch (err) {
        console.error('[NOVA] Failed to parse build response:', err)
        fail(`Server error (${codeRes.status})`)
        return
      }

      if (!codeRes.ok || !data.ok) {
        const msg = typeof data?.error === 'string' ? data.error : `Server error (${codeRes.status})`
        fail(msg)
        return
      }

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
    // Abort any in-flight build or refine
    abortRef.current?.abort()
    abortRef.current = null
    refineAbortRef.current?.abort()
    refineAbortRef.current = null
    setLoading(false)
    setRefining(false)
    setResult(h)
    setMission(h.mission)
    setError(null)
    setFailedMission(null)
    setChatMessages([])
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
    setRefining(false)
    setResult(null)
    setError(null)
    setFailedMission(null)
    setMission('')
    setChatMessages([])
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

  // Chat refine: send message + current HTML to LLM, get back updated HTML
  const sendChat = useCallback(async () => {
    const msg = chatInput.trim()
    const currentResult = resultRef.current
    if (!msg || refining || !currentResult) return

    const userMsg: ChatMessage = { role: 'user', content: msg, ts: Date.now() }
    setChatMessages(prev => [...prev, userMsg])
    setChatInput('')
    setRefining(true)

    // Abort any in-flight refine (separate from build abort)
    refineAbortRef.current?.abort()
    const controller = new AbortController()
    refineAbortRef.current = controller

    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: currentResult.mission, html: currentResult.html, message: msg }),
        signal: controller.signal,
      })

      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        const failMsg = `Server error (${res.status})`
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${failMsg}`, ts: Date.now() }])
        toast.error(failMsg)
        return
      }

      let data: BuildResponse
      try {
        data = (await res.json()) as BuildResponse
      } catch {
        const failMsg = `Server error (${res.status})`
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${failMsg}`, ts: Date.now() }])
        toast.error(failMsg)
        return
      }

      if (!res.ok || !data.ok) {
        const failMsg = typeof data?.error === 'string' ? data.error : `Server error (${res.status})`
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${failMsg}`, ts: Date.now() }])
        toast.error(failMsg)
        return
      }

      // Update the result with the refined HTML
      const refinedResult: BuildResult = {
        ...currentResult,
        id: newBuildId(),
        html: data.html ?? '',
      }
      setResult(refinedResult)

      // Update history with the refined version
      setHistory(prev => {
        const next = [refinedResult, ...prev.filter(h => h.mission !== currentResult.mission)].slice(0, 10)
        try { localStorage.setItem('nova_history', JSON.stringify(next)) } catch {}
        return next
      })

      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Updated! ${data.ms ? `${(data.ms / 1000).toFixed(1)}s` : ''} · ${data.tokens ?? 0} tokens`,
        ts: Date.now(),
      }])

      toast.success('Refined!')
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const failMsg = err instanceof Error ? err.message : 'Network error'
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${failMsg}`, ts: Date.now() }])
      toast.error(failMsg)
    } finally {
      if (refineAbortRef.current === controller) {
        refineAbortRef.current = null
        setRefining(false)
      }
    }
  }, [chatInput, refining])

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatMessages, refining])

  // Keyboard shortcuts: Esc=cancel build/refine, ⌘S/Ctrl+S=download
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc cancels a build or refine
      if (e.key === 'Escape' && (loading || refining)) {
        e.preventDefault()
        if (loading) {
          cancelBuild()
          toast.info('Build cancelled')
        } else if (refining) {
          refineAbortRef.current?.abort()
          refineAbortRef.current = null
          setRefining(false)
          toast.info('Refine cancelled')
        }
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
  }, [loading, refining, result, download, cancelBuild])

  // Helper: get current thinking step text (DYNAMIC — from mission or plan)
  const getThinkingText = useCallback(() => {
    if (loading) {
      return buildSteps[thinkingStep] ?? buildSteps[buildSteps.length - 1] ?? 'Building...'
    }
    if (refining) {
      return REFINE_THINKING_STEPS[thinkingStep] ?? 'Refining...'
    }
    return ''
  }, [loading, refining, thinkingStep, buildSteps])

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
                <span>
                  {loading
                    ? `${getThinkingText()} ${elapsed > 0 && `· ${elapsed}s`}`
                    : 'Building...'}
                </span>
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
            <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span className="font-medium text-foreground/80">
                  {getThinkingText()}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 pl-5">
                <div className="flex gap-1">
                  {buildSteps.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 rounded-full transition-all ${
                        i <= thinkingStep ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/20'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-muted-foreground/50">
                  {elapsed > 0 && `${elapsed}s`}
                  {elapsed > 60 && ' · taking longer than expected'}
                </span>
              </div>
            </div>
          )}

          {/* First-build error (no prior result) */}
          {showFirstError && (
            <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="text-xs text-destructive">{error}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/60">
                    The AI sometimes returns incomplete output. Try again, or simplify your request.
                  </p>
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
                {(loading || refining) && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
                <p className="truncate text-xs text-muted-foreground">
                  {loading ? 'Rebuilding...' : refining ? 'Refining...' : result.mission}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={download} disabled={!result}>
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => build()} disabled={loading || refining}>
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Rebuild
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={loading ? cancelBuild : reset}>
                  {loading ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {loading ? 'Cancel' : 'New'}
                </Button>
              </div>
            </div>

            {/* Chat panel */}
            <div className="flex shrink-0 flex-col border-b border-border/40" style={{ maxHeight: '200px' }}>
              {/* Chat messages */}
              <div ref={chatScrollRef} className="max-h-[120px] overflow-y-auto px-4 py-2">
                {chatMessages.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/40">
                    <MessageSquare className="mr-1 inline h-3 w-3" />
                    Ask NOVA to change something — "make it blue", "add dark mode", "add a high score"
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {chatMessages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-md px-2 py-1 text-[11px] ${
                          m.role === 'user'
                            ? 'bg-primary/15 text-foreground'
                            : m.content.startsWith('Error:')
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-muted/40 text-muted-foreground'
                        }`}>
                          {m.content}
                        </div>
                      </div>
                    ))}
                    {refining && (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1">
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">
                            {getThinkingText()}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Chat input */}
              <div className="flex items-center gap-1.5 border-t border-border/40 p-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendChat()
                    }
                  }}
                  placeholder="Ask NOVA to change something..."
                  disabled={refining || loading}
                  maxLength={500}
                  className="flex-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none disabled:opacity-50"
                />
                <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={sendChat} disabled={refining || loading || !chatInput.trim()}>
                  {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
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
                  <div className="flex flex-col items-center gap-3 text-neutral-400">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-xs font-medium text-foreground/80">
                      {getThinkingText()}
                    </p>
                    <div className="flex gap-1">
                      {buildSteps.map((_, i) => (
                        <div
                          key={i}
                          className={`h-1 rounded-full transition-all ${
                            i <= thinkingStep ? 'w-3 bg-primary' : 'w-1 bg-muted-foreground/20'
                          }`}
                        />
                      ))}
                    </div>
                    {elapsed > 0 && <p className="text-[10px] text-muted-foreground/50">{elapsed}s</p>}
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
