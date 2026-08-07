'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'

/**
 * ThemeToggle — switches NOVA UI between dark and light mode.
 * CSS-only approach: both icons rendered, CSS controls visibility via .dark class.
 * This prevents hydration mismatches (server and client render identical HTML).
 */
export function ThemeToggle() {
  const { setTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      title="Toggle theme"
      aria-label="Toggle theme"
    >
      <Sun className="hidden h-3.5 w-3.5 dark:block" />
      <Moon className="block h-3.5 w-3.5 dark:hidden" />
    </button>
  )
}
