'use client'

// v29.80: Extracted from page.tsx for maintainability

interface ShortcutsModalProps {
  onClose: () => void
}

const SHORTCUTS = [
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
]

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border/40 bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close shortcuts"
          >
            <span className="text-lg">✕</span>
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((shortcut) => (
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
  )
}
