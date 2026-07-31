// Design tokens — NOVA's canonical design system.
//
// Every generated app gets these CSS custom properties injected. The LLM is instructed
// to use ONLY these tokens — no hardcoded colors, no magic numbers. This gives NOVA
// ~80% of design-system quality (like Base44/Wix) at zero runtime cost.
//
// The tokens are designed for dark themes (NOVA's default). Each theme provides:
// - Colors: bg, card, text, primary, accent, muted, border, success, warning, error
// - Spacing: 4/8/12/16/24/32/48/64
// - Type scale: 12/14/16/18/24/32/48/64 with line heights
// - Radius: 4/8/12/16/full
// - Shadow: sm/md/lg/xl
// - Transitions: fast/normal/slow

export interface Theme {
  name: string
  colors: {
    bg: string
    card: string
    text: string
    primary: string
    accent: string
    muted: string
    border: string
    success: string
    warning: string
    error: string
  }
}

export const THEMES: Theme[] = [
  {
    name: 'slate',
    colors: {
      bg: '#0f172a',
      card: '#1e293b',
      text: '#e2e8f0',
      primary: '#3b82f6',
      accent: '#22d3ee',
      muted: '#64748b',
      border: '#334155',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  },
  {
    name: 'midnight',
    colors: {
      bg: '#09090b',
      card: '#18181b',
      text: '#fafafa',
      primary: '#6366f1',
      accent: '#a855f7',
      muted: '#71717a',
      border: '#27272a',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  },
  {
    name: 'ocean',
    colors: {
      bg: '#0c1929',
      card: '#132f4c',
      text: '#e0f2fe',
      primary: '#0ea5e9',
      accent: '#06b6d4',
      muted: '#475569',
      border: '#1e3a5f',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  },
  {
    name: 'forest',
    colors: {
      bg: '#0a0f0d',
      card: '#16241f',
      text: '#d1fae5',
      primary: '#10b981',
      accent: '#84cc16',
      muted: '#4b5563',
      border: '#1f3a30',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  },
  {
    name: 'sunset',
    colors: {
      bg: '#1a0a1a',
      card: '#2a1320',
      text: '#fce7f3',
      primary: '#ec4899',
      accent: '#f97316',
      muted: '#6b7280',
      border: '#3b1e2e',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  },
]

/**
 * Generate the CSS custom properties block for a theme.
 * These are injected as the FIRST thing in <head>, so the app's own CSS can override
 * if needed (though the LLM is instructed to use only these tokens).
 */
export function generateDesignTokens(themeName: string = 'slate'): string {
  const theme = THEMES.find(t => t.name === themeName) || THEMES[0]
  const c = theme.colors

  return `<style>
:root {
  /* Colors — use these, never hardcoded hex */
  --color-bg: ${c.bg};
  --color-card: ${c.card};
  --color-text: ${c.text};
  --color-primary: ${c.primary};
  --color-accent: ${c.accent};
  --color-muted: ${c.muted};
  --color-border: ${c.border};
  --color-success: ${c.success};
  --color-warning: ${c.warning};
  --color-error: ${c.error};

  /* Spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* Type scale */
  --text-xs: 12px;
  --text-sm: 14px;
  --text-base: 16px;
  --text-lg: 18px;
  --text-xl: 24px;
  --text-2xl: 32px;
  --text-3xl: 48px;
  --text-4xl: 64px;

  /* Line heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.4);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.4);
  --shadow-xl: 0 20px 25px rgba(0,0,0,0.5);

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease-out;
  --transition-slow: 300ms ease-in-out;
}

/* Base styles — apply the tokens */
* { box-sizing: border-box; }
body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: system-ui, -apple-system, sans-serif;
  margin: 0;
  padding: var(--space-4);
}
button, input, textarea, select {
  font-family: inherit;
  font-size: var(--text-base);
}
.btn {
  background: var(--color-primary);
  color: white;
  border: none;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-fast);
}
.btn:hover { filter: brightness(1.1); }
.btn:active { transform: scale(0.97); }
.btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-md);
}
.input {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  outline: none;
  transition: var(--transition-fast);
}
.input:focus { border-color: var(--color-primary); }
</style>`
}

/**
 * The design tokens instruction for the LLM prompt.
 * Tells the LLM to use ONLY the provided CSS custom properties.
 */
export const DESIGN_TOKENS_INSTRUCTION = `DESIGN SYSTEM:
- CSS custom properties are already defined in :root (injected before your code).
- USE ONLY these tokens — never hardcode hex colors or magic numbers.
- Colors: var(--color-bg), var(--color-card), var(--color-text), var(--color-primary), var(--color-accent), var(--color-muted), var(--color-border), var(--color-success), var(--color-warning), var(--color-error)
- Spacing: var(--space-1) through var(--space-16) (4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px)
- Type: var(--text-xs) through var(--text-4xl) (12px, 14px, 16px, 18px, 24px, 32px, 48px, 64px)
- Radius: var(--radius-sm) through var(--radius-full) (4px, 8px, 12px, 16px, 9999px)
- Shadow: var(--shadow-sm) through var(--shadow-xl)
- Transitions: var(--transition-fast) (150ms), var(--transition-normal) (200ms), var(--transition-slow) (300ms)
- Base classes available: .btn, .card, .input — use or extend them.
- All elements already have box-sizing: border-box.`
