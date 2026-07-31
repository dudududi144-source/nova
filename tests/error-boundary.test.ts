// Tests for ErrorBoundary behavior (source-level characterization)
import { describe, it, expect } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/components/ErrorBoundary.tsx'),
  'utf-8'
)

describe('ErrorBoundary (characterization)', () => {
  it('has mounted flag to prevent setState after unmount', () => {
    expect(source).toContain('mounted')
    expect(source).toContain('componentDidMount')
    expect(source).toContain('componentWillUnmount')
  })

  it('has error ID generation', () => {
    expect(source).toContain('errorId')
    expect(source).toContain('err_')
  })

  it('has focus management (focus trap)', () => {
    expect(source).toContain('fallbackRef')
    expect(source).toContain('focus()')
    expect(source).toContain('tabIndex')
  })

  it('has ARIA dialog roles', () => {
    expect(source).toContain('role="alertdialog"')
    expect(source).toContain('aria-labelledby')
    expect(source).toContain('aria-describedby')
  })

  it('has two recovery options', () => {
    expect(source).toContain('clearHistoryAndReload')
    expect(source).toContain('reload')
  })

  it('clearHistoryAndReload has error handling (not empty catch)', () => {
    expect(source).toContain('catch (err)')
    expect(source).toContain('Failed to clear history')
  })

  it('logs to console with error ID', () => {
    expect(source).toContain('console.error')
    expect(source).toContain('[ErrorBoundary]')
  })

  it('uses class component (not function — needed for error boundaries)', () => {
    expect(source).toContain('class ErrorBoundary')
    expect(source).toContain('extends Component')
    expect(source).toContain('getDerivedStateFromError')
    expect(source).toContain('componentDidCatch')
  })
})
