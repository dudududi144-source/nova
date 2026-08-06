// ═══════════════════════════════════════════════════════════════════════
// Page constants — extracted from src/app/page.tsx for maintainability.
// All pure data + one pure function. No side effects, no React.
// ═══════════════════════════════════════════════════════════════════════

// Quick-start presets — organized by category.
// Each category has an icon (emoji) + prompts.
// Used by the empty-state grid. Flat EXAMPLES kept for backward compat (tests).
export const STARTER_CATEGORIES: readonly {
  icon: string
  label: string
  prompts: readonly string[]
}[] = [
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

export const EXAMPLES: readonly string[] = STARTER_CATEGORIES.flatMap(c => c.prompts)

// Slash commands — type "/" at the start of the prompt to see these.
// Each command either filters starters by category or inserts a template.
export const SLASH_COMMANDS: readonly {
  cmd: string
  label: string
  icon: string
  action: 'filter' | 'insert'
  category?: string
  template?: string
}[] = [
  { cmd: '/dashboard', label: 'Dashboard apps', icon: '📊', action: 'filter', category: 'Dashboards' },
  { cmd: '/game', label: 'Games', icon: '🎮', action: 'filter', category: 'Games' },
  { cmd: '/creative', label: 'Creative tools', icon: '🎨', action: 'filter', category: 'Creative' },
  { cmd: '/tool', label: 'Utility tools', icon: '🛠️', action: 'filter', category: 'Tools' },
  { cmd: '/enhance', label: 'Enhance current prompt with AI', icon: '✨', action: 'insert', template: '' },
]

export const REFINE_THINKING_STEPS: readonly string[] = [
  'Processing your request...',
  'Making changes...',
  'Finalizing...',
]

// Contextual quick-refine suggestions — shown as clickable chips above the
// chat input after a build completes. Different suggestions for different app types.
// Detected via keyword matching on the mission string.
export interface SuggestionGroup {
  match: readonly string[]
  suggestions: readonly string[]
}

export const SUGGESTION_GROUPS: readonly SuggestionGroup[] = [
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
  // NOTE: The duplicate "art/draw/paint" group that was here has been removed —
  // the first match wins, so the second copy was dead code.
]

// Default suggestions when no keyword matches.
export const DEFAULT_SUGGESTIONS: readonly string[] = [
  'Add dark mode toggle',
  'Make it mobile-responsive',
  'Add smooth animations and transitions',
  'Add keyboard shortcuts',
]

// Returns up to 4 suggestion chips for the given mission.
export function getSuggestionsForMission(mission: string): readonly string[] {
  const lower = mission.toLowerCase()
  for (const group of SUGGESTION_GROUPS) {
    if (group.match.some(kw => lower.includes(kw))) {
      return group.suggestions
    }
  }
  return DEFAULT_SUGGESTIONS
}
