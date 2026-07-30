// Unit tests for injectCsp
import { describe, it, expect } from 'bun:test'
import { injectCsp } from '../src/lib/html-utils'

describe('injectCsp', () => {
  it('injects CSP meta after <head>', () => {
    const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toContain('<head>')
    // CSP should be right after <head>
    expect(result).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy"/)
  })

  it('injects CSP after <head> with attributes', () => {
    const html = '<html><head lang="en"><title>Test</title></head></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toMatch(/<head lang="en">\s*<meta http-equiv="Content-Security-Policy"/)
  })

  it('injects <head> if missing but <html> exists', () => {
    const html = '<!DOCTYPE html><html><body>hello</body></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toContain('<head>')
    expect(result).toContain('</head>')
  })

  it('does not inject duplicate CSP if one already exists', () => {
    const existingCsp = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">'
    const html = `<!DOCTYPE html><html><head>${existingCsp}</head></html>`
    const result = injectCsp(html)
    // Should only have one CSP meta
    const cspCount = (result.match(/Content-Security-Policy/gi) || []).length
    expect(cspCount).toBe(1)
  })

  it('handles case-insensitive HEAD tag', () => {
    const html = '<!DOCTYPE html><HTML><HEAD><title>Test</title></HEAD><BODY></BODY></HTML>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
  })

  it('includes connect-src none to block fetch', () => {
    const html = '<html><head></head></html>'
    const result = injectCsp(html)
    expect(result).toContain("connect-src 'none'")
  })

  it('includes script-src unsafe-inline for inline scripts', () => {
    const html = '<html><head></head></html>'
    const result = injectCsp(html)
    expect(result).toContain("script-src 'unsafe-inline'")
  })

  it('preserves the rest of the HTML', () => {
    const html = '<!DOCTYPE html><html><head><title>My App</title></head><body><canvas></canvas></body></html>'
    const result = injectCsp(html)
    expect(result).toContain('<title>My App</title>')
    expect(result).toContain('<canvas></canvas>')
    expect(result).toContain('<!DOCTYPE html>')
  })
})
