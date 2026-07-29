'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

// Catches render errors in the child tree and shows a fallback UI
// instead of a blank screen. Offers two recovery options:
// 1. Clear localStorage history (in case a corrupted history item caused the error)
// 2. Reload the page
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log to console for debugging — in production this would go to an error tracker
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  clearHistoryAndReload = () => {
    try {
      localStorage.removeItem('nova_history')
    } catch {
      // ignore
    }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            An unexpected error occurred. Try clearing your history and reloading, or just reload.
          </p>
          {this.state.error?.message && (
            <pre className="max-w-md overflow-auto rounded-md border border-border/40 bg-card/40 p-3 text-left text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.clearHistoryAndReload}
              className="rounded-md border border-border/40 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Clear history &amp; reload
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
