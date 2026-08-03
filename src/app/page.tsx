'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles, Play, Loader2, Download, RotateCcw, AlertCircle, Zap, X, RefreshCw, Plus, Send, MessageSquare, Copy, ExternalLink, Bug, CheckCircle2, XCircle, GitCompare, Share2, GitBranch, Maximize2, Wand2, Check, Undo2, BarChart3, Bookmark, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { newBuildId, sanitizeFilename, validateHistory, normalizeMission, groupHistoryByMission, type BuildResult } from '@/lib/helpers'
import { analyzeMission } from '@/lib/mission-analysis'
import { calculateBuildHealth } from '@/lib/build-health'
import { compareBuilds } from '@/lib/build-comparison'
import { loadBuildStats, saveBuildStats, recordBuildInStats, recordRefineInStats, formatStats, type BuildStats } from '@/lib/build-stats'
import { loadTemplates, addTemplate, deleteTemplate, markTemplateUsed, type PromptTemplate } from '@/lib/prompt-templates'
import { extractStepsFromMission, extractStepsFromPlan, getPlanSummary } from '@/lib/build-steps'
import { formatTokens } from '@/lib/format'
import { injectCsp } from '@/lib/html-utils'
import { probeApp, type ProbeResult } from '@/lib/interaction-probe'
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
// v11: Categorized starter prompts — each category has an icon (emoji) + prompts.
// Used by the empty-state grid. Flat EXAMPLES kept for backward compat (tests).
const STARTER_CATEGORIES: readonly { icon: string; label: string; prompts: readonly string[] }[] = [
  {
    icon: '📊',
    label: 'Dashboards',
    prompts: [
      'Build a crypto trading dashboard with live charts, order book, and portfolio tracker',
      'Build a banking dashboard with accounts, transfers, transaction history, and analytics',
      'Build a data visualization dashboard with real-time charts, filters, and KPIs',
    ],
  },
  {
    icon: '🎮',
    label: 'Games',
    prompts: [
      'Build a snake game with score tracking, increasing speed, and mobile swipe controls',
      'Build a 2048 puzzle game with smooth tile animations and undo',
      'Build a memory card matching game with a flip animation and timer',
    ],
  },
  {
    icon: '🎨',
    label: 'Creative',
    prompts: [
      'Build a music production studio with multi-track sequencer, effects, and mixer',
      'Build a pixel art editor with color palette, undo/redo, and PNG export',
      'Build a 3D solar system explorer with orbital mechanics and planet info',
    ],
  },
  {
    icon: '🛠️',
    label: 'Tools',
    prompts: [
      'Build a mobile OS simulator with home screen, app grid, notifications, and settings',
      'Build a markdown editor with live preview, syntax highlighting, and export',
      'Build a Pomodoro timer with session history, sound notifications, and stats',
    ],
  },
]

const EXAMPLES: readonly string[] = STARTER_CATEGORIES.flatMap(c => c.prompts)

// v12: Slash commands — type "/" at the start of the prompt to see these.
// Each command either filters starters by category or inserts a template.
const SLASH_COMMANDS: readonly { cmd: string; label: string; icon: string; action: 'filter' | 'insert'; category?: string; template?: string }[] = [
  { cmd: '/dashboard', label: 'Dashboard apps', icon: '📊', action: 'filter', category: 'Dashboards' },
  { cmd: '/game', label: 'Games', icon: '🎮', action: 'filter', category: 'Games' },
  { cmd: '/creative', label: 'Creative tools', icon: '🎨', action: 'filter', category: 'Creative' },
  { cmd: '/tool', label: 'Utility tools', icon: '🛠️', action: 'filter', category: 'Tools' },
  { cmd: '/enhance', label: 'Enhance current prompt with AI', icon: '✨', action: 'insert', template: '' },
]

const REFINE_THINKING_STEPS: readonly string[] = [
  'Processing your request...',
  'Making changes...',
  'Finalizing...',
]

// v13: Contextual quick-refine suggestions — shown as clickable chips above the
// chat input after a build completes. Different suggestions for different app types.
// Detected via keyword matching on the mission string.
interface SuggestionGroup { match: readonly string[]; suggestions: readonly string[] }
const SUGGESTION_GROUPS: readonly SuggestionGroup[] = [
  {
    match: ['game', 'snake', 'tetris', 'puzzle', 'arcade', '2048', 'pong', 'breakout', 'memory match', 'memory card'],
    suggestions: [
      'Add sound effects and background music',
      'Add difficulty levels (easy, medium, hard)',
      'Add a high score leaderboard',
      'Make it mobile-friendly with touch controls',
    ],
  },
  {
    match: ['dashboard', 'chart', 'analytics', 'stats', 'tracker', 'monitor'],
    suggestions: [
      'Add dark mode toggle',
      'Add data filters and date range selectors',
      'Add export to CSV',
      'Make it fully responsive',
    ],
  },
  {
    match: ['todo', 'task', 'note', 'list', 'planner', 'kanban'],
    suggestions: [
      'Add drag-and-drop reordering',
      'Add categories or tags',
      'Add a search bar',
      'Add due dates and priorities',
    ],
  },
  {
    match: ['art', 'draw', 'paint', 'pixel', 'canvas', 'design'],
    suggestions: [
      'Add undo/redo history',
      'Add a color picker with hex input',
      'Add export to PNG',
      'Add brush size and opacity controls',
    ],
  },
  {
    match: ['editor', 'markdown', 'code', 'text', 'writer'],
    suggestions: [
      'Add syntax highlighting',
      'Add a live preview pane',
      'Add keyboard shortcuts',
      'Add word count and reading time',
    ],
  },
  {
    match: ['timer', 'clock', 'pomodoro', 'stopwatch', 'countdown'],
    suggestions: [
      'Add sound notifications',
      'Add session history and stats',
      'Add customizable intervals',
      'Add a visual progress ring',
    ],
  },
  {
    match: ['art', 'draw', 'paint', 'pixel', 'canvas', 'design'],
    suggestions: [
      'Add undo/redo history',
      'Add a color picker with hex input',
      'Add export to PNG',
      'Add brush size and opacity controls',
    ],
  },
]

// Default suggestions when no keyword matches.
const DEFAULT_SUGGESTIONS: readonly string[] = [
  'Add dark mode toggle',
  'Make it mobile-responsive',
  'Add smooth animations and transitions',
  'Add keyboard shortcuts',
]

