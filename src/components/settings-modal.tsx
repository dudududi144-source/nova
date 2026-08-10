'use client'

import { toast } from 'sonner'

// v29.81: Extracted from page.tsx for maintainability

interface ApiSettings {
  keys: Record<string, { configured: boolean; masked: string; source: string }>
  models: Record<string, boolean>
}

interface SettingsModalProps {
  onClose: () => void
  apiSettings: ApiSettings | null
}

const PROVIDERS = [
  { id: 'zai', label: 'Z.AI (Primary)', key: 'zaiApiKey' },
  { id: 'dashscope', label: 'DashScope / Qwen (Secondary)', key: 'dashscopeApiKey' },
  { id: 'tokenrouter', label: 'TokenRouter / Kimi (Tertiary)', key: 'tokenrouterApiKey' },
]

export function SettingsModal({ onClose, apiSettings }: SettingsModalProps) {
  return (
    <div
      role="dialog"
      aria-label="API Settings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border/40 bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">API Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <span className="text-lg">✕</span>
          </button>
        </div>
        <p className="mb-4 text-[11px] text-muted-foreground">
          Configure LLM API keys. Keys are stored in memory (not disk) and take precedence over environment variables.
        </p>
        {apiSettings ? (
          <div className="space-y-4">
            {PROVIDERS.map(({ id, label, key }) => {
              const info = apiSettings.keys[id]
              return (
                <div key={id} className="rounded-md border border-border/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium">{label}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] ${info?.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted/20 text-muted-foreground'}`}>
                      {info?.configured ? 'Configured' : 'Not set'}
                    </span>
                  </div>
                  {info?.configured && (
                    <p className="mb-2 text-[10px] text-muted-foreground/60">
                      Current: {info.masked} ({info.source})
                    </p>
                  )}
                  <input
                    type="password"
                    placeholder="Enter API key and press Enter..."
                    className="w-full rounded border border-border/40 bg-background px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary"
                    onKeyDown={async (e) => {
                      if (e.key !== 'Enter') return
                      const value = (e.target as HTMLInputElement).value
                      if (!value.trim()) return
                      try {
                        const res = await fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ [key]: value.trim() }),
                        })
                        const data = await res.json()
                        if (data.ok) {
                          toast.success(`${label} key updated`)
                          ;(e.target as HTMLInputElement).value = ''
                        }
                      } catch {
                        toast.error('Failed to update key')
                      }
                    }}
                  />
                </div>
              )
            })}
            <div className="rounded-md bg-muted/10 p-3 text-[10px] text-muted-foreground">
              <p className="font-medium">Available models:</p>
              <div className="mt-1 flex gap-2">
                {Object.entries(apiSettings.models).map(([model, available]) => (
                  <span key={model} className={`rounded px-1.5 py-0.5 text-[9px] ${available ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted/20 text-muted-foreground/50'}`}>
                    {model === 'z-ai' ? 'Z.AI' : model === 'qwen' ? 'Qwen' : 'Kimi'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Loading...
          </div>
        )}
      </div>
    </div>
  )
}

