'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles, Play, Loader2, Download, RotateCcw, AlertCircle, Zap, X, RefreshCw, Plus, Send, MessageSquare, Copy, ExternalLink, Bug, Palette, CheckCircle2, XCircle, GitCompare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { newBuildId, sanitizeFilename, validateHistory, type BuildResult } from '@/lib/helpers'
import { extractStepsFromMission, extractStepsFromPlan, getPlanSummary } from '@/lib/build-steps'
import { formatTokens, BUILD_STAGES, getCurrentStage } from '@/lib/format'
import { injectCsp } from '@/lib/html-utils'
import { probeApp, type ProbeResult } from '@/lib/interaction-probe'
import { THEMES } from '@/lib/design-tokens'
import { ThemeToggle } from '@/components/theme-toggle'
// v4: Build memory — IndexedDB cache for instant restores of past builds.
import { findCachedBuildNormalized, cacheBuild, findSimilarBuilds, type CachedBuild } from '@/lib/build-memory'
// v4: Error recovery — structured error analysis and related-mission suggestions.
import { analyzeError, suggestRelatedMissions, type ErrorAnalysis } from '@/lib/error-recovery'
// v4: Multi-file support — inline external CSS/JS refs into a single HTML doc for preview.
import { inlineForPreview } from '@/lib/multi-file'
// v4: Pipeline progress — visual stage indicator (Plan → Code → Analyze → Validate → Done).
import { PipelineProgress, stageFromProgressStep, type StageKey } from '@/components/pipeline-progress'
// v4: Preview error boundary — catches render crashes in the preview area so they
// don't white-screen the whole app.
import { PreviewErrorBoundary } from '@/components/preview-error-boundary'

// v4: Dynamic-import FileViewer & DiffViewer (ssr: false) — they use browser-only
// APIs (clipboard, Blob, URL.createObjectURL) and add significant bundle weight,
// so we only load them when actually needed.
const FileViewer = dynamic(() => import('@/components/file-viewer').then(m => m.FileViewer), { ssr: false })
const DiffViewer = dynamic(() => import('@/components/diff-viewer').then(m => m.DiffViewer), { ssr: false })

interface BuildResponse {
  ok: boolean
  html?: string
  tokens?: number
  ms?: number
  error?: string
}

interface ProbeError {
  type: string
  msg: string
  line: number
  col: number
  stack?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

// Quick-start presets — organized by category (stolen from TFA's templates concept,
// adapted for NOVA's prompt-to-app model).
// More presets = lower barrier to entry. Users click and build immediately.
const EXAMPLES: readonly string[] = [
  'Build a snake game with score and game-over',
  'Build a todo app with add, complete, and delete',
  'Build a calculator with keyboard support',
  'Build a color palette generator with copy-to-clipboard',
  'Build a pomodoro timer with start/pause/reset',
  'Build a markdown editor with live preview',
  'Build a drawing canvas with brush size and color',
  'Build a quiz app with multiple choice and score',
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
  const [previewWidth, setPreviewWidth] = useState<'full' | 'desktop' | 'tablet' | 'mobile'>('full')
  const [showCodeAnalysis, setShowCodeAnalysis] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [livePreviewHtml, setLivePreviewHtml] = useState<string | null>(null)
  const [planSummary, setPlanSummary] = useState<string | null>(null)
  const [qualityScore, setQualityScore] = useState(0)
  const [qualityMetrics, setQualityMetrics] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [refining, setRefining] = useState(false)
  // v3: runtime errors, theme, probe results, plan adherence
  const [runtimeErrors, setRuntimeErrors] = useState<ProbeError[]>([])
  const [showRuntimeErrors, setShowRuntimeErrors] = useState(false)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [selectedTheme, setSelectedTheme] = useState<string>('slate')
  const [planFeatures, setPlanFeatures] = useState<{name: string; found: boolean}[]>([])
  const [autoFixing, setAutoFixing] = useState(false)
  // v4: Build memory — instant restore from IndexedDB + similar-builds suggestions
  const [memoryHit, setMemoryHit] = useState(false)
  const [similarBuilds, setSimilarBuilds] = useState<CachedBuild[]>([])
  // v4: Error recovery — structured analysis shown in the error panel
  const [errorAnalysis, setErrorAnalysis] = useState<ErrorAnalysis | null>(null)
  // v4: Diff viewer — show before/after comparison between two builds
  const [showDiff, setShowDiff] = useState(false)
  const [previousBuild, setPreviousBuild] = useState<BuildResult | null>(null)
  // v4: Pipeline progress — current build stage + live token text
  const [pipelineStage, setPipelineStage] = useState<StageKey | null>(null)
  const [pipelineLiveText, setPipelineLiveText] = useState('')
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // v10: Build ID for polling fallback (SSE recovery)
  const buildIdRef = useRef<string | null>(null)
  const refineAbortRef = useRef<AbortController | null>(null)
  // v4: Pipeline progress ref mirror — used inside the SSE token handler to
  // update the live text without re-creating the build callback on every token.
  const pipelineLiveTextRef = useRef('')
  // Ref mirror of `result` so build() doesn't need it in useCallback deps.
  // This prevents build from being re-created on every result change (every build).
  // Updated in a useEffect (not during render — that's a side effect).
  const resultRef = useRef<BuildResult | null>(null)
  useEffect(() => {
    resultRef.current = result
  }, [result])

  // Throttled live-preview accumulator.
  // CRITICAL: Without throttling, setLivePreviewHtml fires on every token (~2000+ times per build),
  // and each fires a full iframe srcDoc reload (re-parse + re-render + re-run partial scripts).
  // We accumulate tokens in a ref and flush to state at most every 200ms via an interval.
  const livePreviewAccumulatorRef = useRef<string>('')
  const livePreviewFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track the last char count we updated buildSteps with — used to throttle setBuildSteps
  // during token streaming (prevents ~2000 array allocations per build).
  const generatingCharsRef = useRef(0)

  // Start the throttled flush timer when loading or refining begins; clear when it ends.
  useEffect(() => {
    if (!loading && !refining) {
      // Flush any remaining accumulated text, then stop the timer.
      if (livePreviewAccumulatorRef.current) {
        setLivePreviewHtml(livePreviewAccumulatorRef.current)
        livePreviewAccumulatorRef.current = ''
      }
      if (livePreviewFlushTimerRef.current) {
        clearInterval(livePreviewFlushTimerRef.current)
        livePreviewFlushTimerRef.current = null
      }
      return
    }
    // Start a 200ms flush interval — updates the iframe at most 5 times/second instead of ~2000.
    if (!livePreviewFlushTimerRef.current) {
      livePreviewFlushTimerRef.current = setInterval(() => {
        if (livePreviewAccumulatorRef.current) {
          setLivePreviewHtml(livePreviewAccumulatorRef.current)
          // Don't clear the accumulator — new tokens may have arrived since the flush.
          // It's overwritten on the next token event.
        }
      }, 200)
    }
    return () => {
      // Cleanup on unmount or dep change — don't leave the interval running.
      if (livePreviewFlushTimerRef.current) {
        clearInterval(livePreviewFlushTimerRef.current)
        livePreviewFlushTimerRef.current = null
      }
    }
  }, [loading, refining])

  // ═══ v3: Listen for runtime errors from the preview iframe ═══
  // The injected runtime error capture script sends errors via postMessage.
  // We collect them and display in the runtime errors panel.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.source !== 'nova-preview') return
      if (e.data.kind === 'error' && e.data.error) {
        setRuntimeErrors(prev => {
          // Avoid duplicates — same msg + line
          const exists = prev.some(err => err.msg === e.data.error.msg && err.line === e.data.error.line)
          if (exists || prev.length >= 20) return prev
          return [...prev, e.data.error]
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // ═══ v3: Run interaction probe after build completes ═══
  // After a build finishes (not refine), run the probe to detect runtime errors.
  useEffect(() => {
    if (!result || loading || refining || autoFixing) return
    // Only probe if we haven't probed this result yet
    if (probeResult && probeResult.summary.includes(result.id)) return

    let cancelled = false
    const isGame = /game|snake|tetris|arcade|puzzle/i.test(result.mission)
    setRuntimeErrors([]) // Clear previous errors

    // Small delay to let the iframe finish initializing
    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const probe = await probeApp(result.html, isGame)
        if (!cancelled) {
          setProbeResult({ ...probe, summary: `${result.id} ${probe.summary}` })
          if (probe.errors.length > 0) {
            // Don't toast — just show the badge. User can click to see details.
            console.warn('[NOVA] Probe found', probe.errors.length, 'runtime errors')
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[NOVA] Probe failed:', err)
        }
      }
    }, 1500)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [result, loading, refining, autoFixing, probeResult])

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_history') ?? '[]')
      setHistory(validateHistory(stored))
    } catch (err) {
      console.error('[NOVA] Failed to load history:', err)
    }
  }, [])

