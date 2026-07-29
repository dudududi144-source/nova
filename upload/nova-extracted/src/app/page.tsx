'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles, Play, CheckCircle2, XCircle, Loader2, RotateCcw,
  Copy, Download, Trash, Archive,
  Brain, Terminal, ScanSearch, Package,
  Code2, Eye, Maximize2, X,
  Plus, MessageSquare, Folder, Send,
  Sun, Moon, AlertTriangle, Lightbulb, ChevronRight,
  Coins, Clock, Rocket, History, Zap, Shield, GitBranch, ExternalLink,
  Star, Tag, Bug, TrendingUp, Globe, FileCode,
  Mic, Network, DollarSign, Cloud,
  Share2, Wrench, Layers, Activity, Users, Puzzle, TestTube,
  Smartphone, Tablet, Languages, GitPullRequest, Search as SearchIcon, Footprints,
  Calculator, ListTodo, FileText, CloudSun, Music, Gamepad2, Scale, Gem, Pencil,
  FileJson, FileType, ArrowRight, Bell,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import ChatPanel from '@/components/ChatPanel'
import { cn } from '@/lib/utils'
// WebSocket import — dynamic to avoid build errors if socket.io-client not installed
let io: any = null
try { io = require('socket.io-client').io } catch {}

type Phase = 'idle' | 'building' | 'complete' | 'failed'
type AgentStatus = 'pending' | 'running' | 'done' | 'failed'

interface PipelineStage {
  agent: string
  success: boolean
  output: string
  ms: number
  runId?: string
  status?: string
  exitCode?: number
  projectId?: string
}

interface BuildResult {
  mission: string
  project: { id: string; name: string; kind: string; fileCount: number }
  runs: Record<string, { success: boolean; output: string; runId: string; status: string; exitCode: number; ms: number }>
  release: { version: string; channel: string; signed: boolean; artifactCount: number } | null
  files: { path: string; content: string }[]
  pipeline: PipelineStage[]
  allPassed: boolean
  totalMs: number
}

interface SavedProject {
  id: string
  missionId?: string
  title: string
  mission: string
  category: string
  html: string
  quality: number
  success: boolean
  filesCount: number
  durationMs: number
  createdAt: string
}

const TEMPLATES = [
  { icon: Calculator, label: 'Calculator', text: 'Build a calculator with arithmetic operations and history' },
  { icon: ListTodo, label: 'Todo App', text: 'Build a todo app with add, complete, delete, and filter' },
  { icon: FileText, label: 'Markdown Editor', text: 'Build a markdown to HTML converter with live preview' },
  { icon: Gamepad2, label: 'Snake Game', text: 'Build a snake game with score and levels' },
  { icon: CloudSun, label: 'Weather', text: 'Build a weather app with current conditions display' },
  { icon: Music, label: 'Music Player', text: 'Build a music player with playlist and controls' },
]

const PARAMETRIZED_TEMPLATES = [
  {
    icon: Gamepad2, label: 'Custom Game',
    template: 'Build a {gameType} game with {features}',
    params: [
      { name: 'gameType', label: 'Game type', placeholder: 'snake / pong / chess / 2048', default: 'snake' },
      { name: 'features', label: 'Features', placeholder: 'score, levels, sound effects', default: 'score and levels' },
    ],
  },
  {
    icon: Wrench, label: 'Custom Tool',
    template: 'Build a {toolType} tool with {features}',
    params: [
      { name: 'toolType', label: 'Tool type', placeholder: 'calculator / converter / generator', default: 'calculator' },
      { name: 'features', label: 'Features', placeholder: 'history, export, dark mode', default: 'history and export' },
    ],
  },
]

const PRESETS = [
  { id: 'fast', label: 'Fast', icon: Zap, desc: 'No retries · ~4s', target: 6 },
  { id: 'balanced', label: 'Balanced', icon: Scale, desc: '1 retry · ~6s', target: 7 },
  { id: 'quality', label: 'Quality', icon: Gem, desc: 'Max retries · ~10s', target: 9 },
] as const

