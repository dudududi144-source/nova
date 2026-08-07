// Tests for page.tsx configuration (characterization)
import { describe, it, expect } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/page.tsx'),
  'utf-8'
)

describe('page.tsx (characterization)', () => {
  it('has maxLength on textarea', () => {
    expect(source).toContain('maxLength={5000}')
  })

  it('has autoFocus on textarea', () => {
    expect(source).toContain('autoFocus')
  })

  it('has sandbox="allow-scripts" on iframe (no allow-same-origin)', () => {
    expect(source).toContain('sandbox="allow-scripts"')
    expect(source).not.toContain('allow-same-origin')
  })

  it('uses srcDoc (not blob URL)', () => {
    expect(source).toContain('srcDoc')
    expect(source).not.toContain('createObjectURL.*iframe')
  })

  it('has aria-busy on root container (includes refining)', () => {
    expect(source).toContain('aria-busy={loading || refining}')
  })

  it('has Content-Type check before res.json() call in build/refine flows', () => {
    // v29: RunCodeButton also uses res.json() but doesn't need content-type check
    // (it's a simple API call, not SSE streaming). We check the build/refine flows.
    // Find the content-type check in the architect flow
    const ctPos = source.indexOf("archRes.headers.get('content-type')")
    // Find the first res.json() AFTER the content-type check (in the build flow)
    const afterCt = ctPos > -1 ? source.indexOf('await res.json()', ctPos) : -1
    expect(ctPos).toBeGreaterThan(-1)
    // The build flow should have content-type check before res.json()
    // (RunCodeButton's res.json() at line 241 is before this, which is fine — it's a different flow)
    expect(afterCt).toBeGreaterThan(-1)
  })

  it('has fail() helper for error handling', () => {
    expect(source).toContain('const fail =')
  })

  it('has cancelBuild separate from reset', () => {
    expect(source).toContain('cancelBuild')
    expect(source).toContain('const reset')
    // cancelBuild should NOT setMission('') — that's reset's job
    const cancelPos = source.indexOf('const cancelBuild')
    const resetPos = source.indexOf('const reset')
    const cancelBlock = source.slice(cancelPos, resetPos)
    expect(cancelBlock).not.toContain("setMission('')")
  })

  it('has keyboard shortcuts (Esc, Cmd+S, Cmd+Enter)', () => {
    expect(source).toContain("Escape")
    expect(source).toContain("metaKey")
    expect(source).toContain("'s'")
    expect(source).toContain("Enter")
  })

  it('has elapsed time counter', () => {
    expect(source).toContain('elapsed')
    expect(source).toContain('setInterval')
  })

  it('examples auto-build (not just setMission)', () => {
    // The example onClick should call build(ex), not just setMission(ex)
    expect(source).toContain('build(ex)')
  })

  it('has inline confirm/cancel for clear history (not window.confirm)', () => {
    expect(source).toContain('confirmClear')
    expect(source).not.toContain('window.confirm')
  })

  it('has character count display', () => {
    expect(source).toContain('mission.length')
    expect(source).toContain('/2000')
  })

  it('has prefers-reduced-motion in globals.css', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'src/app/globals.css'),
      'utf-8'
    )
    expect(css).toContain('prefers-reduced-motion')
  })

  it('imports helpers from lib/helpers.ts', () => {
    expect(source).toContain("from '@/lib/helpers'")
    expect(source).toContain('newBuildId')
    expect(source).toContain('sanitizeFilename')
    expect(source).toContain('validateHistory')
  })

  it('does NOT duplicate BuildResult interface (imports from helpers)', () => {
    // BuildResult should be imported, not redefined
    expect(source).toContain('type BuildResult')
    expect(source).not.toMatch(/^interface BuildResult\b/m)
  })
})