  // Focus the mission textarea on mount — desktop only.
  // On mobile, auto-focusing pops the on-screen keyboard which is annoying.
  // Runs after mount to avoid SSR hydration mismatch.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      document.getElementById('mission-input')?.focus()
    }
  }, [])

  // Load saved theme from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nova_theme')
      if (saved && saved !== selectedTheme) setSelectedTheme(saved)
    } catch {}
  }, [])

  // Save history to localStorage — pure side effect, called OUTSIDE of setState updaters
  // to avoid double-firing in React StrictMode.
  const saveHistoryToStorage = useCallback((items: BuildResult[]) => {
    let savedCount = items.length
    try {
      localStorage.setItem('nova_history', JSON.stringify(items))
    } catch (quotaErr) {
      console.error('[NOVA] localStorage quota exceeded:', quotaErr)
      savedCount = 0
      for (let i = items.length - 1; i >= 0; i--) {
        try {
          localStorage.setItem('nova_history', JSON.stringify(items.slice(0, i + 1)))
          savedCount = i + 1
          break
        } catch {
          // keep trying smaller
        }
      }
    }
    if (savedCount < items.length) {
      toast.error(`localStorage full — only ${savedCount} of ${items.length} builds saved to history`)
    }
  }, [])

  // Add a build result to history (dedupe by mission) and persist to localStorage.
  // Uses historyRef to compute newHistory synchronously (not inside the setState updater).
  // The previous implementation had a race: setHistory's updater runs async, so
  // newHistory was still [] when saveHistoryToStorage was called.
  const historyRef = useRef<BuildResult[]>([])
  useEffect(() => {
    historyRef.current = history
  }, [history])

  const addBuildToHistory = useCallback((buildResult: BuildResult) => {
    // Compute new history synchronously from the ref (not from the state closure)
    const newHistory = [buildResult, ...historyRef.current.filter(h => h.mission !== buildResult.mission)].slice(0, 10)
    historyRef.current = newHistory // Update ref synchronously so rapid successive calls see the latest
    setHistory(newHistory)
    saveHistoryToStorage(newHistory)
  }, [saveHistoryToStorage])

  // Abort any in-flight build AND refine on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      refineAbortRef.current?.abort()
    }
  }, [])

  // ═══ v4: Debounced similar-builds search (400ms after mission stops changing) ═══
  // Queries IndexedDB for past builds whose missions share words with the current
  // mission. Shown as a small panel under the prompt — helps users discover that
  // they (or someone else on this browser) have built something similar before.
  useEffect(() => {
    const m = mission.trim()
    if (!m || m.length < 6) {
      setSimilarBuilds([])
      return
    }
    const handle = setTimeout(() => {
      findSimilarBuilds(m, 3)
        .then(setSimilarBuilds)
        .catch(() => setSimilarBuilds([]))
    }, 400)
    return () => clearTimeout(handle)
  }, [mission])

  // ═══ v4: Sync pipelineLiveText state with its ref (called from the SSE reader) ═══
  // The ref lets the SSE reader update text without triggering re-renders on every
  // token; this effect flushes the ref to state on a 200ms cadence (same as the
  // livePreviewHtml accumulator) so the PipelineProgress UI updates smoothly.
  useEffect(() => {
    if (!loading && !refining) {
      pipelineLiveTextRef.current = ''
      setPipelineLiveText('')
      return
    }
    const id = setInterval(() => {
      if (pipelineLiveTextRef.current !== '') {
        setPipelineLiveText(pipelineLiveTextRef.current)
      }
    }, 200)
    return () => clearInterval(id)
  }, [loading, refining])

  // Ref mirror of buildSteps so the elapsed-time effect doesn't need buildSteps in its deps.
  // If buildSteps is in the deps, the effect tears down and re-runs on every token event
  // (because setBuildSteps is called on every token), resetting startTime and thinkingStep.
  const buildStepsRef = useRef<string[]>(['Building...'])
  useEffect(() => {
    buildStepsRef.current = buildSteps
  }, [buildSteps])

  // Elapsed time counter + dynamic thinking step rotation.
  // CRITICAL: deps are [loading, refining] ONLY — not buildSteps.
  // If buildSteps were in deps, every token event would reset startTime to Date.now(),
  // the interval would be cleared before it ever fires, and elapsed would stay at 0.
  useEffect(() => {
    if (!loading && !refining) {
      setElapsed(0)
      setThinkingStep(0)
      return
    }
    const startTime = Date.now()
    let step = 0
    setThinkingStep(0)

    const timer = setInterval(() => {
      const sec = Math.floor((Date.now() - startTime) / 1000)
      setElapsed(sec)

      // Read steps from ref (not from closure — closure would be stale)
      const steps = loading ? buildStepsRef.current : REFINE_THINKING_STEPS
      if (steps.length === 0) return

      // Rotate through steps — ~4s per step for build, 5s for refine
      const stepDuration = loading ? 4 : 5
      const nextStep = Math.min(steps.length - 1, Math.floor(sec / stepDuration))
      if (nextStep !== step) {
        step = nextStep
        setThinkingStep(step)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [loading, refining])

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

    // Abort any in-flight build AND refine (covers: rebuild during refine, history-click-during-build, reset-during-build)
    // This prevents the race condition where build and refine run simultaneously and
    // both call setResult/setHistory, corrupting state.
    abortRef.current?.abort()
    refineAbortRef.current?.abort()
    refineAbortRef.current = null
    setRefining(false)
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setFailedMission(null)
    setChatMessages([])
    setConfirmClear(false) // Hide confirm-clear UI if it was visible

    // v4: Reset error analysis and pipeline state for the new build
    setErrorAnalysis(null)
    setPipelineStage('plan')
    setPipelineLiveText('')
    pipelineLiveTextRef.current = ''

    // v4: Save the current result as previousBuild so the user can diff the new build against it.
    // Only set it if there's an existing result with non-empty HTML (a real previous build).
    if (resultRef.current && resultRef.current.html) {
      setPreviousBuild(resultRef.current)
      setShowDiff(false)
    }

    // v4: Build memory — check IndexedDB for a cached build matching this mission.
    // Word-order independent ("snake game" == "game snake"). If found, restore instantly
    // and skip the LLM call entirely. The user sees their app in <50ms.
    //
    // We do this AFTER setting loading=true so the UI shows the loading state briefly,
    // then flips to the restored result. The visual continuity feels intentional, not jarring.
    try {
      const cached = await findCachedBuildNormalized(m)
      if (cached) {
        // Don't restore if the user started another build in the meantime
        if (controller.signal.aborted) return
        setResult(cached)
        resultRef.current = cached
        addBuildToHistory(cached)
        setMemoryHit(true)
        setQualityScore(cached.quality ?? 0)
        setQualityMetrics('')
        setPipelineStage('done')
        toast.success('⚡ Restored from memory', { description: `Cached build from ${new Date(cached.timestamp).toLocaleString()}` })
        if (abortRef.current === controller) {
          abortRef.current = null
          setLoading(false)
        }
        return
      }
    } catch {
      // IndexedDB unavailable (private mode, old browser) — fall through to LLM build
    }
    setMemoryHit(false)

    // Extract dynamic steps from the mission IMMEDIATELY — not pre-canned
    const steps = extractStepsFromMission(m)
    setBuildSteps(steps)
    setPlanSummary(null)
    setLivePreviewHtml(null)
    livePreviewAccumulatorRef.current = '' // Clear accumulator for fresh build
    generatingCharsRef.current = 0 // Reset char counter for build step throttling

    // Helper: set error state consistently (replaces 6 repeated blocks)
    const fail = (msg: string) => {
      // v10: Don't call fail() if this build was aborted (a new build started)
      if (controller.signal.aborted) return
      setError(msg)
      setFailedMission(m)
      // v4: Analyze the error so the error panel can show structured suggestions
      setErrorAnalysis(analyzeError(msg, m))
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
        // Debug log gated to non-production — don't spam user's console
        if (process.env.NODE_ENV !== 'production') {
          console.log('[NOVA] Architect plan:', summary, planSteps.length, 'steps')
        }
      }
      // If architect failed, continue with mission-based steps (already set)

      // ═══ STAGE 2: CODER — SSE streaming with keepalive ═══
      // The route returns Server-Sent Events: progress events while LLM works,
      // then a result event with the final HTML. No timeout — keepalive prevents it.
      const codeRes = await fetch('/api/build/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ mission: m, plan: archData?.plan ?? null, theme: selectedTheme }),
        signal: controller.signal,
      })

      if (!codeRes.ok) {
        // Non-SSE error (400, 429, 413) — parse as JSON
        let errorMsg = `Server error (${codeRes.status})`
        try {
          const errData = await codeRes.json()
          if (errData?.error) errorMsg = errData.error
        } catch {}
        fail(errorMsg)
        return
      }

      // Verify the response is actually SSE — a proxy or CDN might return 200 with HTML
      // (captive portal, error page) which would silently fail to parse as SSE.
      const codeCt = codeRes.headers.get('content-type') ?? ''
      if (!codeCt.includes('text/event-stream')) {
        let errorMsg = 'Unexpected response from server'
        try {
          const errData = await codeRes.json()
          if (errData?.error) errorMsg = errData.error
        } catch {}
        fail(errorMsg)
        return
      }

      // Read SSE stream
      const reader = codeRes.body?.getReader()
      if (!reader) {
        fail('No response stream')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let finalHtml = ''
      let finalTokens = 0
      let finalMs = 0
      let finalQuality = 0
      let finalMetrics = ''
      let streamError: string | null = null
      // v4: Multi-file capture — server may send files array, outputType, and previewable flag
      let finalFiles: { path: string; content: string; language: string }[] | undefined
      let finalOutputType: string | undefined
      let finalPreviewable: boolean | undefined

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events (separated by \n\n or \r\n\r\n — some proxies normalize to \r\n)
        // Normalize \r\n to \n first so the split works regardless of proxy behavior.
        const normalized = buffer.replace(/\r\n/g, '\n')
        const events = normalized.split('\n\n')
        buffer = events.pop() ?? '' // keep incomplete event in buffer

        for (const eventStr of events) {
          const dataLine = eventStr.trim()
          if (!dataLine.startsWith('data: ')) continue

          try {
            const evt = JSON.parse(dataLine.slice(6))

            if (evt.type === 'progress') {
              // Update thinking steps with real progress from server
              setBuildSteps(prev => {
                // Replace with server-provided step, keep last as fallback
                if (prev.length <= 2) return [evt.step, 'Generating code...', 'Finalizing...']
                return [prev[0], evt.step, ...prev.slice(2)]
              })
              // v4: Map progress step to a pipeline stage (Plan/Code/Analyze/Validate/Done)
              if (typeof evt.step === 'string') {
                setPipelineStage(stageFromProgressStep(evt.step))
              }
            } else if (evt.type === 'buildId') {
              // v10: Save build ID for polling fallback
              buildIdRef.current = evt.buildId
            } else if (evt.type === 'token') {
              // REAL TOKEN STREAMING — accumulate in ref for throttled flush.
              // We DON'T call setLivePreviewHtml here (would reload iframe on every token).
              // The 200ms flush interval picks up the accumulated text.
              livePreviewAccumulatorRef.current = (livePreviewAccumulatorRef.current || '') + (evt.text ?? '')
              // v4: Feed the live token text to the pipeline progress component
              pipelineLiveTextRef.current = livePreviewAccumulatorRef.current
              // Throttle setBuildSteps: only update the "Generating: N chars..." text
              // when the char count crosses a 500-char threshold (not on every token).
              // This prevents ~2000 setBuildSteps calls (each creating a new array) per build.
              const totalLen = (evt.length ?? 0)
              const lastUpdate = generatingCharsRef.current
              if (totalLen - lastUpdate >= 500 || totalLen === 0) {
                generatingCharsRef.current = totalLen
                setBuildSteps(prev => {
                  const last = prev[prev.length - 1]
                  const newLast = `Generating: ${totalLen} chars...`
                  if (last && last.startsWith('Generating:')) {
                    return [...prev.slice(0, -1), newLast]
                  }
                  return [...prev, newLast]
                })
              }
              // v4: First token = we're in the Code stage
              setPipelineStage('code')
            } else if (evt.type === 'result') {
              finalHtml = evt.html ?? ''
              finalTokens = evt.tokens ?? 0
              finalMs = evt.ms ?? 0
              finalQuality = evt.quality ?? 0
              finalMetrics = evt.metrics ?? ''
              // v4: Capture multi-file fields if present
              if (Array.isArray(evt.files)) finalFiles = evt.files
              if (typeof evt.outputType === 'string') finalOutputType = evt.outputType
              if (typeof evt.previewable === 'boolean') finalPreviewable = evt.previewable
            } else if (evt.type === 'error') {
              streamError = evt.error ?? 'Unknown error'
            }
          } catch {
            // Ignore malformed events
          }
        }
      }

      // Flush the decoder — any remaining bytes (incomplete multi-byte chars)
      buffer += decoder.decode()
      // Process any remaining complete event in the buffer
      if (buffer.trim()) {
        const normalized = buffer.replace(/\r\n/g, '\n')
        const events = normalized.split('\n\n')
        for (const eventStr of events) {
          const dataLine = eventStr.trim()
          if (!dataLine.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.type === 'result') {
              finalHtml = evt.html ?? ''
              finalTokens = evt.tokens ?? 0
              finalMs = evt.ms ?? 0
              finalQuality = evt.quality ?? 0
              finalMetrics = evt.metrics ?? ''
              // v4: Capture multi-file fields if present (final flush)
              if (Array.isArray(evt.files)) finalFiles = evt.files
              if (typeof evt.outputType === 'string') finalOutputType = evt.outputType
              if (typeof evt.previewable === 'boolean') finalPreviewable = evt.previewable
            } else if (evt.type === 'error') {
              streamError = evt.error ?? 'Unknown error'
            }
          } catch {}
        }
      }

      // v4: Mark the pipeline as in validation stage after streaming completes
      if (!streamError && finalHtml) {
        setPipelineStage('validate')
      }

      if (streamError) {
        fail(streamError)
        return
      }

      // v10: Polling fallback — if SSE dropped without a result, try polling the server
      if (!finalHtml && buildIdRef.current) {
        console.log('[NOVA] SSE stream dropped, polling for result...', { buildId: buildIdRef.current })
        try {
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise(r => setTimeout(r, 3000))
            if (controller.signal.aborted) return
            const pollRes = await fetch(`/api/build/result?id=${encodeURIComponent(buildIdRef.current!)}`, {
              signal: controller.signal,
            })
            if (pollRes.ok) {
              const pollData = await pollRes.json()
              if (pollData.status === 'completed' && pollData.html) {
                finalHtml = pollData.html
                finalTokens = pollData.tokens ?? 0
                finalMs = pollData.ms ?? 0
                finalQuality = pollData.quality ?? 0
                finalMetrics = pollData.metrics ?? ''
                // v4: Capture multi-file fields from poll response too
                if (Array.isArray(pollData.files)) finalFiles = pollData.files
                if (typeof pollData.outputType === 'string') finalOutputType = pollData.outputType
                if (typeof pollData.previewable === 'boolean') finalPreviewable = pollData.previewable
                break
              } else if (pollData.status === 'failed') {
                fail(pollData.error || 'Build failed on server')
                return
              }
            }
          }
        } catch (pollErr) {
          if (!(pollErr instanceof DOMException && pollErr.name === 'AbortError')) {
            console.error('[NOVA] Poll failed:', String(pollErr))
          }
        }
        if (controller.signal.aborted) return
      }

      if (!finalHtml) {
        fail('Server returned empty HTML. The build may have timed out.')
        return
      }

      const buildResult: BuildResult = {
        id: newBuildId(),
        html: finalHtml,
        tokens: finalTokens,
        ms: finalMs,
        mission: m,
        // v4: Multi-file metadata — used by the FileViewer and inlineForPreview path
        files: finalFiles,
        outputType: finalOutputType,
        previewable: finalPreviewable,
      }

      setResult(buildResult)
      resultRef.current = buildResult // Update ref synchronously
      addBuildToHistory(buildResult)

      // v4: Cache the build in IndexedDB for instant restore next time.
      // Fire-and-forget — failures (private mode, quota) are silently ignored.
      cacheBuild(buildResult, finalQuality).catch(() => {})

      // v4: Mark the pipeline as done
      setPipelineStage('done')

      toast.success(`Built in ${(finalMs / 1000).toFixed(1)}s · ${finalTokens} tokens · quality: ${finalQuality}`)
      setQualityScore(finalQuality)
      setQualityMetrics(finalMetrics)
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
    resultRef.current = h // Update ref synchronously so sendChat sees the correct result immediately
    setMission(h.mission)
    setError(null)
    setFailedMission(null)
    setChatMessages([])
    // Reset all derived state so we don't show the previous build's badges/plan
    setQualityScore(0)
    setQualityMetrics('')
    setPlanSummary(null)
    setLivePreviewHtml(null)
    setConfirmClear(false)
    // v4: Reset new state for build-memory, error analysis, diff, and pipeline
    setMemoryHit(false)
    setErrorAnalysis(null)
    setShowDiff(false)
    setPreviousBuild(null)
    setPipelineStage(null)
    setPipelineLiveText('')
    pipelineLiveTextRef.current = ''
  }, [])

  const cancelBuild = useCallback(() => {
    // Cancel only aborts the in-flight build — does NOT clear mission or result.
    // The user keeps their mission text and the old preview (if any).
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setError(null)
    setFailedMission(null)
    setLivePreviewHtml(null) // Clear stale partial HTML so it doesn't flash back later
  }, [])

  // Cancel an in-flight refine — accessible via the toolbar Cancel button during refining.
  // Previously, the Cancel button only appeared during loading, leaving no mouse-accessible
  // way to cancel a refine (only Esc worked, which is not discoverable).
  const cancelRefine = useCallback(() => {
    refineAbortRef.current?.abort()
    refineAbortRef.current = null
    setRefining(false)
    setLivePreviewHtml(null)
  }, [])

  // ═══ v3: Auto-fix function — sends runtime errors to LLM for automatic repair ═══
  // Collects runtime errors + probe errors, sends them to /api/refine with a fix prompt,
  // and replaces the result with the fixed HTML. This is the "auto-debug loop" that
  // competitors like Replit use — NOVA can now do it too.
  const autoFix = useCallback(async () => {
    const currentResult = resultRef.current
    if (!currentResult || autoFixing) return

    const allErrors = [
      ...runtimeErrors,
      ...(probeResult?.errors || []),
    ].slice(0, 10) // Limit to 10 errors

    if (allErrors.length === 0) {
      toast.info('No runtime errors found — the app looks healthy!')
      return
    }

    setAutoFixing(true)
    toast.info(`Auto-fixing ${allErrors.length} runtime error(s)...`)

    // Build error list with stack traces for better LLM context
    const errorList = allErrors.map((e, i) => {
      const stack = e.stack ? `\n  Stack: ${e.stack.slice(0, 300)}` : ''
      return `${i + 1}. [${e.type}]: ${e.msg}${stack}`
    }).join('\n')

    const fixMessage = `Fix these runtime errors:\n${errorList}\n\nThe app must work without these errors. Fix the root cause, not just the symptom. Test each fix mentally before writing it.`

    refineAbortRef.current?.abort()
    const controller = new AbortController()
    refineAbortRef.current = controller
    setLivePreviewHtml(null)
    livePreviewAccumulatorRef.current = ''
    setRuntimeErrors([])

    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
          mission: currentResult.mission,
          html: currentResult.html,
          message: fixMessage,
          theme: selectedTheme,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`
        try { const e = await res.json(); if (e?.error) errorMsg = e.error } catch {}
        toast.error(errorMsg)
        return
      }

      const refineCt = res.headers.get('content-type') ?? ''
      if (!refineCt.includes('text/event-stream')) {
        toast.error('Unexpected response from server')
        return
      }

      // Read SSE stream (same pattern as sendChat)
      const reader = res.body?.getReader()
      if (!reader) { toast.error('No stream'); return }
      const decoder = new TextDecoder()
      let buffer = ''
      let finalHtml = ''
      let finalTokens = 0
      let finalMs = 0
      let finalQuality = 0
      let finalMetrics = ''
      let streamError: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const normalized = buffer.replace(/\r\n/g, '\n')
        const events = normalized.split('\n\n')
        buffer = events.pop() ?? ''
        for (const eventStr of events) {
          const dataLine = eventStr.trim()
          if (!dataLine.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.type === 'token') {
              livePreviewAccumulatorRef.current = (livePreviewAccumulatorRef.current || '') + (evt.text ?? '')
            } else if (evt.type === 'result') {
              finalHtml = evt.html ?? ''
              finalTokens = evt.tokens ?? 0
              finalMs = evt.ms ?? 0
              finalQuality = evt.quality ?? 0
              finalMetrics = evt.metrics ?? ''
            } else if (evt.type === 'error') {
              streamError = evt.error ?? 'Unknown error'
            }
          } catch {}
        }
      }

      // Flush decoder
      buffer += decoder.decode()
      if (buffer.trim()) {
        const normalized = buffer.replace(/\r\n/g, '\n')
        const events = normalized.split('\n\n')
        for (const eventStr of events) {
          const dataLine = eventStr.trim()
          if (!dataLine.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.type === 'result') {
              finalHtml = evt.html ?? ''
              finalTokens = evt.tokens ?? 0
              finalMs = evt.ms ?? 0
              finalQuality = evt.quality ?? 0
              finalMetrics = evt.metrics ?? ''
            } else if (evt.type === 'error') {
              streamError = evt.error ?? 'Unknown error'
            }
          } catch {}
        }
      }

      if (streamError) {
        toast.error(streamError)
        return
      }

      if (!finalHtml) {
        toast.error('Auto-fix returned empty response')
        return
      }

      const fixedResult: BuildResult = {
        ...currentResult,
        id: newBuildId(),
        html: finalHtml,
        tokens: finalTokens,
        ms: finalMs,
      }
      setResult(fixedResult)
      resultRef.current = fixedResult
      addBuildToHistory(fixedResult)
      setQualityScore(finalQuality)
      setQualityMetrics(finalMetrics)
      setProbeResult(null) // Force re-probe
      toast.success(`Fixed! ${finalMs ? `${(finalMs / 1000).toFixed(1)}s` : ''} · quality: ${finalQuality}`)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const failMsg = err instanceof Error ? err.message : 'Network error'
      toast.error(failMsg)
    } finally {
      if (refineAbortRef.current === controller) {
        refineAbortRef.current = null
        setAutoFixing(false)
        setLivePreviewHtml(null)
      }
    }
  }, [runtimeErrors, probeResult, autoFixing])

  // ═══ MULTI-ITERATION AUTO-FIX LOOP ═══
  // Runs autoFix up to 3 times, re-probing after each fix.
  // Stops when: no errors found, OR 3 iterations reached.
  // This is NOVA's "agent loop" — bounded but effective.
  const [autoFixIterations, setAutoFixIterations] = useState(0)
  const [autoFixLoopRunning, setAutoFixLoopRunning] = useState(false)

  const autoFixLoop = useCallback(async (maxIterations: number = 3) => {
    const currentResult = resultRef.current
    if (!currentResult || autoFixLoopRunning) return

    setAutoFixLoopRunning(true)
    setAutoFixIterations(0)

    for (let i = 0; i < maxIterations; i++) {
      setAutoFixIterations(i + 1)
      const current = resultRef.current
      if (!current) break

      // Step 1: Run probe to find current errors
      const isGame = /game|snake|tetris|arcade|puzzle/i.test(current.mission)
      let probe: ProbeResult
      try {
        probe = await probeApp(current.html, isGame)
      } catch {
        break // Probe failed, can't continue
      }

      // Collect all errors
      const allErrors = [
        ...runtimeErrors,
        ...probe.errors,
      ].slice(0, 10)

      // Step 2: If no errors, we're done!
      if (allErrors.length === 0) {
        toast.success(`All bugs fixed! (${i} iteration${i !== 1 ? 's' : ''})`)
        break
      }

      // Step 3: Send errors to LLM for fixing
      toast.info(`Fixing iteration ${i + 1}/${maxIterations}: ${allErrors.length} error(s)...`)

      const errorList = allErrors.map((e, idx) => {
        const stack = e.stack ? `\n  Stack: ${e.stack.slice(0, 300)}` : ''
        return `${idx + 1}. [${e.type}]: ${e.msg}${stack}`
      }).join('\n')

      const fixMessage = `Fix these runtime errors (iteration ${i + 1}):\n${errorList}\n\nThe app must work without these errors. Fix the root cause.`

      const controller = new AbortController()
      refineAbortRef.current = controller

      try {
        const res = await fetch('/api/refine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify({
            mission: current.mission,
            html: current.html,
            message: fixMessage,
            theme: selectedTheme,
          }),
          signal: controller.signal,
        })

        if (!res.ok) break

        // Read SSE stream (simplified — just get the result)
        const reader = res.body?.getReader()
        if (!reader) break
        const decoder = new TextDecoder()
        let buffer = ''
        let finalHtml = ''
        let finalTokens = 0
        let finalMs = 0
        let finalQuality = 0
        let finalMetrics = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.replace(/\r\n/g, '\n').split('\n\n')
          buffer = events.pop() ?? ''
          for (const eventStr of events) {
            const dataLine = eventStr.trim()
            if (!dataLine.startsWith('data: ')) continue
            try {
              const evt = JSON.parse(dataLine.slice(6))
              if (evt.type === 'result') {
                finalHtml = evt.html ?? ''
                finalTokens = evt.tokens ?? 0
                finalMs = evt.ms ?? 0
                finalQuality = evt.quality ?? 0
                finalMetrics = evt.metrics ?? ''
              }
            } catch {}
          }
        }

        if (!finalHtml) break

        // Update result
        const fixedResult: BuildResult = {
          ...current,
          id: newBuildId(),
          html: finalHtml,
          tokens: finalTokens,
          ms: finalMs,
        }
        setResult(fixedResult)
        resultRef.current = fixedResult
        addBuildToHistory(fixedResult)
        setQualityScore(finalQuality)
        setQualityMetrics(finalMetrics)
        setProbeResult(null) // Force re-probe
        setRuntimeErrors([])

        // Wait for probe to run on new result
        await new Promise(resolve => setTimeout(resolve, 2000))

      } catch {
        break // Network error, stop the loop
      }
    }

    // Final status
    const finalResult = resultRef.current
    if (finalResult) {
      const isGame = /game|snake|tetris|arcade|puzzle/i.test(finalResult.mission)
      try {
        const finalProbe = await probeApp(finalResult.html, isGame)
        setProbeResult({ ...finalProbe, summary: `${finalResult.id} ${finalProbe.summary}` })
        if (finalProbe.errors.length === 0) {
          toast.success('Auto-fix complete — no errors remaining!')
        } else {
          toast.warning(`Auto-fix complete — ${finalProbe.errors.length} error(s) still remain after ${maxIterations} iterations`)
        }
      } catch {}
    }

    setAutoFixLoopRunning(false)
    setAutoFixIterations(0)
  }, [runtimeErrors, autoFixLoopRunning])

  const reset = useCallback(() => {
    // Reset clears everything — used by the "New" button.
    // Abort BOTH in-flight build and refine to prevent phantom state mutations.
    abortRef.current?.abort()
    abortRef.current = null
    refineAbortRef.current?.abort()
    refineAbortRef.current = null
    setLoading(false)
    setRefining(false)
    setResult(null)
    setError(null)
    setFailedMission(null)
    setMission('')
    setChatMessages([])
    setQualityScore(0)
    setQualityMetrics('')
    setLivePreviewHtml(null)
    setPlanSummary(null)
    setConfirmClear(false)
    // v4: Reset new state for build-memory, error analysis, diff, and pipeline
    setMemoryHit(false)
    setErrorAnalysis(null)
    setShowDiff(false)
    setPreviousBuild(null)
    setPipelineStage(null)
    setPipelineLiveText('')
    pipelineLiveTextRef.current = ''
    setSimilarBuilds([])
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
    // Delay revocation — Safari <16 and Firefox with large blobs read asynchronously.
    // Revoking immediately can produce 0-byte files.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`Downloaded ${filename}`)
  }, [result])

  // Copy HTML to clipboard
  const copyHtml = useCallback(async () => {
    if (!result?.html) return
    // Check if clipboard API is available (requires HTTPS or localhost)
    if (!navigator.clipboard) {
      toast.error('Clipboard requires HTTPS — try Download instead')
      return
    }
    try {
      await navigator.clipboard.writeText(result.html)
      toast.success('HTML copied to clipboard')
    } catch {
      toast.error('Failed to copy — try downloading instead')
    }
  }, [result])

  // Open the HTML in a new browser tab (full-screen preview)
  const openInNewTab = useCallback(() => {
    if (!result?.html) return
    const blob = new Blob([result.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    if (!w) {
      // Popup blocker fired — tell the user instead of silently failing
      toast.error('Popup blocked — allow popups for this site')
      URL.revokeObjectURL(url)
      return
    }
    // Revoke after 5min — enough time for the tab to load and be reloaded
    setTimeout(() => URL.revokeObjectURL(url), 300_000)
    toast.info('Opened in new tab')
  }, [result])

  // Chat refine: SSE streaming — same pattern as build/code
  const sendChat = useCallback(async () => {
    const msg = chatInput.trim()
    const currentResult = resultRef.current
    // Guard against both refining AND loading — defensive (UI also disables, but future
    // refactors might remove the disabled attribute and this prevents a race).
    if (!msg || refining || loading) return
    if (!currentResult) {
      toast.info('Build something first, then you can refine it')
      return
    }

    const userMsg: ChatMessage = { role: 'user', content: msg, ts: Date.now() }
    setChatMessages(prev => [...prev, userMsg])
    // Don't clear chatInput yet — clear it only after the refine succeeds.
    // If the refine fails, we restore the input so the user doesn't lose their message.
    setRefining(true)

    refineAbortRef.current?.abort()
    const controller = new AbortController()
    refineAbortRef.current = controller

    // Clear live preview so refine starts fresh
    setLivePreviewHtml(null)
    livePreviewAccumulatorRef.current = '' // Clear accumulator for fresh refine

    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ mission: currentResult.mission, html: currentResult.html, message: msg, theme: selectedTheme }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let errorMsg = `Server error (${res.status})`
        try { const e = await res.json(); if (e?.error) errorMsg = e.error } catch {}
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMsg}`, ts: Date.now() }])
        toast.error(errorMsg)
        return
      }

      // Verify the response is actually SSE — a proxy or CDN might return 200 with HTML
      const refineCt = res.headers.get('content-type') ?? ''
      if (!refineCt.includes('text/event-stream')) {
        let errorMsg = 'Unexpected response from server'
        try { const e = await res.json(); if (e?.error) errorMsg = e.error } catch {}
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMsg}`, ts: Date.now() }])
        toast.error(errorMsg)
        return
      }

      // Read SSE stream
      const reader = res.body?.getReader()
      if (!reader) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error: No stream', ts: Date.now() }])
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let finalHtml = ''
      let finalTokens = 0
      let finalMs = 0
      let finalQuality = 0
      let finalMetrics = ''
      let streamError: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // Normalize \r\n to \n for proxy compatibility, then split on \n\n
        const normalized = buffer.replace(/\r\n/g, '\n')
        const events = normalized.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventStr of events) {
          const dataLine = eventStr.trim()
          if (!dataLine.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.type === 'token') {
              // Live token streaming — accumulate in ref for throttled flush (same as build)
              livePreviewAccumulatorRef.current = (livePreviewAccumulatorRef.current || '') + (evt.text ?? '')
            } else if (evt.type === 'result') {
              finalHtml = evt.html ?? ''
              finalTokens = evt.tokens ?? 0
              finalMs = evt.ms ?? 0
              finalQuality = evt.quality ?? 0
              finalMetrics = evt.metrics ?? ''
            } else if (evt.type === 'error') {
              streamError = evt.error ?? 'Unknown error'
            }
          } catch {}
        }
      }

      // Flush the decoder — any remaining bytes (incomplete multi-byte chars)
      buffer += decoder.decode()
      // Process any remaining complete event in the buffer
      if (buffer.trim()) {
        const normalized = buffer.replace(/\r\n/g, '\n')
        const events = normalized.split('\n\n')
        for (const eventStr of events) {
          const dataLine = eventStr.trim()
          if (!dataLine.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(dataLine.slice(6))
            if (evt.type === 'token') {
              livePreviewAccumulatorRef.current = (livePreviewAccumulatorRef.current || '') + (evt.text ?? '')
            } else if (evt.type === 'result') {
              finalHtml = evt.html ?? ''
              finalTokens = evt.tokens ?? 0
              finalMs = evt.ms ?? 0
              finalQuality = evt.quality ?? 0
              finalMetrics = evt.metrics ?? ''
            } else if (evt.type === 'error') {
              streamError = evt.error ?? 'Unknown error'
            }
          } catch {}
        }
      }

      if (streamError) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${streamError}`, ts: Date.now() }])
        toast.error(streamError)
        return
      }

      if (!finalHtml) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: 'Error: Empty response', ts: Date.now() }])
        return
      }

      const refinedResult: BuildResult = {
        ...currentResult,
        id: newBuildId(),
        html: finalHtml,
        tokens: finalTokens, // Update tokens so the header shows the refine's token count
        ms: finalMs,         // Update ms so the header shows the refine's time
      }
      setResult(refinedResult)
      resultRef.current = refinedResult // Update ref synchronously
      addBuildToHistory(refinedResult)

      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Updated! ${finalMs ? `${(finalMs / 1000).toFixed(1)}s` : ''} · ${finalTokens} tokens`,
        ts: Date.now(),
      }])

      toast.success(`Refined! ${(finalMs / 1000).toFixed(1)}s · quality: ${finalQuality}`)
      setQualityScore(finalQuality)
      setQualityMetrics(finalMetrics)
      setChatInput('') // Clear input only after success
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const failMsg = err instanceof Error ? err.message : 'Network error'
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${failMsg}`, ts: Date.now() }])
      toast.error(failMsg)
      // Restore the user's message so they can edit and retry — don't lose their input on error
      setChatInput(msg)
    } finally {
      if (refineAbortRef.current === controller) {
        refineAbortRef.current = null
        setRefining(false)
        setLivePreviewHtml(null) // clear live preview so final result shows
      }
    }
  }, [chatInput, refining])

  // Auto-scroll chat to bottom on new messages — but only if user is already near the bottom.
  // Don't yank the scroll position if the user scrolled up to read history.
  useEffect(() => {
    const el = chatScrollRef.current
    if (!el) return
    // If user is within 40px of the bottom, auto-scroll. Otherwise, leave them where they are.
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [chatMessages, refining])

  // Keyboard shortcuts: Esc=cancel build/refine, ⌘S/Ctrl+S=download, ⌘N/Ctrl+N=new
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc cancels a build or refine — but NOT when the user is focused in a text field.
      // In text fields, Esc should clear the field (standard behavior), not cancel the build.
      if (e.key === 'Escape' && (loading || refining)) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (isTextField) return // Let the text field handle Esc (clear input)

        e.preventDefault()
        if (loading) {
          cancelBuild()
          toast.info('Build cancelled')
        } else if (refining) {
          cancelRefine()
          toast.info('Refine cancelled')
        }
        return
      }
      // ⌘S / Ctrl+S downloads the current result — only preventDefault when we have a result
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        if (result) {
          e.preventDefault()
          download()
        }
        return
      }
      // ⌘N / Ctrl+N starts a new build — only preventDefault when we'll actually handle it
      // (don't block the browser's new-window shortcut during loading/refining)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !loading && !refining) {
        e.preventDefault()
        reset()
        return
      }
      // ? shows keyboard shortcuts help panel (only when not typing in a text field)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField) {
          e.preventDefault()
          setShowShortcuts(prev => !prev)
          return
        }
      }
      // Escape closes shortcuts panel if open
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, refining, result, download, cancelBuild, cancelRefine, reset, showShortcuts])

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

  // Current build stage (stolen from TFA's StageRail concept)
  const currentStage = loading || refining
    ? getCurrentStage(elapsed, !!planSummary, !!livePreviewHtml, false)
    : result
      ? BUILD_STAGES[6]
      : BUILD_STAGES[0]

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground" aria-busy={loading || refining}>
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
        <div className="flex items-center gap-3">
          {/* v3: Theme selector — always visible, not just in showExamples */}
          <div className="flex items-center gap-1">
            <Palette className="h-3 w-3 text-muted-foreground/60" />
            <div className="flex items-center gap-0.5">
              {THEMES.map((theme) => (
                <button
                  key={theme.name}
                  type="button"
                  onClick={() => {
                    setSelectedTheme(theme.name)
                    try { localStorage.setItem('nova_theme', theme.name) } catch {}
                    toast.info(`Theme: ${theme.name}`)
                  }}
                  className={`h-4 w-4 rounded-full border transition-transform hover:scale-125 ${
                    selectedTheme === theme.name ? 'border-primary ring-1 ring-primary/30' : 'border-border/40'
                  }`}
                  style={{ background: theme.colors.bg }}
                  title={`${theme.name} theme — bg: ${theme.colors.bg}, primary: ${theme.colors.primary}`}
                  aria-label={`Select ${theme.name} theme`}
                />
              ))}
            </div>
          </div>
          {/* v10: Dark/light mode toggle for NOVA UI */}
          <ThemeToggle />
          {/* v4: Build-memory badge — shown when the current result was restored from IndexedDB */}
          {memoryHit && result && (
            <span
              className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400"
              title="This build was restored from local memory (IndexedDB) — no LLM call was made"
            >
              <Zap className="h-3 w-3" />
              memory
            </span>
          )}
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
                <span>{(result.ms / 1000).toFixed(1)}s · {formatTokens(result.tokens)} tokens</span>
                {qualityScore > 0 && (
                  <span className={`ml-1 rounded px-1 ${qualityScore >= 70 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`} title={qualityMetrics}>
                    Q:{qualityScore}
                  </span>
                )}
              </>
            )}
          </div>
        )}
        </div>
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
            // autoFocus only on desktop via useEffect (see missionInputRef).
            // On mobile, autoFocus pops the on-screen keyboard on load — annoying.
            autoFocus={false}
            value={mission}
            maxLength={2000}
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
            <span className={`text-[10px] ${mission.length > 2000 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
              {mission.length}/2000
            </span>
          </div>
          <Button
            onClick={() => build()}
            disabled={loading || refining || !mission.trim()}
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

          {/* First-build loading (no prior result) — with StageRail stolen from TFA */}
          {loading && !result && (
            <div role="status" aria-live="polite" className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span className="font-medium text-foreground/80">
                  {getThinkingText()}
                </span>
              </div>
              {/* StageRail — visual progress bar (stolen from TFA Evolution Studio) */}
              <div className="mt-3 flex items-center">
                {BUILD_STAGES.map((stage, i) => {
                  const done = i < BUILD_STAGES.indexOf(currentStage)
                  const active = stage.key === currentStage.key
                  const color = done || active ? 'bg-primary' : 'bg-muted-foreground/20'
                  return (
                    <div key={stage.key} className="flex flex-1 items-center">
                      {i > 0 && <div className={`h-0.5 flex-1 ${done ? 'bg-primary' : 'bg-muted-foreground/20'}`} />}
                      <div className={`h-2.5 w-2.5 rounded-full ${color} ${active ? 'ring-2 ring-primary/30' : ''}`} title={stage.label} />
                      {i < BUILD_STAGES.length - 1 && <div className={`h-0.5 flex-1 ${done ? 'bg-primary' : 'bg-muted-foreground/20'}`} />}
                    </div>
                  )
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-[8px] text-muted-foreground/50">
                {BUILD_STAGES.map(s => <span key={s.key}>{s.short}</span>)}
              </div>
              <div className="mt-2 flex items-center gap-2 pl-0">
                <span className="text-[10px] text-muted-foreground/50">
                  {elapsed > 0 && `${elapsed}s`}
                  {elapsed > 60 && ' · taking longer than expected'}
                  {planSummary && ` · ${planSummary}`}
                  {livePreviewHtml && ` · ${livePreviewHtml.length} chars generated`}
                </span>
              </div>
              {/* v4: PipelineProgress — richer stage indicator with live token text */}
              {pipelineStage && (
                <div className="mt-2 rounded-md border border-border/40 bg-card/30 p-2">
                  <PipelineProgress
                    currentStage={pipelineStage}
                    liveText={pipelineLiveText}
                    elapsedSeconds={elapsed}
                    mode="full"
                  />
                </div>
              )}
            </div>
          )}

          {/* First-build error (no prior result) */}
          {showFirstError && (
            <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  {/* v4: Structured error analysis — title + message + suggestions + related missions */}
                  {errorAnalysis ? (
                    <>
                      <p className="text-xs font-semibold text-destructive">{errorAnalysis.title}</p>
                      <p className="mt-0.5 text-[11px] text-destructive/80">{errorAnalysis.message}</p>
                      {errorAnalysis.suggestions.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {errorAnalysis.suggestions.map((s, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                              <span className="mt-px text-muted-foreground/50">•</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {/* "Try instead" — related missions the user might have better luck with */}
                      {(() => {
                        const related = suggestRelatedMissions(failedMission ?? mission)
                        if (related.length === 0) return null
                        return (
                          <div className="mt-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Try instead</p>
                            <div className="mt-1 space-y-1">
                              {related.map((rel, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => build(rel)}
                                  className="block w-full rounded border border-border/40 bg-card/40 px-2 py-1 text-left text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                                >
                                  {rel}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  ) : (
                    <p className="text-xs text-destructive">{error}</p>
                  )}
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

              {/* v4: Similar builds from IndexedDB memory — shown when the user types something
                  that matches past builds (by word overlap). Helps discover cached builds. */}
              {similarBuilds.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-400/80">
                    <Zap className="h-3 w-3" />
                    ⚡ Similar builds from memory
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {similarBuilds.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => loadFromHistory(b)}
                        className="block w-full rounded border border-border/40 bg-card/40 px-2 py-1 text-left text-[10px] text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-foreground"
                        title={`Cached ${new Date(b.timestamp).toLocaleString()} · quality ${b.quality}`}
                      >
                        <span className="truncate">{b.mission}</span>
                        {b.quality > 0 && (
                          <span className="ml-1 text-amber-400/60">Q:{b.quality}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Theme selector is now in the header — always visible */}

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
                  disabled={loading || refining}
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
                      historyRef.current = [] // Sync ref so addBuildToHistory doesn't use stale data
                      try { localStorage.removeItem('nova_history') } catch {}
                      setConfirmClear(false)
                      toast.success('History cleared')
                    }}
                    disabled={loading || refining}
                    className="flex-1 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/20 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    disabled={loading || refining}
                    className="flex-1 rounded border border-border/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  disabled={loading || refining}
                  className="block w-full px-3 py-1 text-left text-[10px] text-muted-foreground/50 hover:text-destructive disabled:opacity-50"
                >
                  Clear history
                </button>
              )}
            </div>
          )}
        </section>

        {/* Right panel: preview — shown when there's a result OR a build/refine in progress.
            This is critical for first build: without this, the live-preview iframe (NOVA's
            breakthrough feature) doesn't render at all until the build completes. */}
        {(result || loading) && (
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
                  {loading && !result ? 'Building...' : loading ? 'Rebuilding...' : refining ? 'Refining...' : result?.mission ?? ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* Responsive preview toggle */}
                <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewWidth('full')}
                    className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${previewWidth === 'full' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Full width"
                    aria-label="Full width preview"
                  >Full</button>
                  <button
                    type="button"
                    onClick={() => setPreviewWidth('desktop')}
                    className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${previewWidth === 'desktop' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Desktop (1280px)"
                    aria-label="Desktop width preview"
                  >D</button>
                  <button
                    type="button"
                    onClick={() => setPreviewWidth('tablet')}
                    className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${previewWidth === 'tablet' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Tablet (768px)"
                    aria-label="Tablet width preview"
                  >T</button>
                  <button
                    type="button"
                    onClick={() => setPreviewWidth('mobile')}
                    className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${previewWidth === 'mobile' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Mobile (375px)"
                    aria-label="Mobile width preview"
                  >M</button>
                </div>
                {qualityScore > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCodeAnalysis(!showCodeAnalysis)}
                    className={`rounded-md px-2 py-1 text-[10px] transition-colors ${showCodeAnalysis ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Toggle code analysis"
                  >
                    Q:{qualityScore}
                  </button>
                )}
                {/* v3: Runtime errors badge — red if errors found, green if clean */}
                {result && !loading && !refining && (
                  <button
                    type="button"
                    onClick={() => setShowRuntimeErrors(!showRuntimeErrors)}
                    className={`rounded-md px-2 py-1 text-[10px] flex items-center gap-1 transition-colors ${
                      runtimeErrors.length > 0 || (probeResult && probeResult.errors.length > 0)
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                    }`}
                    title={runtimeErrors.length > 0 || (probeResult && probeResult.errors.length > 0)
                      ? `${runtimeErrors.length + (probeResult?.errors.length || 0)} runtime error(s) found — click to view`
                      : 'No runtime errors detected'
                    }
                  >
                    {runtimeErrors.length > 0 || (probeResult && probeResult.errors.length > 0) ? (
                      <><Bug className="h-3 w-3" />{runtimeErrors.length + (probeResult?.errors.length || 0)}</>
                    ) : (
                      <><CheckCircle2 className="h-3 w-3" /></>
                    )}
                  </button>
                )}
                {/* v3: Auto-fix button — appears when runtime errors are found */}
                {result && !loading && !refining && !autoFixing && (runtimeErrors.length > 0 || (probeResult && probeResult.errors.length > 0)) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs text-amber-400 hover:bg-amber-500/10"
                    onClick={() => autoFixLoop()}
                    title="Automatically fix runtime errors using AI"
                  >
                    <Bug className="h-3.5 w-3.5" />
                    Auto-fix
                  </Button>
                )}
                {(autoFixing || autoFixLoopRunning) && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {autoFixLoopRunning ? `Fixing (${autoFixIterations}/3)...` : 'Fixing...'}
                  </span>
                )}
                {/* v4: Diff viewer toggle — compare current build against the previous one.
                    Visible only when both previousBuild and result exist, and not loading/refining. */}
                {previousBuild && result && !loading && !refining && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-7 gap-1.5 text-xs ${showDiff ? 'bg-primary/20 text-primary' : ''}`}
                    onClick={() => setShowDiff(!showDiff)}
                    title={showDiff ? 'Hide diff' : 'Compare with previous build'}
                  >
                    <GitCompare className="h-3.5 w-3.5" />
                    Diff
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={copyHtml} disabled={!result || loading} title="Copy HTML to clipboard">
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={openInNewTab} disabled={!result || loading} title="Open in new tab">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={download} disabled={!result} title="Download HTML file">
                  <Download className="h-3.5 w-3.5" />
                  Download
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => build()} disabled={loading || refining} title="Rebuild from scratch">
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Rebuild
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={loading ? cancelBuild : refining ? cancelRefine : reset} title={loading ? 'Cancel build' : refining ? 'Cancel refine' : 'Start new'}>
                  {(loading || refining) ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {(loading || refining) ? 'Cancel' : 'New'}
                </Button>
              </div>
            </div>

            {/* Chat panel */}
            <div className="flex shrink-0 flex-col border-b border-border/40 max-h-[200px]">
              {/* Chat messages — role=log + aria-live so screen readers announce new messages */}
              <div ref={chatScrollRef} role="log" aria-live="polite" aria-atomic="false" className="max-h-[120px] overflow-y-auto px-4 py-2">
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
                  maxLength={2000}
                  className="flex-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none disabled:opacity-50"
                />
                <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={sendChat} disabled={refining || loading || !chatInput.trim()}>
                  {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            {/* v3: Runtime errors panel — shows runtime errors with auto-fix option */}
            {showRuntimeErrors && result && (
              <div className="shrink-0 border-b border-border/40 bg-card/20 px-4 py-2 max-h-[200px] overflow-y-auto">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Runtime Errors</p>
                  {runtimeErrors.length > 0 || (probeResult && probeResult.errors.length > 0) ? (
                    <button
                      type="button"
                      onClick={() => autoFixLoop()}
                      disabled={autoFixing || autoFixLoopRunning || loading || refining}
                      className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
                    >
                      {(autoFixing || autoFixLoopRunning) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bug className="h-3 w-3" />}
                      {autoFixLoopRunning ? `Fixing (${autoFixIterations}/3)...` : (autoFixing ? 'Fixing...' : 'Auto-fix all (3 iterations)')}
                    </button>
                  ) : null}
                </div>
                {runtimeErrors.length === 0 && (!probeResult || probeResult.errors.length === 0) ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>No runtime errors detected. The app runs cleanly.</span>
                    </div>
                    {probeResult && (
                      <div className="space-y-1 text-[10px] text-muted-foreground/60">
                        <span>{probeResult.buttonsClicked} buttons clicked, {probeResult.inputsTested} inputs tested{probeResult.gameKeysDispatched ? ', arrow keys dispatched' : ''}</span>
                        {probeResult.stateChanges && probeResult.stateChanges.length > 0 ? (
                          <div className="mt-1 space-y-0.5">
                            <span className="text-emerald-400/80">State changes detected (features working):</span>
                            {probeResult.stateChanges.map((sc, i) => (
                              <div key={i} className="pl-3 text-[10px]">
                                <span className="text-muted-foreground">{sc.selector}:</span>{' '}
                                <span className="text-foreground/60">"{sc.before}"</span>{' → '}{/* eslint-disable-line */}
                                <span className="text-emerald-400/80">"{sc.after}"</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-amber-400/60">No state changes detected — buttons may not be wired up correctly.</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {/* Live runtime errors from postMessage */}
                    {runtimeErrors.map((err, i) => (
                      <div key={`live-${i}`} className="flex items-start gap-2 text-[11px]">
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                        <div className="min-w-0 flex-1">
                          <span className="text-red-400">[{err.type}]</span>
                          {err.line > 0 && <span className="text-muted-foreground"> line {err.line}:{err.col}</span>}
                          <span className="text-foreground/80"> {err.msg}</span>
                        </div>
                      </div>
                    ))}
                    {/* Probe errors (from interaction testing) */}
                    {probeResult?.errors.map((err, i) => (
                      <div key={`probe-${i}`} className="flex items-start gap-2 text-[11px]">
                        <Bug className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <span className="text-amber-400">[{err.type}]</span>
                          {err.line > 0 && <span className="text-muted-foreground"> line {err.line}:{err.col}</span>}
                          <span className="text-foreground/80"> {err.msg}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Code analysis panel — collapsible, shows quality metrics breakdown */}
            {showCodeAnalysis && qualityMetrics && (
              <div className="shrink-0 border-b border-border/40 bg-card/20 px-4 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Code Analysis</p>
                <p className="text-[11px] text-muted-foreground font-mono">{qualityMetrics}</p>
                {qualityScore > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
                      <div
                        className={`h-full transition-all ${qualityScore >= 70 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${qualityScore}%` }}
                      />
                    </div>
                    <span className={`text-[10px] font-mono ${qualityScore >= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {qualityScore}/100
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Preview iframe — single iframe handles both live preview and final result.
                During build/refine, srcDoc shows livePreviewHtml (partial HTML as tokens arrive).
                When idle, srcDoc shows the final result.html.
                bg-neutral-950 prevents white flash before the LLM's CSS loads.
                The preview wrapper centers the iframe when a specific width is selected.

                v4: Wrapped in PreviewErrorBoundary so render crashes don't white-screen the app.
                v4: If result.previewable === false and files exist, show FileViewer instead of iframe.
                v4: If showDiff is true and previousBuild exists, show DiffViewer instead of iframe. */}
            <PreviewErrorBoundary className="min-h-0 flex-1">
              <div className="relative min-h-0 flex-1 bg-neutral-950 overflow-auto">
                {/* Loading overlay (shown when building/refining and no live preview yet) */}
                {(loading || refining) && (!livePreviewHtml || livePreviewHtml.length <= 50) && (
                  <div role="status" aria-live="polite" className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/80 backdrop-blur-sm">
                    <div className="flex w-full max-w-md flex-col items-center gap-3 px-6 text-neutral-400">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-xs font-medium text-foreground/80">
                        {getThinkingText()}
                      </p>
                      {/* v4: PipelineProgress — visual stage indicator (Plan → Code → Analyze → Validate → Done) */}
                      {pipelineStage && (
                        <div className="w-full rounded-md border border-border/40 bg-card/30 p-2">
                          <PipelineProgress
                            currentStage={pipelineStage}
                            liveText={pipelineLiveText}
                            elapsedSeconds={elapsed}
                            mode="full"
                          />
                        </div>
                      )}
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
                {/* v4: DiffViewer — show before/after comparison instead of the iframe.
                    Only when showDiff is true AND we have both previous and current builds. */}
                {showDiff && previousBuild && result ? (
                  <div className="h-full min-h-[400px] p-2">
                    <DiffViewer
                      oldText={previousBuild.html}
                      newText={result.html}
                      title={`Diff: ${previousBuild.mission.slice(0, 40)} → ${result.mission.slice(0, 40)}`}
                      className="h-full"
                    />
                  </div>
                ) : result && result.previewable === false && result.files && result.files.length > 0 ? (
                  /* v4: FileViewer — multi-file output (React/Python/Node) can't be previewed in iframe */
                  <div className="h-full min-h-[400px] p-2">
                    <FileViewer
                      files={result.files}
                      title={result.outputType ? `Files · ${result.outputType}` : 'Files'}
                      className="h-full"
                    />
                  </div>
                ) : (
                  /* Responsive preview wrapper — centers iframe when a specific width is selected */
                  <div className={`flex min-h-full ${previewWidth === 'full' ? 'w-full' : 'justify-center pt-4 pb-4'}`}>
                    <iframe
                      key={result?.id ?? 'loading'}
                      srcDoc={(loading || refining) && livePreviewHtml
                        ? injectCsp(livePreviewHtml)
                        : (result && result.files && result.files.length > 1
                            ? injectCsp(inlineForPreview(result.files))
                            : (result?.html ?? ''))}
                      title="Preview"
                      sandbox="allow-scripts"
                      className={`h-full border-0 bg-neutral-950 transition-all ${
                        previewWidth === 'full' ? 'w-full' :
                        previewWidth === 'desktop' ? 'w-[1280px] max-w-full' :
                        previewWidth === 'tablet' ? 'w-[768px] max-w-full' :
                        'w-[375px] max-w-full'
                      }`}
                      style={previewWidth !== 'full' ? { minHeight: 'calc(100% - 2rem)' } : undefined}
                    />
                  </div>
                )}
              </div>
            </PreviewErrorBoundary>
          </section>
        )}
      </main>

      {/* Keyboard shortcuts help panel — press ? to toggle */}
      {showShortcuts && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border/40 bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close shortcuts"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              {[
                { keys: ['⌘', 'Enter'], label: 'Build the app' },
                { keys: ['⌘', 'S'], label: 'Download HTML file' },
                { keys: ['⌘', 'N'], label: 'Start a new build' },
                { keys: ['Esc'], label: 'Cancel build/refine' },
                { keys: ['?'], label: 'Show/hide this help' },
              ].map((shortcut) => (
                <div key={shortcut.label} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{shortcut.label}</span>
                  <div className="flex gap-1">
                    {shortcut.keys.map((k) => (
                      <kbd key={k} className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-auto shrink-0 border-t border-border/40 px-4 py-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>NOVA · prompt-to-app</span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border/40 px-1">⌘+Enter</kbd> build ·
            <kbd className="ml-1 rounded border border-border/40 px-1">⌘+S</kbd> download ·
            <kbd className="ml-1 rounded border border-border/40 px-1">⌘+N</kbd> new ·
            <kbd className="ml-1 rounded border border-border/40 px-1">Esc</kbd> cancel ·
            <kbd className="ml-1 rounded border border-border/40 px-1">?</kbd> help
          </span>
          <span className="sm:hidden">⌘+Enter to build</span>
        </div>
      </footer>
    </div>
  )
}