const AGENT_LABELS: Record<string, { name: string; icon: any; color: string }> = {
  'pm': { name: 'PM Agent', icon: Brain, color: 'text-blue-400' },
  'architect': { name: 'Architect', icon: ScanSearch, color: 'text-purple-400' },
  'coder': { name: 'Coder', icon: Code2, color: 'text-amber-400' },
  'forge-create': { name: 'Forge Create', icon: Package, color: 'text-cyan-400' },
  'forge-build': { name: 'Forge Build', icon: Terminal, color: 'text-emerald-400' },
  'forge-test': { name: 'Forge Test', icon: CheckCircle2, color: 'text-emerald-400' },
  'forge-lint': { name: 'Forge Lint', icon: ScanSearch, color: 'text-yellow-400' },
  'forge-security': { name: 'Security', icon: Shield, color: 'text-red-400' },
  'vault-publish': { name: 'Vault Publish', icon: GitBranch, color: 'text-emerald-400' },
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [phase, setPhase] = useState<Phase>('idle')
  const [mission, setMission] = useState('')
  const [missionId, setMissionId] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])
  const [buildError, setBuildError] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [liveFiles, setLiveFiles] = useState<any[]>([])
  const [costTicker, setCostTicker] = useState<{ calls: number; tokens: number; cost: number; guardPct: number; lastMs: number; lastRetryMs: number } | null>(null)
  const [difficulty, setDifficulty] = useState<{ score: number; label: string; fileCount: number } | null>(null)
  const buildStartRef = useRef<number | null>(null)
  const [resultTab, setResultTab] = useState<'code' | 'preview' | 'tests'>('preview')
  const previewRef = useRef<HTMLIFrameElement>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [viewingDiff, setViewingDiff] = useState<any>(null)
  const [expandedLiveFile, setExpandedLiveFile] = useState<string | null>(null)
  const [streamingFile, setStreamingFile] = useState<{ path: string; content: string; displayed: number } | null>(null)
  const [refineRequest, setRefineRequest] = useState('')
  const [refining, setRefining] = useState(false)
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const [deploying, setDeploying] = useState(false)
  const [showQualityStats, setShowQualityStats] = useState(false)
  const [qualityStats, setQualityStats] = useState<any>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [diffData, setDiffData] = useState<{ before: string; after: string; path: string } | null>(null)
  // V1: Version Control
  const [buildVersion, setBuildVersion] = useState(1)
  // V2: Code Annotation
  const [annotations, setAnnotations] = useState<Record<string, Record<number, string>>>({})
  const [annotationLine, setAnnotationLine] = useState<number | null>(null)
  const [annotationText, setAnnotationText] = useState('')
  // V4: AI Code Review
  const [aiReview, setAiReview] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  // V5: Multi-language
  const [buildLanguage, setBuildLanguage] = useState<'web' | 'python' | 'node'>('web')
  // V6: Marketplace
  const [showMarketplace, setShowMarketplace] = useState(false)
  // V7: Performance Profiling
  const [perfProfile, setPerfProfile] = useState<any>(null)
  // V8: Security Audit
  const [securityAudit, setSecurityAudit] = useState<any>(null)
  const [auditing, setAuditing] = useState(false)
  // W1: Voice Input
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef<any>(null)
  // W2: Code Execution
  const [execOutput, setExecOutput] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  // W4: Build Branching
  const [branches, setBranches] = useState<any[]>([])
  // W5: AI Pair Programming
  const [pairSuggestion, setPairSuggestion] = useState<string | null>(null)
  // W6: Visual Code Map
  const [showCodeMap, setShowCodeMap] = useState(false)
  // W7: Build Cost Optimization
  const [costOptimization, setCostOptimization] = useState<string | null>(null)
  // W8: Auto-Deploy on Refine
  const [autoDeployRefine, setAutoDeployRefine] = useState(true)
  // X1: Natural Language Code Editing
  const [nlEditRequest, setNlEditRequest] = useState('')
  const [nlEditing, setNlEditing] = useState(false)
  // X2: Build Sharing
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  // X3: AI Debugging
  const [debugResult, setDebugResult] = useState<string | null>(null)
  const [debugging, setDebugging] = useState(false)
  // X4: Component Library
  const [components, setComponents] = useState<any[]>([])
  // X5: Live API Testing
  const [apiEndpoints, setApiEndpoints] = useState<any[]>([])
  const [apiTestResults, setApiTestResults] = useState<Record<string, any>>({})
  // X6: Build Analytics
  const [showAnalytics, setShowAnalytics] = useState(false)
  // X7: Team Workspaces
  const [workspaceName, setWorkspaceName] = useState('My Workspace')
  const [showWorkspace, setShowWorkspace] = useState(false)
  // X8: Plugin System
  const [plugins, setPlugins] = useState<any[]>([])
  // Y1: AI Code Completion
  const [completionSuggestion, setCompletionSuggestion] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  // Y2: Build Templates from URL
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloning, setCloning] = useState(false)
  // Y3: Multi-screen Preview
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  // Y4: Build CI/CD
  const [ciCdEnabled, setCiCdEnabled] = useState(false)
  // Y5: AI Code Translation
  const [translateTarget, setTranslateTarget] = useState<'python' | 'node' | null>(null)
  const [translating, setTranslating] = useState(false)
  // Y6: Build Cost Prediction
  const [costPrediction, setCostPrediction] = useState<string | null>(null)
  // Y7: Interactive Code Walkthrough
  const [walkthrough, setWalkthrough] = useState<string | null>(null)
  const [walkthroughLine, setWalkthroughLine] = useState(0)
  // Y8: Build Diff Between Versions
  const [showVersionDiff, setShowVersionDiff] = useState(false)
  // Y9: Code Search
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  // ── IDE Shell features (command palette + toasts + split + tabs + chat + status bar) ──
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandIndex, setCommandIndex] = useState(0)
  const [toasts, setToasts] = useState<{ id: number; kind: 'success' | 'error' | 'info'; msg: string }[]>([])
  const toastIdRef = useRef(0)
  const [splitView, setSplitView] = useState(false)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, string>>({})
  const [savedFiles, setSavedFiles] = useState<Record<string, string>>({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; content: string; files?: any[]; ts: number }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [cursorLine, setCursorLine] = useState(1)
  const [cursorCol, setCursorCol] = useState(1)

  const showToast = useCallback((kind: 'success' | 'error' | 'info', msg: string) => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, kind, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200)
  }, [])

  // ⌘K keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCommandOpen(o => !o)
      } else if (e.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Open/close file tabs
  const openFileTab = useCallback((path: string) => {
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path])
    setActiveTab(path)
    setSelectedFile(path)
  }, [])

  const closeFileTab = useCallback((path: string) => {
    setOpenTabs(prev => {
      const idx = prev.indexOf(path)
      const next = prev.filter(p => p !== path)
      if (activeTab === path) {
        const neighbor = next[idx] || next[idx - 1] || next[0] || null
        setActiveTab(neighbor)
        if (neighbor) setSelectedFile(neighbor)
      }
      return next
    })
  }, [activeTab])

  // Live editing
  const editFile = useCallback((path: string, content: string) => {
    setDirtyFiles(prev => ({ ...prev, [path]: content }))
    setResult((r: any) => r ? { ...r, files: r.files.map((f: any) => f.path === path ? { ...f, content } : f) } : r)
  }, [])

  const saveFile = useCallback((path: string) => {
    setSavedFiles(prev => ({ ...prev, [path]: dirtyFiles[path] || '' }))
    setDirtyFiles(prev => { const n = { ...prev }; delete n[path]; return n })
    showToast('success', `Saved ${path.split('/').pop()}`)
  }, [dirtyFiles, showToast])

  // Per-project chat
  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatLoading || !result?.files?.length) return
    const userMsg = { role: 'user' as const, content: msg, ts: Date.now() }
    setChatHistory(prev => [...prev, userMsg])
    setChatInput(''); setChatLoading(true)
    try {
      const res = await fetch('/api/nova/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission, files: result.files, message: msg, history: chatHistory.slice(-8) }),
      })
      const data = await res.json()
      if (data.ok) {
        const aiMsg = { role: 'assistant' as const, content: data.reply || '(no response)', files: data.files || [], ts: Date.now() }
        setChatHistory(prev => [...prev, aiMsg])
        if (data.appliedChanges && data.files?.length > 0) {
          const updatedFiles = result.files.map((orig: any) => {
            const u = data.files.find((f: any) => f.path === orig.path)
            return u ? { ...orig, content: u.content } : orig
          })
          setResult({ ...result, files: updatedFiles })
          showToast('success', `Applied changes to ${data.files.length} file(s)`)
        }
      } else {
        setChatHistory(prev => [...prev, { role: 'assistant', content: `⚠ Error: ${data.error}`, ts: Date.now() }])
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: `⚠ Network error`, ts: Date.now() }])
    }
    setChatLoading(false)
  }

  // Deploy — publish HTML to a public URL instantly
  const deployBuild = async () => {
    if (!htmlFile?.content || deploying) return
    setDeploying(true); setDeployUrl(null)
    try {
      const res = await fetch('/api/nova/deploy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlFile.content, mission }),
      })
      if (!res.ok) { setDeploying(false); return }
      const data = await res.json()
      if (data.ok && data.url) setDeployUrl(data.url)
    } catch {}
    setDeploying(false)
  }

  // Quality Stats — fetch from DB
  const fetchQualityStats = async () => {
    setShowQualityStats(true)
    try {
      const res = await fetch('/api/nova/quality-stats')
      if (res.ok) {
        const data = await res.json()
        if (data.ok) setQualityStats(data)
      }
    } catch {}
  }

  // Diff viewer — render before/after side by side
  function renderDiff(before: string, after: string): React.ReactNode {
    const beforeLines = before.split('\n')
    const afterLines = after.split('\n')
    const maxLen = Math.max(beforeLines.length, afterLines.length)
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="overflow-auto rounded-lg border border-red-500/20 bg-red-500/5 p-2">
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-red-500">Before</p>
          {beforeLines.slice(0, 50).map((line, i) => (
            <div key={i} className="font-mono text-[10px] text-red-300/70">{line || ' '}</div>
          ))}
          {beforeLines.length > 50 && <div className="text-[9px] text-muted-foreground">... ({beforeLines.length - 50} more)</div>}
        </div>
        <div className="overflow-auto rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-emerald-500">After</p>
          {afterLines.slice(0, 50).map((line, i) => (
            <div key={i} className="font-mono text-[10px] text-emerald-300/70">{line || ' '}</div>
          ))}
          {afterLines.length > 50 && <div className="text-[9px] text-muted-foreground">... ({afterLines.length - 50} more)</div>}
        </div>
      </div>
    )
  }

  // V1: Version Control — save version to localStorage
  const saveVersion = () => {
    if (!result?.files) return
    try {
      const versions = JSON.parse(localStorage.getItem('nova_versions') || '[]')
      versions.push({ version: buildVersion, mission, files: result.files, qualityScore, timestamp: new Date().toISOString() })
      localStorage.setItem('nova_versions', JSON.stringify(versions.slice(0, 20)))
      setBuildVersion(v => v + 1)
    } catch {}
  }

  // V2: Code Annotation — add note to a line
  const addAnnotation = (path: string, line: number, text: string) => {
    if (!text.trim()) return
    setAnnotations(prev => ({ ...prev, [path]: { ...(prev[path] || {}), [line]: text.trim() } }))
    setAnnotationLine(null); setAnnotationText('')
  }

  // V3: Export to GitHub — generate a git repo as ZIP
  const exportToGithub = async () => {
    if (!result?.files?.length) return
    const readme = `# ${mission.slice(0, 60)}\n\nGenerated by NOVA · Build Anything\n\n## Files\n${result.files.map(f => `- \`${f.path}\``).join('\n')}\n`
    const gitignore = 'node_modules/\n.env\ndist/\nbuild/\n*.log\n'
    const allFiles = [{ path: 'README.md', content: readme }, { path: '.gitignore', content: gitignore }, ...result.files]
    try {
      const res = await fetch('/api/nova/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: allFiles, name: (mission || 'project').slice(0, 30) + '-github' }) })
      const data = await res.json()
      if (data.ok && data.zip) {
        const blob = new Blob([Uint8Array.from(atob(data.zip), c => c.charCodeAt(0))], { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = data.filename; a.click(); URL.revokeObjectURL(url)
      }
    } catch {}
  }

  // V4: AI Code Review
  const runAiReview = async () => {
    if (!result?.files?.length || reviewing) return
    setReviewing(true); setAiReview(null)
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission, files: result.files, refineRequest: 'Review this code as a senior developer. List 3 strengths and 3 areas for improvement. Be concise.' }),
      })
      if (!res.ok) { setReviewing(false); return }
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) { setAiReview((completeEv.payload?.files?.[0]?.content || 'Review complete').slice(0, 500)); stopped = true; setReviewing(false); return }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setReviewing(false) }
  }

  // V5: Multi-language templates
  const languageTemplates: Record<string, { emoji: string; label: string; text: string }[]> = {
    web: TEMPLATES,
    python: [
      { icon: 'Snake', label: 'Fibonacci', text: 'Build a Python fibonacci sequence generator' },
      { icon: 'Calculator', label: 'Calculator', text: 'Build a Python calculator with argparse' },
      { icon: 'Chart', label: 'Data Parser', text: 'Build a Python CSV parser with statistics' },
    ],
    node: [
      { icon: 'Rocket', label: 'REST API', text: 'Build a Node.js REST API with Express' },
      { icon: 'MessageSquare', label: 'Chat Server', text: 'Build a Node.js WebSocket chat server' },
    ],
  }

  // V6: Marketplace
  const shareTemplate = (template: { icon: string; label: string; text: string }) => {
    try {
      const marketplace = JSON.parse(localStorage.getItem('nova_marketplace') || '[]')
      marketplace.push({ ...template, id: 'mkt_' + Date.now(), sharedBy: 'you', sharedAt: new Date().toISOString() })
      localStorage.setItem('nova_marketplace', JSON.stringify(marketplace.slice(0, 50)))
    } catch {}
  }

  // V7: Performance Profiling
  const runPerfProfile = () => {
    if (!result?.files?.length) return
    const profile: any = { files: [], totalLines: 0, totalChars: 0 }
    for (const f of result.files) {
      const lines = f.content.split('\n').length
      const complexity = (f.content.match(/if|for|while|switch|catch/g) || []).length
      profile.files.push({ path: f.path, lines, complexity })
      profile.totalLines += lines
      profile.totalChars += f.content.length
    }
    profile.avgFileLength = Math.round(profile.totalLines / result.files.length)
    setPerfProfile(profile)
  }

  // V8: Security Audit
  const runSecurityAudit = () => {
    if (!result?.files?.length || auditing) return
    setAuditing(true)
    const findings: any[] = []
    for (const f of result.files) {
      f.content.split('\n').forEach((line: string, i: number) => {
        if (/eval\s*\(/.test(line)) findings.push({ severity: 'high', file: f.path, line: i + 1, issue: 'eval() usage' })
        if (/innerHTML\s*=/.test(line)) findings.push({ severity: 'med', file: f.path, line: i + 1, issue: 'innerHTML assignment' })
        if (/document\.write/.test(line)) findings.push({ severity: 'high', file: f.path, line: i + 1, issue: 'document.write()' })
        if (/password|secret|api_key/i.test(line) && /=/.test(line)) findings.push({ severity: 'med', file: f.path, line: i + 1, issue: 'Hardcoded credential' })
      })
    }
    setSecurityAudit({ findings, safe: !findings.some(f => f.severity === 'high') })
    setAuditing(false)
  }

  // W1: Voice Input — Web Speech API
  const toggleVoice = () => {
    if (recording) {
      recognitionRef.current?.stop()
      setRecording(false)
      return
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) { alert('Voice input not supported in this browser'); return }
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript
      setMission(transcript)
    }
    recognition.onerror = () => setRecording(false)
    recognition.onend = () => setRecording(false)
    recognition.start()
    recognitionRef.current = recognition
    setRecording(true)
  }

  // W2: Code Execution — run JS in sandboxed iframe
  const executeCode = () => {
    if (!currentFile?.content || executing) return
    setExecuting(true); setExecOutput(null)
    try {
      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.sandbox = 'allow-scripts'
      document.body.appendChild(iframe)
      const logs: string[] = []
      iframe.contentWindow!.console.log = (...args: any[]) => { logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')) }
      iframe.contentWindow!.console.error = (...args: any[]) => { logs.push('ERROR: ' + args.map(a => String(a)).join(' ')) }
      try {
        iframe.contentWindow!.eval(currentFile.content)
      } catch (err) {
        logs.push('ERROR: ' + (err instanceof Error ? err.message : String(err)))
      }
      setExecOutput(logs.join('\n') || '(no output)')
      setTimeout(() => document.body.removeChild(iframe), 100)
    } catch (err) {
      setExecOutput('Error: ' + (err instanceof Error ? err.message : String(err)))
    }
    setExecuting(false)
  }

  // W4: Build Branching — save branch from current build
  const createBranch = () => {
    if (!result?.files) return
    try {
      const stored = JSON.parse(localStorage.getItem('nova_branches') || '[]')
      stored.push({
        id: 'br_' + Date.now(),
        parentVersion: buildVersion,
        mission: mission + ' (branch)',
        files: result.files,
        qualityScore,
        createdAt: new Date().toISOString(),
      })
      localStorage.setItem('nova_branches', JSON.stringify(stored.slice(0, 20)))
      setBranches(stored)
    } catch {}
  }

  // W5: AI Pair Programming — get inline suggestion
  const getPairSuggestion = async () => {
    if (!currentFile?.content) return
    setPairSuggestion('Analyzing...')
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission,
          files: [{ path: currentFile.path, content: currentFile.content }],
          refineRequest: 'Suggest ONE improvement to this file. Be very concise (2-3 sentences max).',
        }),
      })
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) { setPairSuggestion((completeEv.payload?.files?.[0]?.content || 'No suggestion').slice(0, 300)); stopped = true; return }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setPairSuggestion('Error getting suggestion') }
  }

  // W6: Visual Code Map — render dependency graph
  const renderCodeMap = (): React.ReactNode => {
    if (!result?.files?.length) return null
    const files = result.files
    const nodes = files.map((f, i) => ({ x: 50 + (i % 3) * 120, y: 50 + Math.floor(i / 3) * 80, path: f.path }))
    const edges: { from: number; to: number }[] = []
    files.forEach((f, i) => {
      files.forEach((f2, j) => {
        if (i !== j && f.content.includes(f2.path.replace(/\.(js|ts)$/, ''))) edges.push({ from: i, to: j })
      })
    })
    return (
      <svg width="100%" height="200" className="bg-[#0a0e1a]">
        {edges.map((e, i) => (
          <line key={i} x1={nodes[e.from].x} y1={nodes[e.from].y} x2={nodes[e.to].x} y2={nodes[e.to].y} stroke="#3b82f6" strokeWidth="1" opacity="0.5" />
        ))}
        {nodes.map((n, i) => (
          <g key={i}>
            <rect x={n.x - 40} y={n.y - 12} width="80" height="24" rx="4" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fill="#60a5fa" fontSize="9" fontFamily="monospace">{n.path.slice(0, 12)}</text>
          </g>
        ))}
      </svg>
    )
  }

  // W7: Build Cost Optimization — analyze and suggest
  const analyzeCost = () => {
    if (!costTicker) return
    const tips: string[] = []
    if (costTicker.calls > 10) tips.push(`Reduce LLM calls: ${costTicker.calls} calls used. Use dedup cache for repeated missions.`)
    if (costTicker.cost > 0.03) tips.push(`Lower cost: $${costTicker.cost.toFixed(4)} — try 'Fast' preset for simpler builds.`)
    if (costTicker.lastRetryMs > 0) tips.push(`429 retries cost time: ${costTicker.lastRetryMs}ms wasted. Wait between builds.`)
    if (difficulty && difficulty.score > 7) tips.push(`High difficulty (${difficulty.score}/10) — break into smaller builds.`)
    if (tips.length === 0) tips.push('✅ Build cost is optimal!')
    setCostOptimization(tips.join('\n'))
  }

  // W8: Auto-Deploy on Refine — auto publish after refine completes
  // (integrated into refineBuild — if autoDeployRefine, auto-deploy after complete)

  // X1: Natural Language Code Editing — "change the button color to blue"
  const nlEdit = async () => {
    const req = nlEditRequest.trim()
    if (!req || nlEditing || !currentFile) return
    setNlEditing(true)
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission,
          files: [{ path: currentFile.path, content: currentFile.content }],
          refineRequest: req,
        }),
      })
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) {
                const updatedFile = completeEv.payload?.files?.find((f: any) => f.path === currentFile.path)
                if (updatedFile) {
                  // Update the file in result
                  setResult((r: any) => ({
                    ...r,
                    files: r.files.map((f: any) => f.path === currentFile.path ? { ...f, content: updatedFile.content } : f),
                  }))
                }
                setNlEditing(false); setNlEditRequest('')
                stopped = true
              }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setNlEditing(false) }
  }

  // X2: Build Sharing — share build with public URL
  const shareBuild = async () => {
    if (!htmlFile?.content) return
    try {
      const res = await fetch('/api/nova/deploy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlFile.content, mission: `shared: ${mission}` }),
      })
      const data = await res.json()
      if (data.ok && data.url) {
        setShareUrl(data.url)
        try { navigator.clipboard?.writeText(data.url) } catch {}
      }
    } catch {}
  }

  // X3: AI Debugging — auto-fix on execution failure
  const aiDebug = async () => {
    if (!execOutput || !debugging) return
    setDebugging(true); setDebugResult(null)
    try {
      const errorLines = execOutput.split('\n').filter(l => l.includes('Error') || l.includes('ERROR'))
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission,
          files: result.files,
          refineRequest: `Debug this error:\n${errorLines.join('\n')}\n\nFix the code to resolve this error.`,
        }),
      })
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) {
                setDebugResult((completeEv.payload?.files?.[0]?.content || 'Debug complete').slice(0, 500))
                if (completeEv.payload?.files) {
                  setResult((r: any) => ({ ...r, files: completeEv.payload.files, allRepoFiles: completeEv.payload.allRepoFiles || completeEv.payload.files }))
                }
                setDebugging(false); stopped = true
              }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setDebugging(false) }
  }

  // X4: Component Library — save reusable components from builds
  const saveComponent = (name: string, code: string, type: string) => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_components') || '[]')
      stored.push({ id: 'comp_' + Date.now(), name, code, type, savedAt: new Date().toISOString() })
      localStorage.setItem('nova_components', JSON.stringify(stored.slice(0, 50)))
      setComponents(stored)
    } catch {}
  }

  // X5: Live API Testing — detect and test API endpoints
  const detectApiEndpoints = () => {
    if (!result?.files) return
    const endpoints: any[] = []
    for (const f of result.files) {
      // Detect Express/Fastify routes
      const matches = f.content.matchAll(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]*)['"`]/g)
      for (const m of matches) {
        endpoints.push({ method: m[1].toUpperCase(), path: m[2], file: f.path })
      }
    }
    setApiEndpoints(endpoints)
  }

  const testApiEndpoint = async (endpoint: any) => {
    const key = `${endpoint.method} ${endpoint.path}`
    setApiTestResults(prev => ({ ...prev, [key]: { loading: true } }))
    try {
      // Real test: fetch the deployed URL + path
      const baseUrl = deployUrl || (htmlFile ? URL.createObjectURL(new Blob([htmlFile.content], { type: 'text/html' })) : null)
      if (!baseUrl) {
        setApiTestResults(prev => ({ ...prev, [key]: { status: 0, response: 'Deploy the build first to test API endpoints', ok: false } }))
        return
      }
      const testUrl = endpoint.method === 'GET' ? `${baseUrl}${endpoint.path}` : baseUrl
      const res = await fetch(testUrl, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: endpoint.method !== 'GET' ? JSON.stringify({ test: true }) : undefined,
      })
      const text = await res.text().catch(() => '(no response body)')
      setApiTestResults(prev => ({
        ...prev,
        [key]: {
          status: res.status,
          response: text.slice(0, 200),
          ok: res.ok,
        },
      }))
    } catch (err) {
      setApiTestResults(prev => ({ ...prev, [key]: { status: 0, response: err instanceof Error ? err.message : String(err), ok: false } }))
    }
  }

  // X6: Build Analytics — aggregate from localStorage
  const fetchAnalytics = () => {
    setShowAnalytics(true)
    try {
      const projects = JSON.parse(localStorage.getItem('nova_projects') || '[]')
      const analytics = {
        totalBuilds: projects.length,
        avgQuality: projects.length ? (projects.reduce((s: number, p: any) => s + (p.quality || 0), 0) / projects.length).toFixed(2) : 0,
        avgDuration: projects.length ? Math.round(projects.reduce((s: number, p: any) => s + (p.durationMs || 0), 0) / projects.length) : 0,
        successRate: projects.length ? Math.round(projects.filter((p: any) => p.success).length / projects.length * 100) : 0,
        types: {},
      }
      projects.forEach((p: any) => { analytics.types[p.category] = (analytics.types[p.category] || 0) + 1 })
      setQualityStats({ ...qualityStats, analytics })
    } catch {}
  }

  // X7: Team Workspaces — save to shared localStorage
  const saveToWorkspace = () => {
    if (!result?.files) return
    try {
      const workspaces = JSON.parse(localStorage.getItem('nova_workspaces') || '{}')
      if (!workspaces[workspaceName]) workspaces[workspaceName] = { builds: [], members: ['you'] }
      workspaces[workspaceName].builds.push({
        mission, files: result.files, qualityScore, timestamp: new Date().toISOString(),
      })
      localStorage.setItem('nova_workspaces', JSON.stringify(workspaces))
    } catch {}
  }

  // X8: Plugin System — custom agents
  const addPlugin = (name: string, prompt: string, stage: string) => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_plugins') || '[]')
      stored.push({ id: 'plug_' + Date.now(), name, prompt, stage, createdAt: new Date().toISOString() })
      localStorage.setItem('nova_plugins', JSON.stringify(stored.slice(0, 20)))
      setPlugins(stored)
    } catch {}
  }

  // Y1: AI Code Completion — suggest next lines
  const getCompletion = async () => {
    if (!currentFile?.content || completing) return
    setCompleting(true); setCompletionSuggestion(null)
    try {
      const lines = currentFile.content.split('\n')
      const lastLines = lines.slice(-10).join('\n')
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission,
          files: [{ path: currentFile.path, content: currentFile.content }],
          refineRequest: `Complete the next 5 lines of this code. Only return the new code, nothing else.\n\nLast lines:\n${lastLines}`,
        }),
      })
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) { setCompletionSuggestion((completeEv.payload?.files?.[0]?.content || '').slice(0, 300)); stopped = true; setCompleting(false); return }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setCompleting(false) }
  }

  // Y2: Build Templates from URL — clone a website
  const cloneFromUrl = async () => {
    const url = cloneUrl.trim()
    if (!url || cloning) return
    setCloning(true)
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission: `Clone this website: ${url}`,
          files: [{ path: 'index.html', content: '<!DOCTYPE html><html><body></body></html>' }],
          refineRequest: `Clone the website at ${url}. Build an HTML file that looks similar to it. Include CSS and basic structure.`,
        }),
      })
      const data = await res.json()
      if (data?.missionId) { setMissionId(data.missionId); setPhase('building'); setEvents([]); setLiveFiles([]); setResult(null) }
    } catch { setCloning(false) }
  }

  // Y3: Multi-screen Preview — device width
  const deviceWidth = previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%'

  // Y4: Build CI/CD — auto re-build on refine
  // (integrated into refineBuild — if ciCdEnabled, auto-run tests + deploy after refine)

  // Y5: AI Code Translation — translate code between languages
  const translateCode = async (target: 'python' | 'node') => {
    if (!currentFile?.content || translating) return
    setTranslating(true); setTranslateTarget(target)
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission: `Translate ${currentFile.path} to ${target}`,
          files: [{ path: currentFile.path, content: currentFile.content }],
          refineRequest: `Translate this code to ${target === 'python' ? 'Python 3' : 'Node.js'}. Keep the same functionality. Return ONLY the translated code.`,
        }),
      })
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) {
                const translated = completeEv.payload?.files?.[0]?.content || ''
                setResult((r: any) => ({ ...r, files: [...r.files, { path: currentFile.path.replace(/\.\w+$/, target === 'python' ? '.py' : '.js'), content: translated, language: target === 'python' ? 'python' : 'javascript' }] }))
                setTranslating(false); setTranslateTarget(null); stopped = true
              }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setTranslating(false); setTranslateTarget(null) }
  }

  // Y6: Build Cost Prediction — AI estimate from mission text
  const predictCost = async () => {
    const m = mission.trim()
    if (!m) return
    setCostPrediction('Asking AI...')
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission: m,
          files: [{ path: 'placeholder.js', content: '// placeholder' }],
          refineRequest: `Predict the build cost for: "${m}". Return ONLY: "X files, Y tokens, $Z, Ws" (X=estimated file count, Y=estimated tokens, Z=estimated cost, W=estimated duration in seconds).`,
        }),
      })
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) { setCostPrediction((completeEv.payload?.files?.[0]?.content || 'No prediction').slice(0, 200)); stopped = true; return }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setCostPrediction('Error') }
  }

  // Y7: Interactive Code Walkthrough — LLM explains line-by-line
  const startWalkthrough = async () => {
    if (!currentFile?.content) return
    setWalkthroughLine(0); setWalkthrough('Asking LLM to explain this code...')
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission,
          files: [{ path: currentFile.path, content: currentFile.content }],
          refineRequest: 'Explain this code line-by-line for a junior developer. For each line, write: "Line N: <explanation>". Cover the first 10 lines.',
        }),
      })
      const data = await res.json()
      if (data?.missionId) {
        let stopped = false
        const poll = async () => {
          if (stopped) return
          try {
            const evRes = await fetch(`/api/nova/mission-events/${data.missionId}?all=1`)
            if (evRes.ok) {
              const evData = await evRes.json()
              const completeEv = evData.events?.find((e: any) => e.eventType === 'mission.complete')
              if (completeEv) {
                const explanation = (completeEv.payload?.files?.[0]?.content || 'No explanation').slice(0, 500)
                setWalkthrough(explanation)
                setWalkthroughLine(10)
                stopped = true
              }
            }
          } catch {}
          setTimeout(poll, 2000)
        }
        poll()
      }
    } catch { setWalkthrough('Error getting walkthrough') }
  }

  // Y8: Build Diff Between Versions — show actual diff viewer
  const showDiffBetweenVersions = () => {
    try {
      const versions = JSON.parse(localStorage.getItem('nova_versions') || '[]')
      if (versions.length < 2) { alert('Need at least 2 saved versions. Click v1 button first to save versions.'); return }
      const v1 = versions[versions.length - 2]
      const v2 = versions[versions.length - 1]
      const file1 = v1.files?.[0]
      const file2 = v2.files?.[0]
      if (file1 && file2) {
        setDiffData({ before: file1.content, after: file2.content, path: `${file1.path} (v${v1.version} → v${v2.version})` })
        setShowDiff(true)
      }
    } catch {}
  }

  // Y9: Code Search — search across all build files
  const searchInFiles = () => {
    const term = searchTerm.trim()
    if (!term || !result?.files) return
    const results: any[] = []
    for (const f of result.files) {
      const lines = f.content.split('\n')
      lines.forEach((line: string, i: number) => {
        if (line.toLowerCase().includes(term.toLowerCase())) {
          results.push({ file: f.path, line: i + 1, content: line.trim() })
        }
      })
    }
    setSearchResults(results)
  }
  const refineBuild = async () => {
    const req = refineRequest.trim()
    if (!req || refining) return
    if (!result?.files?.length) return
    // Save before-state for diff
    const beforeFiles = result.files.map(f => ({ ...f }))
    setRefining(true); setBuildError(null)
    try {
      const res = await fetch('/api/nova/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission, files: result.files, refineRequest: req }),
      })
      if (!res.ok) { setBuildError(`Server ${res.status}`); setRefining(false); return }
      const data = await res.json()
      if (data?.missionId) {
        setMissionId(data.missionId)
        setPhase('building')
        setEvents([]); setLiveFiles([]); setResult(null)
        // Store before for diff after refine completes
        // The polling useEffect will handle completion + we can show diff then
        // For now, store the before in a ref
        ;(window as any).__novaBeforeRefine = beforeFiles
        ;(window as any).__novaRefineRequest = req
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err)); setRefining(false)
    }
  }

  // Streaming typing effect — when a new file is built, animate it appearing char-by-char
  useEffect(() => {
    if (!streamingFile || streamingFile.displayed >= streamingFile.content.length) return
    const t = setTimeout(() => {
      setStreamingFile(s => s ? { ...s, displayed: Math.min(s.content.length, s.displayed + 50) } : null)
    }, 20) // 50 chars per 20ms = 2500 chars/sec — fast but visible
    return () => clearTimeout(t)
  }, [streamingFile])

  // UI state
  const [activePreset, setActivePreset] = useState<'fast' | 'balanced' | 'quality'>('balanced')
  const [showProjects, setShowProjects] = useState(true)
  const [activeParamTemplate, setActiveParamTemplate] = useState<any>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [customTemplates, setCustomTemplates] = useState<{ id: string; icon: string; label: string; text: string }[]>([])
  const [showTemplateEditor, setShowTemplateEditor] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<{ id: string; icon: string; label: string; text: string } | null>(null)
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([])
  const [showGallery, setShowGallery] = useState(false)
  const [zipping, setZipping] = useState(false)

  // Mission rewrite suggestions (client-side heuristic, NO LLM)
  const missionSuggestions = useMemo(() => {
    const m = mission.trim()
    if (!m) return []
    const sugs: { original: string; rewritten: string; reason: string }[] = []
    if (m.length < 15) {
      sugs.push({
        original: m,
        rewritten: m.startsWith('Build') ? `${m} with core features and good UI` : `Build a ${m.toLowerCase()} with core features and good UI`,
        reason: 'Too short — add details for better results',
      })
    }
    if (m.length > 200) {
      const truncated = m.slice(0, 200)
      const lastDot = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'))
      sugs.push({
        original: m,
        rewritten: lastDot > 80 ? truncated.slice(0, lastDot + 1) : truncated + '...',
        reason: 'Too long — trimmed at sentence boundary',
      })
    }
    if (!/^(build|create|make|generate|design|implement|write)\b/i.test(m) && m.length >= 15) {
      sugs.push({
        original: m,
        rewritten: `Build ${m.charAt(0).toLowerCase()}${m.slice(1)}`,
        reason: 'Start with "Build" for clearer intent',
      })
    }
    if (m === m.toUpperCase() && m.length > 5) {
      sugs.push({
        original: m,
        rewritten: m.charAt(0) + m.slice(1).toLowerCase(),
        reason: 'All caps detected — switch to normal case',
      })
    }
    return sugs
  }, [mission])

  // Build history + dedup
  const dedupMatch = useMemo(() => {
    if (!mission.trim() || mission.trim().length < 10) return null
    const simplified = mission.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
    if (simplified.length === 0) return null
    let best: SavedProject | null = null
    let bestSim = 0
    for (const p of savedProjects) {
      const tokens = p.mission.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
      if (tokens.length === 0) continue
      let inter = 0
      for (const w of simplified) if (tokens.includes(w)) inter++
      const uni = simplified.length + tokens.length - inter
      const sim = uni > 0 ? inter / uni : 0
      if (sim > bestSim) { bestSim = sim; best = p }
    }
    return bestSim > 0.85 && best?.success ? { project: best, similarity: bestSim } : null
  }, [mission, savedProjects])

  // Smart post-build suggestions
  const postBuildSuggestions = useMemo(() => {
    if (phase !== 'complete' || !result) return []
    const subtype = (result.project?.kind || result.mission || '').toLowerCase()
    const sugs: { emoji: string; label: string; text: string }[] = []
    if (/calc|calculator/.test(subtype)) {
      sugs.push({ emoji: '🔢', label: 'Unit Converter', text: 'Build a unit converter with length, weight, and temperature' })
      sugs.push({ icon: TrendingUp, label: 'Currency', text: 'Build a currency converter with multiple currencies' })
    } else if (/snake|game/.test(subtype)) {
      sugs.push({ icon: Gamepad2, label: 'Pong', text: 'Build a pong game with AI opponent' })
      sugs.push({ icon: Gamepad2, label: '2048', text: 'Build a 2048 game with score tracking' })
    } else if (/todo|task/.test(subtype)) {
      sugs.push({ icon: ListTodo, label: 'Kanban', text: 'Build a kanban board with drag and drop' })
      sugs.push({ icon: Clock, label: 'Calendar', text: 'Build a calendar app with reminders' })
    } else if (/markdown|editor/.test(subtype)) {
      sugs.push({ icon: FileText, label: 'Rich Editor', text: 'Build a rich text editor with formatting toolbar' })
    } else {
      sugs.push({ icon: ListTodo, label: 'Todo', text: 'Build a todo app with localStorage and filters' })
      sugs.push({ icon: Calculator, label: 'Calculator', text: 'Build a calculator with scientific functions' })
      sugs.push({ icon: Gamepad2, label: 'Snake', text: 'Build a snake game with score and levels' })
    }
    return sugs
  }, [phase, result])

  // Load state
  useEffect(() => {
    setMounted(true)
    try { const t = localStorage.getItem('nova_theme'); if (t === 'light' || t === 'dark') setTheme(t) } catch {}
    try {
      const stored = JSON.parse(localStorage.getItem('nova_projects') || '[]')
      if (stored.length > 0) setSavedProjects(stored)
    } catch {}
    try {
      const stored = JSON.parse(localStorage.getItem('nova_custom_templates') || '[]')
      if (Array.isArray(stored)) setCustomTemplates(stored)
    } catch {}
  }, [])

  // Theme
  useEffect(() => {
    if (mounted) { document.documentElement.classList.toggle('light', theme === 'light'); try { localStorage.setItem('nova_theme', theme) } catch {} }
  }, [theme, mounted])

  // Live timer
  useEffect(() => {
    if (phase !== 'building' || !buildStartRef.current) return
    const iv = setInterval(() => {
      if (buildStartRef.current) setElapsedSec(Math.floor((Date.now() - buildStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(iv)
  }, [phase])

  // Stats
  const stats = useMemo(() => {
    if (savedProjects.length === 0) return null
    const q = savedProjects.map(p => p.quality || 0).filter(x => x > 0)
    return {
      count: savedProjects.length,
      avg: q.length ? (q.reduce((s, x) => s + x, 0) / q.length).toFixed(1) : '0',
      best: q.length ? Math.max(...q).toFixed(1) : '0',
    }
  }, [savedProjects])

  // Quality score
  const qualityScore = useMemo(() => {
    if (!result) return null
    // pipeline can be a string ("nova-8stage") or an array of stages
    const stages = Array.isArray(result.pipeline) ? result.pipeline : []
    if (stages.length === 0) return result.qualityScore != null ? String(result.qualityScore) : null
    const passCount = stages.filter((p: any) => p.success).length
    return (passCount / stages.length * 10).toFixed(1)
  }, [result])

  // Build function — uses LLM-powered master-mission pipeline
  const startBuild = async (text?: string, skipConfirm = false) => {
    const m = (text ?? mission).trim()
    if (!m || phase === 'building') return
    setMission(m); setResult(null); setEvents([]); setPhase('building'); setBuildError(null)
    setLiveFiles([]); setSelectedFile(null); setViewingDiff(null)
    buildStartRef.current = Date.now(); setElapsedSec(0)
    try {
      const res = await fetch('/api/nova/master-mission', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: m, stream: true }),
      })
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}))
        const mins = Math.ceil((data.retryAfter || 3600) / 60)
        setBuildError(`Rate limited — try again in ${mins} min`)
        setPhase('failed'); return
      }
      if (!res.ok) { setBuildError(`Server ${res.status}`); setPhase('failed'); return }
      const data = await res.json()
      // If cached build found, load it
      if (data?.cachedBuild) {
        const cb = data.cachedBuild
        setResult({
          mission: m,
          project: { id: '', name: cb.mission?.slice(0, 50) || m.slice(0, 50), kind: cb.subType || 'web-app', fileCount: 1 },
          runs: {}, release: null,
          files: [{ path: 'index.html', content: cb.html }],
          pipeline: [], allPassed: true, totalMs: 0, durationMs: 0,
          qualityScore: 7.5,
        } as any)
        setPhase('complete'); return
      }
      if (data?.missionId) {
        setMissionId(data.missionId)
        // Event polling will be handled by useEffect on missionId
      } else {
        setBuildError('No mission ID'); setPhase('failed')
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err)); setPhase('failed')
    }
  }

  // Event polling — fetches events from the LLM pipeline
  // Falls back to polling if WebSocket is unavailable
  useEffect(() => {
    if (!missionId) return
    let stopped = false, lastSeq = 0, count = 0

    // Try WebSocket first (real-time push)
    let socket: any = null
    try {
      socket = io('/?XTransformPort=3003', { transports: ['websocket'], timeout: 2000 })
      socket.on('connect', () => {
        socket.emit('subscribe', missionId)
      })
      socket.on('mission:event', (ev: any) => {
        if (stopped) return
        setEvents(prev => [...prev, ev])
        if (ev.seq > lastSeq) lastSeq = ev.seq
        // Handle events (same as polling handler)
        if (ev.eventType === 'file.built') {
          setLiveFiles(prev => {
            const existing = prev.findIndex(f => f.path === ev.payload?.path)
            if (existing >= 0) { const u = [...prev]; u[existing] = ev.payload; return u }
            return [...prev, ev.payload]
          })
          if (ev.payload?.content) setStreamingFile({ path: ev.payload.path, content: ev.payload.content, displayed: 0 })
        }
        if (ev.eventType === 'cost.update' && ev.payload) {
          setCostTicker({ calls: ev.payload.callNumber || 0, tokens: ev.payload.totalTokens || 0, cost: ev.payload.totalCost || 0, guardPct: ev.payload.costGuardPct || 0, lastMs: ev.payload.ms || 0, lastRetryMs: ev.payload.retryWaitMs || 0 })
        }
        if (ev.eventType === 'difficulty.report' && ev.payload) {
          setDifficulty({ score: ev.payload.score || 0, label: ev.payload.label || 'medium', fileCount: ev.payload.fileCount || 0 })
        }
        if (ev.eventType === 'mission.complete') {
          const payload = ev.payload || ev
          setResult(payload)
          setPhase(payload?.success === false ? 'failed' : 'complete')
          if (payload?.success !== false && payload?.allRepoFiles?.length) {
            try {
              const stored = JSON.parse(localStorage.getItem('nova_projects') || '[]')
              const htmlFile = payload.allRepoFiles.find((f: any) => /\.html$/i.test(f.path || ''))
              const project: SavedProject = {
                id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                missionId, title: payload?.classification?.title || mission.slice(0, 60), mission,
                category: payload?.classification?.subtype || payload?.classification?.type || 'web-app',
                html: htmlFile?.content || payload.allRepoFiles[0]?.content || '',
                quality: payload?.qualityScore ?? 0, success: payload?.success !== false,
                filesCount: payload.allRepoFiles.length, durationMs: payload?.durationMs ?? 0,
                createdAt: new Date().toISOString(),
              }
              localStorage.setItem('nova_projects', JSON.stringify([project, ...stored].slice(0, 50)))
              setSavedProjects([project, ...stored].slice(0, 50))
            } catch {}
            if (ciCdEnabled && payload?.success !== false) {
              setTimeout(async () => {
                const findings: any[] = []
                for (const f of payload.allRepoFiles) {
                  f.content?.split('\n').forEach((line: string, i: number) => {
                    if (/eval\s*\(/.test(line)) findings.push({ severity: 'high', file: f.path, line: i + 1, issue: 'eval()' })
                    if (/innerHTML\s*=/.test(line)) findings.push({ severity: 'med', file: f.path, line: i + 1, issue: 'innerHTML' })
                  })
                }
                setSecurityAudit({ findings, safe: !findings.some(f => f.severity === 'high') })
                const htmlFile = payload.allRepoFiles.find((f: any) => /\.html$/i.test(f.path || ''))
                if (htmlFile?.content) {
                  try {
                    const deployRes = await fetch('/api/nova/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: htmlFile.content, mission }) })
                    const deployData = await deployRes.json()
                    if (deployData.ok && deployData.url) setDeployUrl(deployData.url)
                  } catch {}
                }
              }, 1000)
            }
          }
          stopped = true; socket?.disconnect(); return
        }
        if (ev.eventType === 'mission.fail') { setPhase('failed'); stopped = true; socket?.disconnect(); return }
      })
      socket.on('connect_error', () => {
        // Fallback to polling if WebSocket fails
        socket = null
      })
    } catch { socket = null }

    // Fallback: polling every 1s
    const poll = async () => {
      if (stopped || socket) return
      try {
        const res = await fetch(`/api/nova/mission-events/${missionId}?since=${lastSeq}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.events?.length > 0) {
          for (const ev of data.events) {
            setEvents(prev => [...prev, ev])
            if (ev.seq > lastSeq) lastSeq = ev.seq
            if (ev.eventType === 'file.built') {
              setLiveFiles(prev => {
                const existing = prev.findIndex(f => f.path === ev.payload?.path)
                if (existing >= 0) { const u = [...prev]; u[existing] = ev.payload; return u }
                return [...prev, ev.payload]
              })
              if (ev.payload?.content) setStreamingFile({ path: ev.payload.path, content: ev.payload.content, displayed: 0 })
            }
            if (ev.eventType === 'cost.update' && ev.payload) {
              setCostTicker({ calls: ev.payload.callNumber || 0, tokens: ev.payload.totalTokens || 0, cost: ev.payload.totalCost || 0, guardPct: ev.payload.costGuardPct || 0, lastMs: ev.payload.ms || 0, lastRetryMs: ev.payload.retryWaitMs || 0 })
            }
            if (ev.eventType === 'difficulty.report' && ev.payload) {
              setDifficulty({ score: ev.payload.score || 0, label: ev.payload.label || 'medium', fileCount: ev.payload.fileCount || 0 })
            }
            if (ev.eventType === 'mission.complete') {
              const payload = ev.payload || ev
              setResult(payload)
              setPhase(payload?.success === false ? 'failed' : 'complete')
              if (payload?.success !== false && payload?.allRepoFiles?.length) {
                try {
                  const stored = JSON.parse(localStorage.getItem('nova_projects') || '[]')
                  const htmlFile = payload.allRepoFiles.find((f: any) => /\.html$/i.test(f.path || ''))
                  const project: SavedProject = {
                    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    missionId, title: payload?.classification?.title || mission.slice(0, 60), mission,
                    category: payload?.classification?.subtype || payload?.classification?.type || 'web-app',
                    html: htmlFile?.content || payload.allRepoFiles[0]?.content || '',
                    quality: payload?.qualityScore ?? 0, success: payload?.success !== false,
                    filesCount: payload.allRepoFiles.length, durationMs: payload?.durationMs ?? 0,
                    createdAt: new Date().toISOString(),
                  }
                  localStorage.setItem('nova_projects', JSON.stringify([project, ...stored].slice(0, 50)))
                  setSavedProjects([project, ...stored].slice(0, 50))
                } catch {}
                if (ciCdEnabled && payload?.success !== false) {
                  setTimeout(async () => {
                    const findings: any[] = []
                    for (const f of payload.allRepoFiles) {
                      f.content?.split('\n').forEach((line: string, i: number) => {
                        if (/eval\s*\(/.test(line)) findings.push({ severity: 'high', file: f.path, line: i + 1, issue: 'eval()' })
                        if (/innerHTML\s*=/.test(line)) findings.push({ severity: 'med', file: f.path, line: i + 1, issue: 'innerHTML' })
                      })
                    }
                    setSecurityAudit({ findings, safe: !findings.some(f => f.severity === 'high') })
                    const htmlFile = payload.allRepoFiles.find((f: any) => /\.html$/i.test(f.path || ''))
                    if (htmlFile?.content) {
                      try {
                        const deployRes = await fetch('/api/nova/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: htmlFile.content, mission }) })
                        const deployData = await deployRes.json()
                        if (deployData.ok && deployData.url) setDeployUrl(deployData.url)
                      } catch {}
                    }
                  }, 1000)
                }
              }
              stopped = true; return
            }
            if (ev.eventType === 'mission.fail') { setPhase('failed'); stopped = true; return }
          }
        }
        if (++count > 600) { stopped = true; setPhase('failed'); setBuildError('Timed out') }
      } catch {}
    }
    const iv = setInterval(poll, 1000); poll()
    return () => { stopped = true; clearInterval(iv); socket?.disconnect() }
  }, [missionId, ciCdEnabled])

  const reset = () => {
    setPhase('idle'); setMissionId(null); setResult(null); setEvents([])
    buildStartRef.current = null; setElapsedSec(0)
    setSelectedFile(null); setViewingDiff(null); setExpandedLiveFile(null)
  }

  const downloadZip = async () => {
    if (!result?.files?.length) return
    setZipping(true)
    try {
      const res = await fetch('/api/nova/zip', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: result.files, name: mission || 'project' }),
      })
      const data = await res.json()
      if (data.ok && data.zip) {
        const blob = new Blob([Uint8Array.from(atob(data.zip), c => c.charCodeAt(0))], { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = data.filename; a.click()
        URL.revokeObjectURL(url)
      }
    } catch {}
    setZipping(false)
  }

  const buildParametrizedMission = (template: string, values: Record<string, string>) => {
    return template.replace(/\{(\w+)\}/g, (_, key) => values[key] || '').trim()
  }

  const saveCustomTemplate = (t: { id: string; emoji: string; label: string; text: string }) => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_custom_templates') || '[]')
      const idx = stored.findIndex((x: any) => x.id === t.id)
      if (idx >= 0) stored[idx] = t; else stored.push(t)
      localStorage.setItem('nova_custom_templates', JSON.stringify(stored))
      setCustomTemplates(stored)
      setShowTemplateEditor(false); setEditingTemplate(null)
    } catch {}
  }

  const deleteCustomTemplate = (id: string) => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_custom_templates') || '[]')
      const updated = stored.filter((x: any) => x.id !== id)
      localStorage.setItem('nova_custom_templates', JSON.stringify(updated))
      setCustomTemplates(updated)
    } catch {}
  }

  const deleteProject = (id: string) => {
    setSavedProjects(prev => {
      const updated = prev.filter(p => p.id !== id)
      try { localStorage.setItem('nova_projects', JSON.stringify(updated)) } catch {}
      return updated
    })
  }

  const openProject = (project: SavedProject) => {
    setResult({
      mission: project.mission,
      project: { id: '', name: project.title, kind: project.category, fileCount: project.filesCount },
      runs: {}, release: null,
      files: [{ path: 'index.html', content: project.html }],
      pipeline: [], allPassed: project.success, totalMs: project.durationMs,
    })
    setMission(project.mission); setPhase('complete'); setShowGallery(false)
  }

  const currentFile = result?.files.find(f => f.path === selectedFile) || result?.files[0]
  const codeContent = currentFile?.content || ''
  const allRepoFiles = result?.files || []
  const htmlFile = allRepoFiles.find(f => /\.html$/i.test(f.path))

  // ── Syntax highlighting (XSS-safe) ──
  function highlightCode(code: string): React.ReactNode {
    if (!code) return 'No code'
    return code.split('\n').map((line, i) => {
      const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      if (escaped.trim().startsWith('//') || escaped.trim().startsWith('*') || escaped.trim().startsWith('/*')) {
        return <div key={i} className="text-green-500/60">{escaped || ' '}</div>
      }
      let highlighted = escaped
      const keywords = ['import', 'export', 'const', 'let', 'var', 'function', 'class', 'return', 'if', 'else', 'for', 'while', 'try', 'catch', 'new', 'async', 'await', 'extends', 'super', 'this', 'require', 'module']
      for (const kw of keywords) {
        highlighted = highlighted.replace(new RegExp(`\\b${kw}\\b`, 'g'), `<span class="text-purple-400">${kw}</span>`)
      }
      highlighted = highlighted.replace(/(&quot;|&#39;|`)((?:\\.|(?!\1).)*?)\1/g, '<span class="text-amber-400">$1$2$1</span>')
      highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span class="text-cyan-400">$1</span>')
      return <div key={i} dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />
    })
  }

  if (!mounted) return null

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-card/80 backdrop-blur-md">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-sm font-black text-primary-foreground shadow-md">N</div>
          <div className="flex-1">
            <div className="text-sm font-bold leading-tight">NOVA <span className="text-muted-foreground">//</span> Build Anything</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">AI Code Generation Engine</div>
          </div>
          {stats && (
            <div className="hidden items-center gap-4 sm:flex">
              <div className="text-center"><div className="text-sm font-bold">{stats.count}</div><div className="text-[9px] uppercase text-muted-foreground">Builds</div></div>
              <div className="text-center"><div className="text-sm font-bold text-emerald-500">{stats.avg}</div><div className="text-[9px] uppercase text-muted-foreground">Avg Q</div></div>
              <div className="text-center"><div className="text-sm font-bold text-primary">{stats.best}</div><div className="text-[9px] uppercase text-muted-foreground">Best</div></div>
            </div>
          )}
          {savedProjects.length > 0 && (
            <button onClick={() => setShowGallery(true)} className="flex items-center gap-1.5 rounded-md border border-border/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
              <Archive className="h-3.5 w-3.5" /> {savedProjects.length}
            </button>
          )}
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex items-center gap-1.5 rounded-md border border-border/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* ═══ IDLE ═══ */}
        {phase === 'idle' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: Projects panel — collapsible */}
            {showProjects && (
              <div className="w-72 shrink-0 border-r border-border/40 bg-card/30 overflow-y-auto">
                <div className="sticky top-0 z-10 border-b border-border/40 bg-card/80 px-3 py-2.5 backdrop-blur">
                  <button onClick={() => setShowProjects(false)} className="flex w-full items-center justify-between">
                    <h2 className="flex items-center gap-1.5 text-xs font-bold">
                      <Folder className="h-3.5 w-3.5 text-primary" /> Projects
                    </h2>
                    <span className="flex items-center gap-1.5">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-mono font-bold text-primary">{savedProjects.length}</span>
                      <ChevronRight className="h-3.5 w-3.5 rotate-90 text-muted-foreground transition-transform" />
                    </span>
                  </button>
                </div>
              {savedProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center">
                  <Folder className="mb-2 h-8 w-8 text-muted-foreground/20" />
                  <p className="text-[10px] text-muted-foreground/60">No projects yet.<br />Build something to get started.</p>
                </div>
              ) : (
                <div className="space-y-0.5 p-2">
                  {savedProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => openProject(p)}
                      className="group flex w-full flex-col gap-1 rounded-lg border border-transparent px-2.5 py-2 text-left transition-all hover:border-primary/30 hover:bg-primary/5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary text-[8px] font-bold uppercase">{(p.category || 'app').slice(0, 2)}</span>
                        <span className="flex-1 truncate text-[11px] font-semibold">{p.title}</span>
                        {p.quality > 0 && (
                          <span className={cn('rounded px-1.5 py-0.5 font-mono text-[8px] font-bold',
                            p.quality >= 8 ? 'bg-emerald-500/15 text-emerald-500' :
                            p.quality >= 5 ? 'bg-amber-500/15 text-amber-500' : 'bg-red-500/15 text-red-500')}>
                            {p.quality.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[9px] text-muted-foreground/70">{p.mission}</p>
                      <div className="flex items-center gap-2 text-[8px] text-muted-foreground/50">
                        <span>{p.filesCount || 0} files</span>
                        <span>·</span>
                        <span>{p.durationMs ? `${(p.durationMs / 1000).toFixed(0)}s` : '—'}</span>
                        <span>·</span>
                        <span>{new Date(p.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Right: Build area */}
            <div className="flex flex-1 flex-col overflow-y-auto p-6">
              {/* Projects toggle when collapsed */}
              {!showProjects && (
                <button onClick={() => setShowProjects(true)} className="mb-3 flex items-center gap-1.5 rounded-lg border border-border/40 bg-card/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground">
                  <Folder className="h-3.5 w-3.5" /> Projects ({savedProjects.length})
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl space-y-4 text-center">
                <div className="space-y-1.5">
                  <h1 className="bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-4xl font-bold tracking-tight text-transparent md:text-5xl">Build Anything</h1>
                  <p className="text-sm text-muted-foreground">Describe what you want. NOVA&apos;s AI designs, codes, tests, and ships it.</p>
                </div>

                {/* Mission input */}
                <div className="rounded-xl border border-border/60 bg-card p-1 shadow-lg">
                  <Textarea
                    value={mission}
                    onChange={(e) => setMission(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') startBuild() }}
                    rows={3}
                    placeholder="Build a snake game... Build a markdown editor... Build a calculator with history..."
                    className="resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                  />
                  <div className="flex items-center justify-between border-t border-border/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono">Ctrl</kbd> + <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono">Enter</kbd>
                      </span>
                      <button
                        onClick={toggleVoice}
                        title="Voice input"
                        className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-all',
                          recording ? 'border-red-500 bg-red-500/10 text-red-500 animate-pulse' : 'border-border/40 text-muted-foreground hover:text-foreground')}
                      >
                        <Mic className="h-3 w-3" /> {recording ? '...' : 'Voice'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Engine mode inline */}
                      <div className="inline-flex rounded-lg border border-border/40 bg-card/50 p-0.5">
                        {PRESETS.map(p => (
                          <button key={p.id} onClick={() => setActivePreset(p.id)} title={p.desc} className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all', activePreset === p.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                            <p.icon className="h-3 w-3" />
                          </button>
                        ))}
                      </div>
                      <Button size="sm" disabled={!mission.trim()} onClick={() => startBuild()} className="gap-1.5 shadow-md">
                        <Sparkles className="h-3.5 w-3.5" /> Build
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Mission suggestions */}
                {missionSuggestions.length > 0 && (
                  <div className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-left">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500">
                      <Lightbulb className="h-3 w-3" /> Suggestions ({missionSuggestions.length})
                    </p>
                    {missionSuggestions.map((s, i) => (
                      <button key={i} onClick={() => setMission(s.rewritten)} className="flex w-full items-start gap-2 rounded-lg border border-amber-500/20 bg-card/40 px-2.5 py-1.5 text-left text-[11px] transition-all hover:border-amber-500/50 hover:bg-card/70">
                        <span className="text-amber-500/70">→</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground/80">{s.rewritten}</p>
                          <p className="text-[9px] text-muted-foreground">{s.reason}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Dedup cache hit */}
                {dedupMatch && (
                  <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-left">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
                      <CheckCircle2 className="h-3 w-3" /> Similar build found ({Math.round(dedupMatch.similarity * 100)}% match)
                    </p>
                    <button onClick={() => openProject(dedupMatch.project)} className="flex w-full items-center gap-2 rounded-lg border border-emerald-500/20 bg-card/40 px-2.5 py-1.5 text-left transition-all hover:border-emerald-500/50 hover:bg-card/70">
                      <Archive className="h-4 w-4 text-emerald-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{dedupMatch.project.title}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{dedupMatch.project.mission}</p>
                      </div>
                      <span className="text-[10px] text-emerald-500">Load →</span>
                    </button>
                  </div>
                )}

                {/* Templates — collapsible */}
                <details className="group rounded-xl border border-border/40 bg-card/30">
                  <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    <span className="flex items-center gap-1.5"><ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" /> Templates</span>
                    <span className="text-[9px]">{TEMPLATES.length + PARAMETRIZED_TEMPLATES.length + customTemplates.length}</span>
                  </summary>
                  <div className="space-y-2 border-t border-border/40 p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {TEMPLATES.map(s => (
                        <button key={s.label} onClick={() => { setMission(s.text); startBuild(s.text, true) }} className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-card/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground">
                          <s.icon className="h-3.5 w-3.5" /><span>{s.label}</span>
                        </button>
                      ))}
                      {PARAMETRIZED_TEMPLATES.map(pt => (
                        <button key={pt.label} onClick={() => { setActiveParamTemplate(pt); const d: Record<string, string> = {}; pt.params.forEach((p: any) => { d[p.name] = p.default }); setParamValues(d) }} className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all', activeParamTemplate?.label === pt.label ? 'border-primary bg-primary/10 text-primary' : 'border-primary/30 bg-primary/5 text-primary/70 hover:border-primary/60 hover:text-primary')}>
                          <pt.icon className="h-3.5 w-3.5" /><span>{pt.label}</span>
                        </button>
                      ))}
                      {customTemplates.map(ct => (
                        <button key={ct.id} onClick={() => { setMission(ct.text); startBuild(ct.text, true) }} className="group inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-1 text-[11px] font-medium text-emerald-600 transition-all hover:border-emerald-500/70 dark:text-emerald-400">
                          <ct.icon className="h-3.5 w-3.5" /><span>{ct.label}</span>
                          <span onClick={(e) => { e.stopPropagation(); setEditingTemplate(ct); setShowTemplateEditor(true) }} className="ml-0.5 hidden group-hover:inline"><Pencil className="h-3 w-3 text-muted-foreground/60" /></span>
                          <span onClick={(e) => { e.stopPropagation(); deleteCustomTemplate(ct.id) }} className="hidden group-hover:inline"><Trash className="h-3 w-3 text-destructive" /></span>
                        </button>
                      ))}
                      <button onClick={() => { setEditingTemplate({ id: 'ct_' + Date.now(), icon: 'Star', label: '', text: '' }); setShowTemplateEditor(true) }} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/70 transition-all hover:border-primary/40 hover:text-foreground">
                        <Plus className="h-3 w-3" /> New
                      </button>
                    </div>
                  </div>
                </details>

                {/* Parametrized template form */}
                {activeParamTemplate && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-left">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">{activeParamTemplate.emoji} {activeParamTemplate.label}</p>
                      <button onClick={() => setActiveParamTemplate(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                    </div>
                    <div className="space-y-2">
                      {activeParamTemplate.params.map((p: any) => (
                        <div key={p.name} className="flex flex-col gap-1">
                          <label className="text-[10px] font-medium text-muted-foreground">{p.label}</label>
                          <input value={paramValues[p.name] || ''} onChange={(e) => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))} placeholder={p.placeholder} className="rounded-lg border border-border/40 bg-card/60 px-3 py-1.5 text-xs outline-none focus:border-primary/60" />
                        </div>
                      ))}
                      <div className="rounded-lg border border-border/30 bg-background/40 p-2">
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Preview</p>
                        <p className="mt-0.5 text-xs text-foreground/80">{buildParametrizedMission(activeParamTemplate.template, paramValues)}</p>
                      </div>
                      <Button size="sm" className="w-full gap-1.5" onClick={() => { const m = buildParametrizedMission(activeParamTemplate.template, paramValues); if (!m || m.length < 5) return; setMission(m); setActiveParamTemplate(null); startBuild(m, true) }}>
                        <Sparkles className="h-3.5 w-3.5" /> Build with these parameters
                      </Button>
                    </div>
                  </div>
                )}

                {/* Custom template editor */}
                {showTemplateEditor && editingTemplate && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-left">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary"><Plus className="h-3 w-3" /> {customTemplates.find(t => t.id === editingTemplate.id) ? 'Edit template' : 'New custom template'}</p>
                      <button onClick={() => { setShowTemplateEditor(false); setEditingTemplate(null) }} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input value={editingTemplate.icon} onChange={(e) => setEditingTemplate({ ...editingTemplate, icon: e.target.value.slice(0, 2) })} placeholder="Icon" className="w-16 rounded-lg border border-border/40 bg-card/60 px-2 py-1.5 text-xs outline-none focus:border-primary/60" />
                        <input value={editingTemplate.label} onChange={(e) => setEditingTemplate({ ...editingTemplate, label: e.target.value.slice(0, 30) })} placeholder="Label" className="flex-1 rounded-lg border border-border/40 bg-card/60 px-2 py-1.5 text-xs outline-none focus:border-primary/60" />
                      </div>
                      <Textarea value={editingTemplate.text} onChange={(e) => setEditingTemplate({ ...editingTemplate, text: e.target.value })} placeholder="Mission text" rows={2} className="text-xs" />
                      <Button size="sm" className="w-full gap-1.5" disabled={!editingTemplate.label.trim() || !editingTemplate.text.trim()} onClick={() => saveCustomTemplate(editingTemplate)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Save template
                      </Button>
                    </div>
                  </div>
                )}

                {/* Quality trend */}
                {savedProjects.length > 3 && (
                  <div className="pt-1">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Quality Trend</p>
                    <div className="flex items-end gap-0.5 h-8">
                      {savedProjects.slice(0, 20).reverse().map((p, i) => {
                        const q = p.quality || 0
                        const h = q > 0 ? (q / 10) * 100 : 0
                        return (
                          <div key={i} className="flex-1 min-w-[3px] rounded-t-sm" style={{ height: `${h}%`, backgroundColor: q >= 8 ? '#10b981' : q >= 5 ? '#f59e0b' : '#ef4444', opacity: 0.7 }} title={`${q.toFixed(1)}/10`} />
                        )
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        )}

        {/* ═══ BUILDING ═══ */}
        {phase === 'building' && (
          <div className="flex flex-1 flex-col overflow-hidden p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
                <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 shadow-lg">
                  <Loader2 className="h-5 w-5 animate-spin text-primary-foreground" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{mission}</p>
                <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> LIVE
                  </span>
                  <span className="font-mono">{elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span>{events.length} events</span>
                  {costTicker && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="font-mono text-amber-500/80">{costTicker.tokens.toLocaleString()} tok · ${costTicker.cost.toFixed(4)}</span>
                    </>
                  )}
                  {difficulty && (
                    <>
                      <span className="text-muted-foreground/50">·</span>
                      <span className={cn('rounded px-1.5 py-0.5 font-mono text-[9px]', difficulty.label === 'easy' ? 'bg-emerald-500/15 text-emerald-500' : difficulty.label === 'medium' ? 'bg-amber-500/15 text-amber-500' : 'bg-red-500/15 text-red-500')}>
                        {difficulty.label} {difficulty.score}/10
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Pipeline stages — live from events */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {['discover', 'architect', 'builder', 'integrator', 'tester', 'reviewer', 'fixer'].map(stage => {
                const ev = events.find(e => e.agentId === stage)
                const status = ev?.eventType === 'agent.message' ? 'done' : ev ? 'active' : 'pending'
                return (
                  <div key={stage} className={cn(
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all',
                    status === 'done' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : '',
                    status === 'active' ? 'border-primary/40 bg-primary/10 text-primary animate-pulse' : '',
                    status === 'pending' ? 'border-border/40 bg-card/30 text-muted-foreground/50' : ''
                  )}>
                    {status === 'done' && <CheckCircle2 className="h-2.5 w-2.5" />}
                    {status === 'active' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                    <span className="capitalize">{stage}</span>
                  </div>
                )
              })}
            </div>

            {/* Terminal log — live events */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/30 bg-[#0a0e1a]">
              <div className="flex items-center gap-2 border-b border-border/20 px-3 py-1.5">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">nova-build.log</span>
                <span className="ml-auto text-[9px] text-muted-foreground/60">{events.length} events</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] leading-relaxed">
                {events.length === 0 ? (
                  <p className="text-muted-foreground/40">Waiting for LLM response...</p>
                ) : (
                  events.slice(-100).map((ev, i) => {
                    const msg = ev.payload?.message || ev.payload?.detail || ''
                    const isErr = ev.eventType === 'mission.fail' || (msg && /error|fail/i.test(msg))
                    return (
                      <div key={i} className={cn(
                        ev.eventType === 'agent.thinking' ? 'text-muted-foreground/60' : '',
                        ev.eventType === 'agent.message' ? 'text-foreground/80' : '',
                        ev.eventType === 'file.built' ? 'text-emerald-500' : '',
                        ev.eventType === 'cost.update' ? 'text-amber-500/60' : '',
                        ev.eventType === 'difficulty.report' ? 'text-sky-500' : '',
                        isErr ? 'text-red-500' : ''
                      )}>
                        {msg || ev.eventType}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Live files with streaming typing effect */}
            {liveFiles.length > 0 && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Folder className="h-3 w-3" /> Live Files ({liveFiles.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {liveFiles.map((f, i) => {
                    const isStreaming = streamingFile?.path === f.path && streamingFile.displayed < streamingFile.content.length
                    return (
                      <button
                        key={i}
                        onClick={() => setExpandedLiveFile(expandedLiveFile === f.path ? null : f.path)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border bg-card/50 px-2 py-1 text-[10px] transition-all',
                          expandedLiveFile === f.path ? 'border-primary text-primary' : 'border-border/40 hover:border-primary/40'
                        )}
                      >
                        <FileType className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-muted-foreground">{f.path}</span>
                        <span className="text-emerald-500">{f.lines}L</span>
                        {isStreaming && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
                      </button>
                    )
                  })}
                </div>
                {/* Streaming content preview */}
                {expandedLiveFile && (() => {
                  const f = liveFiles.find(x => x.path === expandedLiveFile)
                  if (!f) return null
                  const isStreaming = streamingFile?.path === f.path && streamingFile.displayed < streamingFile.content.length
                  const displayContent = isStreaming
                    ? (streamingFile.content.slice(0, streamingFile.displayed))
                    : (f.content || '').split('\n').slice(0, 30).join('\n')
                  return (
                    <div className="mt-2 overflow-hidden rounded-lg border border-border/40 bg-[#0a0e1a]">
                      <div className="flex items-center justify-between border-b border-border/20 px-2 py-1">
                        <span className="font-mono text-[10px] text-muted-foreground">{f.path} · {f.lines} lines</span>
                        {isStreaming && <span className="text-[9px] text-primary animate-pulse">streaming...</span>}
                      </div>
                      <pre className="max-h-48 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed text-foreground/80">
                        {displayContent || '(empty file)'}
                        {isStreaming && <span className="text-primary animate-pulse">▊</span>}
                      </pre>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* ═══ COMPLETE / FAILED ═══ */}
        {(phase === 'complete' || phase === 'failed') && result && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-3 border-b border-border/40 bg-card/30 px-4 py-2.5">
              {phase === 'complete' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{phase === 'complete' ? 'Build Complete' : 'Build Failed'}</p>
                <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">{((result.totalMs || result.durationMs || 0) / 1000).toFixed(1)}s</span>
                  <span>·</span>
                  <span>{result.files.length} file(s)</span>
                  {qualityScore && (
                    <>
                      <span>·</span>
                      <span className={cn('font-mono font-bold', parseFloat(qualityScore) >= 8 ? 'text-emerald-500' : parseFloat(qualityScore) >= 5 ? 'text-amber-500' : 'text-red-500')}>
                        {qualityScore}/10 quality
                      </span>
                    </>
                  )}
                  {result.release && <><span>·</span><span className="text-emerald-500 flex items-center gap-0.5"><Archive className="h-3 w-3" /> published</span></>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {/* Iterative Refinement input */}
                <input
                  value={refineRequest}
                  onChange={(e) => setRefineRequest(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') refineBuild() }}
                  placeholder="Make it blue, add dark mode..."
                  className="h-7 w-48 rounded-md border border-border/40 bg-background px-2 text-[11px] outline-none focus:border-primary/60 placeholder:text-muted-foreground/40"
                />
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={refineBuild}
                  disabled={refining || !refineRequest.trim()}
                  title="Refine existing code (Ctrl+Enter)"
                >
                  {refining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Refine
                </Button>
                <div className="mx-1 h-5 w-px bg-border/40" />
                {/* Deploy button — publish HTML to public URL */}
                {htmlFile && (
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 gap-1 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={deployBuild}
                    disabled={deploying}
                    title="Deploy to a public URL instantly"
                  >
                    {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />} Deploy
                  </Button>
                )}
                {deployUrl && (
                  <a
                    href={deployUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono text-emerald-500 hover:bg-emerald-500/20"
                    title="Open deployed app"
                  >
                    <ExternalLink className="h-3 w-3" /> Open deployed
                  </a>
                )}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={reset} title="Start a new build">
                  <RotateCcw className="h-3 w-3" /> New
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={downloadZip} disabled={zipping} title="Download as ZIP">
                  {zipping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} ZIP
                </Button>
                {htmlFile && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => {
                    const blob = new Blob([htmlFile.content], { type: 'text/html' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url; a.download = (mission || 'project').slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_') + '.html'; a.click()
                    URL.revokeObjectURL(url)
                  }} title="Download HTML">
                    <Code2 className="h-3 w-3" /> HTML
                  </Button>
                )}
                {/* V1: Version Control — save version */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={saveVersion} title="Save version (v{buildVersion})">
                  <GitBranch className="h-3 w-3" /> v{buildVersion}
                </Button>
                {/* V3: Export to GitHub */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={exportToGithub} title="Export as GitHub repo (ZIP with README + .gitignore)">
                  <Globe className="h-3 w-3" /> GitHub
                </Button>
                {/* V4: AI Code Review */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={runAiReview} disabled={reviewing} title="AI Code Review — senior dev feedback">
                  {reviewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />} Review
                </Button>
                {/* V8: Security Audit */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={runSecurityAudit} disabled={auditing} title="Security audit — scan for vulnerabilities">
                  {auditing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />} Audit
                </Button>
                {/* V7: Performance Profiling */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={runPerfProfile} title="Performance profile — complexity analysis">
                  <TrendingUp className="h-3 w-3" /> Profile
                </Button>
                {/* Quality Stats */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={fetchQualityStats} title="Quality stats dashboard">
                  <ScanSearch className="h-3 w-3" /> Stats
                </Button>
                {/* W2: Code Execution */}
                {currentFile?.path?.endsWith('.js') && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={executeCode} disabled={executing} title="Run this JS file in sandbox">
                    {executing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
                  </Button>
                )}
                {/* W4: Build Branching */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={createBranch} title="Create a branch from this build">
                  <GitBranch className="h-3 w-3" /> Branch
                </Button>
                {/* W6: Visual Code Map */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setShowCodeMap(!showCodeMap)} title="Visual dependency map">
                  <Network className="h-3 w-3" /> Map
                </Button>
                {/* W7: Cost Optimization */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={analyzeCost} title="Cost optimization suggestions">
                  <DollarSign className="h-3 w-3" /> Cost
                </Button>
                {/* W8: Auto-Deploy on Refine toggle */}
                <button
                  onClick={() => setAutoDeployRefine(!autoDeployRefine)}
                  title="Auto-deploy after refine"
                  className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-all',
                    autoDeployRefine ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border/40 text-muted-foreground')}
                >
                  <Cloud className="h-3 w-3" /> Auto-Deploy
                </button>
                {/* X1: Natural Language Code Edit */}
                {resultTab === 'code' && currentFile && (
                  <input
                    value={nlEditRequest}
                    onChange={(e) => setNlEditRequest(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') nlEdit() }}
                    placeholder="Change button to blue..."
                    className="h-7 w-40 rounded-md border border-border/40 bg-background px-2 text-[10px] outline-none focus:border-primary/60"
                  />
                )}
                {nlEditing && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                {/* X2: Build Sharing */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={shareBuild} title="Share build with public URL">
                  <Share2 className="h-3 w-3" /> Share
                </Button>
                {shareUrl && (
                  <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-500" title="Copied! Open shared build">
                    <ExternalLink className="h-3 w-3" /> Shared
                  </a>
                )}
                {/* X3: AI Debugging */}
                {execOutput && execOutput.includes('Error') && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-red-500" onClick={aiDebug} disabled={debugging} title="AI Debug — auto-fix errors">
                    {debugging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />} Debug
                  </Button>
                )}
                {/* X4: Component Library */}
                {currentFile && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => saveComponent(currentFile.path, currentFile.content, currentFile.path.split('.').pop() || 'text')} title="Save to component library for reuse">
                    <Layers className="h-3 w-3" /> Save Component
                  </Button>
                )}
                {/* X5: Live API Testing */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={detectApiEndpoints} title="Detect and test API endpoints">
                  <TestTube className="h-3 w-3" /> API Test
                </Button>
                {/* X6: Build Analytics */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={fetchAnalytics} title="Build analytics — time/cost/quality trends">
                  <Activity className="h-3 w-3" /> Analytics
                </Button>
                {/* X7: Team Workspaces */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => { setShowWorkspace(!showWorkspace); if (!showWorkspace) saveToWorkspace() }} title="Save to team workspace">
                  <Users className="h-3 w-3" /> Workspace
                </Button>
                {/* X8: Plugin System */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => addPlugin('Custom Agent', 'You are a custom agent. Analyze the code.', 'review')} title="Add custom plugin agent">
                  <Puzzle className="h-3 w-3" /> Plugin
                </Button>
                {/* Y1: AI Code Completion */}
                {resultTab === 'code' && currentFile && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={getCompletion} disabled={completing} title="AI complete next lines">
                    {completing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Complete
                  </Button>
                )}
                {/* Y5: AI Code Translation */}
                {resultTab === 'code' && currentFile && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => translateCode('python')} disabled={translating} title="Translate to Python">
                      <Languages className="h-3 w-3" /> Py
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => translateCode('node')} disabled={translating} title="Translate to Node.js">
                      <Languages className="h-3 w-3" /> Node
                    </Button>
                  </>
                )}
                {/* Y7: Interactive Code Walkthrough */}
                {resultTab === 'code' && currentFile && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={startWalkthrough} title="Interactive code walkthrough — explains line-by-line">
                    <Footprints className="h-3 w-3" /> Walk
                  </Button>
                )}
                {/* Y9: Code Search */}
                {resultTab === 'code' && (
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') searchInFiles() }}
                    placeholder="Search code..."
                    className="h-7 w-32 rounded-md border border-border/40 bg-background px-2 text-[10px] outline-none focus:border-primary/60"
                  />
                )}
                {/* Y8: Build Diff Between Versions */}
                <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={showDiffBetweenVersions} title="Compare versions">
                  <GitPullRequest className="h-3 w-3" /> Diff v
                </Button>
                {/* Y4: Build CI/CD toggle */}
                <button
                  onClick={() => setCiCdEnabled(!ciCdEnabled)}
                  title="CI/CD — auto test + deploy on refine"
                  className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-all',
                    ciCdEnabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' : 'border-border/40 text-muted-foreground')}
                >
                  <GitPullRequest className="h-3 w-3" /> CI/CD
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* File sidebar */}
              <div className="w-48 shrink-0 overflow-y-auto border-r border-border/40 bg-card/30">
                <p className="border-b border-border/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Files ({allRepoFiles.length})</p>
                {allRepoFiles.map((f) => (
                  <button key={f.path} onClick={() => { setSelectedFile(f.path); setViewingDiff(null) }}
                    className={cn('flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/30',
                      (currentFile?.path === f.path && !viewingDiff) ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground')}>
                    <FileType className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.path}</span>
                  </button>
                ))}
              </div>

              {/* Code / Preview / Tests view with tabs */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Tab bar */}
                <div className="flex shrink-0 items-center gap-1 border-b border-border/40 bg-muted/20 px-2 py-1.5">
                  {(['code', 'preview', 'tests'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setResultTab(tab)}
                      className={cn('flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all',
                        resultTab === tab ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}
                    >
                      {tab === 'code' ? <Code2 className="h-3.5 w-3.5" /> : tab === 'preview' ? <Eye className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {tab === 'code' ? 'Code' : tab === 'preview' ? 'Preview' : 'Tests'}
                      {tab === 'preview' && htmlFile && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                      {tab === 'tests' && result.runs?.test && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-1">
                    {resultTab === 'code' && currentFile && (
                      <>
                        <span className="font-mono text-[10px] text-muted-foreground">{currentFile.path}</span>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" onClick={() => navigator.clipboard?.writeText(currentFile.content)}>
                          <Copy className="h-3 w-3" /> Copy
                        </Button>
                        {/* W5: AI Pair Programming */}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" onClick={getPairSuggestion} title="AI suggests an improvement">
                          <Sparkles className="h-3 w-3" /> AI Pair
                        </Button>
                      </>
                    )}
                    {resultTab === 'preview' && htmlFile && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" onClick={() => {
                        const blob = new Blob([htmlFile.content], { type: 'text/html' })
                        const url = URL.createObjectURL(blob)
                        window.open(url, '_blank')
                        setTimeout(() => URL.revokeObjectURL(url), 10000)
                      }}>
                        <Maximize2 className="h-3 w-3" /> Open
                      </Button>
                    )}
                  </div>
                </div>

                {/* Tab content */}
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  {/* Code tab */}
                  {resultTab === 'code' && currentFile && (
                    <div className="flex-1 overflow-auto bg-[#0a0e1a] p-4 font-mono text-[11px] leading-relaxed">
                      {currentFile.content.split('\n').map((line, i) => {
                        const ann = annotations[currentFile.path]?.[i + 1]
                        return (
                          <div key={i} className="group relative">
                            <div
                              className={cn('cursor-pointer hover:bg-primary/5', ann && 'bg-amber-500/10')}
                              onClick={() => setAnnotationLine(annotationLine === i + 1 ? null : i + 1)}
                            >
                              <span className="mr-3 inline-block w-8 select-none text-right text-muted-foreground/40">{i + 1}</span>
                              <span dangerouslySetInnerHTML={{ __html: line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || ' ' }} />
                            </div>
                            {ann && <div className="ml-12 mb-1 rounded border-l-2 border-amber-500/40 bg-amber-500/5 px-2 py-0.5 text-[10px] text-amber-500"><MessageSquare className="h-3 w-3 inline" /> {ann}</div>}
                            {annotationLine === i + 1 && (
                              <div className="ml-12 mb-1 flex gap-1">
                                <input
                                  autoFocus
                                  value={annotationText}
                                  onChange={(e) => setAnnotationText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') addAnnotation(currentFile.path, i + 1, annotationText); if (e.key === 'Escape') { setAnnotationLine(null); setAnnotationText('') } }}
                                  placeholder="Add note..."
                                  className="h-6 flex-1 rounded border border-amber-500/40 bg-background px-2 text-[10px] outline-none focus:border-amber-500"
                                />
                                <Button size="sm" className="h-6 px-2 text-[9px]" onClick={() => addAnnotation(currentFile.path, i + 1, annotationText)}>Save</Button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Preview tab — Live HTML rendering in iframe with multi-screen */}
                  {resultTab === 'preview' && (
                    <div className="flex flex-1 flex-col overflow-hidden bg-white">
                      {/* Y3: Multi-screen device selector */}
                      <div className="flex shrink-0 items-center gap-1 border-b border-border/20 bg-muted/10 px-2 py-1">
                        {(['desktop', 'tablet', 'mobile'] as const).map(device => (
                          <button
                            key={device}
                            onClick={() => setPreviewDevice(device)}
                            className={cn('flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-all',
                              previewDevice === device ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}
                          >
                            {device === 'desktop' ? <Smartphone className="h-2.5 w-2.5 rotate-90" /> : device === 'tablet' ? <Tablet className="h-2.5 w-2.5" /> : <Smartphone className="h-2.5 w-2.5" />}
                            {device}
                          </button>
                        ))}
                        {htmlFile && (
                          <Button size="sm" variant="ghost" className="ml-auto h-5 px-1.5 text-[9px] gap-0.5" onClick={() => {
                            const blob = new Blob([htmlFile.content], { type: 'text/html' })
                            const url = URL.createObjectURL(blob)
                            window.open(url, '_blank')
                            setTimeout(() => URL.revokeObjectURL(url), 10000)
                          }}>
                            <Maximize2 className="h-2.5 w-2.5" /> Open
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-1 items-center justify-center justify-start overflow-auto bg-muted/5" style={{ height: '100%' }}>
                        {htmlFile ? (
                          <iframe
                            title="Live Preview"
                            srcDoc={htmlFile.content}
                            className="h-full border-0 transition-all"
                            style={{ width: deviceWidth, maxWidth: '100%' }}
                            sandbox="allow-scripts allow-forms allow-modals allow-popups"
                            ref={previewRef}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted-foreground">
                            <div className="text-center">
                              <Eye className="mx-auto mb-2 h-8 w-8 opacity-30" />
                              <p className="text-sm">No HTML file to preview</p>
                              <p className="mt-1 text-xs text-muted-foreground/60">Build a web app to see a live preview</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tests tab — Real test output */}
                  {resultTab === 'tests' && (
                    <div className="flex-1 overflow-auto bg-[#0a0e1a] p-4 font-mono text-[11px] leading-relaxed">
                      {result.runs?.test?.output ? (
                        <div className="space-y-0.5">
                          {result.runs.test.output.split('\n').map((line: string, i: number) => {
                            const isPass = line.includes('pass') || line.includes('ok') || line.includes('success')
                            const isFail = line.includes('fail') || line.includes('error') || line.includes('Error')
                            const isError = line.includes('Error') || line.includes('TypeError') || line.includes('SyntaxError')
                            return (
                              <div key={i} className={cn(
                                isPass ? 'text-emerald-500' : '',
                                isFail ? 'text-red-500' : '',
                                isError ? 'text-red-500' : '',
                                !isPass && !isFail && !isError ? 'text-muted-foreground' : ''
                              )}>
                                {line || ' '}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">
                          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-30" />
                          <p className="text-center text-sm">No test output</p>
                          <p className="mt-1 text-center text-xs text-muted-foreground/60">
                            {result.runs?.test ? `Test ${result.runs.test.success ? 'passed' : 'failed'}` : 'Tests will appear here after build'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right panel: Pipeline + details */}
              <div className="w-80 shrink-0 overflow-y-auto border-l border-border/40 bg-card/30">
                {/* Pipeline */}
                <div className="border-b border-border/40 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Pipeline ({Array.isArray(result.pipeline) ? result.pipeline.length : 0} stages)</p>
                  <div className="space-y-1.5">
                    {(Array.isArray(result.pipeline) ? result.pipeline : []).map((p, i) => {
                      const meta = AGENT_LABELS[p.agent] || { name: p.agent, icon: Terminal, color: 'text-muted-foreground' }
                      const Icon = meta.icon
                      const totalMs = result.totalMs || result.durationMs || 1
                      const pct = p.ms > 0 ? (p.ms / totalMs * 100).toFixed(0) : 0
                      return (
                        <div key={i} className="rounded-lg border border-border/30 bg-background/40 p-2">
                          <div className="flex items-center gap-2">
                            <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.color)} />
                            <span className="flex-1 truncate text-[11px] font-medium">{meta.name}</span>
                            {p.success ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground/70">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/40">
                              <div className={cn('h-full rounded-full', p.success ? 'bg-emerald-500' : 'bg-red-500')} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="font-mono">{p.ms}ms ({pct}%)</span>
                          </div>
                          {p.output && (
                            <p className="mt-1 truncate text-[9px] text-muted-foreground/60" title={p.output}>{p.output}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Stage timing heatmap */}
                <div className="border-b border-border/40 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    <Clock className="h-3 w-3" /> Stage timings
                  </p>
                  <div className="space-y-1">
                    {(Array.isArray(result.pipeline) ? result.pipeline : []).map((p, i) => {
                      const totalMs = result.totalMs || result.durationMs || 1
                      const pct = p.ms > 0 ? (p.ms / totalMs * 100) : 0
                      const color = p.ms > 1500 ? '#ef4444' : p.ms > 500 ? '#f59e0b' : '#10b981'
                      return (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <span className="w-20 truncate font-mono text-muted-foreground">{p.agent}</span>
                          <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/30">
                            <div className="h-full rounded-sm" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.7 }} />
                          </div>
                          <span className="w-12 font-mono text-[9px]" style={{ color }}>{p.ms}ms</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* FORGE runs */}
                {result.runs && Object.keys(result.runs).length > 0 && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Forge workflows</p>
                    <div className="space-y-1">
                      {Object.entries(result.runs).map(([name, r]) => (
                        <div key={name} className="flex items-center gap-2 rounded border border-border/30 bg-background/40 px-2 py-1 text-[10px]">
                          {r.success ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-destructive" />}
                          <span className="flex-1 truncate font-mono text-muted-foreground">{name}</span>
                          <span className="font-mono text-[9px] text-muted-foreground/70">{r.ms}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* VAULT release */}
                {result.release && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-500"><Archive className="h-3 w-3 inline" /> VAULT release</p>
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-[10px]">
                      <p className="font-mono">v{result.release.version} · {result.release.channel}</p>
                      <p className="text-muted-foreground">Signed: {result.release.signed ? '✅' : '❌'} · {result.release.artifactCount} artifacts</p>
                    </div>
                  </div>
                )}

                {/* Quality score */}
                {qualityScore && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Quality score</p>
                    <div className={cn('rounded-lg border p-2 text-center',
                      parseFloat(qualityScore) >= 8 ? 'border-emerald-500/30 bg-emerald-500/5' : parseFloat(qualityScore) >= 5 ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
                      <p className={cn('text-2xl font-black',
                        parseFloat(qualityScore) >= 8 ? 'text-emerald-500' : parseFloat(qualityScore) >= 5 ? 'text-amber-500' : 'text-red-500')}>
                        {qualityScore}<span className="text-sm text-muted-foreground">/10</span>
                      </p>
                      <p className="text-[9px] text-muted-foreground">{(Array.isArray(result.pipeline) ? result.pipeline.filter(p => p.success).length : 0)}/{Array.isArray(result.pipeline) ? result.pipeline.length : 0} stages passed</p>
                    </div>
                  </div>
                )}

                {/* V4: AI Code Review result */}
                {aiReview && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                      <Brain className="h-3 w-3" /> AI Code Review
                    </p>
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2 text-[10px] text-foreground/80 whitespace-pre-wrap">
                      {aiReview}
                    </div>
                  </div>
                )}

                {/* V8: Security Audit result */}
                {securityAudit && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
                      <Shield className={cn('h-3 w-3', securityAudit.safe ? 'text-emerald-500' : 'text-red-500')} /> Security Audit
                    </p>
                    <div className={cn('rounded-lg border p-2 text-[10px]', securityAudit.safe ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
                      <p className={securityAudit.safe ? 'text-emerald-500' : 'text-red-500'}>
                        {securityAudit.safe ? '✅ Safe' : `⚠ ${securityAudit.findings.length} findings`}
                      </p>
                      {securityAudit.findings.slice(0, 5).map((f: any, i: number) => (
                        <div key={i} className="mt-1 text-muted-foreground">
                          <span className={f.severity === 'high' ? 'text-red-500' : f.severity === 'med' ? 'text-amber-500' : 'text-muted-foreground'}>
                            {f.severity}
                          </span> {f.file}:{f.line} — {f.issue}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* V7: Performance Profile result */}
                {perfProfile && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                      <TrendingUp className="h-3 w-3" /> Performance Profile
                    </p>
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2 text-[10px]">
                      <p className="text-muted-foreground">{perfProfile.totalLines} lines · {perfProfile.files.length} files · avg {perfProfile.avgFileLength} lines/file</p>
                      {perfProfile.files.map((f: any, i: number) => (
                        <div key={i} className="mt-1 flex items-center gap-2 text-[9px]">
                          <span className="flex-1 truncate font-mono text-muted-foreground">{f.path}</span>
                          <span className="text-sky-400">{f.lines}L</span>
                          <span className={cn(f.complexity > 10 ? 'text-red-500' : f.complexity > 5 ? 'text-amber-500' : 'text-emerald-500')}>
                            {f.complexity} branches
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quality Stats result */}
                {showQualityStats && qualityStats && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      <ScanSearch className="h-3 w-3" /> Quality Stats
                    </p>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 text-[10px]">
                      <p className="text-muted-foreground">
                        {qualityStats.overall?.totalBuilds || 0} builds · avg {qualityStats.overall?.avgQuality || 0}/10 · best {qualityStats.overall?.bestQuality || 0}/10
                      </p>
                      {(qualityStats.byType || []).slice(0, 5).map((t: any, i: number) => (
                        <div key={i} className="mt-1 flex items-center gap-2 text-[9px]">
                          <span className="flex-1 truncate font-mono text-muted-foreground">{t.type}</span>
                          <span className="text-emerald-500">{t.count}×</span>
                          <span className="text-primary">{t.avg}/10</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* W2: Code Execution output */}
                {execOutput && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                      <Play className="h-3 w-3" /> Execution Output
                    </p>
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] font-mono whitespace-pre-wrap">
                      {execOutput}
                    </div>
                  </div>
                )}

                {/* W5: AI Pair Programming suggestion */}
                {pairSuggestion && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                      <Sparkles className="h-3 w-3" /> AI Pair Programming
                    </p>
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2 text-[10px] whitespace-pre-wrap">
                      {pairSuggestion}
                    </div>
                  </div>
                )}

                {/* W6: Visual Code Map */}
                {showCodeMap && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                      <Network className="h-3 w-3" /> Code Map
                    </p>
                    {renderCodeMap()}
                  </div>
                )}

                {/* W7: Cost Optimization */}
                {costOptimization && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      <DollarSign className="h-3 w-3" /> Cost Optimization
                    </p>
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] whitespace-pre-wrap">
                      {costOptimization}
                    </div>
                  </div>
                )}

                {/* X3: AI Debugging result */}
                {debugResult && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">
                      <Wrench className="h-3 w-3" /> AI Debug Result
                    </p>
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-[10px] whitespace-pre-wrap">
                      {debugResult}
                    </div>
                  </div>
                )}

                {/* X5: Live API Testing results */}
                {apiEndpoints.length > 0 && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                      <TestTube className="h-3 w-3" /> API Endpoints ({apiEndpoints.length})
                    </p>
                    <div className="space-y-1.5">
                      {apiEndpoints.map((ep, i) => {
                        const key = `${ep.method} ${ep.path}`
                        const testResult = apiTestResults[key]
                        return (
                          <div key={i} className="rounded-lg border border-border/30 bg-background/40 p-2">
                            <div className="flex items-center gap-2">
                              <span className={cn('rounded px-1.5 py-0.5 font-mono text-[9px] font-bold',
                                ep.method === 'GET' ? 'bg-emerald-500/15 text-emerald-500' :
                                ep.method === 'POST' ? 'bg-amber-500/15 text-amber-500' :
                                ep.method === 'DELETE' ? 'bg-red-500/15 text-red-500' : 'bg-sky-500/15 text-sky-500')}>
                                {ep.method}
                              </span>
                              <span className="flex-1 truncate font-mono text-[10px] text-muted-foreground">{ep.path}</span>
                              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] gap-0.5" onClick={() => testApiEndpoint(ep)}>
                                {testResult?.loading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Play className="h-2.5 w-2.5" />} Test
                              </Button>
                            </div>
                            {testResult && !testResult.loading && (
                              <div className="mt-1 rounded border border-border/20 bg-muted/20 p-1 font-mono text-[9px]">
                                <span className={testResult.ok ? 'text-emerald-500' : 'text-red-500'}>{testResult.status}</span>
                                <span className="text-muted-foreground"> · {testResult.response?.slice(0, 80)}</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* X6: Build Analytics */}
                {showAnalytics && qualityStats?.analytics && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                      <Activity className="h-3 w-3" /> Build Analytics
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="rounded border border-border/30 bg-background/40 p-1.5">
                        <p className="text-[8px] uppercase text-muted-foreground">Total</p>
                        <p className="font-mono font-bold text-sky-400">{qualityStats.analytics.totalBuilds}</p>
                      </div>
                      <div className="rounded border border-border/30 bg-background/40 p-1.5">
                        <p className="text-[8px] uppercase text-muted-foreground">Avg Quality</p>
                        <p className="font-mono font-bold text-emerald-500">{qualityStats.analytics.avgQuality}/10</p>
                      </div>
                      <div className="rounded border border-border/30 bg-background/40 p-1.5">
                        <p className="text-[8px] uppercase text-muted-foreground">Avg Duration</p>
                        <p className="font-mono font-bold text-amber-500">{qualityStats.analytics.avgDuration}ms</p>
                      </div>
                      <div className="rounded border border-border/30 bg-background/40 p-1.5">
                        <p className="text-[8px] uppercase text-muted-foreground">Success</p>
                        <p className="font-mono font-bold text-emerald-500">{qualityStats.analytics.successRate}%</p>
                      </div>
                    </div>
                    {qualityStats.analytics.types && Object.keys(qualityStats.analytics.types).length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        <p className="text-[8px] uppercase text-muted-foreground">By Type</p>
                        {Object.entries(qualityStats.analytics.types).map(([type, count]) => (
                          <div key={type} className="flex items-center gap-2 text-[9px]">
                            <span className="flex-1 truncate font-mono text-muted-foreground">{type}</span>
                            <span className="text-sky-400">{count as number}×</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* X7: Team Workspaces */}
                {showWorkspace && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                      <Users className="h-3 w-3" /> Workspace: {workspaceName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Build saved to workspace. Team members can view and refine.</p>
                  </div>
                )}

                {/* X8: Plugins */}
                {plugins.length > 0 && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                      <Puzzle className="h-3 w-3" /> Plugin Agents ({plugins.length})
                    </p>
                    {plugins.slice(-3).map((p, i) => (
                      <div key={i} className="rounded border border-border/30 bg-background/40 p-1.5 text-[9px]">
                        <p className="font-medium text-amber-400">{p.name}</p>
                        <p className="truncate text-muted-foreground">{p.prompt}</p>
                        <p className="text-[8px] text-muted-foreground/60">Stage: {p.stage}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Y1: AI Code Completion result */}
                {completionSuggestion && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                      <Sparkles className="h-3 w-3" /> AI Completion
                    </p>
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2 text-[10px] font-mono whitespace-pre-wrap">
                      {completionSuggestion}
                    </div>
                  </div>
                )}

                {/* Y7: Interactive Code Walkthrough */}
                {walkthrough && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      <Footprints className="h-3 w-3" /> Walkthrough (Line {walkthroughLine})
                    </p>
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] font-mono">
                      {walkthrough}
                    </div>
                  </div>
                )}

                {/* Y9: Code Search results */}
                {searchResults.length > 0 && (
                  <div className="border-b border-border/40 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                      <SearchIcon className="h-3 w-3" /> Search: "{searchTerm}" ({searchResults.length} results)
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {searchResults.slice(0, 20).map((r, i) => (
                        <div key={i} className="rounded border border-border/30 bg-background/40 p-1.5 text-[9px]">
                          <span className="font-mono text-sky-400">{r.file}:{r.line}</span>
                          <p className="mt-0.5 truncate font-mono text-muted-foreground">{r.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ FAILED ═══ */}
        {phase === 'failed' && !result && buildError && (
          <div className="flex flex-1 flex-col items-center justify-center p-6">
            <div className="w-full max-w-md space-y-4 text-center">
              <XCircle className="mx-auto h-12 w-12 text-destructive" />
              <h2 className="text-lg font-bold">Build Failed</h2>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-left text-[11px] text-amber-500">
                <AlertTriangle className="mb-1 h-3.5 w-3.5" />
                <p>{buildError}</p>
                <p className="mt-1 text-muted-foreground">Try: simplify your request, or use a template.</p>
              </div>
              <Button onClick={reset} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Try again</Button>
            </div>
          </div>
        )}
      </main>

      {/* ── Gallery Modal ── */}
      <AnimatePresence>
        {showGallery && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
              <div className="flex items-center gap-2.5">
                <Archive className="h-5 w-5 text-primary" />
                <h2 className="text-base font-bold">Projects ({savedProjects.length})</h2>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowGallery(false)} className="gap-1.5">
                <X className="h-4 w-4" /> Close
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {savedProjects.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Archive className="mb-3 h-10 w-10 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">No projects yet. Build something!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {savedProjects.map((p) => (
                    <div key={p.id} className="group relative overflow-hidden rounded-xl border border-border/50 bg-card transition-all hover:border-primary/40 hover:shadow-lg">
                      <div className="flex h-32 items-center justify-center border-b border-border/40 bg-gradient-to-br from-primary/10 via-accent/5 to-primary/5">
                        <Sparkles className="h-8 w-8 text-primary/30" />
                        {p.quality > 0 && <span className="absolute right-2 top-2 rounded bg-emerald-500/80 px-1.5 py-0.5 text-[9px] font-bold text-background">{p.quality.toFixed(1)}</span>}
                      </div>
                      <div className="p-3">
                        <h3 className="truncate text-sm font-semibold">{p.title}</h3>
                        <p className="truncate text-[11px] text-muted-foreground">{p.mission}</p>
                        <div className="mt-2 flex gap-1.5">
                          <Button size="sm" className="h-7 flex-1 gap-1 text-xs" onClick={() => openProject(p)}><Play className="h-3 w-3" /> Open</Button>
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { const b = new Blob([p.html], { type: 'text/html' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = (p.title || 'p').replace(/[^a-zA-Z0-9]/g, '_') + '.html'; a.click(); URL.revokeObjectURL(u) }}><Download className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-destructive" onClick={() => deleteProject(p.id)}><Trash className="h-3 w-3" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ── */}
      <footer className="mt-auto shrink-0 border-t border-border/40 bg-card/30 px-4 py-2">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span>NOVA · Build Anything · v1.0</span>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1"><Sparkles className="h-2.5 w-2.5" /> AI-powered</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Zap className="h-2.5 w-2.5" /> {PRESETS.find(p => p.id === activePreset)?.label} mode</span>
          </span>
        </div>
      </footer>

      {/* ── Command Palette (⌘K) — searchable, categorized, 21+ actions ── */}
      <AnimatePresence>
        {commandOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
            onClick={() => setCommandOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: -8 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl"
            >
              <div className="flex items-center gap-2.5 border-b border-border/40 px-4 py-3">
                <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                <input
                  autoFocus
                  value={commandQuery}
                  onChange={(e) => { setCommandQuery(e.target.value); setCommandIndex(0) }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setCommandIndex(i => Math.min(i + 1, 20)) }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setCommandIndex(i => Math.max(i - 1, 0)) }
                    else if (e.key === 'Enter') { e.preventDefault(); setCommandOpen(false); showToast('info', 'Action executed') }
                  }}
                  placeholder="Search actions… (deploy, review, audit, translate, zip…)"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                />
                <kbd className="hidden rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">Esc</kbd>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2">
                {(() => {
                  const actions = [
                    { id: 'new', label: 'New build', icon: RotateCcw, cat: 'Start', run: () => reset() },
                    { id: 'deploy', label: 'Deploy to URL', icon: Rocket, cat: 'Deploy', run: () => deployBuild(), disabled: deploying },
                    { id: 'refine', label: 'Refine build', icon: Sparkles, cat: 'Build', run: () => refineBuild() },
                    { id: 'zip', label: 'Download ZIP', icon: Download, cat: 'Export', run: () => downloadZip() },
                    { id: 'html', label: 'Download HTML', icon: Code2, cat: 'Export', run: () => { if (htmlFile) { const b = new Blob([htmlFile.content], { type: 'text/html' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'app.html'; a.click(); URL.revokeObjectURL(u) } }, disabled: !htmlFile },
                    { id: 'github', label: 'Export to GitHub', icon: Globe, cat: 'Export', run: () => exportToGithub() },
                    { id: 'version', label: `Save version (v${buildVersion})`, icon: GitBranch, cat: 'Export', run: () => saveVersion() },
                    { id: 'review', label: 'AI Code Review', icon: Brain, cat: 'AI Analysis', run: () => runAiReview(), disabled: reviewing },
                    { id: 'audit', label: 'Security Audit', icon: Shield, cat: 'AI Analysis', run: () => runSecurityAudit(), disabled: auditing },
                    { id: 'profile', label: 'Performance Profile', icon: TrendingUp, cat: 'AI Analysis', run: () => runPerfProfile() },
                    { id: 'stats', label: 'Quality Stats', icon: ScanSearch, cat: 'AI Analysis', run: () => fetchQualityStats() },
                    { id: 'analytics', label: 'Build Analytics', icon: Activity, cat: 'AI Analysis', run: () => fetchAnalytics() },
                    { id: 'cost', label: 'Cost Optimization', icon: DollarSign, cat: 'AI Analysis', run: () => analyzeCost() },
                    { id: 'pair', label: 'AI Pair Programming', icon: Sparkles, cat: 'AI Analysis', run: () => getPairSuggestion() },
                    { id: 'completion', label: 'AI Code Completion', icon: Sparkles, cat: 'AI Analysis', run: () => getCompletion() },
                    { id: 'walkthrough', label: 'Interactive Walkthrough', icon: Footprints, cat: 'AI Analysis', run: () => startWalkthrough() },
                    { id: 'translate-py', label: 'Translate to Python', icon: Languages, cat: 'AI Analysis', run: () => translateCode('python') },
                    { id: 'translate-node', label: 'Translate to Node.js', icon: Languages, cat: 'AI Analysis', run: () => translateCode('node') },
                    { id: 'run', label: 'Run JS file', icon: Play, cat: 'Code Tools', run: () => executeCode() },
                    { id: 'branch', label: 'Create branch', icon: GitBranch, cat: 'Code Tools', run: () => createBranch() },
                    { id: 'map', label: 'Visual code map', icon: Network, cat: 'Code Tools', run: () => setShowCodeMap(v => !v) },
                    { id: 'component', label: 'Save to component library', icon: Layers, cat: 'Code Tools', run: () => { if (currentFile) { saveComponent(currentFile.path, currentFile.content, 'text'); showToast('success', 'Component saved') } } },
                    { id: 'api-test', label: 'Detect & test APIs', icon: TestTube, cat: 'Code Tools', run: () => detectApiEndpoints() },
                    { id: 'debug', label: 'AI Debug', icon: Wrench, cat: 'Code Tools', run: () => aiDebug() },
                    { id: 'diff-v', label: 'Diff between versions', icon: GitPullRequest, cat: 'Code Tools', run: () => showDiffBetweenVersions() },
                    { id: 'plugin', label: 'Add plugin agent', icon: Puzzle, cat: 'Code Tools', run: () => { addPlugin('Custom Agent', 'Analyze code', 'review'); showToast('success', 'Plugin added') } },
                    { id: 'share', label: 'Share build', icon: Share2, cat: 'Deploy', run: () => shareBuild() },
                    { id: 'workspace', label: 'Save to workspace', icon: Users, cat: 'Deploy', run: () => { setShowWorkspace(true); saveToWorkspace(); showToast('success', 'Saved') } },
                    { id: 'auto-deploy', label: 'Auto-deploy on refine', icon: Cloud, cat: 'Toggles', run: () => setAutoDeployRefine(v => !v) },
                    { id: 'ci-cd', label: 'CI/CD on refine', icon: GitPullRequest, cat: 'Toggles', run: () => setCiCdEnabled(v => !v) },
                  ].filter(a => {
                    const q = commandQuery.trim().toLowerCase()
                    if (!q) return true
                    return a.label.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q)
                  })
                  if (actions.length === 0) return <div className="px-3 py-8 text-center text-sm text-muted-foreground/60">No actions match "{commandQuery}"</div>
                  const groups: { cat: string; items: typeof actions }[] = []
                  for (const a of actions) {
                    const g = groups.find(x => x.cat === a.cat)
                    if (g) { g.items.push(a) } else { groups.push({ cat: a.cat, items: [a] }) }
                  }
                  let idx = 0
                  return groups.map(g => (
                    <div key={g.cat} className="mb-1.5">
                      <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">{g.cat}</p>
                      {g.items.map(a => {
                        const Icon = a.icon
                        const selected = idx++ === commandIndex
                        return (
                          <button
                            key={a.id}
                            disabled={a.disabled}
                            onMouseEnter={() => setCommandIndex(idx - 1)}
                            onClick={() => { if (!a.disabled) { a.run(); setCommandOpen(false) } }}
                            className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                              a.disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-primary/10',
                              selected && !a.disabled && 'bg-primary/10')}
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/40 text-muted-foreground">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{a.label}</span>
                            {selected && !a.disabled && <span className="shrink-0 text-[10px] text-muted-foreground/50">↵</span>}
                          </button>
                        )
                      })}
                    </div>
                  ))
                })()}
              </div>
              <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-2">
                  <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono">↑↓</kbd> navigate
                  <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono">↵</kbd> run
                </span>
                <span>⌘K</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Toast notifications ── */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 30, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className={cn('pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-md',
                t.kind === 'success' ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                t.kind === 'error' ? 'border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400' :
                'border-primary/40 bg-primary/15 text-primary')}
            >
              {t.kind === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : t.kind === 'error' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 shrink-0" />}
              <span className="font-medium">{t.msg}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Per-project AI Chat panel (floating, toggleable) ── */}
      {phase === 'complete' && result && (
        <ChatPanel
          chatHistory={chatHistory}
          chatInput={chatInput}
          chatLoading={chatLoading}
          setChatInput={setChatInput}
          sendChat={sendChat}
          setChatHistory={setChatHistory}
        />
      )}
    </div>
  )
}
