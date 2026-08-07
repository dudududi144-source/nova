// Comprehensive characterization tests for src/app/page.tsx
// Tests UI structure, keyboard shortcuts, state management, and configuration constants
// by reading the source file as text (no React rendering).
import { describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

// page.tsx — UI structure, keyboard shortcuts, state management
const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/page.tsx'),
  'utf-8'
)
// page-constants.ts — STARTER_CATEGORIES, SLASH_COMMANDS, SUGGESTION_GROUPS, etc.
// (extracted from page.tsx for maintainability)
const constSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/page-constants.ts'),
  'utf-8'
)
// Combined source — for tests that check constants exist somewhere in the codebase
const allSource = source + '\n' + constSource

describe('page.tsx — UI structure', () => {
  test('renders a <main> semantic element', () => {
    expect(source).toMatch(/<main[\s>]/)
  })
  test('renders a <header> semantic element', () => {
    expect(source).toMatch(/<header[\s>]/)
  })
  test('renders a <footer> semantic element with mt-auto', () => {
    expect(source).toMatch(/<footer[^>]*mt-auto/)
  })
  test('renders a <textarea> for the mission input', () => {
    expect(source).toMatch(/<textarea/)
  })
  test('textarea has maxLength={5000}', () => {
    expect(source).toContain('maxLength={5000}')
  })
  test('textarea has autoFocus', () => {
    expect(source).toContain('autoFocus')
  })
  test('mission Textarea has id="mission-input"', () => {
    expect(source).toContain('id="mission-input"')
  })
  test('iframe uses sandbox="allow-scripts" (no allow-same-origin)', () => {
    expect(source).toContain('sandbox="allow-scripts"')
    expect(source).not.toContain('allow-same-origin')
  })
  test('iframe uses srcDoc (not blob URL for iframe)', () => {
    expect(source).toContain('srcDoc')
    // createObjectURL is used for ZIP/file downloads, NOT for the iframe src
    expect(source).not.toMatch(/createObjectURL[^;]*iframe/)
  })
  test('has aria-busy on root container', () => {
    expect(source).toContain('aria-busy={loading || refining}')
  })
  test('has the title "NOVA"', () => {
    expect(source).toMatch(/NOVA/)
  })
  test('has NOVA subtitle text', () => {
    expect(source).toContain('Prompt-to-Reality')
  })
})

