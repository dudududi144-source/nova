// Tests for runtime-errors.ts — RUNTIME_ERROR_SCRIPT, injectRuntimeErrorCapture.
// Covers: script content, injection locations, idempotency, edge inputs.
import { describe, it, expect } from 'bun:test'
import { RUNTIME_ERROR_SCRIPT, injectRuntimeErrorCapture } from '../src/lib/runtime-errors'

describe('RUNTIME_ERROR_SCRIPT', () => {
  it('is a non-empty string', () => {
    expect(typeof RUNTIME_ERROR_SCRIPT).toBe('string')
    expect(RUNTIME_ERROR_SCRIPT.length).toBeGreaterThan(100)
  })

  it('starts with <script> tag', () => {
    expect(RUNTIME_ERROR_SCRIPT.startsWith('<script>')).toBe(true)
  })

  it('ends with </script> tag', () => {
    expect(RUNTIME_ERROR_SCRIPT.endsWith('</script>')).toBe(true)
  })

  it('contains the postMessage call to parent window', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('parent.postMessage')
  })

  it('listens for "error" events', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain("'error'")
    expect(RUNTIME_ERROR_SCRIPT).toContain('addEventListener')
  })

  it('listens for "unhandledrejection" events', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain("'unhandledrejection'")
  })

  it('overrides console.error to capture error logs', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('console.error')
    expect(RUNTIME_ERROR_SCRIPT).toContain('origConsoleError')
  })

  it('exposes __novaGetErrors function on window', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('__novaGetErrors')
  })

  it('exposes __novaClearErrors function on window', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('__novaClearErrors')
  })

  it('sends a "ready" signal to the parent on load', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain("kind: 'ready'")
  })

  it('sends error messages with source: nova-preview', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain("source: 'nova-preview'")
  })

  it('limits captured errors to MAX_ERRORS=20', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('MAX_ERRORS = 20')
  })

  it('truncates error messages to 1000 chars', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('slice(0, 1000)')
  })

  it('truncates stack traces to 2000 chars', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('slice(0, 2000)')
  })

  it('is wrapped in an IIFE (immediately-invoked function expression)', () => {
    expect(RUNTIME_ERROR_SCRIPT).toContain('(function() {')
    expect(RUNTIME_ERROR_SCRIPT).toContain('})();')
  })
})

describe('injectRuntimeErrorCapture', () => {
  it('injects the script right after <head> tag when present', () => {
    const html = `<html><head><title>Test</title></head><body></body></html>`
    const result = injectRuntimeErrorCapture(html)
    const headIdx = result.indexOf('<head>')
    const scriptIdx = result.indexOf('RUNTIME_ERROR_SCRIPT') // not present; just check for __novaGetErrors
    const novaIdx = result.indexOf('__novaGetErrors')
    expect(novaIdx).toBeGreaterThan(headIdx)
    // The script should be the first thing after <head>
    expect(result.indexOf('<head>\n<script>')).toBeGreaterThan(-1)
  })

  it('injects after <head> with attributes (e.g. <head lang="en">)', () => {
    const html = `<html><head lang="en"><title>Test</title></head></html>`
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('<head lang="en">\n<script>')
    expect(result).toContain('__novaGetErrors')
  })

  it('creates a new <head> when only <html> tag is present', () => {
    const html = `<html><body>hello</body></html>`
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('<head>')
    expect(result).toContain('</head>')
    expect(result).toContain('__novaGetErrors')
  })

  it('prepends the script when neither <html> nor <head> is present', () => {
    const html = `<body>hello</body>`
    const result = injectRuntimeErrorCapture(html)
    expect(result.startsWith(RUNTIME_ERROR_SCRIPT)).toBe(true)
  })

  it('does NOT inject twice when the html already contains __novaGetErrors', () => {
    const html = `<html><head><script>window.__novaGetErrors = function() {};</script></head></html>`
    const result = injectRuntimeErrorCapture(html)
    // The script should NOT be injected again.
    const count = (result.match(/__novaGetErrors/g) || []).length
    expect(count).toBe(1)
  })

  it('handles empty string by prepending the script (no <html>/<head> found)', () => {
    // Per source: when no <head> or <html> match exists, the script is prepended.
    // For an empty string, this means the result is the script itself (+ newline).
    const result = injectRuntimeErrorCapture('')
    expect(result).toContain('__novaGetErrors')
    expect(result.startsWith(RUNTIME_ERROR_SCRIPT)).toBe(true)
  })

  it('preserves the rest of the HTML structure', () => {
    const html = `<html><head></head><body><h1>Hello</h1></body></html>`
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('<h1>Hello</h1>')
    expect(result).toContain('</body>')
    expect(result).toContain('</html>')
  })

  it('injects the script BEFORE the app\'s own scripts', () => {
    const html = `<html><head></head><body><script>var appVar = 1;</script></body></html>`
    const result = injectRuntimeErrorCapture(html)
    const captureIdx = result.indexOf('__novaGetErrors')
    const appIdx = result.indexOf('appVar')
    expect(captureIdx).toBeGreaterThan(-1)
    expect(appIdx).toBeGreaterThan(captureIdx)
  })

  it('handles <HEAD> in uppercase', () => {
    const html = `<HTML><HEAD><TITLE>Test</TITLE></HEAD><BODY></BODY></HTML>`
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('__novaGetErrors')
  })

  it('handles <HTML> in uppercase without <head>', () => {
    const html = `<HTML><BODY>hello</BODY></HTML>`
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('<head>')
    expect(result).toContain('__novaGetErrors')
  })

  it('is idempotent — running inject twice produces the same result', () => {
    const html = `<html><head></head><body>hello</body></html>`
    const once = injectRuntimeErrorCapture(html)
    const twice = injectRuntimeErrorCapture(once)
    expect(twice).toBe(once)
  })

  it('handles HTML with comments before <head>', () => {
    const html = `<!-- comment --><html><head></head><body></body></html>`
    const result = injectRuntimeErrorCapture(html)
    expect(result).toContain('<!-- comment -->')
    expect(result).toContain('__novaGetErrors')
  })

  it('handles a malformed HTML string gracefully', () => {
    const html = `random text not html`
    const result = injectRuntimeErrorCapture(html)
    // Should prepend the script.
    expect(result.startsWith(RUNTIME_ERROR_SCRIPT)).toBe(true)
    expect(result).toContain('random text not html')
  })
})
