'use client'

import { Component, type ReactNode, createRef } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorId?: string
}

// Catches render errors in the child tree and shows a fallback UI
// instead of a blank screen. Offers two recovery options:
// 1. Clear localStorage history (in case a corrupted history item caused the error)
// 2. Reload the page
//
// The fallback container is focusable and focused on mount so keyboard users
// can navigate to the recovery buttons.
export class ErrorBoundary extends Component<Props, State> {
  private mounted = false
  private fallbackRef = createRef<HTMLDivElement>()

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  componentDidMount() {
    this.mounted = true
  }

  componentWillUnmount() {
    this.mounted = false
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    if (!this.mounted) return
    // Generate an error ID for support — included in the UI so users can reference it
    const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.setState({ errorId })
    // Log to console with error ID — in production this would go to an error tracker
    console.error('[ErrorBoundary]', errorId, error, info.componentStack)
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    // When error state appears, focus the fallback container for keyboard users
    if (!prevState.hasError && this.state.hasError) {
      // Use setTimeout to ensure the DOM is updated
      setTimeout(() => {
        this.fallbackRef.current?.focus()
      }, 0)
    }
  }

  clearHistoryAndReload = () => {
    try {
      localStorage.removeItem('nova_history')
    } catch (err) {
      console.error('[ErrorBoundary] Failed to clear history:', err)
    }
    window.location.reload()
  }

  reload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          ref={this.fallbackRef}
          tabIndex={-1}
          role="alertdialog"
          aria-labelledby="error-title"
          aria-describedby="error-description"
          className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground outline-none"
        >
          <h1 id="error-title" className="text-lg font-semibold">Something went wrong</h1>
          <p id="error-description" className="max-w-md text-sm text-muted-foreground">
            An unexpected error occurred. Try clearing your history and reloading, or just reload.
          </p>
          {this.state.error?.message && (
            <pre className="max-w-md overflow-auto rounded-md border border-border/40 bg-card/40 p-3 text-left text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          {this.state.errorId && (
            <p className="text-[10px] text-muted-foreground/50">
              Error ID: <code className="font-mono">{this.state.errorId}</code>
            </p>
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
              onClick={this.reload}
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