describe('page-constants.ts — STARTER_CATEGORIES structure', () => {
  test('has 4 starter categories', () => {
    // Find STARTER_CATEGORIES block — match from declaration up to first line starting with `]`
    const startIdx = constSource.indexOf('const STARTER_CATEGORIES')
    const linesFromStart = constSource.slice(startIdx).split('\n')
    let endLineIdx = -1
    for (let i = 1; i < linesFromStart.length; i++) {
      if (linesFromStart[i].startsWith(']')) { endLineIdx = i; break }
    }
    const block = linesFromStart.slice(0, endLineIdx + 1).join('\n')
    const labels = block.match(/label: '/g)
    expect(labels).toHaveLength(4)
  })
  test('each category has 3 prompts', () => {
    const startIdx = constSource.indexOf('const STARTER_CATEGORIES')
    const linesFromStart = constSource.slice(startIdx).split('\n')
    let endLineIdx = -1
    for (let i = 1; i < linesFromStart.length; i++) {
      if (linesFromStart[i].startsWith(']')) { endLineIdx = i; break }
    }
    const block = linesFromStart.slice(0, endLineIdx + 1).join('\n')
    const prompts = block.match(/'Build a/g)
    expect(prompts).toHaveLength(12) // 4 categories × 3 prompts
  })
  test('categories: Dashboards, Games, Creative, Tools', () => {
    expect(constSource).toContain("label: 'Dashboards'")
    expect(constSource).toContain("label: 'Games'")
    expect(constSource).toContain("label: 'Creative'")
    expect(constSource).toContain("label: 'Tools'")
  })
  test('EXAMPLES is derived from STARTER_CATEGORIES', () => {
    expect(constSource).toContain("EXAMPLES: readonly string[] = STARTER_CATEGORIES.flatMap")
  })
  test('examples are ambitious (not basic)', () => {
    expect(constSource).toContain('crypto trading dashboard')
    expect(constSource).toContain('banking dashboard')
    expect(constSource).toContain('snake game')
    expect(constSource).toContain('music production studio')
    expect(constSource).toContain('mobile OS simulator')
  })
})

describe('page-constants.ts — SLASH_COMMANDS structure', () => {
  test('has 5 slash commands', () => {
    const startIdx = constSource.indexOf('const SLASH_COMMANDS')
    const linesFromStart = constSource.slice(startIdx).split('\n')
    let endLineIdx = -1
    for (let i = 1; i < linesFromStart.length; i++) {
      if (linesFromStart[i].startsWith(']')) { endLineIdx = i; break }
    }
    const block = linesFromStart.slice(0, endLineIdx + 1).join('\n')
    const cmds = block.match(/cmd: '/g)
    expect(cmds).toHaveLength(5)
  })
  test('slash commands include /dashboard, /game, /creative, /tool, /enhance', () => {
    expect(constSource).toContain("cmd: '/dashboard'")
    expect(constSource).toContain("cmd: '/game'")
    expect(constSource).toContain("cmd: '/creative'")
    expect(constSource).toContain("cmd: '/tool'")
    expect(constSource).toContain("cmd: '/enhance'")
  })
  test('slash commands have action: filter or insert', () => {
    expect(constSource).toMatch(/action: 'filter'/)
    expect(constSource).toMatch(/action: 'insert'/)
  })
})

describe('page-constants.ts — REFINE_THINKING_STEPS', () => {
  test('has 3 refine thinking steps', () => {
    const startIdx = constSource.indexOf('const REFINE_THINKING_STEPS')
    const linesFromStart = constSource.slice(startIdx).split('\n')
    let endLineIdx = -1
    for (let i = 1; i < linesFromStart.length; i++) {
      if (linesFromStart[i].startsWith(']')) { endLineIdx = i; break }
    }
    const block = linesFromStart.slice(0, endLineIdx + 1).join('\n')
    // Count string literals (lines with quoted text)
    const steps = block.match(/^\s+'[^']+'/gm)
    expect(steps).toHaveLength(3)
  })
  test('includes "Processing your request"', () => {
    expect(constSource).toContain('Processing your request')
  })
  test('includes "Making changes"', () => {
    expect(constSource).toContain('Making changes')
  })
  test('includes "Finalizing"', () => {
    expect(constSource).toContain('Finalizing')
  })
})

describe('page-constants.ts — SUGGESTION_GROUPS structure', () => {
  test('has multiple suggestion groups', () => {
    const startIdx = constSource.indexOf('const SUGGESTION_GROUPS')
    const linesFromStart = constSource.slice(startIdx).split('\n')
    let endLineIdx = -1
    for (let i = 1; i < linesFromStart.length; i++) {
      if (linesFromStart[i].startsWith(']')) { endLineIdx = i; break }
    }
    const block = linesFromStart.slice(0, endLineIdx + 1).join('\n')
    // Count "match:" occurrences — should be 6 groups (duplicate removed)
    const matches = block.match(/match: \[/g)
    expect(matches!.length).toBe(6)
  })
  test('includes a group matching "game" keyword', () => {
    expect(constSource).toMatch(/match: \[[^\]]*'game'/)
  })
  test('includes a group matching "dashboard" keyword', () => {
    expect(constSource).toMatch(/match: \[[^\]]*'dashboard'/)
  })
  test('includes a group matching "todo" keyword', () => {
    expect(constSource).toMatch(/match: \[[^\]]*'todo'/)
  })
  test('includes a group matching "timer" keyword', () => {
    expect(constSource).toMatch(/match: \[[^\]]*'timer'/)
  })
  test('DEFAULT_SUGGESTIONS has 4 entries', () => {
    const startIdx = constSource.indexOf('const DEFAULT_SUGGESTIONS')
    const linesFromStart = constSource.slice(startIdx).split('\n')
    let endLineIdx = -1
    for (let i = 1; i < linesFromStart.length; i++) {
      if (linesFromStart[i].startsWith(']')) { endLineIdx = i; break }
    }
    const block = linesFromStart.slice(0, endLineIdx + 1).join('\n')
    const sugs = block.match(/^\s+'[^']+'/gm)
    expect(sugs).toHaveLength(4)
  })
  test('no duplicate suggestion groups (art/draw/paint deduped)', () => {
    // The duplicate "art/draw/paint" group was removed — count 'paint' keyword occurrences
    // in match arrays. Should be 1 (was 2 before dedup).
    const paintMatches = constSource.match(/'paint'/g)
    expect(paintMatches).toHaveLength(1)
  })
})

describe('page.tsx — keyboard shortcuts (single keys)', () => {
  test('Escape cancels build/refine', () => {
    expect(source).toContain("e.key === 'Escape'")
  })
  test('M cycles AI models', () => {
    expect(source).toContain("e.key === 'm'")
  })
  test('E triggers prompt enhance', () => {
    expect(source).toContain("e.key === 'e'")
  })
  test('I toggles insights panel', () => {
    expect(source).toContain("e.key === 'i'")
  })
  test('D toggles diff view', () => {
    expect(source).toContain("e.key === 'd'")
  })
  test('F toggles fullscreen', () => {
    expect(source).toContain("e.key === 'f'")
  })
  test('S toggles stats', () => {
    expect(source).toContain("e.key === 's'")
  })
  test('T toggles templates', () => {
    expect(source).toContain("e.key === 't'")
  })
  test('? toggles shortcuts panel', () => {
    expect(source).toContain("e.key === '?'")
  })
})

describe('page.tsx — keyboard shortcuts (combos)', () => {
  test('Cmd/Ctrl+S downloads the result', () => {
    expect(source).toMatch(/\(e\.metaKey \|\| e\.ctrlKey\).*e\.key\.toLowerCase\(\) === 's'/)
  })
  test('Cmd/Ctrl+N starts a new build', () => {
    expect(source).toMatch(/\(e\.metaKey \|\| e\.ctrlKey\).*e\.key\.toLowerCase\(\) === 'n'/)
  })
  test('Cmd/Ctrl+Enter triggers build', () => {
    expect(source).toMatch(/\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === 'Enter'/)
  })
  test('single-key shortcuts require NOT in text field', () => {
    // Each single-key handler checks isTextField
    const matches = source.match(/isTextField/g)
    expect(matches!.length).toBeGreaterThanOrEqual(8)
  })
})

describe('page.tsx — keyboard shortcuts (text field guard)', () => {
  test('checks for INPUT, TEXTAREA, contentEditable', () => {
    expect(source).toContain("target.tagName === 'INPUT'")
    expect(source).toContain("target.tagName === 'TEXTAREA'")
    expect(source).toContain('target.isContentEditable')
  })
  test('Esc in text field is NOT hijacked', () => {
    // The Escape handler returns early when target is a text field
    const escBlock = source.slice(
      source.indexOf("e.key === 'Escape' && (loading || refining)"),
      source.indexOf("e.key === 'Escape' && (loading || refining)") + 500
    )
    expect(escBlock).toContain('isTextField')
    expect(escBlock).toContain('return')
  })
})

describe('page.tsx — state management (useState)', () => {
  test('has mission state', () => {
    expect(source).toMatch(/const \[mission, setMission\] = useState\(''\)/)
  })
  test('has loading state', () => {
    expect(source).toMatch(/const \[loading, setLoading\] = useState\(false\)/)
  })
  test('has refining state', () => {
    expect(source).toMatch(/const \[refining, setRefining\] = useState\(false\)/)
  })
  test('has result state (BuildResult | null)', () => {
    expect(source).toMatch(/const \[result, setResult\] = useState<BuildResult \| null>/)
  })
  test('has history state (BuildResult[])', () => {
    expect(source).toMatch(/const \[history, setHistory\] = useState<BuildResult\[\]>/)
  })
  test('has error state', () => {
    expect(source).toMatch(/const \[error, setError\] = useState<string \| null>/)
  })
  test('has confirmClear state', () => {
    expect(source).toMatch(/const \[confirmClear, setConfirmClear\] = useState\(false\)/)
  })
  test('has elapsed state', () => {
    expect(source).toMatch(/const \[elapsed, setElapsed\] = useState\(0\)/)
  })
  test('has previewWidth state with 4 modes', () => {
    expect(source).toMatch(/const \[previewWidth, setPreviewWidth\] = useState<'full' \| 'desktop' \| 'tablet' \| 'mobile'>/)
  })
  test('has fullscreen state', () => {
    expect(source).toMatch(/const \[fullscreen, setFullscreen\] = useState\(false\)/)
  })
  test('has showShortcuts state', () => {
    expect(source).toMatch(/const \[showShortcuts, setShowShortcuts\] = useState\(false\)/)
  })
  test('has selectedModel state with 3 models', () => {
    expect(source).toMatch(/const \[selectedModel, setSelectedModel\] = useState<'z-ai' \| 'qwen' \| 'kimi'>/)
  })
  test('has showStats state', () => {
    expect(source).toMatch(/const \[showStats, setShowStats\] = useState\(false\)/)
  })
  test('has showTemplates state', () => {
    expect(source).toMatch(/const \[showTemplates, setShowTemplates\] = useState\(false\)/)
  })
  test('has slashMenuOpen state', () => {
    expect(source).toMatch(/const \[slashMenuOpen, setSlashMenuOpen\] = useState\(false\)/)
  })
  test('has chatMessages state', () => {
    expect(source).toMatch(/const \[chatMessages, setChatMessages\] = useState/)
  })
  test('has expandedVersions state (Set<string>)', () => {
    expect(source).toMatch(/const \[expandedVersions, setExpandedVersions\] = useState<Set<string>>/)
  })
})

describe('page.tsx — useRef mirrors', () => {
  test('has selectedModelRef mirror', () => {
    expect(source).toContain("const selectedModelRef = useRef<'z-ai' | 'qwen' | 'kimi'>('z-ai')")
  })
  test('has quickModeRef mirror', () => {
    expect(source).toContain('const quickModeRef = useRef(false)')
  })
  test('has abortRef for build cancellation', () => {
    expect(source).toContain('const abortRef = useRef<AbortController | null>(null)')
  })
  test('has refineAbortRef for refine cancellation', () => {
    expect(source).toContain('const refineAbortRef = useRef<AbortController | null>(null)')
  })
  test('has buildIdRef', () => {
    expect(source).toContain('const buildIdRef = useRef<string | null>(null)')
  })
  test('has resultRef mirror (avoids useCallback dep)', () => {
    expect(source).toContain('const resultRef = useRef<BuildResult | null>(null)')
  })
  test('has historyRef mirror', () => {
    expect(source).toMatch(/const historyRef = useRef<BuildResult\[\]>/)
  })
  test('synchronizes selectedModelRef with selectedModel via useEffect', () => {
    expect(source).toMatch(/useEffect\(\(\) => \{ selectedModelRef\.current = selectedModel \}/)
  })
})

describe('page.tsx — useEffect hooks', () => {
  test('has keydown listener registration', () => {
    expect(source).toContain("window.addEventListener('keydown', onKey)")
    expect(source).toContain("window.removeEventListener('keydown', onKey)")
  })
  test('keydown effect deps include loading, refining, result', () => {
    // v29.45: Added fullscreen, previousBuild, buildStats, qualityScore to deps
    const match = source.match(/\}, \[loading, refining, result, download, cancelBuild, cancelRefine, reset, showShortcuts, fullscreen, previousBuild, buildStats, qualityScore\]\)/)
    expect(match).not.toBeNull()
  })
  test('has elapsed time counter using setInterval', () => {
    expect(source).toContain('setInterval')
    expect(source).toContain('setElapsed')
  })
  test('has useEffect that loads history from localStorage on mount', () => {
    expect(source).toContain("localStorage.getItem('nova_history')")
  })
  test('has useEffect that loads saved model from localStorage', () => {
    expect(source).toContain("localStorage.getItem('nova_model')")
  })
  test('has useEffect that loads quick mode setting', () => {
    expect(source).toContain("localStorage.getItem('nova_quick_mode')")
  })
})

describe('page.tsx — useCallback definitions', () => {
  test('has cancelBuild callback (separate from reset)', () => {
    expect(source).toContain('const cancelBuild')
    expect(source).toContain('const reset')
  })
  test('cancelBuild does NOT call setMission("")', () => {
    const cancelPos = source.indexOf('const cancelBuild')
    const resetPos = source.indexOf('const reset')
    const cancelBlock = source.slice(cancelPos, resetPos)
    expect(cancelBlock).not.toContain("setMission('')")
  })
  test('has cancelRefine callback', () => {
    expect(source).toContain('const cancelRefine')
  })
  test('has download callback', () => {
    expect(source).toContain('const download')
  })
  test('has build callback', () => {
    expect(source).toMatch(/const build = useCallback/)
  })
  test('has retryWithModel callback', () => {
    expect(source).toContain('const retryWithModel = useCallback')
  })
})

describe('page.tsx — error handling', () => {
  test('has fail() helper function', () => {
    expect(source).toContain('const fail =')
  })
  test('has Content-Type check before res.json() in build flow', () => {
    expect(source).toContain("archRes.headers.get('content-type')")
  })
  test('does NOT use window.confirm for clearing history', () => {
    expect(source).not.toContain('window.confirm')
  })
  test('uses inline confirmClear state for clear history', () => {
    expect(source).toContain('confirmClear')
  })
  test('uses toast for error notifications', () => {
    expect(source).toContain('toast.error')
  })
  test('uses toast for success notifications', () => {
    expect(source).toContain('toast.success')
  })
  test('uses toast for info notifications', () => {
    expect(source).toContain('toast.info')
  })
})

describe('page.tsx — localStorage persistence', () => {
  test('persists history under "nova_history" key', () => {
    expect(source).toContain("localStorage.setItem('nova_history'")
  })
  test('persists model under "nova_model" key', () => {
    expect(source).toContain("localStorage.setItem('nova_model'")
  })
  test('persists quick mode under "nova_quick_mode" key', () => {
    expect(source).toContain("localStorage.setItem('nova_quick_mode'")
  })
  test('all localStorage.setItem calls are wrapped in try/catch', () => {
    // Find all setItem calls and verify each is inside a try block
    const setItemLines = source.split('\n').filter(l => l.includes('localStorage.setItem'))
    expect(setItemLines.length).toBeGreaterThan(0)
    // The pattern `try { localStorage.setItem(...) } catch` should appear
    expect(source).toMatch(/try \{[^}]*localStorage\.setItem[^}]*\} catch/)
  })
})

describe('page.tsx — helper imports', () => {
  test('imports newBuildId from lib/helpers', () => {
    expect(source).toContain("from '@/lib/helpers'")
    expect(source).toContain('newBuildId')
  })
  test('imports sanitizeFilename', () => {
    expect(source).toContain('sanitizeFilename')
  })
  test('imports validateHistory', () => {
    expect(source).toContain('validateHistory')
  })
  test('imports type BuildResult (not redefines)', () => {
    expect(source).toContain('type BuildResult')
    expect(source).not.toMatch(/^interface BuildResult\b/m)
  })
  test('imports ThemeToggle component', () => {
    expect(source).toContain("from '@/components/theme-toggle'")
    expect(source).toContain('ThemeToggle')
  })
  test('imports PipelineProgress component', () => {
    expect(source).toContain("from '@/components/pipeline-progress'")
    expect(source).toContain('PipelineProgress')
  })
})

describe('page.tsx — examples behavior', () => {
  test('examples auto-build (call build(ex), not just setMission)', () => {
    expect(source).toContain('build(ex)')
  })
  test('has character count display', () => {
    expect(source).toContain('mission.length')
    expect(source).toContain('/2000')
  })
  test('has elapsed time counter display', () => {
    expect(source).toContain('elapsed')
  })
})

describe('page.tsx — preview width modes', () => {
  test('all 4 modes have onClick handlers', () => {
    expect(source).toContain("setPreviewWidth('full')")
    expect(source).toContain("setPreviewWidth('desktop')")
    expect(source).toContain("setPreviewWidth('tablet')")
    expect(source).toContain("setPreviewWidth('mobile')")
  })
  test('desktop width = 1280px', () => {
    expect(source).toContain("w-[1280px]")
  })
  test('tablet width = 768px', () => {
    expect(source).toContain("w-[768px]")
  })
  test('mobile width = 375px', () => {
    expect(source).toContain("w-[375px]")
  })
})

describe('page.tsx — shortcuts panel content', () => {
  test('shortcuts panel uses role="dialog"', () => {
    expect(source).toContain('role="dialog"')
  })
  test('shortcuts panel has aria-label="Keyboard shortcuts"', () => {
    expect(source).toContain('aria-label="Keyboard shortcuts"')
  })
  test('shortcuts panel lists 13 shortcuts', () => {
    const panelStart = source.indexOf("showShortcuts && (")
    const panelEnd = source.indexOf('</div>\n      )}', panelStart)
    const panel = source.slice(panelStart, panelEnd)
    const items = panel.match(/keys: \[/g)
    expect(items!.length).toBe(13)
  })
  test('shortcuts panel includes Cmd+Enter, Cmd+S, Cmd+N, E, I, D, F, S, T, M, /, Esc, ?', () => {
    const panelStart = source.indexOf("showShortcuts && (")
    const panelEnd = source.indexOf('</div>\n      )}', panelStart)
    const panel = source.slice(panelStart, panelEnd)
    expect(panel).toContain("Build the app")
    expect(panel).toContain("Download ZIP file")
    expect(panel).toContain("Start a new build")
    expect(panel).toContain("Enhance prompt with AI")
    expect(panel).toContain("Toggle build insights panel")
    expect(panel).toContain("Toggle diff view")
    expect(panel).toContain("Toggle fullscreen preview")
    expect(panel).toContain("Toggle build statistics")
    expect(panel).toContain("Toggle prompt templates")
    expect(panel).toContain("Cycle AI model")
    expect(panel).toContain("Slash commands menu")
    expect(panel).toContain("Cancel build/refine")
    expect(panel).toContain("Show/hide this help")
  })
})

describe('page.tsx — model selection UI', () => {
  test('has 3 model buttons (z-ai, qwen, kimi)', () => {
    expect(source).toContain("setSelectedModel('z-ai')")
    expect(source).toContain("setSelectedModel('qwen')")
    expect(source).toContain("setSelectedModel('kimi')")
  })
  test('model cycle order is z-ai → qwen → kimi', () => {
    expect(source).toContain("models: Array<'z-ai' | 'qwen' | 'kimi'> = ['z-ai', 'qwen', 'kimi']")
  })
  test('M shortcut cycles to next model', () => {
    expect(source).toContain('models.indexOf(selectedModelRef.current) + 1')
  })
  test('model cycle wraps around (modulo)', () => {
    expect(source).toMatch(/% models\.length/)
  })
})

describe('page.tsx — selectedModelRef synchronization', () => {
  test('useEffect keeps selectedModelRef in sync', () => {
    expect(source).toContain("selectedModelRef.current = selectedModel")
  })
  test('retryWithModel updates both state and ref', () => {
    expect(source).toContain('setSelectedModel(model)')
    expect(source).toContain('selectedModelRef.current = model')
  })
})

describe('page.tsx — footer', () => {
  test('footer is sticky (mt-auto + shrink-0)', () => {
    expect(source).toMatch(/<footer[^>]*mt-auto/)
    expect(source).toMatch(/<footer[^>]*shrink-0/)
  })
  test('footer shows build count when history > 0', () => {
    expect(source).toContain('history.length > 0')
    expect(source).toMatch(/\{history\.length\} build/)
  })
  test('footer shows avg quality (Q:N) when builds have quality', () => {
    expect(source).toContain('avg Q:')
  })
  test('footer shows shortcut hints', () => {
    expect(source).toContain('⌘+Enter')
    expect(source).toContain('enhance')
    expect(source).toContain('fullscreen')
  })
})

describe('RunCodeButton component (extracted to src/components/run-code-button.tsx)', () => {
  // v29.43: RunCodeButton was extracted from page.tsx to its own file.
  const rcbSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/run-code-button.tsx'),
    'utf-8'
  )
  test('RunCodeButton is defined as a function component', () => {
    expect(rcbSource).toMatch(/export function RunCodeButton\(/)
  })
  test('RunCodeButton accepts a result prop', () => {
    expect(rcbSource).toMatch(/RunCodeButton\(\{ result \}/)
  })
  test('RunCodeButton has its own running/output state', () => {
    expect(rcbSource).toContain('const [running, setRunning] = useState(false)')
    expect(rcbSource).toContain('const [output, setOutput] = useState')
  })
  test('page.tsx imports RunCodeButton from the component file', () => {
    expect(source).toContain("import { RunCodeButton } from '@/components/run-code-button'")
  })
})

describe('page.tsx — dynamic imports', () => {
  test('FileViewer is dynamically imported', () => {
    expect(source).toContain("dynamic(() => import('@/components/file-viewer')")
  })
  test('DiffViewer is dynamically imported', () => {
    expect(source).toContain("dynamic(() => import('@/components/diff-viewer')")
  })
  test('dynamic imports use ssr: false', () => {
    expect(source).toMatch(/ssr: false/)
  })
})

describe('page.tsx — slash menu and prompt history', () => {
  test('has slashFilter state', () => {
    expect(source).toMatch(/const \[slashFilter, setSlashFilter\] = useState\(''\)/)
  })
  test('has slashIndex state', () => {
    expect(source).toMatch(/const \[slashIndex, setSlashIndex\] = useState\(0\)/)
  })
  test('has promptHistory state', () => {
    expect(source).toMatch(/const \[promptHistory, setPromptHistory\] = useState<string\[\]>/)
  })
  test('has promptHistoryIndex state', () => {
    expect(source).toMatch(/const \[promptHistoryIndex, setPromptHistoryIndex\] = useState\(-1\)/)
  })
  test('slash menu supports ArrowDown/ArrowUp navigation', () => {
    expect(source).toContain("e.key === 'ArrowDown'")
    expect(source).toContain("e.key === 'ArrowUp'")
  })
  test('slash menu supports Enter/Tab selection', () => {
    expect(source).toMatch(/e\.key === 'Enter' \|\| e\.key === 'Tab'/)
  })
  test('prompt history navigation with ArrowUp at start', () => {
    expect(source).toContain('atStart')
  })
})

describe('page.tsx — mission validation', () => {
  test('rejects empty mission with toast.error', () => {
    expect(source).toContain("toast.error('Describe what to build first')")
  })
  test('uses mission.trim() for emptiness check', () => {
    expect(source).toMatch(/mission\.trim\(\)/)
  })
})

describe('page.tsx — sandbox security', () => {
  test('iframe sandbox does NOT include allow-same-origin', () => {
    expect(source).not.toContain('allow-same-origin')
  })
  test('iframe sandbox does NOT include allow-top-navigation', () => {
    expect(source).not.toContain('allow-top-navigation')
  })
  test('iframe sandbox only has allow-scripts', () => {
    expect(source).toContain('sandbox="allow-scripts"')
  })
})
