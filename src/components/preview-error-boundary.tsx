'use client'

// PreviewErrorBoundary — catches render crashes in the preview area.
//
// NOVA's preview pane renders LLM-generated content in three ways:
// 1. An <iframe> for HTML output (srcdoc)
// 2. A <FileViewer> for multi-file / non-HTML output
// 3. A <DiffViewer> for build comparison
//
// Any of these can crash during render — e.g. the LLM produced pathological
// content that triggers a React error, the diff module threw on bad input,
// or the file viewer hit an unexpected state. Without this boundary, the
// crash would propagate up and white-screen the entire app.
//
// This boundary:
// - Catches the error in getDerivedStateFromError (React lifecycle)
// - Logs it to the console with a stable error ID (for support)
// - Renders a compact fallback with a "Recover" button that resets the
//   boundary's internal state (re-mounts children on next render)
//
// Note: this is a SEPARATE boundary from the top-level ErrorBoundary
// (src/components/ErrorBoundary.tsx) which catches app-wide crashes and
// offers to clear localStorage. PreviewErrorBoundary is scoped to the
// preview area only — a crash here shouldn't take down the whole app.

import { Component, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional className for the fallback container. */
  className?: string
}

interface State {
  hasError: boolean
  error?: Error
  errorId?: string
  // Bumped on each recovery attempt to force a remount of children.
  recoveryKey: number
}

export class PreviewErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, recoveryKey: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    const errorId = `pv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.setState({ errorId })
    // Log to console — in production this would go to an error tracker.
    console.error('[PreviewErrorBoundary]', errorId, error, info.componentStack)
  }

  handleRecover = () => {
    // Bump the recovery key — this is passed as `key` to children on next render,
    // forcing React to unmount the crashed subtree and remount fresh.
    this.setState(prev => ({
      hasError: false,
      error: undefined,
      errorId: undefined,
      recoveryKey: prev.recoveryKey + 1,
    }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className={`flex h-full min-h-[200px] flex-col items-center justify-center gap-3 rounded-md border border-red-500/30 bg-red-500/5 p-6 text-center ${this.props.className ?? ''}`}
          role="alert"
        >
          <AlertCircle className="h-6 w-6 text-red-400" />
          <div>
            <p className="text-sm font-medium text-foreground">Preview failed to render</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The preview area hit an unexpected error. Try recovering.
            </p>
          </div>
          {this.state.error?.message && (
            <pre className="max-w-md overflow-auto rounded border border-border/40 bg-card/40 p-2 text-left text-[10px] text-muted-foreground">
              {this.state.error.message.slice(0, 500)}
            </pre>
          )}
          {this.state.errorId && (
            <p className="text-[9px] text-muted-foreground/50">
              Error ID: <code className="font-mono">{this.state.errorId}</code>
            </p>
          )}
          <button
            type="button"
            onClick={this.handleRecover}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="h-3 w-3" />
            Recover
          </button>
        </div>
      )
    }

    // The `key` prop forces React to remount children on recovery — without it,
    // a crashed component might keep its broken internal state.
    return (
      <div key={this.state.recoveryKey} className="h-full">
        {this.props.children}
      </div>
    )
  }
}
