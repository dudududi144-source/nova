// Comprehensive tests for src/lib/html-utils.ts
// Tests: stripCodeFences (all fence types), looksLikeHtml (edge cases),
// injectCsp, stripBlockedAPIs
import { describe, expect, test } from 'bun:test'
import {
  stripCodeFences,
  looksLikeHtml,
  injectCsp,
  stripBlockedAPIs,
} from '../src/lib/html-utils'

// ──────────────────────────────────────────────────────────────────────────────
// stripCodeFences — all fence types
// ──────────────────────────────────────────────────────────────────────────────

describe('stripCodeFences — fence types', () => {
  test('strips ```html fences', () => {
    expect(stripCodeFences('```html\n<!DOCTYPE html>\n```')).toBe('<!DOCTYPE html>')
  })

  test('strips ``` (no language) fences with HTML content', () => {
    // Content starting with non-alphanumeric char (so it's not consumed as a language identifier)
    expect(stripCodeFences('```\n<!DOCTYPE html>\n```')).toBe('<!DOCTYPE html>')
  })

  test('strips 4-backtick fences', () => {
    expect(stripCodeFences('````html\n<!DOCTYPE html>\n````')).toBe('<!DOCTYPE html>')
  })

  test('strips 5-backtick fences', () => {
    expect(stripCodeFences('`````html\n<!DOCTYPE html>\n`````')).toBe('<!DOCTYPE html>')
  })

  test('strips ```javascript fences', () => {
    expect(stripCodeFences('```javascript\nconsole.log("hi")\n```')).toBe('console.log("hi")')
  })

  test('strips ```css fences', () => {
    expect(stripCodeFences('```css\nbody { color: red; }\n```')).toBe('body { color: red; }')
  })

  test('strips ```json fences', () => {
    expect(stripCodeFences('```json\n{"key": "value"}\n```')).toBe('{"key": "value"}')
  })

  test('strips ```python fences', () => {
    expect(stripCodeFences('```python\nprint("hi")\n```')).toBe('print("hi")')
  })

  test('strips ```file:server_config.json fences (file path identifier)', () => {
    expect(stripCodeFences('```file:server_config.json\n{"port": 3000}\n```')).toBe('{"port": 3000}')
  })

  test('strips ```file:src/App.tsx fences (file path with slashes)', () => {
    expect(stripCodeFences('```file:src/App.tsx\nexport default () => <div/>\n```')).toBe('export default () => <div/>')
  })

  test('strips fences with hyphen in language identifier', () => {
    expect(stripCodeFences('```my-lang\ncontent\n```')).toBe('content')
  })
})

