// Tests for the quick-refine suggestion generator
import { describe, it, expect } from 'bun:test'

// Replicate the suggestion logic from page.tsx
// (page.tsx is a client component, so we test the pure logic here)
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

const DEFAULT_SUGGESTIONS: readonly string[] = [
  'Add dark mode toggle',
  'Make it mobile-responsive',
  'Add smooth animations and transitions',
  'Add keyboard shortcuts',
]

function getSuggestionsForMission(mission: string): readonly string[] {
  const lower = mission.toLowerCase()
  for (const group of SUGGESTION_GROUPS) {
    if (group.match.some(kw => lower.includes(kw))) {
      return group.suggestions
    }
  }
  return DEFAULT_SUGGESTIONS
}

describe('getSuggestionsForMission', () => {
  it('returns game suggestions for "snake game"', () => {
    const suggestions = getSuggestionsForMission('Build a snake game')
    expect(suggestions).toContain('Add sound effects and background music')
    expect(suggestions).toContain('Add difficulty levels (easy, medium, hard)')
  })

  it('returns game suggestions for "2048 puzzle"', () => {
    const suggestions = getSuggestionsForMission('Build a 2048 puzzle game')
    expect(suggestions.some(s => s.includes('difficulty'))).toBe(true)
  })

  it('returns dashboard suggestions for "crypto dashboard"', () => {
    const suggestions = getSuggestionsForMission('Build a crypto trading dashboard')
    expect(suggestions).toContain('Add dark mode toggle')
    expect(suggestions).toContain('Add export to CSV')
  })

  it('returns todo suggestions for "todo app"', () => {
    const suggestions = getSuggestionsForMission('Build a todo app')
    expect(suggestions).toContain('Add drag-and-drop reordering')
    expect(suggestions).toContain('Add a search bar')
  })

  it('returns editor suggestions for "markdown editor"', () => {
    const suggestions = getSuggestionsForMission('Build a markdown editor')
    expect(suggestions).toContain('Add syntax highlighting')
    expect(suggestions).toContain('Add a live preview pane')
  })

  it('returns timer suggestions for "pomodoro timer"', () => {
    const suggestions = getSuggestionsForMission('Build a Pomodoro timer')
    expect(suggestions).toContain('Add sound notifications')
    expect(suggestions).toContain('Add a visual progress ring')
  })

  it('returns art suggestions for "pixel art editor"', () => {
    const suggestions = getSuggestionsForMission('Build a pixel art editor')
    expect(suggestions).toContain('Add undo/redo history')
    expect(suggestions).toContain('Add export to PNG')
  })

  it('returns default suggestions for unrecognized mission', () => {
    const suggestions = getSuggestionsForMission('Build a weather forecast dashboard with 5-day forecast')
    // "dashboard" is in the dashboard group, so this should return dashboard suggestions.
    // Let me test with something truly unrecognized:
    const defaults = getSuggestionsForMission('Build a calculator')
    expect(defaults).toBe(DEFAULT_SUGGESTIONS)
  })

  it('is case-insensitive', () => {
    const lower = getSuggestionsForMission('build a snake game')
    const upper = getSuggestionsForMission('BUILD A SNAKE GAME')
    const mixed = getSuggestionsForMission('Build a SNAKE Game')
    expect(lower).toEqual(upper)
    expect(lower).toEqual(mixed)
  })

  it('always returns exactly 4 suggestions', () => {
    const missions = [
      'Build a snake game',
      'Build a crypto dashboard',
      'Build a todo app',
      'Build a markdown editor',
      'Build a Pomodoro timer',
      'Build a pixel art editor',
      'Build a calculator',
      'Build a weather app',
    ]
    for (const m of missions) {
      const suggestions = getSuggestionsForMission(m)
      expect(suggestions.length).toBe(4)
    }
  })

  it('matches partial keywords (substring match)', () => {
    // "games" contains "game"
    const suggestions = getSuggestionsForMission('Build a collection of mini games')
    expect(suggestions).toContain('Add sound effects and background music')
  })

  it('returns default for empty string', () => {
    const suggestions = getSuggestionsForMission('')
    expect(suggestions).toBe(DEFAULT_SUGGESTIONS)
  })

  it('does NOT match "memory" in "in-memory persistence" (todo app)', () => {
    // Bug fix: "memory" keyword used to match "in-memory" in todo app missions,
    // causing game suggestions to appear for a todo app. Now "memory" alone is
    // not a keyword — only "memory match" / "memory card" are.
    // The mission also contains "todo" so it should match the TODO group, not games.
    const suggestions = getSuggestionsForMission('Build a todo app with in-memory persistence')
    expect(suggestions).not.toContain('Add sound effects and background music')
    expect(suggestions).toContain('Add drag-and-drop reordering') // todo group
  })

  it('matches "memory card" for memory card games', () => {
    const suggestions = getSuggestionsForMission('Build a memory card matching game')
    expect(suggestions).toContain('Add sound effects and background music')
  })
})
