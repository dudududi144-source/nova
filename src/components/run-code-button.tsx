'use client'

// v29.43: Extracted from src/app/page.tsx for maintainability.
// RunCodeButton — appears in the toolbar for non-HTML executable output.
// Executes the code in a sandbox and shows output in a modal.

import { useState, useCallback } from 'react'
import { Play, Loader2, X, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BuildResult } from '@/lib/helpers'

interface RunOutput {
  stdout: string
  stderr: string
  exitCode: number
  ms: number
  timedOut: boolean
}

export function RunCodeButton({ result }: { result: BuildResult }) {
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState<RunOutput | null>(null)
  const [showOutput, setShowOutput] = useState(false)
  const [showStdin, setShowStdin] = useState(false)
  const [stdin, setStdin] = useState('')

  const handleRun = useCallback(async () => {
    if (!result || running) return
    setRunning(true)
    setShowOutput(true)
    setOutput(null)
    try {
      const lang = result.language || 'text'
      const payload: Record<string, unknown> = {
        language: lang === 'javascript' || lang === 'js' || lang === 'node' ? 'javascript' : lang,
      }
      if (stdin.trim()) {
        payload.stdin = stdin
      }
      if (result.files && result.files.length > 0) {
        payload.files = result.files.map(f => ({ path: f.path, content: f.content }))
        payload.primaryFile = result.fileName || result.files[0]?.path
      } else {
        payload.code = result.html
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.ok === true || typeof data.stdout === 'string') {
        setOutput({
          stdout: data.stdout ?? '', stderr: data.stderr ?? '',
          exitCode: data.exitCode ?? 0, ms: data.ms ?? 0, timedOut: data.timedOut ?? false,
        })
      } else {
        setOutput({
          stdout: '', stderr: data.error ?? 'Unknown error',
          exitCode: -1, ms: 0, timedOut: false,
        })
      }
    } catch (err) {
      setOutput({
        stdout: '', stderr: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: -1, ms: 0, timedOut: false,
      })
    } finally {
      setRunning(false)
    }
  }, [result, running, stdin])

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10"
        onClick={handleRun}
        disabled={running}
        title="Run code in sandbox"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {running ? 'Running...' : 'Run'}
      </Button>
      {showOutput && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowOutput(false)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-border/40 bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Code Output</h2>
              <div className="flex items-center gap-2">
                {output && !running && (
                  <>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                      output.exitCode === 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {output.exitCode === 0 ? 'SUCCESS' : output.timedOut ? 'TIMEOUT' : `EXIT ${output.exitCode}`}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">{output.ms}ms</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowStdin(!showStdin)}
                  className={`rounded p-1 transition-colors ${showStdin ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'}`}
                  title="Toggle stdin input"
                  aria-label="Toggle stdin input"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowOutput(false)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {showStdin && (
              <div className="mb-3">
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  stdin input
                </label>
                <textarea
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  className="h-20 w-full resize-none rounded border border-border/40 bg-neutral-950 p-2 font-mono text-[11px] text-neutral-300 focus:outline-none"
                  placeholder="Enter input for the script (stdin)..."
                  spellCheck={false}
                />
                <div className="mt-1 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10"
                    onClick={handleRun}
                    disabled={running}
                  >
                    {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Run with stdin
                  </Button>
                </div>
              </div>
            )}
            <div className="max-h-[60vh] overflow-auto rounded-md bg-neutral-950 p-4 font-mono text-[12px]">
              {running ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                  <span>Executing code in sandbox...</span>
                </div>
              ) : !output || (!output.stdout && !output.stderr) ? (
                <div className="text-muted-foreground/60">
                  {output?.exitCode === 0 ? '(no output — script ran successfully but printed nothing)' : 'No output.'}
                </div>
              ) : (
                <>
                  {output.stdout && (
                    <pre className="whitespace-pre-wrap break-words text-emerald-300">{output.stdout}</pre>
                  )}
                  {output.stderr && (
                    <pre className="whitespace-pre-wrap break-words text-red-400">{output.stderr}</pre>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