// Returns up to 4 suggestion chips for the given mission.
function getSuggestionsForMission(mission: string): readonly string[] {
  const lower = mission.toLowerCase()
  for (const group of SUGGESTION_GROUPS) {
    if (group.match.some(kw => lower.includes(kw))) {
      return group.suggestions
    }
  }
  return DEFAULT_SUGGESTIONS
}

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
  // v10.13: Fullscreen preview mode
  const [fullscreen, setFullscreen] = useState(false)
  const [showCodeAnalysis, setShowCodeAnalysis] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // v11: Expanded version-history groups (keyed by normalized mission)
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set())
  // v11: Starter-prompt search filter
  const [starterQuery, setStarterQuery] = useState('')
  // v12: Prompt enhancer state
  const [enhancing, setEnhancing] = useState(false)
  const [enhancedPreview, setEnhancedPreview] = useState<string | null>(null)
  const [originalPromptBeforeEnhance, setOriginalPromptBeforeEnhance] = useState<string | null>(null)
  // v12: Slash-command autocomplete — shows when user types "/" at start of prompt
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
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
  // v10.11: Theme selector removed — always use 'slate' for generated apps
  const selectedTheme = 'slate'
  // v10.9: Model selector — Z.AI (default), Qwen (free), Kimi (reasoning)
  const [selectedModel, setSelectedModel] = useState<'z-ai' | 'qwen' | 'kimi'>('z-ai')
  const selectedModelRef = useRef<'z-ai' | 'qwen' | 'kimi'>('z-ai')
  // v13: Ref for enhancePrompt so the keyboard handler can call it without re-running on every keystroke
  const enhancePromptRef = useRef<() => void>(() => {})
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
  // v15: Build timing breakdown — architect / code / validate / total
  const [buildTimings, setBuildTimings] = useState<{ architect: number; code: number; total: number } | null>(null)
  // v16: Quality breakdown — specific checks, missing features, static issues, truncation flag
  const [qualityBreakdown, setQualityBreakdown] = useState<{
    checks: { name: string; passed: boolean; detail: string }[]
    missingFeatures: string[]
    staticIssues: { severity: string; message: string }[]
    truncated: boolean
  } | null>(null)
  // v15: Prompt history — cycle through previous prompts with ↑/↓
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [promptHistoryIndex, setPromptHistoryIndex] = useState(-1)
  // v20: Build stats — persistent across sessions
  const [buildStats, setBuildStats] = useState<BuildStats>(() => loadBuildStats())
  const [showStats, setShowStats] = useState(false)
  // v21: Prompt templates — save/load custom prompts
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  // v15: Quick mode — smaller token budget for faster builds (~2min vs ~5min)
  const [quickMode, setQuickMode] = useState(false)
  const quickModeRef = useRef(false)
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

  // Load saved model from localStorage after mount
  useEffect(() => {
    // v10.9: Load saved model
    try {
      const savedModel = localStorage.getItem('nova_model')
      if (savedModel === 'qwen' || savedModel === 'kimi' || savedModel === 'z-ai') {
        setSelectedModel(savedModel)
        selectedModelRef.current = savedModel
      }
    } catch {}
    // v15: Load prompt history
    try {
      const stored = JSON.parse(localStorage.getItem('nova_prompts') ?? '[]')
      if (Array.isArray(stored)) setPromptHistory(stored.filter((s: unknown) => typeof s === 'string').slice(0, 20))
    } catch {}
    // v21: Load prompt templates
    setTemplates(loadTemplates())
  }, [])
  // v10.9: Keep model ref in sync
  useEffect(() => { selectedModelRef.current = selectedModel }, [selectedModel])
  // v15: Load + sync quick mode
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nova_quick_mode')
      if (saved === 'true') { setQuickMode(true); quickModeRef.current = true }
    } catch {}
  }, [])
  useEffect(() => {
    quickModeRef.current = quickMode
    try { localStorage.setItem('nova_quick_mode', String(quickMode)) } catch {}
  }, [quickMode])

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
    // v11: Keep multiple versions per mission (max 5 per mission, 30 total).
    // Earlier builds of the same mission are kept as older versions — users can
    // browse/restore them via the expandable "Versions" UI.
    const key = normalizeMission(buildResult.mission)
    const sameMission = historyRef.current.filter(h => normalizeMission(h.mission) === key)
    const others = historyRef.current.filter(h => normalizeMission(h.mission) !== key)
    // Newest first; cap at 5 versions per mission.
    const cappedSameMission = [buildResult, ...sameMission].slice(0, 5)
    const newHistory = [...cappedSameMission, ...others].slice(0, 30)
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

  // ═══ v14 ROAST FIX: Auto-filter starters based on typed prompt ═══
  // Moved below showExamples definition — see next occurrence.
  // (kept as placeholder for dependency ordering)

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
    // v15: Reset build timings + save prompt to history
    setBuildTimings(null)
    if (m.length >= 3) {
      setPromptHistory(prev => {
        const next = [m, ...prev.filter(p => p !== m)].slice(0, 20)
        try { localStorage.setItem('nova_prompts', JSON.stringify(next)) } catch {}
        return next
      })
    }
    setPromptHistoryIndex(-1)
    const archStartTime = Date.now()

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
        body: JSON.stringify({ mission: m, model: selectedModelRef.current }),
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

      // v15: Track architect time
      const archMs = Date.now() - archStartTime
      const codeStartTime = Date.now()

      // ═══ STAGE 2: CODER — SSE streaming with keepalive ═══
      // The route returns Server-Sent Events: progress events while LLM works,
      // then a result event with the final HTML. No timeout — keepalive prevents it.
      const codeRes = await fetch('/api/build/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ mission: m, plan: archData?.plan ?? null, theme: selectedTheme, model: selectedModelRef.current, quickMode: quickModeRef.current }),
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
      // v16: Quality breakdown capture
      let finalQualityBreakdown: { checks: { name: string; passed: boolean; detail: string }[]; missingFeatures: string[]; staticIssues: { severity: string; message: string }[]; truncated: boolean } | null = null

      while (true) {
        // v10.5: 180s timeout — if no data arrives, the connection is dead
        let readResult: ReadableStreamReadResult<Uint8Array>
        try {
          readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('SSE_TIMEOUT')), 180_000)
            )
          ]) as ReadableStreamReadResult<Uint8Array>
        } catch {
          streamError = 'Connection timed out — no data for 180s'
          break
        }
        const { done, value } = readResult
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
              // v16: Capture quality breakdown for the insights panel
              if (Array.isArray(evt.checks) || Array.isArray(evt.missingFeatures) || Array.isArray(evt.staticIssues) || evt.truncated) {
                finalQualityBreakdown = {
                  checks: Array.isArray(evt.checks) ? evt.checks : [],
                  missingFeatures: Array.isArray(evt.missingFeatures) ? evt.missingFeatures : [],
                  staticIssues: Array.isArray(evt.staticIssues) ? evt.staticIssues : [],
                  truncated: evt.truncated === true,
                }
              }
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
        // v11: Quality + timestamp for version history
        quality: finalQuality,
        timestamp: Date.now(),
        // v13: Store metrics string for the insights panel
        metrics: finalMetrics,
      }

      setResult(buildResult)
      resultRef.current = buildResult // Update ref synchronously
      addBuildToHistory(buildResult)

      // v4: Cache the build in IndexedDB for instant restore next time.
      // Fire-and-forget — failures (private mode, quota) are silently ignored.
      cacheBuild(buildResult, finalQuality).catch(() => {})

      // v4: Mark the pipeline as done
      setPipelineStage('done')

      // v15: Set build timing breakdown
      const codeMs = Date.now() - codeStartTime
      const finalTimings = { architect: archMs, code: codeMs, total: finalMs }
      setBuildTimings(finalTimings)
      // v23: Save timings on the build result so they persist in history
      buildResult.timings = finalTimings

      toast.success(`Built in ${(finalMs / 1000).toFixed(1)}s · ${finalTokens} tokens · quality: ${finalQuality}`)
      setQualityScore(finalQuality)
      setQualityMetrics(finalMetrics)
      // v16: Set quality breakdown for the insights panel
      setQualityBreakdown(finalQualityBreakdown)
      // v20: Record build in persistent stats
      const newStats = recordBuildInStats(buildStats, {
        quality: finalQuality,
        ms: finalMs,
        tokens: finalTokens,
        mission: m,
        model: selectedModelRef.current,
      })
      setBuildStats(newStats)
      saveBuildStats(newStats)
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

  // v18: Smart retry — rebuild with a different model (e.g., Kimi for low-quality builds)
  // Temporarily switches the model, builds, then restores the original selection
  const retryWithModel = useCallback(async (model: 'z-ai' | 'qwen' | 'kimi') => {
    const prevModel = selectedModelRef.current
    if (prevModel === model) {
      // Same model — just rebuild
      build()
      return
    }
    setSelectedModel(model)
    selectedModelRef.current = model
    try { localStorage.setItem('nova_model', model) } catch {}
    toast.info(`Rebuilding with ${model === 'z-ai' ? 'Z.AI' : model === 'qwen' ? 'Qwen' : 'Kimi K3'}...`)
    await build()
    // Restore previous model after build starts
    setTimeout(() => {
      setSelectedModel(prevModel)
      selectedModelRef.current = prevModel
      try { localStorage.setItem('nova_model', prevModel) } catch {}
    }, 100)
  }, [build])

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
    // v13: Restore quality + metrics from the build result if it has them (added in v11/v13)
    setQualityScore(h.quality ?? 0)
    setQualityMetrics(h.metrics ?? '')
    // v23: Restore build timings if available
    setBuildTimings(h.timings ?? null)
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
        // v10.5: 180s timeout — if no data arrives, the connection is dead
        let readResult: ReadableStreamReadResult<Uint8Array>
        try {
          readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('SSE_TIMEOUT')), 180_000)
            )
          ]) as ReadableStreamReadResult<Uint8Array>
        } catch {
          streamError = 'Connection timed out — no data for 180s'
          break
        }
        const { done, value } = readResult
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
        // v11: Update quality + timestamp so the fix shows as a new version
        quality: finalQuality,
        timestamp: Date.now(),
        // v13: Store metrics string for the insights panel
        metrics: finalMetrics,
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

      // Step 2: If no errors AND functional score is good, we're done!
      // v25: Also check functional score — even with 0 runtime errors, buttons might not work
      const functionalScore = probe.functionalScore ?? 0
      if (allErrors.length === 0 && functionalScore >= 50) {
        toast.success(`All bugs fixed! ${functionalScore}% functional (${i} iteration${i !== 1 ? 's' : ''})`)
        break
      }

      // v25: If we have dead clicks but no runtime errors, add that info to the fix prompt
      const deadClicksInfo = probe.deadClicks > 0
        ? `\n${probe.deadClicks} button(s) did nothing when clicked. Make sure every button has a working onclick handler that changes something visible.`
        : ''

      // Step 3: Send errors to LLM for fixing
      toast.info(`Fixing iteration ${i + 1}/${maxIterations}: ${allErrors.length} error(s), ${functionalScore}% functional...`)

      const errorList = allErrors.map((e, idx) => {
        const stack = e.stack ? `\n  Stack: ${e.stack.slice(0, 300)}` : ''
        return `${idx + 1}. [${e.type}]: ${e.msg}${stack}`
      }).join('\n')

      const fixMessage = `Fix these runtime errors (iteration ${i + 1}):\n${errorList}${deadClicksInfo}\n\nCRITICAL: Every function referenced in onclick or addEventListener MUST be defined. Do not use prompt() or confirm() — they are blocked. Use inline inputs instead.\n\nThe app must work without these errors. Fix the root cause.`

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
          // v10.5: 180s timeout
          let readResult: ReadableStreamReadResult<Uint8Array>
          try {
            readResult = await Promise.race([
              reader.read(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('SSE_TIMEOUT')), 180_000)
              )
            ]) as ReadableStreamReadResult<Uint8Array>
          } catch {
            break
          }
          const { done, value } = readResult
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
          // v11: Update quality + timestamp for version history
          quality: finalQuality,
          timestamp: Date.now(),
          // v13: Store metrics string for the insights panel
          metrics: finalMetrics,
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
    // v11: Reset version-history expansion + starter search
    setExpandedVersions(new Set())
    setStarterQuery('')
    // v12: Reset enhance state
    setEnhancing(false)
    setEnhancedPreview(null)
    setOriginalPromptBeforeEnhance(null)
    // v12: Reset slash-menu state
    setSlashMenuOpen(false)
    setSlashFilter('')
    setSlashIndex(0)
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
    // v10.11: ZIP download using dependency-free encoder
    import('@/lib/zip').then(({ createZip }) => {
      const files = result.files && result.files.length > 0
        ? result.files.map(f => ({ name: f.path, content: f.content }))
        : [{ name: sanitizeFilename(result.mission).replace('.html', '') + '/index.html', content: result.html }]
      const zipBytes = createZip(files)
      const blob = new Blob([zipBytes as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = sanitizeFilename(result.mission).replace('.html', '') + '.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(`Downloaded ${a.download}`)
    }).catch(() => {
      // Fallback: plain HTML download
      const blob = new Blob([result.html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = sanitizeFilename(result.mission)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(`Downloaded ${a.download}`)
    })
  }, [result])

  // v13: Direct HTML download — downloads a single .html file without ZIP wrapping.
  // Useful for quick sharing or when the user just wants the raw HTML.
  const downloadHtml = useCallback(() => {
    if (!result?.html) return
    const blob = new Blob([result.html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = sanitizeFilename(result.mission)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`Downloaded ${a.download}`)
  }, [result])

  // v18: Export all builds — downloads a JSON backup of all history items
  const exportBuilds = useCallback(() => {
    try {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        builds: historyRef.current,
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nova-builds-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(`Exported ${historyRef.current.length} builds`)
    } catch {
      toast.error('Failed to export builds')
    }
  }, [])

  // v18: Import builds — loads builds from a JSON backup file
  const importBuilds = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (!data.builds || !Array.isArray(data.builds)) {
          toast.error('Invalid backup file — missing builds array')
          return
        }
        const valid = data.builds.filter((b: unknown) => {
          if (typeof b !== 'object' || b === null) return false
          const item = b as Record<string, unknown>
          return typeof item.id === 'string' && typeof item.html === 'string' && typeof item.mission === 'string'
        })
        if (valid.length === 0) {
          toast.error('No valid builds found in backup file')
          return
        }
        // Merge with existing history (dedupe by id)
        const existingIds = new Set(historyRef.current.map(h => h.id))
        const newBuilds = valid.filter((b: BuildResult) => !existingIds.has(b.id))
        const merged = [...newBuilds, ...historyRef.current].slice(0, 30)
        historyRef.current = merged
        setHistory(merged)
        saveHistoryToStorage(merged)
        toast.success(`Imported ${newBuilds.length} new builds (${merged.length} total)`)
      } catch {
        toast.error('Failed to parse backup file — not valid JSON')
      }
    }
    reader.readAsText(file)
  }, [saveHistoryToStorage])

  // v21: Save current prompt as a template
  const savePromptTemplate = useCallback(() => {
    const m = mission.trim()
    if (!m) {
      toast.error('Type a prompt first')
      return
    }
    if (m.length < 5) {
      toast.error('Prompt too short to save as template')
      return
    }
    const name = saveTemplateName.trim() || m.slice(0, 30)
    addTemplate(name, m)
    setTemplates(loadTemplates())
    setSaveTemplateName('')
    setShowTemplates(false)
    toast.success(`Saved template "${name}"`)
  }, [mission, saveTemplateName])

  // v21: Load a template into the textarea
  const loadPromptTemplate = useCallback((t: PromptTemplate) => {
    setMission(t.prompt)
    markTemplateUsed(t.id)
    setTemplates(loadTemplates())
    setShowTemplates(false)
    toast.info(`Loaded template "${t.name}"`)
  }, [])

  // v21: Delete a template
  const removePromptTemplate = useCallback((id: string, name: string) => {
    deleteTemplate(id)
    setTemplates(loadTemplates())
    toast.success(`Deleted template "${name}"`)
  }, [])

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

  // v12: Apply a slash command — either filter starters by category or trigger enhance.
  // For "filter" commands: set the starter search to the category label (shows that category's prompts),
  // and clear the slash from the textarea (set to empty so the user can pick a starter).
  // For "insert" commands (like /enhance): clear the slash and trigger the action.
  const applySlashCommand = useCallback((cmd: { cmd: string; action: 'filter' | 'insert'; category?: string }) => {
    setSlashMenuOpen(false)
    setMission('')
    if (cmd.action === 'filter' && cmd.category) {
      // Use the category label (e.g. "Games") as the search filter —
      // matches the category label OR the prompt text.
      setStarterQuery(cmd.category.toLowerCase())
      toast.info(`Showing ${cmd.category} starters — click one to build`)
    } else if (cmd.action === 'insert' && cmd.cmd === '/enhance') {
      // /enhance with no prompt — just focus the textarea so the user can type
      toast.info('Type a prompt, then click Enhance')
    }
  }, [])

  // v12: Compare a historical version against the current result.
  // Sets the version as `previousBuild` and enables the DiffViewer.
  const compareWithCurrent = useCallback((h: BuildResult) => {
    if (!result) {
      toast.error('Build something first, then compare versions')
      return
    }
    if (h.id === result.id) {
      toast.error('Cannot compare a build with itself')
      return
    }
    setPreviousBuild(h)
    setShowDiff(true)
    toast.info('Showing diff — click Diff again to hide')
  }, [result])

  // v12: Enhance prompt — calls /api/enhance to expand a terse prompt into a
  // detailed build spec. Shows a preview diff; user can accept or undo.
  const enhancePrompt = useCallback(async () => {
    const m = mission.trim()
    if (!m) {
      toast.error('Type a prompt first')
      return
    }
    if (m.length < 3) {
      toast.error('Prompt too short to enhance')
      return
    }
    // If already showing a preview, don't re-enhance
    if (enhancedPreview !== null) return
    setEnhancing(true)
    try {
      const res = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: m }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Enhancement failed')
        return
      }
      const enhanced: string = data.enhanced
      // Don't enhance if it's identical to the original
      if (enhanced.trim() === m) {
        toast.info('Prompt is already detailed')
        return
      }
      setOriginalPromptBeforeEnhance(m)
      setEnhancedPreview(enhanced)
      toast.success(`Enhanced · ${data.tokens ?? 0} tokens · ${(data.ms / 1000).toFixed(1)}s`)
    } catch (err) {
      toast.error('Network error — could not enhance')
    } finally {
      setEnhancing(false)
    }
  }, [mission, enhancedPreview])

  // v13: Keep the ref in sync so the keyboard handler always calls the latest version
  useEffect(() => { enhancePromptRef.current = enhancePrompt }, [enhancePrompt])

  // v12: Accept the enhanced preview — applies it to the textarea
  const acceptEnhanced = useCallback(() => {
    if (enhancedPreview === null) return
    setMission(enhancedPreview)
    setEnhancedPreview(null)
    setOriginalPromptBeforeEnhance(null)
    toast.success('Prompt enhanced')
  }, [enhancedPreview])

  // v12: Reject the enhanced preview — discard and keep the original
  const rejectEnhanced = useCallback(() => {
    if (originalPromptBeforeEnhance !== null) {
      setMission(originalPromptBeforeEnhance)
    }
    setEnhancedPreview(null)
    setOriginalPromptBeforeEnhance(null)
  }, [originalPromptBeforeEnhance])

  // v10.10: Share via URL — encode build in URL hash
  const shareUrl = useCallback(() => {
    if (!result?.html) return
    try {
      // Encode mission + html + optional quality as base64 in URL hash
      const payload = JSON.stringify({ m: result.mission, h: result.html, q: result.quality })
      const encoded = btoa(unescape(encodeURIComponent(payload)))
      const url = `${window.location.origin}${window.location.pathname}#s=${encoded}`
      navigator.clipboard.writeText(url)
      toast.success('Share link copied to clipboard!')
    } catch {
      toast.error('Failed to create share link')
    }
  }, [result])

  // v10.10: Load shared build from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.startsWith('#s=')) return
    try {
      const encoded = hash.slice(3)
      const payload = JSON.parse(decodeURIComponent(escape(atob(encoded))))
      if (payload.h && payload.m) {
        const shared: BuildResult = {
          id: newBuildId(),
          html: payload.h,
          tokens: 0,
          ms: 0,
          mission: payload.m,
          // v11: Mark as shared build with current timestamp
          quality: payload.q,
          timestamp: Date.now(),
        }
        setResult(shared)
        resultRef.current = shared
        setMission(payload.m)
        toast.info('Loaded shared build')
        // Clear the hash so it doesn't reload on refresh
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch {}
  }, [])

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
  const sendChat = useCallback(async (overrideMsg?: string) => {
    const msg = (overrideMsg ?? chatInput).trim()
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
    // v13: If using an override message (suggestion chip), clear the input field now.
    // If using the typed input, don't clear yet — clear only after success so a
    // failed refine restores the user's message.
    if (overrideMsg) setChatInput('')
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
        body: JSON.stringify({ mission: currentResult.mission, html: currentResult.html, message: msg, theme: selectedTheme, model: selectedModelRef.current }),
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
        // v10.5: 180s timeout — if no data arrives, the connection is dead
        let readResult: ReadableStreamReadResult<Uint8Array>
        try {
          readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('SSE_TIMEOUT')), 180_000)
            )
          ]) as ReadableStreamReadResult<Uint8Array>
        } catch {
          streamError = 'Connection timed out — no data for 180s'
          break
        }
        const { done, value } = readResult
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
        // v11: Update quality + timestamp so refine shows as a new version
        quality: finalQuality,
        timestamp: Date.now(),
        // v13: Store metrics string for the insights panel
        metrics: finalMetrics,
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
      // v20: Record refine in persistent stats
      const refinedStats = recordRefineInStats(buildStats)
      setBuildStats(refinedStats)
      saveBuildStats(refinedStats)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const failMsg = err instanceof Error ? err.message : 'Network error'
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${failMsg}`, ts: Date.now() }])
      toast.error(failMsg)
      // v13: Only restore the input on error if the user typed it (not a suggestion chip).
      // Suggestion chips don't need restoring — the user can click them again.
      if (!overrideMsg) setChatInput(msg)
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
      // v10.10: M cycles through models (only when not typing)
      if (e.key === 'm' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField && !loading && !refining) {
          e.preventDefault()
          const models: Array<'z-ai' | 'qwen' | 'kimi'> = ['z-ai', 'qwen', 'kimi']
          const next = models[(models.indexOf(selectedModelRef.current) + 1) % models.length]
          setSelectedModel(next)
          selectedModelRef.current = next
          try { localStorage.setItem('nova_model', next) } catch {}
          toast.info(`Model: ${next === 'z-ai' ? 'Z.AI' : next === 'qwen' ? 'Qwen' : 'Kimi K3'}`)
        }
      }
      // v13: E triggers prompt enhance (only when not typing, not building, and there's a prompt)
      if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField && !loading && !refining) {
          e.preventDefault()
          enhancePromptRef.current()
        }
      }
      // v17: I toggles insights panel, D toggles diff, F toggles fullscreen
      if (e.key === 'i' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField && result && qualityScore > 0) {
          e.preventDefault()
          setShowCodeAnalysis(prev => !prev)
        }
      }
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField && previousBuild && result && !loading && !refining) {
          e.preventDefault()
          setShowDiff(prev => !prev)
        }
      }
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField && result && !loading && !refining) {
          e.preventDefault()
          setFullscreen(prev => !prev)
        }
      }
      // v21: S toggles stats, T toggles templates
      if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField && buildStats.totalBuilds > 0) {
          e.preventDefault()
          setShowStats(prev => !prev)
        }
      }
      if (e.key === 't' && !e.metaKey && !e.ctrlKey) {
        const target = e.target as HTMLElement
        const isTextField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (!isTextField && !loading && !refining) {
          e.preventDefault()
          setShowTemplates(prev => !prev)
        }
      }
      // Escape closes shortcuts panel if open
      // v10.13: Esc exits fullscreen
      if (e.key === 'Escape' && fullscreen) {
        setFullscreen(false)
        return
      }
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
      // v14 ROAST FIX: Show real progress text instead of fake static steps.
      // Priority: live pipeline text > current build step > stage-based fallback.
      if (pipelineLiveText) return pipelineLiveText
      const stageText: Record<StageKey, string> = {
        plan: 'Planning the architecture...',
        code: 'Generating code...',
        analyze: 'Analyzing code quality...',
        validate: 'Validating output...',
        done: 'Build complete',
      }
      return stageText[pipelineStage ?? 'plan'] ?? buildSteps[thinkingStep] ?? 'Building...'
    }
    if (refining) {
      return REFINE_THINKING_STEPS[thinkingStep] ?? 'Refining...'
    }
    return ''
  }, [loading, refining, thinkingStep, buildSteps, pipelineLiveText, pipelineStage])

  // Whether to show examples (only when no result, no error, not loading)
  const showExamples = !result && !loading && !error
  // Whether to show first-build error panel (no result, has error, not loading)
  const showFirstError = !result && !!error && !loading

  // ═══ v14 ROAST FIX: Auto-filter starters based on typed prompt ═══
  // When the user types a prompt, auto-filter the starters panel to show relevant matches.
  useEffect(() => {
    if (!showExamples) return
    const m = mission.trim()
    if (m.length < 4) return
    const lower = m.toLowerCase()
    const hasMatch = STARTER_CATEGORIES
      .flatMap(c => c.prompts)
      .some(p => p.toLowerCase().includes(lower))
    if (hasMatch) {
      setStarterQuery(lower.slice(0, 20))
    }
  }, [mission, showExamples])

  // v10.8: Removed dead BUILD_STAGES/currentStage — PipelineProgress handles all UI

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground" aria-busy={loading || refining}>
      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">NOVA</h1>
            <p className="hidden text-[10px] text-muted-foreground sm:block">Prompt to Reality</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* v10.11: Theme color selector removed — dark/light toggle is enough */}
          {/* v10.9: Model selector — Z.AI (default), Qwen (free), Kimi (reasoning) */}
          <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
            <button
              type="button"
              onClick={() => { setSelectedModel('z-ai'); try { localStorage.setItem('nova_model', 'z-ai') } catch {} }}
              disabled={loading || refining}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${
                selectedModel === 'z-ai' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Z.AI — fast, reliable (default)"
            >Z.AI</button>
            <button
              type="button"
              onClick={() => { setSelectedModel('qwen'); try { localStorage.setItem('nova_model', 'qwen') } catch {} }}
              disabled={loading || refining}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${
                selectedModel === 'qwen' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Qwen — free, fast via DashScope"
            >Qwen</button>
            <button
              type="button"
              onClick={() => { setSelectedModel('kimi'); try { localStorage.setItem('nova_model', 'kimi') } catch {} }}
              disabled={loading || refining}
              className={`rounded px-2 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${
                selectedModel === 'kimi' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Kimi K3 — reasoning model, slower but detailed"
            >Kimi</button>
          </div>
          {/* v15: Quick mode toggle — halved token budget for faster builds */}
          <button
            type="button"
            onClick={() => setQuickMode(prev => !prev)}
            disabled={loading || refining}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${
              quickMode
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                : 'border-border/40 text-muted-foreground hover:text-foreground'
            }`}
            title={quickMode ? 'Quick mode ON — faster builds, simpler output. Click to disable.' : 'Enable Quick mode — faster builds with simpler output'}
            aria-pressed={quickMode}
          >
            <Zap className="h-3 w-3" />
            <span className="hidden sm:inline">Quick</span>
          </button>
          {/* v20: Stats button — shows build statistics across sessions */}
          {buildStats.totalBuilds > 0 && (
            <button
              type="button"
              onClick={() => setShowStats(prev => !prev)}
              className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                showStats ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground hover:text-foreground'
              }`}
              title="Build statistics across all sessions"
            >
              <BarChart3 className="h-3 w-3" />
              <span className="hidden sm:inline">{buildStats.totalBuilds}</span>
            </button>
          )}
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
                <span>{(result.ms / 1000).toFixed(1)}s · {formatTokens(result.tokens)} tokens · ~${(result.tokens * 0.000002).toFixed(3)}</span>
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
          {/* v12: Slash-command autocomplete menu.
              Shows when the prompt starts with "/" (and only the slash + filter word).
              Arrow keys navigate, Enter/Tab selects, Escape closes. */}
          {slashMenuOpen && (() => {
            const filtered = SLASH_COMMANDS.filter(c =>
              slashFilter === '' || c.cmd.includes(slashFilter.toLowerCase()) || c.label.toLowerCase().includes(slashFilter.toLowerCase())
            )
            if (filtered.length === 0) return null
            return (
              <div
                role="listbox"
                aria-label="Slash commands"
                className="relative z-20 mb-2 overflow-hidden rounded-md border border-border/60 bg-popover shadow-lg"
              >
                {filtered.map((c, i) => (
                  <button
                    key={c.cmd}
                    type="button"
                    role="option"
                    aria-selected={i === slashIndex}
                    onMouseEnter={() => setSlashIndex(i)}
                    onClick={() => {
                      applySlashCommand(c)
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      i === slashIndex ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <span className="text-sm">{c.icon}</span>
                    <span className="font-mono text-violet-400">{c.cmd}</span>
                    <span className="text-muted-foreground/70">— {c.label}</span>
                  </button>
                ))}
              </div>
            )
          })()}
          <Textarea
            id="mission-input"
            // autoFocus only on desktop via useEffect (see missionInputRef).
            // On mobile, autoFocus pops the on-screen keyboard on load — annoying.
            autoFocus={false}
            value={mission}
            maxLength={2000}
            onChange={(e) => {
              const v = e.target.value
              setMission(v)
              // v12: Detect slash-command trigger — "/" at start, optionally followed by filter text
              const slashMatch = v.match(/^\/(\w*)$/)
              if (slashMatch) {
                setSlashMenuOpen(true)
                setSlashFilter(slashMatch[1] || '')
                setSlashIndex(0)
              } else {
                setSlashMenuOpen(false)
              }
            }}
            onKeyDown={(e) => {
              // v12: Slash-menu keyboard navigation
              if (slashMenuOpen) {
                const filtered = SLASH_COMMANDS.filter(c =>
                  slashFilter === '' || c.cmd.includes(slashFilter.toLowerCase()) || c.label.toLowerCase().includes(slashFilter.toLowerCase())
                )
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSlashIndex(prev => Math.min(prev + 1, filtered.length - 1))
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSlashIndex(prev => Math.max(prev - 1, 0))
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault()
                  const selected = filtered[slashIndex]
                  if (selected) applySlashCommand(selected)
                  return
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSlashMenuOpen(false)
                  return
                }
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                build()
              }
              // v15: Prompt history navigation — ↑/↓ to cycle previous prompts
              // Only when slash menu is closed and cursor is at start (↑) or end (↓) of text
              if (!slashMenuOpen && promptHistory.length > 0) {
                const target = e.target as HTMLTextAreaElement
                const atStart = target.selectionStart === 0 && target.selectionEnd === 0
                const atEnd = target.selectionStart === mission.length && target.selectionEnd === mission.length
                if (e.key === 'ArrowUp' && atStart) {
                  e.preventDefault()
                  const nextIdx = promptHistoryIndex < 0 ? 0 : Math.min(promptHistoryIndex + 1, promptHistory.length - 1)
                  setPromptHistoryIndex(nextIdx)
                  setMission(promptHistory[nextIdx] ?? '')
                } else if (e.key === 'ArrowDown' && promptHistoryIndex >= 0 && atEnd) {
                  e.preventDefault()
                  const nextIdx = promptHistoryIndex - 1
                  if (nextIdx < 0) {
                    setPromptHistoryIndex(-1)
                    setMission('')
                  } else {
                    setPromptHistoryIndex(nextIdx)
                    setMission(promptHistory[nextIdx] ?? '')
                  }
                }
              }
            }}
            placeholder="Describe anything — or type / for commands (dashboard, game, creative, tool, enhance)"
            className="min-h-[120px] resize-none font-mono text-sm"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/40">
              ⌘+Enter to build · ↑↓ for history
            </span>
            <span className={`text-[10px] ${mission.length > 2000 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
              {mission.length}/2000
            </span>
          </div>

          {/* v16: Smart mission analysis — shows complexity, warnings, and estimated time
              BEFORE the user builds. Helps them write better prompts and set expectations. */}
          {mission.trim().length >= 3 && !result && !loading && !error && (() => {
            const analysis = analyzeMission(mission)
            const complexityColor = analysis.complexity === 'simple' ? 'text-emerald-400' : analysis.complexity === 'medium' ? 'text-amber-400' : 'text-orange-400'
            const complexityIcon = analysis.complexity === 'simple' ? '🟢' : analysis.complexity === 'medium' ? '🟡' : '🟠'
            return (
              <div className="mt-2 rounded-md border border-border/40 bg-card/20 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]">{complexityIcon}</span>
                    <span className={`text-[10px] font-medium uppercase tracking-wider ${complexityColor}`}>
                      {analysis.complexity}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">·</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {analysis.featureCount} feature{analysis.featureCount === 1 ? '' : 's'} · {analysis.wordCount} words
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                    <span title="Estimated build time">~{Math.round(analysis.estimatedTime / 60)}min</span>
                    <span className="text-muted-foreground/30">·</span>
                    {/* v22: Auto-suggest model — clickable button to switch to recommended model */}
                    {analysis.recommendedModel !== selectedModel ? (
                      <button
                        type="button"
                        onClick={() => {
                          const rec = analysis.recommendedModel
                          setSelectedModel(rec)
                          selectedModelRef.current = rec
                          try { localStorage.setItem('nova_model', rec) } catch {}
                          toast.info(`Switched to ${rec === 'z-ai' ? 'Z.AI' : rec === 'qwen' ? 'Qwen' : 'Kimi K3'} — ${analysis.modelReason}`)
                        }}
                        title={`Click to switch: ${analysis.modelReason}`}
                        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-violet-400 transition-colors hover:bg-violet-500/10"
                      >
                        <Sparkles className="h-2.5 w-2.5" />
                        use {analysis.recommendedModel === 'z-ai' ? 'Z.AI' : analysis.recommendedModel === 'qwen' ? 'Qwen' : 'Kimi'}
                      </button>
                    ) : (
                      <span title={analysis.modelReason} className="cursor-help text-emerald-400/70">
                        ✓ {selectedModel === 'z-ai' ? 'Z.AI' : selectedModel === 'qwen' ? 'Qwen' : 'Kimi'}
                      </span>
                    )}
                  </div>
                </div>
                {/* Warnings */}
                {(analysis.vagueness !== 'none' || analysis.isTooComplex) && (
                  <div className="mt-1.5 space-y-1">
                    {analysis.vagueness === 'too-vague' && (
                      <p className="flex items-center gap-1 text-[10px] text-amber-400">
                        <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                        {analysis.vaguenessReason}
                      </p>
                    )}
                    {analysis.vagueness === 'vague' && (
                      <p className="flex items-center gap-1 text-[10px] text-amber-400/70">
                        <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                        {analysis.vaguenessReason}
                      </p>
                    )}
                    {analysis.isTooComplex && (
                      <p className="flex items-center gap-1 text-[10px] text-orange-400">
                        <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                        {analysis.tooComplexReason}
                      </p>
                    )}
                  </div>
                )}
                {/* v22: Clickable improvement suggestions — when prompt is vague,
                    offer specific clickable chips that append to the prompt */}
                {analysis.suggestions.length > 0 && analysis.suggestions[0] !== 'Prompt looks good — ready to build!' && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {analysis.suggestions.slice(0, 3).map((s, i) => {
                      // Extract the quoted example from suggestions like: 'Add specific features: "with add, delete..."'
                      const match = s.match(/"([^"]+)"/)
                      const clickableText = match ? match[1] : null
                      if (clickableText) {
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              const current = mission.trim()
                              const addition = clickableText.startsWith('with') || clickableText.startsWith('add')
                                ? ` ${clickableText}`
                                : ` with ${clickableText}`
                              setMission(current + (current.endsWith(addition[0] ?? ' ') ? '' : ' ') + clickableText.trim())
                              toast.info('Added to prompt')
                            }}
                            className="rounded-full border border-violet-500/30 bg-violet-500/5 px-2 py-0.5 text-[10px] text-violet-400/80 transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-300"
                            title={`Click to add: ${clickableText}`}
                          >
                            + {clickableText.length > 30 ? clickableText.slice(0, 30) + '...' : clickableText}
                          </button>
                        )
                      }
                      return (
                        <p key={i} className="flex items-start gap-1 text-[10px] text-muted-foreground/60">
                          <span className="mt-px text-muted-foreground/40">→</span>
                          <span>{s}</span>
                        </p>
                      )
                    })}
                  </div>
                )}
                {/* Ready indicator */}
                {analysis.suggestions[0] === 'Prompt looks good — ready to build!' && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400/70">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {analysis.suggestions[0]}
                  </p>
                )}
              </div>
            )
          })()}

          {/* v12: Enhanced-prompt preview — shows when the user clicked Enhance.
              Displays the AI-expanded prompt with Accept (apply) / Reject (undo) buttons. */}
          {enhancedPreview !== null && (
            <div role="region" aria-label="Enhanced prompt preview" className="mt-3 rounded-md border border-violet-500/40 bg-violet-500/5 p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Wand2 className="h-3 w-3 shrink-0 text-violet-400" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-violet-400/80">
                  Enhanced prompt
                </span>
              </div>
              {originalPromptBeforeEnhance && (
                <p className="mb-1.5 line-through text-[11px] text-muted-foreground/50">
                  {originalPromptBeforeEnhance}
                </p>
              )}
              <p className="text-[12px] leading-relaxed text-foreground/90">
                {enhancedPreview}
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={acceptEnhanced}
                >
                  <Check className="h-3 w-3" />
                  Use this
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={rejectEnhanced}
                >
                  <Undo2 className="h-3 w-3" />
                  Keep original
                </Button>
              </div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => build()}
              disabled={loading || refining || !mission.trim() || enhancedPreview !== null}
              className="flex-1 gap-2"
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
            {/* v12: Enhance prompt — expand terse prompts into detailed build specs */}
            <Button
              onClick={enhancePrompt}
              disabled={loading || refining || enhancing || !mission.trim() || enhancedPreview !== null}
              variant="outline"
              className="gap-2 border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300"
              size="lg"
              title="Enhance your prompt with AI — adds concrete features and interactions"
            >
              {enhancing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Enhance</span>
            </Button>
            {/* v21: Templates button — save/load custom prompts */}
            <Button
              onClick={() => { setShowTemplates(prev => !prev); setSaveTemplateName('') }}
              disabled={loading || refining}
              variant="ghost"
              className="gap-2 text-muted-foreground hover:text-foreground"
              size="lg"
              title="Prompt templates — save and load custom prompts"
            >
              <Bookmark className="h-4 w-4" />
              <span className="hidden sm:inline">Templates</span>
              {templates.length > 0 && (
                <span className="ml-0.5 rounded bg-primary/20 px-1 text-[9px] text-primary">{templates.length}</span>
              )}
            </Button>
          </div>

          {/* v21: Templates panel — save current prompt + list saved templates */}
          {showTemplates && (
            <div className="mt-2 rounded-md border border-border/40 bg-card/20 p-3">
              {/* Save current prompt as template */}
              {mission.trim().length >= 5 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">Save current prompt</p>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={saveTemplateName}
                      onChange={(e) => setSaveTemplateName(e.target.value)}
                      placeholder="Template name (optional)"
                      maxLength={60}
                      className="flex-1 rounded-md border border-border/40 bg-background/40 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePromptTemplate() } }}
                    />
                    <Button size="sm" className="h-7 gap-1 text-[11px]" onClick={savePromptTemplate}>
                      <Bookmark className="h-3 w-3" />
                      Save
                    </Button>
                  </div>
                </div>
              )}
              {/* List saved templates */}
              {templates.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">Saved templates ({templates.length})</p>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {templates.map((t) => (
                      <div key={t.id} className="flex items-center gap-1.5 rounded border border-border/30 bg-background/40 px-2 py-1">
                        <button
                          type="button"
                          onClick={() => loadPromptTemplate(t)}
                          className="flex-1 min-w-0 text-left"
                          title={t.prompt}
                        >
                          <p className="truncate text-[11px] font-medium text-foreground/80">{t.name}</p>
                          <p className="truncate text-[10px] text-muted-foreground/50">{t.prompt}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => removePromptTemplate(t.id, t.name)}
                          className="shrink-0 text-muted-foreground/40 transition-colors hover:text-destructive"
                          title="Delete template"
                          aria-label={`Delete template ${t.name}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground/40">No saved templates yet — type a prompt and click Save to create one.</p>
              )}
            </div>
          )}

          {/* Loading state — single unified progress */}
          {loading && !result && (
            <div role="status" aria-live="polite" className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span className="font-medium text-foreground/80">
                  {getThinkingText()}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground/50">
                  {elapsed > 0 && `${elapsed}s`}
                </span>
              </div>
              {/* Single progress display */}
              <div className="mt-2">
                <PipelineProgress
                  currentStage={pipelineStage ?? 'plan'}
                  liveText={pipelineLiveText || (livePreviewHtml ? `${livePreviewHtml.length} chars generated` : '')}
                  elapsedSeconds={elapsed}
                  mode="full"
                />
              </div>
              {/* v14 ROAST FIX: Cancel button visible during first build —
                  previously the user had to scroll to the preview toolbar to cancel.
                  Now it's right next to the progress. */}
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                  onClick={cancelBuild}
                  title="Cancel build"
                >
                  <X className="h-3 w-3" />
                  Cancel
                </Button>
              </div>
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
            <div className="mt-4 space-y-2">
              {/* v22: Recent prompts — quick-access chips for last 5 prompts */}
              {promptHistory.length > 0 && starterQuery.trim() === '' && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">Recent prompts</p>
                  <div className="flex flex-wrap gap-1">
                    {promptHistory.slice(0, 5).map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setMission(p); setPromptHistoryIndex(-1) }}
                        className="max-w-full truncate rounded-full border border-border/40 bg-card/30 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                        title={p}
                      >
                        {p.length > 30 ? p.slice(0, 30) + '...' : p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Try one
              </p>
              {/* v11: Search filter for starters */}
              <input
                type="text"
                value={starterQuery}
                onChange={(e) => setStarterQuery(e.target.value)}
                placeholder="Search starters..."
                className="w-full rounded-md border border-border/40 bg-background/40 px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none"
              />
              {/* v11: Categorized starter grid */}
              {starterQuery.trim() === '' ? (
                <div className="space-y-2">
                  {STARTER_CATEGORIES.map((cat) => (
                    <div key={cat.label} className="rounded-md border border-border/40 bg-card/30 p-2">
                      <p className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                        <span>{cat.icon}</span>
                        {cat.label}
                      </p>
                      <div className="space-y-1">
                        {cat.prompts.map((ex) => (
                          <button
                            key={ex}
                            type="button"
                            onClick={() => {
                              setMission(ex)
                              build(ex)
                            }}
                            className="block w-full rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-left text-[11px] text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/10"
                          >
                            {ex.replace(/^Build a /, '').replace(/^Build /, '')}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {STARTER_CATEGORIES
                    .flatMap(c => c.prompts.map(p => ({ prompt: p, category: c.label })))
                    .filter(({ prompt, category }) =>
                      prompt.toLowerCase().includes(starterQuery.toLowerCase()) ||
                      category.toLowerCase().includes(starterQuery.toLowerCase())
                    )
                    .map(({ prompt: ex }) => (
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
                  {STARTER_CATEGORIES
                    .flatMap(c => c.prompts.map(p => ({ prompt: p, category: c.label })))
                    .filter(({ prompt, category }) =>
                      prompt.toLowerCase().includes(starterQuery.toLowerCase()) ||
                      category.toLowerCase().includes(starterQuery.toLowerCase())
                    ).length === 0 && (
                    <p className="px-2 py-3 text-center text-[10px] text-muted-foreground/50">
                      No starters match "{starterQuery}"
                    </p>
                  )}
                </div>
              )}

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

          {/* v11: Version history — builds grouped by normalized mission.
              Each group shows the latest build; click the vN badge to expand all versions. */}
          {history.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Recent
              </p>
              {(() => {
                const groups = groupHistoryByMission(history)
                return groups.map((group) => {
                  const latest = group[0]
                  const key = normalizeMission(latest.mission)
                  const isExpanded = expandedVersions.has(key)
                  const versionCount = group.length
                  return (
                    <div key={key}>
                      <div className="flex items-stretch gap-1">
                        <button
                          type="button"
                          title={latest.mission}
                          onClick={() => loadFromHistory(latest)}
                          disabled={loading || refining}
                          className="flex flex-1 min-w-0 items-center gap-2 rounded-md border border-border/40 bg-card/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                        >
                          <Zap className="h-3 w-3 shrink-0 text-primary/40" />
                          <span className="truncate">{latest.mission}</span>
                          {latest.quality != null && latest.quality > 0 && (
                            <span className={`ml-auto shrink-0 rounded px-1 text-[9px] ${latest.quality >= 70 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                              Q:{latest.quality}
                            </span>
                          )}
                        </button>
                        {versionCount > 1 && (
                          <button
                            type="button"
                            onClick={() => setExpandedVersions(prev => {
                              const next = new Set(prev)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })}
                            disabled={loading || refining}
                            className="shrink-0 rounded-md border border-border/40 bg-card/40 px-2 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                            title={isExpanded ? 'Hide versions' : `Show all ${versionCount} versions`}
                            aria-label={isExpanded ? 'Hide versions' : `Show all ${versionCount} versions`}
                            aria-expanded={isExpanded}
                          >
                            v{versionCount}
                          </button>
                        )}
                      </div>
                      {isExpanded && versionCount > 1 && (
                        <div className="ml-3 mt-1 space-y-1 border-l border-border/30 pl-2">
                          {group.map((h, i) => (
                            <div key={h.id} className="flex items-stretch gap-1">
                              <button
                                type="button"
                                onClick={() => loadFromHistory(h)}
                                disabled={loading || refining}
                                className="flex flex-1 min-w-0 items-center gap-2 rounded border border-border/30 bg-card/20 px-2 py-1 text-left text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                                title={h.timestamp ? new Date(h.timestamp).toLocaleString() : h.mission}
                              >
                                <span className="shrink-0 font-mono text-muted-foreground/50">
                                  v{versionCount - i}
                                </span>
                                <span className="truncate">{h.mission}</span>
                                {h.quality != null && h.quality > 0 && (
                                  <span className={`ml-auto shrink-0 text-[9px] ${h.quality >= 70 ? 'text-emerald-400/70' : 'text-amber-400/70'}`}>
                                    Q:{h.quality}
                                  </span>
                                )}
                                {h.timestamp && (
                                  <span className="shrink-0 text-[9px] text-muted-foreground/40">
                                    {new Date(h.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                              </button>
                              {/* v12: Compare this version against the current result */}
                              {result && h.id !== result.id && !loading && !refining && (
                                <button
                                  type="button"
                                  onClick={() => compareWithCurrent(h)}
                                  className="shrink-0 rounded border border-border/30 bg-card/20 px-1.5 text-[9px] text-muted-foreground transition-colors hover:border-violet-500/50 hover:text-violet-400"
                                  title="Compare this version with the current build"
                                  aria-label={`Compare version ${versionCount - i} with current build`}
                                >
                                  <GitCompare className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
              {confirmClear ? (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setHistory([])
                      historyRef.current = [] // Sync ref so addBuildToHistory doesn't use stale data
                      try { localStorage.removeItem('nova_history') } catch {}
                      setConfirmClear(false)
                      setExpandedVersions(new Set())
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
                <div className="flex gap-1.5">
                  {/* v18: Export/Import builds */}
                  <button
                    type="button"
                    onClick={exportBuilds}
                    disabled={loading || refining || history.length === 0}
                    className="flex-1 rounded border border-border/40 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                    title="Export all builds as JSON backup"
                  >
                    Export
                  </button>
                  <label
                    className="flex-1 cursor-pointer rounded border border-border/40 px-2 py-1 text-center text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
                    title="Import builds from JSON backup"
                  >
                    Import
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) importBuilds(file)
                        e.target.value = '' // Reset so same file can be selected again
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    disabled={loading || refining}
                    className="flex-1 rounded border border-border/40 px-2 py-1 text-[10px] text-muted-foreground/50 hover:text-destructive disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}

          {/* v22: Import button — always available, even when history is empty.
              Lets users restore builds from a backup file without needing existing history. */}
          {history.length === 0 && showExamples && (
            <div className="mt-4">
              <label
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border/40 bg-card/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                title="Import builds from JSON backup file"
              >
                <Download className="h-3 w-3" />
                Import builds from backup
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) importBuilds(file)
                    e.target.value = ''
                  }}
                />
              </label>
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

            {/* v14 ROAST FIX: Low-quality warning — shown when build completes but score < 70.
                Previously the build would silently complete with Q:68 and the user had no idea
                the output was broken. Now there's a clear amber banner with a Rebuild button. */}
            {result && !loading && !refining && !error && qualityScore > 0 && qualityScore < 70 && (
              <div role="alert" className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="truncate text-xs text-amber-400">
                    Build quality is low (Q:{qualityScore}/100) — the output may have bugs. Try rebuilding or simplifying your request.
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px] text-amber-400 hover:bg-amber-500/10" onClick={() => build()} title="Rebuild from scratch with same model">
                    <RefreshCw className="h-3 w-3" />
                    Rebuild
                  </Button>
                  {/* v18: Smart retry with Kimi — reasoning model for better quality */}
                  {selectedModel !== 'kimi' && (
                    <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px] text-violet-400 hover:bg-violet-500/10" onClick={() => retryWithModel('kimi')} title="Rebuild with Kimi K3 — reasoning model for better quality">
                      <Sparkles className="h-3 w-3" />
                      Retry with Kimi
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowCodeAnalysis(true)}
                    className="text-amber-400/60 transition-colors hover:text-amber-400"
                    aria-label="View build insights"
                  >
                    <Bug className="h-3.5 w-3.5" />
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
                {/* v10.13: Fullscreen preview toggle */}
                {result && !loading && !refining && (
                  <button
                    type="button"
                    onClick={() => setFullscreen(!fullscreen)}
                    className={`rounded-md px-2 py-1 text-[10px] transition-colors ${fullscreen ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title={fullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}
                    aria-label="Toggle fullscreen preview"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </button>
                )}
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
                {/* v25: Functional score badge — shows what % of clicks actually worked */}
                {result && !loading && !refining && probeResult && probeResult.buttonsClicked > 0 && (
                  <span
                    className={`rounded-md px-2 py-1 text-[10px] flex items-center gap-1 ${
                      probeResult.functionalScore >= 70
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : probeResult.functionalScore >= 40
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-red-500/20 text-red-400'
                    }`}
                    title={`${probeResult.functionalScore}% of buttons caused a visible change (${probeResult.functionalClicks || probeResult.buttonsClicked - probeResult.deadClicks}/${probeResult.buttonsClicked} worked, ${probeResult.deadClicks} dead clicks)`}
                  >
                    {probeResult.functionalScore}% fn
                  </span>
                )}
                {/* v3: Auto-fix button — appears when runtime errors found OR functional score is low */}
                {result && !loading && !refining && !autoFixing && (runtimeErrors.length > 0 || (probeResult && probeResult.errors.length > 0) || (probeResult && probeResult.functionalScore < 50 && probeResult.buttonsClicked > 0)) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs text-amber-400 hover:bg-amber-500/10"
                    onClick={() => autoFixLoop()}
                    title="Automatically fix broken buttons using AI"
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
                {/* v10.10: Share via URL — encodes build in URL hash */}
                {result && !loading && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={shareUrl} title="Share via URL">
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={openInNewTab} disabled={!result || loading} title="Open in new tab">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={download} disabled={!result} title="Download as ZIP">
                  <Download className="h-3.5 w-3.5" />
                  ZIP
                </Button>
                {/* v13: Direct HTML download — single file, no ZIP wrapping */}
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={downloadHtml} disabled={!result} title="Download as single HTML file">
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">HTML</span>
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => build()} disabled={loading || refining} title="Rebuild from scratch">
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Rebuild
                </Button>
                {/* v10.12: Fork — copy mission to textarea for a new variation */}
                {result && !loading && !refining && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => {
                    setMission(result.mission)
                    setResult(null)
                    resultRef.current = null
                    setRuntimeErrors([])
                    setProbeResult(null)
                    setQualityScore(0)
                    setQualityMetrics('')
                    setChatMessages([])
                    setLivePreviewHtml(null)
                    toast.info('Forked — modify the prompt and build a new variation')
                  }} title="Fork — modify prompt and build a variation">
                    <GitBranch className="h-3.5 w-3.5" />
                    Fork
                  </Button>
                )}
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
                    Ask NOVA to change anything — refine, add features, redesign
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
              {/* v13: Quick-refine suggestion chips — contextual based on mission keywords.
                  Shown when there's a result, no chat messages yet, and not refining. */}
              {result && !loading && !refining && chatMessages.length === 0 && (
                <div className="flex flex-wrap gap-1 border-t border-border/40 px-2 py-1.5">
                  {getSuggestionsForMission(result.mission).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => sendChat(s)}
                      className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] text-foreground/70 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
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
                <Button size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={() => sendChat()} disabled={refining || loading || !chatInput.trim()}>
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
                                <span className="text-foreground/60">"{sc.before}"</span>{' → '}
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
              <div className="shrink-0 border-b border-border/40 bg-card/20 px-4 py-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Build Insights</p>
                    {/* v17: Health grade badge — A/B/C/D composite rating */}
                    {qualityScore > 0 && result && (() => {
                      const health = calculateBuildHealth({
                        quality: qualityScore,
                        missingFeatures: qualityBreakdown?.missingFeatures.length ?? 0,
                        staticErrors: qualityBreakdown?.staticIssues.filter(i => i.severity === 'error').length ?? 0,
                        buildTimeMs: result.ms,
                        truncated: qualityBreakdown?.truncated ?? false,
                      })
                      return (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${health.bgColor} ${health.color}`}
                          title={health.reasons.join('\n')}
                        >
                          {health.grade} · {health.label}
                        </span>
                      )
                    })()}
                  </div>
                  {qualityScore > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-muted-foreground/20 overflow-hidden">
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
                {/* v13: Parse metrics string into individual stat cards.
                    Format: "985 lines · 28 functions · 14 listeners · 47 CSS rules" */}
                <div className="flex flex-wrap gap-2">
                  {qualityMetrics.split('·').map((m, i) => {
                    const trimmed = m.trim()
                    const parts = trimmed.match(/^(\d+)\s+(.+)$/)
                    if (!parts) return null
                    const [, num, label] = parts
                    return (
                      <div key={i} className="rounded border border-border/40 bg-background/40 px-2 py-1">
                        <span className="font-mono text-[13px] font-semibold text-foreground">{num}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground/70">{label}</span>
                      </div>
                    )
                  })}
                  {/* Token + time + size stats from the result object */}
                  {result && (
                    <>
                      <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                        <span className="font-mono text-[13px] font-semibold text-foreground">{formatTokens(result.tokens)}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground/70">tokens</span>
                      </div>
                      <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                        <span className="font-mono text-[13px] font-semibold text-foreground">{(result.ms / 1000).toFixed(1)}s</span>
                        <span className="ml-1 text-[10px] text-muted-foreground/70">build time</span>
                      </div>
                      <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
                        <span className="font-mono text-[13px] font-semibold text-foreground">{(result.html.length / 1024).toFixed(1)}KB</span>
                        <span className="ml-1 text-[10px] text-muted-foreground/70">HTML size</span>
                      </div>
                    </>
                  )}
                  {/* v15: Build timing breakdown — architect vs code generation */}
                  {buildTimings && (
                    <div className="flex w-full items-center gap-1 rounded border border-border/40 bg-background/40 px-2 py-1.5">
                      <span className="text-[9px] text-muted-foreground/50">timing:</span>
                      <span className="font-mono text-[10px] text-blue-400/80">arch {(buildTimings.architect / 1000).toFixed(1)}s</span>
                      <span className="text-muted-foreground/30">→</span>
                      <span className="font-mono text-[10px] text-emerald-400/80">code {(buildTimings.code / 1000).toFixed(1)}s</span>
                      <div className="ml-2 flex-1 h-1 rounded-full bg-muted-foreground/20 overflow-hidden flex">
                        <div className="bg-blue-500/60" style={{ width: `${(buildTimings.architect / buildTimings.total) * 100}%` }} />
                        <div className="bg-emerald-500/60" style={{ width: `${(buildTimings.code / buildTimings.total) * 100}%` }} />
                      </div>
                    </div>
                  )}
                  {/* v16: Quality breakdown — specific checks, missing features, truncation warning */}
                  {qualityBreakdown && (
                    <div className="flex w-full flex-col gap-1.5 rounded border border-border/40 bg-background/40 px-2 py-1.5">
                      {/* Truncation warning */}
                      {qualityBreakdown.truncated && (
                        <p className="flex items-center gap-1 text-[10px] text-orange-400">
                          <AlertCircle className="h-2.5 w-2.5 shrink-0" />
                          Output was truncated — build may be incomplete
                        </p>
                      )}
                      {/* Failed checks */}
                      {qualityBreakdown.checks.filter(c => !c.passed).length > 0 && (
                        <div>
                          <p className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50">Failed checks</p>
                          {qualityBreakdown.checks.filter(c => !c.passed).slice(0, 4).map((c, i) => (
                            <p key={i} className="flex items-start gap-1 text-[10px] text-red-400/80">
                              <XCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                              <span>{c.detail}</span>
                            </p>
                          ))}
                        </div>
                      )}
                      {/* Missing features */}
                      {qualityBreakdown.missingFeatures.length > 0 && (
                        <div>
                          <p className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50">Missing from plan</p>
                          {qualityBreakdown.missingFeatures.map((f, i) => (
                            <p key={i} className="flex items-start gap-1 text-[10px] text-amber-400/80">
                              <span className="mt-px text-amber-400/50">•</span>
                              <span>{f}</span>
                            </p>
                          ))}
                        </div>
                      )}
                      {/* Static issues */}
                      {qualityBreakdown.staticIssues.length > 0 && (
                        <div>
                          <p className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50">Static analysis</p>
                          {qualityBreakdown.staticIssues.map((issue, i) => (
                            <p key={i} className="flex items-start gap-1 text-[10px] text-muted-foreground/70">
                              <span className={`mt-px ${issue.severity === 'error' ? 'text-red-400/60' : 'text-amber-400/60'}`}>●</span>
                              <span>{issue.message}</span>
                            </p>
                          ))}
                        </div>
                      )}
                      {/* All checks passed */}
                      {qualityBreakdown.checks.length > 0 && qualityBreakdown.checks.every(c => c.passed) && qualityBreakdown.missingFeatures.length === 0 && (
                        <p className="flex items-center gap-1 text-[10px] text-emerald-400/70">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          All {qualityBreakdown.checks.length} quality checks passed
                        </p>
                      )}
                    </div>
                  )}
                </div>
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
                      {/* Single progress display */}
                      <div className="w-full">
                        <PipelineProgress
                          currentStage={pipelineStage ?? 'code'}
                          liveText={pipelineLiveText}
                          elapsedSeconds={elapsed}
                          mode="compact"
                        />
                      </div>
                    </div>
                  </div>
                )}
                {/* v4: DiffViewer — show before/after comparison instead of the iframe.
                    Only when showDiff is true AND we have both previous and current builds. */}
                {showDiff && previousBuild && result ? (
                  <div className="flex h-full min-h-[400px] flex-col p-2">
                    {/* v19: Comparison summary — plain-text stats showing what changed */}
                    {(() => {
                      const cmp = compareBuilds(previousBuild, result)
                      const color = cmp.isImprovement ? 'text-emerald-400' : cmp.qualityChange < 0 ? 'text-red-400' : 'text-amber-400'
                      return (
                        <div className={`mb-2 flex items-center gap-2 rounded-md border border-border/40 bg-card/20 px-3 py-1.5 text-[11px] ${color}`}>
                          {cmp.isImprovement ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
                          <span className="font-medium">{cmp.isImprovement ? 'Improved' : cmp.qualityChange < 0 ? 'Regressed' : 'Changed'}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-muted-foreground">{cmp.summary}</span>
                        </div>
                      )
                    })()}
                    <div className="min-h-0 flex-1">
                      <DiffViewer
                        oldText={previousBuild.html}
                        newText={result.html}
                        title={`Diff: ${previousBuild.mission.slice(0, 40)} → ${result.mission.slice(0, 40)}`}
                        className="h-full"
                      />
                    </div>
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

      {/* v10.13: Fullscreen preview overlay */}
      {fullscreen && result && (
        <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
          <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-2">
            <span className="truncate text-xs text-muted-foreground">{result.mission}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/50">{(result.ms / 1000).toFixed(1)}s · {formatTokens(result.tokens)} tokens</span>
              {qualityScore > 0 && (
                <span className={`rounded px-1 text-[10px] ${qualityScore >= 70 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>Q:{qualityScore}</span>
              )}
              <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => setFullscreen(false)} title="Exit fullscreen">
                <X className="h-3.5 w-3.5" />
                Exit
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <iframe
              srcDoc={result.html}
              title="Fullscreen Preview"
              sandbox="allow-scripts"
              className="h-full w-full border-0 bg-neutral-950"
            />
          </div>
        </div>
      )}

      {/* v20: Build statistics panel — shows persistent stats across sessions */}
      {showStats && buildStats.totalBuilds > 0 && (() => {
        const { details } = formatStats(buildStats)
        return (
          <div
            role="dialog"
            aria-label="Build statistics"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowStats(false)}
          >
            <div
              className="w-full max-w-md rounded-lg border border-border/40 bg-card p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Build Statistics</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Reset all build statistics? This cannot be undone.')) {
                        const empty = loadBuildStats()
                        // Use resetBuildStats via direct call
                        try { localStorage.removeItem('nova_build_stats') } catch {}
                        setBuildStats({ ...empty, totalBuilds: 0 })
                        setShowStats(false)
                        toast.success('Statistics reset')
                      }
                    }}
                    className="text-[10px] text-muted-foreground/50 hover:text-destructive"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStats(false)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Close stats"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {details.map((d, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/20 pb-1.5">
                    <span className="text-xs text-muted-foreground">{d.label}</span>
                    <span className="font-mono text-xs text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
              {buildStats.bestMission && (
                <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-400/70">Best build</p>
                  <p className="mt-0.5 text-xs text-foreground/80">{buildStats.bestMission}</p>
                </div>
              )}
              {buildStats.worstMission && buildStats.worstMission !== buildStats.bestMission && (
                <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-400/70">Worst build</p>
                  <p className="mt-0.5 text-xs text-foreground/80">{buildStats.worstMission}</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

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
                { keys: ['⌘', 'S'], label: 'Download ZIP file' },
                { keys: ['⌘', 'N'], label: 'Start a new build' },
                { keys: ['E'], label: 'Enhance prompt with AI' },
                { keys: ['I'], label: 'Toggle build insights panel' },
                { keys: ['D'], label: 'Toggle diff view (compare versions)' },
                { keys: ['F'], label: 'Toggle fullscreen preview' },
                { keys: ['S'], label: 'Toggle build statistics' },
                { keys: ['T'], label: 'Toggle prompt templates' },
                { keys: ['M'], label: 'Cycle AI model (Z.AI → Qwen → Kimi)' },
                { keys: ['/'], label: 'Slash commands menu' },
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
          <span className="flex items-center gap-2">
            <span>NOVA · The Prompt-to-Reality Engine</span>
            {history.length > 0 && (
              <span className="hidden items-center gap-1.5 sm:flex">
                <span className="text-muted-foreground/30">·</span>
                <span>{history.length} build{history.length === 1 ? '' : 's'}</span>
                {(() => {
                  const scored = history.filter(h => h.quality != null && h.quality > 0)
                  if (scored.length === 0) return null
                  const avg = Math.round(scored.reduce((s, h) => s + (h.quality ?? 0), 0) / scored.length)
                  return (
                    <>
                      <span className="text-muted-foreground/30">·</span>
                      <span className={avg >= 70 ? 'text-emerald-400/70' : 'text-amber-400/70'}>avg Q:{avg}</span>
                    </>
                  )
                })()}
              </span>
            )}
          </span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border/40 px-1">⌘+Enter</kbd> build ·
            <kbd className="ml-1 rounded border border-border/40 px-1">E</kbd> enhance ·
            <kbd className="ml-1 rounded border border-border/40 px-1">I</kbd> insights ·
            <kbd className="ml-1 rounded border border-border/40 px-1">D</kbd> diff ·
            <kbd className="ml-1 rounded border border-border/40 px-1">F</kbd> fullscreen ·
            <kbd className="ml-1 rounded border border-border/40 px-1">M</kbd> model ·
            <kbd className="ml-1 rounded border border-border/40 px-1">?</kbd> help
          </span>
          <span className="sm:hidden">⌘+Enter to build</span>
        </div>
      </footer>
    </div>
  )
}
