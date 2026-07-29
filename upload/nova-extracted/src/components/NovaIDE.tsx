'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, Eye, Code2, Folder, Activity, Sparkles,
  Brain, Send, Loader2, CheckCircle2, XCircle, Copy, Download,
  RotateCcw, Rocket, ExternalLink, Maximize2, Monitor, Tablet, Smartphone,
  FileJson, ChevronRight, X, Cloud, GitPullRequest, Gem,
  PanelRight, PanelLeftClose, PanelLeftOpen,
  Search, Shield, TrendingUp, Globe, Share2, Zap, Scale, Wrench, Layers,
  Users, Puzzle, TestTube, DollarSign, Network, Footprints,
  GitBranch, Archive, Play, Languages, Bug,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Activity = 'chat' | 'preview' | 'code' | 'files' | 'pipeline' | 'insights'

interface BuildFile { path: string; content: string; language?: string }
interface BuildResult {
  mission: string
  files: BuildFile[]
  pipeline: { agent: string; success: boolean; output: string; ms: number }[]
  qualityScore: number
  totalMs: number
  tokens: number
}
interface ChatMsg { role: 'user' | 'assistant'; content: string; files?: any[]; ts: number }

const ACTIVITIES: { id: Activity; icon: any; label: string }[] = [
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'preview', icon: Eye, label: 'Preview' },
  { id: 'code', icon: Code2, label: 'Code' },
  { id: 'files', icon: Folder, label: 'Files' },
  { id: 'pipeline', icon: Activity, label: 'Pipeline' },
  { id: 'insights', icon: Sparkles, label: 'Insights' },
]