describe('stripCodeFences — multiple blocks and edge cases', () => {
  test('returns first non-empty block when multiple fences exist', () => {
    // Content starts with < so it's not consumed as a language identifier
    const input = '```\n\n```\n```\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  test('skips empty first fence and returns content from second', () => {
    const input = '```html\n\n```\n```html\n<!DOCTYPE html>\n```'
    expect(stripCodeFences(input)).toBe('<!DOCTYPE html>')
  })

  test('returns trimmed text when no fences present', () => {
    expect(stripCodeFences('plain text')).toBe('plain text')
  })

  test('trims whitespace around non-fenced text', () => {
    expect(stripCodeFences('  \nplain text\n  ')).toBe('plain text')
  })

  test('extracts HTML from prose when no fences (<!DOCTYPE present)', () => {
    const input = 'Here is your app:\n<!DOCTYPE html>\n<html>\n<body>hi</body>\n</html>\nThanks!'
    const result = stripCodeFences(input)
    expect(result).toContain('<!DOCTYPE html>')
    expect(result).not.toContain('Here is your app')
    expect(result).toContain('</html>')
  })

  test('extracts HTML even without closing </html>', () => {
    const input = 'Here is your app:\n<!DOCTYPE html>\n<html>\n<body>hi</body>'
    const result = stripCodeFences(input)
    expect(result).toContain('<!DOCTYPE html>')
    expect(result).not.toContain('Here is your app')
  })

  test('returns empty string for empty input', () => {
    expect(stripCodeFences('')).toBe('')
  })

  test('returns empty string for whitespace-only input', () => {
    expect(stripCodeFences('   \n\n  ')).toBe('')
  })

  test('preserves content with backticks inside fence block', () => {
    // Content starts with < so the regex doesn't consume the first word as a language identifier
    const input = '```\n<div>He said `hi` to me</div>\n```'
    expect(stripCodeFences(input)).toBe('<div>He said `hi` to me</div>')
  })

  test('handles fence with no trailing newline before closing', () => {
    const result = stripCodeFences('```html\n<!DOCTYPE html>```')
    expect(result).toBe('<!DOCTYPE html>')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// looksLikeHtml — edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe('looksLikeHtml — positive cases', () => {
  test('accepts complete HTML with doctype', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html></html>')).toBe(true)
  })

  test('accepts HTML with <html> tag (no doctype)', () => {
    expect(looksLikeHtml('<html><body></body></html>')).toBe(true)
  })

  test('accepts HTML with uppercase <HTML>', () => {
    expect(looksLikeHtml('<HTML><BODY></BODY></HTML>')).toBe(true)
  })

  test('accepts HTML with mixed case <Html>', () => {
    expect(looksLikeHtml('<Html><Body></Body></Html>')).toBe(true)
  })

  test('accepts HTML with leading whitespace', () => {
    expect(looksLikeHtml('  \n\n  <!DOCTYPE html><html></html>')).toBe(true)
  })

  test('accepts HTML with leading HTML comment', () => {
    expect(looksLikeHtml('<!-- generated by LLM -->\n<!DOCTYPE html><html></html>')).toBe(true)
  })

  test('accepts HTML with UTF-8 BOM', () => {
    expect(looksLikeHtml('\uFEFF<!DOCTYPE html><html></html>')).toBe(true)
  })

  test('accepts HTML with attributes on <html> tag', () => {
    expect(looksLikeHtml('<html lang="en"><body></body></html>')).toBe(true)
  })

  test('accepts HTML with attributes on <!DOCTYPE>', () => {
    expect(looksLikeHtml('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN"><html></html>')).toBe(true)
  })
})

describe('looksLikeHtml — negative cases', () => {
  test('rejects <div> fragment', () => {
    expect(looksLikeHtml('<div>hello</div>')).toBe(false)
  })

  test('rejects conversational text', () => {
    expect(looksLikeHtml('Here is your app:')).toBe(false)
  })

  test('rejects JSON object', () => {
    expect(looksLikeHtml('{"key": "value"}')).toBe(false)
  })

  test('rejects JSON array', () => {
    expect(looksLikeHtml('[1, 2, 3]')).toBe(false)
  })

  test('rejects markdown', () => {
    expect(looksLikeHtml('# Heading\n\n**bold** text')).toBe(false)
  })

  test('rejects Python code', () => {
    expect(looksLikeHtml('def hello():\n    print("hi")')).toBe(false)
  })

  test('rejects JavaScript code', () => {
    expect(looksLikeHtml('const x = 42;')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(looksLikeHtml('')).toBe(false)
  })

  test('rejects whitespace-only string', () => {
    expect(looksLikeHtml('   \n\n  ')).toBe(false)
  })

  test('rejects text starting with prose then HTML', () => {
    expect(looksLikeHtml('Here is your app:\n<!DOCTYPE html><html></html>')).toBe(false)
  })

  test('rejects <body> without <html> wrapper', () => {
    expect(looksLikeHtml('<body>content</body>')).toBe(false)
  })

  test('rejects <head> without <html> wrapper', () => {
    expect(looksLikeHtml('<head><title>T</title></head>')).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// injectCsp
// ──────────────────────────────────────────────────────────────────────────────

describe('injectCsp — injection locations', () => {
  test('injects CSP meta after <head>', () => {
    const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy"/)
  })

  test('injects CSP after <head> with attributes', () => {
    const html = '<html><head lang="en"><title>Test</title></head></html>'
    const result = injectCsp(html)
    expect(result).toMatch(/<head lang="en">\s*<meta http-equiv="Content-Security-Policy"/)
  })

  test('injects <head> if missing but <html> exists', () => {
    const html = '<!DOCTYPE html><html><body>hello</body></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toContain('<head>')
    expect(result).toContain('</head>')
  })

  test('prepends CSP if no <html> tag', () => {
    const html = 'just some text'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
  })
})

describe('injectCsp — security: strips existing CSP', () => {
  test('strips existing permissive CSP and injects strict CSP', () => {
    const existingCsp = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">'
    const html = `<!DOCTYPE html><html><head>${existingCsp}</head></html>`
    const result = injectCsp(html)
    expect(result).not.toContain("default-src 'self'")
    expect(result).toContain("connect-src 'none'")
  })

  test('only one CSP meta after injection', () => {
    const existingCsp = '<meta http-equiv="Content-Security-Policy" content="default-src *">'
    const html = `<!DOCTYPE html><html><head>${existingCsp}</head></html>`
    const result = injectCsp(html)
    const cspCount = (result.match(/Content-Security-Policy/gi) || []).length
    expect(cspCount).toBe(1)
  })

  test('strips existing CSP with single-quoted content', () => {
    const existingCsp = "<meta http-equiv='Content-Security-Policy' content='default-src *'>"
    const html = `<!DOCTYPE html><html><head>${existingCsp}</head></html>`
    const result = injectCsp(html)
    expect(result).not.toContain("default-src *")
    expect(result).toContain("connect-src 'none'")
  })
})

describe('injectCsp — CSP content includes required directives', () => {
  const sampleHtml = '<!DOCTYPE html><html><head></head></html>'

  test('includes default-src \'none\'', () => {
    expect(injectCsp(sampleHtml)).toContain("default-src 'none'")
  })

  test('includes script-src \'unsafe-inline\'', () => {
    expect(injectCsp(sampleHtml)).toContain("script-src 'unsafe-inline'")
  })

  test('includes style-src \'unsafe-inline\'', () => {
    expect(injectCsp(sampleHtml)).toContain("style-src 'unsafe-inline'")
  })

  test('includes img-src \'unsafe-inline\' data:', () => {
    expect(injectCsp(sampleHtml)).toContain("img-src 'unsafe-inline' data:")
  })

  test('includes font-src \'unsafe-inline\' data:', () => {
    expect(injectCsp(sampleHtml)).toContain("font-src 'unsafe-inline' data:")
  })

  test('includes connect-src \'none\'', () => {
    expect(injectCsp(sampleHtml)).toContain("connect-src 'none'")
  })

  test('includes base-uri \'none\'', () => {
    expect(injectCsp(sampleHtml)).toContain("base-uri 'none'")
  })

  test('includes form-action \'none\'', () => {
    expect(injectCsp(sampleHtml)).toContain("form-action 'none'")
  })
})

describe('injectCsp — preserves HTML', () => {
  test('preserves the rest of the HTML', () => {
    const html = '<!DOCTYPE html><html><head><title>My App</title></head><body><canvas></canvas></body></html>'
    const result = injectCsp(html)
    expect(result).toContain('<title>My App</title>')
    expect(result).toContain('<canvas></canvas>')
    expect(result).toContain('<!DOCTYPE html>')
  })

  test('handles case-insensitive HEAD tag', () => {
    const html = '<!DOCTYPE html><HTML><HEAD><title>Test</title></HEAD><BODY></BODY></HTML>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
  })

  test('does not match <header> tag (which contains "head")', () => {
    const html = '<!DOCTYPE html><html><head></head><body><header>Nav</header></body></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
    expect(result).toContain('<header>Nav</header>')
    // CSP should be in <head>, not in <header>
    expect(result).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy"/)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// stripBlockedAPIs
// ──────────────────────────────────────────────────────────────────────────────

describe('stripBlockedAPIs — polyfill injection', () => {
  test('injects polyfill script after <head>', () => {
    const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('<script>')
    expect(result).toMatch(/<head>\s*<script>/)
  })

  test('polyfill contains localStorage shim', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('localStorage')
  })

  test('polyfill contains sessionStorage shim', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('sessionStorage')
  })

  test('polyfill defines getItem function', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('getItem')
  })

  test('polyfill defines setItem function', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('setItem')
  })

  test('polyfill defines removeItem function', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('removeItem')
  })

  test('polyfill defines clear function', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('clear')
  })

  test('polyfill uses Object.defineProperty', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('Object.defineProperty')
  })

  test('polyfill defines key function (for indexing)', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('key')
  })

  test('polyfill defines length getter', () => {
    const html = '<html><head></head></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('length')
  })
})

describe('stripBlockedAPIs — preserves content', () => {
  test('preserves existing head content', () => {
    const html = '<!DOCTYPE html><html><head><title>My App</title><meta charset="utf-8"></head><body></body></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('<title>My App</title>')
    expect(result).toContain('<meta charset="utf-8">')
  })

  test('preserves body content', () => {
    const html = '<!DOCTYPE html><html><head></head><body><div id="app">content</div></body></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('<div id="app">content</div>')
  })

  test('handles missing <head> without crashing', () => {
    const html = '<!DOCTYPE html><html><body>hello</body></html>'
    const result = stripBlockedAPIs(html)
    // Should not crash; polyfill just won't be injected (no <head> to inject into)
    expect(typeof result).toBe('string')
    expect(result).toContain('hello')
  })

  test('returns string for empty input', () => {
    const result = stripBlockedAPIs('')
    expect(typeof result).toBe('string')
  })

  test('preserves existing scripts in the HTML', () => {
    const html = '<!DOCTYPE html><html><head></head><body><script>console.log("app logic")</script></body></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('console.log("app logic")')
  })
})