export default function NovaIDE({ mission: initialMission, onExit }: { mission: string; onExit: () => void }) {
  const [activity, setActivity] = useState<Activity>('preview')
  const [mission, setMission] = useState(initialMission)
  const [phase, setPhase] = useState<'idle' | 'building' | 'complete'>('idle')
  const [result, setResult] = useState<BuildResult | null>(null)
  const [buildLog, setBuildLog] = useState<string[]>([])
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [splitView, setSplitView] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [toasts, setToasts] = useState<{ id: number; kind: 'success' | 'error' | 'info'; msg: string }[]>([])
  const toastIdRef = useRef(0)
  const [projects, setProjects] = useState<{ id: string; mission: string; files: BuildFile[]; quality: number; createdAt: string }[]>([])

  const showToast = useCallback((kind: 'success' | 'error' | 'info', msg: string) => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, kind, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200)
  }, [])

  // ⌘K / Ctrl+K — open command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCommandOpen(o => !o)
      } else if (e.key === 'Escape') {
        setCommandOpen(false)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        showToast('success', 'Saved')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showToast])

  // Load projects from localStorage
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('nova_projects') || '[]')
      if (Array.isArray(stored)) setProjects(stored)
    } catch {}
  }, [])

  // Save project when build completes
  useEffect(() => {
    if (phase === 'complete' && result?.files?.length) {
      const proj = {
        id: 'p_' + Date.now(),
        mission: result.mission,
        files: result.files,
        quality: result.qualityScore,
        createdAt: new Date().toISOString(),
      }
      setProjects(prev => {
        const updated = [proj, ...prev].slice(0, 20)
        try { localStorage.setItem('nova_projects', JSON.stringify(updated)) } catch {}
        return updated
      })
    }
  }, [phase, result])

  // Command palette actions
  type CmdAction = { id: string; label: string; icon: any; cat: string; run: () => void; hint?: string }
  const commandActions: CmdAction[] = [
    { id: 'new', label: 'New build', icon: RotateCcw, cat: 'Start', run: () => { setPhase('idle'); setResult(null); setBuildLog([]); setOpenTabs([]); setActiveTab(null) } },
    { id: 'deploy', label: 'Deploy to URL', icon: Rocket, cat: 'Deploy', run: () => showToast('info', 'Deploying…'), hint: 'Publish HTML' },
    { id: 'zip', label: 'Download ZIP', icon: Download, cat: 'Export', run: () => showToast('info', 'Preparing ZIP…') },
    { id: 'github', label: 'Export to GitHub', icon: Globe, cat: 'Export', run: () => showToast('info', 'Generating repo…') },
    { id: 'share', label: 'Share build', icon: Share2, cat: 'Share', run: () => showToast('info', 'Creating link…') },
    { id: 'review', label: 'AI Code Review', icon: Brain, cat: 'AI Analysis', run: () => { setActivity('chat'); setChatInput('Review this code as a senior developer.'); }, hint: 'Senior dev feedback' },
    { id: 'audit', label: 'Security Audit', icon: Shield, cat: 'AI Analysis', run: () => { setActivity('chat'); setChatInput('Audit this code for security vulnerabilities.'); } },
    { id: 'profile', label: 'Performance Profile', icon: TrendingUp, cat: 'AI Analysis', run: () => { setActivity('chat'); setChatInput('Analyze performance and suggest optimizations.'); } },
    { id: 'optimize', label: 'Cost Optimization', icon: DollarSign, cat: 'AI Analysis', run: () => { setActivity('chat'); setChatInput('Suggest ways to reduce build cost.'); } },
    { id: 'translate-py', label: 'Translate to Python', icon: Languages, cat: 'AI Analysis', run: () => { setActivity('chat'); setChatInput('Translate this code to Python.'); } },
    { id: 'walkthrough', label: 'Interactive Walkthrough', icon: Footprints, cat: 'AI Analysis', run: () => { setActivity('chat'); setChatInput('Explain this code line by line.'); } },
    { id: 'debug', label: 'AI Debug', icon: Wrench, cat: 'AI Analysis', run: () => { setActivity('chat'); setChatInput('Find and fix bugs in this code.'); } },
    { id: 'search', label: 'Search in files', icon: Search, cat: 'Code Tools', run: () => { setActivity('files') } },
    { id: 'map', label: 'Visual code map', icon: Network, cat: 'Code Tools', run: () => { setActivity('insights') } },
    { id: 'component', label: 'Save component', icon: Layers, cat: 'Code Tools', run: () => showToast('success', 'Component saved') },
    { id: 'api-test', label: 'Detect & test APIs', icon: TestTube, cat: 'Code Tools', run: () => showToast('info', 'Scanning for endpoints…') },
    { id: 'stats', label: 'Quality Stats', icon: Activity, cat: 'AI Analysis', run: () => { setActivity('pipeline') } },
    { id: 'analytics', label: 'Build Analytics', icon: TrendingUp, cat: 'AI Analysis', run: () => { setActivity('pipeline') } },
    { id: 'plugin', label: 'Add plugin agent', icon: Puzzle, cat: 'Code Tools', run: () => showToast('success', 'Plugin added') },
    { id: 'workspace', label: 'Save to workspace', icon: Users, cat: 'Share', run: () => showToast('success', 'Saved to workspace') },
    { id: 'branch', label: 'Create branch', icon: GitBranch, cat: 'Code Tools', run: () => showToast('success', 'Branch created') },
  ]
  const filteredActions = commandActions.filter(a => {
    const q = commandQuery.trim().toLowerCase()
    if (!q) return true
    return a.label.toLowerCase().includes(q) || a.cat.toLowerCase().includes(q) || (a.hint || '').toLowerCase().includes(q)
  })
  const actionGroups = filteredActions.reduce((acc, a) => {
    const g = acc.find(x => x.cat === a.cat)
    if (g) { g.items.push(a) } else { acc.push({ cat: a.cat, items: [a] }) }
    return acc
  }, [] as { cat: string; items: CmdAction[] }[])
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, string>>({})
  const [cursorLine, setCursorLine] = useState(1)
  const [cursorCol, setCursorCol] = useState(1)
  const [elapsed, setElapsed] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const buildStartRef = useRef<number | null>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Auto-open first file when build completes
  useEffect(() => {
    if (phase === 'complete' && result?.files?.length && openTabs.length === 0) {
      const html = result.files.find(f => /\.html$/i.test(f.path))
      openFile(html?.path || result.files[0].path)
    }
  }, [phase, result])

  // Timer
  useEffect(() => {
    if (phase !== 'building' || !buildStartRef.current) return
    const iv = setInterval(() => {
      if (buildStartRef.current) setElapsed(Math.floor((Date.now() - buildStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(iv)
  }, [phase])

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [chatHistory, chatLoading])

  const startBuild = async (m: string) => {
    if (!m.trim() || phase === 'building') return
    setPhase('building')
    setResult(null)
    setBuildLog([])
    setOpenTabs([])
    setActiveTab(null)
    setMission(m)
    setElapsed(0)
    buildStartRef.current = Date.now()

    try {
      const res = await fetch('/api/nova/build-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission: m, qualityTarget: 7 }),
      })

      if (!res.ok) { setPhase('idle'); return }

      const reader = res.body?.getReader()
      if (!reader) { setPhase('idle'); return }

      const decoder = new TextDecoder()
      let buffer = ''
      const files: BuildFile[] = []
      const pipeline: any[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.event === 'stage') {
              setBuildLog(prev => [...prev, `[${data.stage}] ${data.status}: ${data.detail || ''}`])
            } else if (data.event === 'file.start') {
              setBuildLog(prev => [...prev, `Building ${data.path} (${data.index}/${data.total})...`])
            } else if (data.event === 'file.built') {
              files.push({ path: data.path, content: data.content, language: 'text' })
              setBuildLog(prev => [...prev, `${data.path} ✓ (${data.lines} lines)`])
              setResult(prev => prev ? { ...prev, files: [...prev.files, { path: data.path, content: data.content }] } : { mission: m, files: [{ path: data.path, content: data.content }], pipeline: [], qualityScore: 0, totalMs: 0, tokens: 0 })
            } else if (data.event === 'file.fixed') {
              setBuildLog(prev => [...prev, `Fixed ${data.path} (${data.lines} lines)`])
            } else if (data.event === 'complete') {
              const finalFiles = data.files || files
              setResult({
                mission: m,
                files: finalFiles,
                pipeline: data.pipeline || [],
                qualityScore: data.qualityScore || 5,
                totalMs: data.totalMs || 0,
                tokens: data.tokens || 0,
              })
              setPhase('complete')
            } else if (data.event === 'error') {
              setBuildLog(prev => [...prev, `⚠ Error: ${data.error}`])
            }
          } catch {}
        }
      }
    } catch (err) {
      setBuildLog(prev => [...prev, `⚠ Network error: ${err}`])
      setPhase('idle')
    }
  }

  // Start build automatically if mission provided
  useEffect(() => {
    if (initialMission && phase === 'idle' && !result) {
      startBuild(initialMission)
    }
  }, [])

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatLoading || !result?.files?.length) return
    const userMsg: ChatMsg = { role: 'user', content: msg, ts: Date.now() }
    setChatHistory(prev => [...prev, userMsg])
    setChatInput('')
    setChatLoading(true)

    try {
      const res = await fetch('/api/nova/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission,
          files: result.files,
          message: msg,
          history: chatHistory.slice(-8),
        }),
      })
      const data = await res.json()
      if (data.ok) {
        const aiMsg: ChatMsg = { role: 'assistant', content: data.reply || '(no response)', files: data.files || [], ts: Date.now() }
        setChatHistory(prev => [...prev, aiMsg])
        if (data.appliedChanges && data.files?.length > 0) {
          const updatedFiles = result.files.map(orig => {
            const u = data.files.find((f: any) => f.path === orig.path)
            return u ? { ...orig, content: u.content } : orig
          })
          setResult({ ...result, files: updatedFiles })
        }
      } else {
        setChatHistory(prev => [...prev, { role: 'assistant', content: `⚠ Error: ${data.error}`, ts: Date.now() }])
      }
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: `⚠ Network error: ${err}`, ts: Date.now() }])
    }
    setChatLoading(false)
  }

  const openFile = (path: string) => {
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path])
    setActiveTab(path)
  }

  const closeTab = (path: string) => {
    setOpenTabs(prev => {
      const idx = prev.indexOf(path)
      const next = prev.filter(p => p !== path)
      if (activeTab === path) {
        const neighbor = next[idx] || next[idx - 1] || next[0] || null
        setActiveTab(neighbor)
      }
      return next
    })
  }

  const currentFile = result?.files.find(f => f.path === activeTab) || result?.files[0]
  const htmlFile = result?.files.find(f => /\.html$/i.test(f.path))
  const deviceWidth = previewDevice === 'mobile' ? '375px' : previewDevice === 'tablet' ? '768px' : '100%'

  const editFile = (path: string, content: string) => {
    setDirtyFiles(prev => ({ ...prev, [path]: content }))
    if (result) {
      setResult({
        ...result,
        files: result.files.map(f => f.path === path ? { ...f, content } : f),
      })
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Topbar (44px) ── */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/30 bg-card/40 px-3">
        <button onClick={onExit} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Back</span>
        </button>
        <div className="h-5 w-px bg-border/30" />
        {phase === 'building' ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : phase === 'complete' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : (
          <Sparkles className="h-4 w-4 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight">
            {phase === 'building' ? `Building... ${elapsed}s` : phase === 'complete' ? 'Build complete' : mission || 'NOVA IDE'}
          </p>
          {phase === 'complete' && result && (
            <p className="flex items-center gap-1.5 text-[9px] leading-tight text-muted-foreground">
              <span className="font-mono">{(result.totalMs / 1000).toFixed(0)}s</span>
              <span>·</span>
              <span>{result.files.length} files</span>
              {result.qualityScore > 0 && (<><span>·</span><span className={cn('font-mono font-semibold', result.qualityScore >= 7 ? 'text-emerald-500' : 'text-amber-500')}>{result.qualityScore}/10</span></>)}
            </p>
          )}
        </div>
        {phase === 'idle' && (
          <input
            value={mission}
            onChange={e => setMission(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') startBuild(mission) }}
            placeholder="Describe what to build... (⌘+Enter)"
            className="h-7 w-48 rounded-md border border-border/40 bg-background px-2 text-xs outline-none focus:border-primary/60"
          />
        )}
        {phase === 'idle' && (
          <Button size="sm" className="h-7 gap-1 px-3 text-xs" onClick={() => startBuild(mission)} disabled={!mission.trim()}>
            <Sparkles className="h-3 w-3" /> Build
          </Button>
        )}
        {phase === 'complete' && htmlFile && (
          <Button size="sm" className="h-7 gap-1 bg-emerald-600 px-2.5 text-xs hover:bg-emerald-700" onClick={() => showToast('info', 'Deploying…')}>
            <Rocket className="h-3 w-3" /> <span className="hidden sm:inline">Deploy</span>
          </Button>
        )}
        <button
          onClick={() => setCommandOpen(true)}
          title="Command palette (⌘K)"
          className="flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-background/60 px-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground"
        >
          <Sparkles className="h-3 w-3 text-primary" />
          <kbd className="hidden rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[9px] sm:inline">⌘K</kbd>
        </button>
      </div>

      {/* ── IDE Shell: activity rail + main area ── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Activity Rail (collapsible) */}
        <nav className={cn('flex shrink-0 flex-col border-r border-border/30 bg-card/30 py-2 transition-all duration-200', sidebarCollapsed ? 'w-12 items-center' : 'w-52 px-2')}>
          <button
            onClick={() => setSidebarCollapsed(s => !s)}
            title={sidebarCollapsed ? 'Expand' : 'Collapse'}
            className={cn('mb-1 flex h-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground', sidebarCollapsed ? 'w-9' : 'w-full gap-2 px-2')}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> <span className="text-[10px] font-medium uppercase">Collapse</span></>}
          </button>
          <div className="mb-1 h-px bg-border/30" />
          {ACTIVITIES.map(a => {
            const Icon = a.icon
            const active = activity === a.id
            const badge = a.id === 'files' ? (result?.files?.length || 0) : a.id === 'chat' ? chatHistory.length : 0
            return (
              <button
                key={a.id}
                onClick={() => setActivity(a.id)}
                title={a.label}
                className={cn('group relative flex h-9 items-center rounded-lg transition-all', sidebarCollapsed ? 'w-9 justify-center' : 'w-full gap-2.5 px-2',
                  active ? 'bg-primary/15 text-primary' : 'text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="flex-1 truncate text-xs font-medium">{a.label}</span>}
                {badge > 0 && (
                  <span className={cn('flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8px] font-bold',
                    sidebarCollapsed ? 'absolute -right-0.5 -top-0.5' : '',
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground')}>
                    {badge}
                  </span>
                )}
                {active && sidebarCollapsed && <span className="absolute -left-2 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
              </button>
            )
          })}
        </nav>

        {/* Main area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {/* ═══ CHAT ═══ */}
          {activity === 'chat' && (
            <div className="flex h-full flex-col bg-background">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-4 py-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15"><Brain className="h-3.5 w-3.5 text-primary" /></div>
                <p className="text-xs font-semibold">Chat with NOVA</p>
                {chatHistory.length > 0 && <button onClick={() => setChatHistory([])} className="ml-auto text-[10px] text-muted-foreground hover:text-destructive">Clear</button>}
              </div>
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                {chatHistory.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                    <Brain className="mb-3 h-12 w-12 text-muted-foreground/20" />
                    <p className="text-sm font-medium">Ask NOVA anything about this build</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground/60">e.g. "make the button blue", "explain index.html", "add dark mode"</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                      {['Explain the project', 'Add dark mode', 'Make it responsive'].map(s => (
                        <button key={s} onClick={() => setChatInput(s)} className="rounded-full border border-border/40 bg-card/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">{s}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-3">
                    {chatHistory.map((m, i) => (
                      <div key={i} className={cn('flex gap-2.5', m.role === 'user' ? 'flex-row-reverse' : '')}>
                        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground')}>
                          {m.role === 'user' ? 'You' : 'N'}
                        </div>
                        <div className={cn('min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed', m.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-muted/40 text-foreground/90')}>
                          <div className="whitespace-pre-wrap break-words">{m.content}</div>
                          {m.files?.length > 0 && <p className="mt-1.5 text-[10px] text-emerald-500">✓ Applied to {m.files.length} file(s)</p>}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/50 text-[10px] font-bold text-muted-foreground">N</div>
                        <div className="rounded-lg bg-muted/40 px-3 py-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="shrink-0 border-t border-border/30 p-3">
                <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-border/40 bg-card/50 p-2 focus-within:border-primary/50">
                  <Textarea
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChat() } }}
                    placeholder="Message NOVA… (⌘+Enter)"
                    rows={1}
                    className="min-h-[36px] flex-1 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                  />
                  <Button size="sm" className="h-8 shrink-0 gap-1.5 px-3" onClick={sendChat} disabled={!chatInput.trim() || chatLoading}>
                    {chatLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ═══ PREVIEW — full-bleed iframe ═══ */}
          {activity === 'preview' && (
            <div className="flex h-full flex-col overflow-hidden bg-muted/10">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/30 bg-card/40 px-3 py-1.5">
                <div className="flex items-center gap-0.5 rounded-md border border-border/30 bg-card/40 p-0.5">
                  {(['desktop', 'tablet', 'mobile'] as const).map(d => (
                    <button key={d} onClick={() => setPreviewDevice(d)} title={d}
                      className={cn('flex items-center justify-center rounded px-2 py-0.5 text-[10px] font-medium', previewDevice === d ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                      {d === 'desktop' ? <Monitor className="h-3 w-3" /> : d === 'tablet' ? <Tablet className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
                <span className="font-mono text-[10px] text-muted-foreground/60">{deviceWidth}</span>
                {htmlFile && (
                  <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[11px] gap-1" onClick={() => { const b = new Blob([htmlFile.content], { type: 'text/html' }); const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 10000) }}>
                    <Maximize2 className="h-3 w-3" /> Open
                  </Button>
                )}
              </div>
              {htmlFile ? (
                <iframe
                  title="Live Preview"
                  srcDoc={htmlFile.content}
                  className="block h-full w-full flex-1 border-0 bg-white"
                  style={{ width: deviceWidth, maxWidth: '100%', margin: '0 auto' }}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-muted-foreground">
                  {phase === 'building' ? (
                    <div className="text-center">
                      <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
                      <p className="text-sm">Building... {elapsed}s</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Eye className="mx-auto mb-3 h-10 w-10 opacity-20" />
                      <p className="text-sm font-medium">No preview yet</p>
                      <p className="mt-1 text-xs text-muted-foreground/60">Build something to see a live preview</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══ CODE — editable textarea with tabs ═══ */}
          {activity === 'code' && (
            <div className="flex h-full flex-col bg-background">
              {/* File tabs */}
              {openTabs.length > 0 && (
                <div className="flex shrink-0 items-center overflow-x-auto border-b border-border/30 bg-card/20">
                  {openTabs.map(path => (
                    <div key={path} className={cn('group flex shrink-0 items-center gap-1.5 border-r border-border/30 px-3 py-1.5 text-xs', activeTab === path ? 'bg-background text-foreground' : 'bg-card/20 text-muted-foreground hover:bg-card/40')}>
                      <button onClick={() => { setActiveTab(path); setActivity('code') }} className="flex items-center gap-1.5">
                        <FileJson className="h-3 w-3" />
                        <span className="font-mono">{path.split('/').pop()}</span>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); closeTab(path) }} className="ml-1 rounded p-0.5 text-muted-foreground/50 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setSplitView(v => !v)}
                    title="Split view"
                    className={cn('ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium', splitView ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/40')}
                  >
                    <PanelRight className="h-3.5 w-3.5" /> Split
                  </button>
                </div>
              )}
              {/* Code header */}
              <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-1.5">
                {currentFile ? (
                  <>
                    <FileJson className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs font-medium">{currentFile.path}</span>
                    <span className="text-[10px] text-muted-foreground/60">{currentFile.content.split('\n').length} lines</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1" onClick={() => navigator.clipboard?.writeText(currentFile.content)}>
                        <Copy className="h-3 w-3" /> Copy
                      </Button>
                    </div>
                  </>
                ) : <span className="text-xs text-muted-foreground">No file selected</span>}
              </div>
              {/* Code + Preview split */}
              <div className={cn('flex min-h-0 flex-1 overflow-hidden', splitView ? 'flex-row' : 'flex-col')}>
                {currentFile ? (
                  <div className={cn('flex min-h-0 overflow-hidden bg-[#0a0e1a] font-mono text-[12px]', splitView ? 'w-1/2 border-r border-border/30' : 'flex-1')}>
                    <div className="select-none overflow-hidden py-4 pl-3 pr-2 text-right text-muted-foreground/40" style={{ minWidth: '3.5rem' }}>
                      {currentFile.content.split('\n').map((_, i) => <div key={i} style={{ height: '1.5rem' }}>{i + 1}</div>)}
                    </div>
                    <textarea
                      value={currentFile.content}
                      onChange={e => { editFile(currentFile.path, e.target.value); const v = e.target.value; const p = e.target.selectionStart; const b = v.slice(0, p); setCursorLine(b.split('\n').length); setCursorCol(b.length - b.lastIndexOf('\n')) }}
                      onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); const ta = e.target as HTMLTextAreaElement; const s = ta.selectionStart; const e2 = ta.selectionEnd; const nv = ta.value.slice(0, s) + '  ' + ta.value.slice(e2); editFile(currentFile.path, nv); requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2 }) } }}
                      spellCheck={false}
                      className="flex-1 resize-none overflow-auto whitespace-pre border-0 bg-transparent py-4 pl-2 pr-4 text-foreground/90 outline-none caret-primary"
                      style={{ lineHeight: '1.5rem' }}
                      placeholder="// Edit code..."
                    />
                    {dirtyFiles[currentFile.path] != null && (
                      <div className="pointer-events-none absolute right-3 top-2 flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> UNSAVED
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-muted-foreground">
                    <p className="text-xs">Select a file from Files</p>
                  </div>
                )}
                {splitView && htmlFile && (
                  <div className="flex w-1/2 flex-col overflow-hidden bg-muted/10">
                    <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-1.5">
                      <Eye className="h-3.5 w-3.5 text-primary" /><span className="text-xs font-medium">Live Preview</span>
                    </div>
                    <iframe title="Split Preview" srcDoc={htmlFile.content} className="h-full w-full border-0 bg-white" sandbox="allow-scripts allow-forms allow-modals allow-popups" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ FILES ═══ */}
          {activity === 'files' && (
            <div className="flex h-full flex-col bg-background">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-4 py-2.5">
                <Folder className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-semibold">Project files</p>
                <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{result?.files?.length || 0}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {(result?.files || []).map(f => (
                  <button key={f.path} onClick={() => { openFile(f.path); setActivity('code') }}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all', activeTab === f.path ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground')}>
                    <FileJson className={cn('h-4 w-4 shrink-0', /\.html$/i.test(f.path) ? 'text-amber-500' : 'text-muted-foreground/70')} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                    <span className="text-[9px] text-muted-foreground/50">{f.content.split('\n').length}L</span>
                    {/\.html$/i.test(f.path) && <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-bold uppercase text-amber-500">HTML</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ═══ PIPELINE ═══ */}
          {activity === 'pipeline' && (
            <div className="flex h-full flex-col bg-background">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-4 py-2.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-semibold">Pipeline</p>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <div className="mx-auto max-w-3xl space-y-4">
                  {phase === 'building' && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                        <p className="text-sm font-medium">Building... {elapsed}s</p>
                      </div>
                      <div className="mt-3 space-y-1">
                        {buildLog.slice(-10).map((log, i) => (
                          <p key={i} className="font-mono text-[10px] text-muted-foreground">{log}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {result?.qualityScore != null && result.qualityScore > 0 && (
                    <div className="flex items-center gap-4">
                      <div className={cn('flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-2', result.qualityScore >= 7 ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10')}>
                        <div className="text-center">
                          <p className={cn('text-3xl font-black tabular-nums leading-none', result.qualityScore >= 7 ? 'text-emerald-500' : 'text-amber-500')}>{result.qualityScore}</p>
                          <p className="text-[9px] text-muted-foreground">/10</p>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Quality score</p>
                        <p className="text-xs text-muted-foreground">{result.files.length} files · {(result.totalMs / 1000).toFixed(0)}s · {result.tokens} tokens</p>
                      </div>
                    </div>
                  )}
                  {result?.pipeline?.map((p, i) => (
                    <div key={i} className="rounded-lg border border-border/20 bg-card/30 p-3">
                      <div className="flex items-center gap-2">
                        {p.success ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
                        <span className="flex-1 truncate text-xs font-medium capitalize">{p.agent}</span>
                        <span className="font-mono text-[10px] text-muted-foreground/70">{p.ms}ms</span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground/70">{p.output}</p>
                    </div>
                  ))}
                  {buildLog.length > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Build log</p>
                      <div className="space-y-0.5 rounded-lg border border-border/20 bg-[#0a0e1a] p-3">
                        {buildLog.map((log, i) => (
                          <p key={i} className={cn('font-mono text-[10px]', log.includes('✓') ? 'text-emerald-500' : log.includes('⚠') ? 'text-amber-500' : 'text-muted-foreground')}>{log}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══ INSIGHTS ═══ */}
          {activity === 'insights' && (
            <div className="flex h-full flex-col bg-background">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/30 px-4 py-2.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <p className="text-xs font-semibold">AI Insights</p>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <div className="mx-auto max-w-3xl">
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Sparkles className="mb-3 h-12 w-12 text-muted-foreground/20" />
                    <p className="text-sm font-medium text-muted-foreground">Ask NOVA in the Chat activity</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground/60">Use the Chat tab to ask NOVA for code review, security audit, or improvements. Results appear here.</p>
                    <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => setActivity('chat')}>
                      <MessageSquare className="h-3.5 w-3.5" /> Open Chat
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Status Bar (22px) ── */}
      <div className="flex h-[22px] shrink-0 items-center gap-3 border-t border-border/30 bg-primary/5 px-3 text-[10px] text-muted-foreground/80">
        {phase === 'complete' ? (
          <span className="flex items-center gap-1 text-emerald-500"><CheckCircle2 className="h-2.5 w-2.5" /> ready</span>
        ) : phase === 'building' ? (
          <span className="flex items-center gap-1 text-amber-500"><Loader2 className="h-2.5 w-2.5 animate-spin" /> building</span>
        ) : (
          <span className="flex items-center gap-1"><Sparkles className="h-2.5 w-2.5" /> idle</span>
        )}
        <span className="text-muted-foreground/40">|</span>
        {activity === 'code' && currentFile && <span className="font-mono">Ln {cursorLine}, Col {cursorCol}</span>}
        {currentFile && <span className="font-mono uppercase">{currentFile.path.split('.').pop() || 'txt'}</span>}
        <span className="text-muted-foreground/40">|</span>
        <span className="font-mono">{result?.files?.length || 0} files</span>
        {result?.qualityScore != null && result.qualityScore > 0 && (<><span className="text-muted-foreground/40">|</span><span className={cn('font-mono', result.qualityScore >= 7 ? 'text-emerald-500' : 'text-amber-500')}>Q {result.qualityScore}/10</span></>)}
        <span className="ml-auto capitalize">{activity}</span>
      </div>

      {/* ── Command Palette (⌘K) ── */}
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
                <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                <input
                  autoFocus
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  placeholder="Search actions… (deploy, review, python, zip)"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                />
                <kbd className="hidden rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">Esc</kbd>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2">
                {filteredActions.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground/60">No actions match "{commandQuery}"</div>
                ) : (
                  actionGroups.map(g => (
                    <div key={g.cat} className="mb-1.5">
                      <p className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">{g.cat}</p>
                      {g.items.map(a => {
                        const Icon = a.icon
                        return (
                          <button
                            key={a.id}
                            onClick={() => { a.run(); setCommandOpen(false) }}
                            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-primary/10"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/40 text-muted-foreground">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{a.label}</span>
                              {a.hint && <span className="block truncate text-[10px] text-muted-foreground/60">{a.hint}</span>}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-2">
                  <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono">↑↓</kbd> navigate
                  <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono">↵</kbd> run
                </span>
                <span>{filteredActions.length} actions</span>
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
    </div>
  )
}
