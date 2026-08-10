// PROOF OF WORK tests — verify actual behavior, not just structure.
import { describe, it, expect } from 'bun:test'
import { analyzeHtml } from '../src/lib/static-analysis'
import { validateOutput, estimateTokenBudget } from '../src/lib/build-intelligence'
import { stripCodeFences, looksLikeHtml, injectCsp, stripBlockedAPIs } from '../src/lib/html-utils'
import { validateMission } from '../src/lib/mission'
import { normalizeMission } from '../src/lib/helpers'
import { crc32 } from '../src/lib/zip'

describe('PROOF: Static Analysis catches real bugs', () => {
  it('catches onclick calling undefined function', () => {
    const html = `<!DOCTYPE html><html><body>
      <button onclick="missingFn()">Click</button>
      <script>function definedFn() {}</script>
    </body></html>`
    const result = analyzeHtml(html)
    expect(result.issues.some(i => i.message.includes('missingFn'))).toBe(true)
    expect(result.passed).toBe(false)
  })

  it('catches getElementById on non-existent element', () => {
    const html = `<!DOCTYPE html><html><body>
      <button id="realBtn">Click</button>
      <script>document.getElementById('fakeBtn').addEventListener('click', fn)</script>
    </body></html>`
    const result = analyzeHtml(html)
    expect(result.issues.some(i => i.type === 'missing-id' && i.message.includes('fakeBtn'))).toBe(true)
  })

  it('passes clean HTML with all functions defined', () => {
    const html = `<!DOCTYPE html><html><body>
      <button id="btn">Click</button>
      <script>
        function handleClick() { console.log('clicked'); }
        document.getElementById('btn').addEventListener('click', handleClick);
      </script>
    </body></html>`
    const result = analyzeHtml(html)
    expect(result.issues.length).toBe(0)
    expect(result.passed).toBe(true)
  })

  it('does NOT false-positive on comments', () => {
    const html = `<!DOCTYPE html><html><body>
      <script>
        // This comment mentions handlers() and handler() and headings()
        function init() { console.log('ok'); }
        init();
      </script>
    </body></html>`
    const result = analyzeHtml(html)
    const fp = result.issues.filter(i => /handlers|handler|headings/.test(i.message))
    expect(fp.length).toBe(0)
  })

  it('does NOT false-positive on CSS functions in strings', () => {
    const html = `<!DOCTYPE html><html><body>
      <script>
        var color = 'var(--primary)';
        var bg = 'rgba(0,0,0,0.5)';
        el.style.filter = 'brightness(1.1)';
      </script>
    </body></html>`
    const result = analyzeHtml(html)
    const fp = result.issues.filter(i => /var\(|rgba|brightness/.test(i.message))
    expect(fp.length).toBe(0)
  })

  it('does NOT false-positive on function parameters', () => {
    const html = `<!DOCTYPE html><html><body>
      <script>
        function filterItems(query) {
          query = query.toLowerCase().trim();
          return query;
        }
      </script>
    </body></html>`
    const result = analyzeHtml(html)
    expect(result.issues.filter(i => i.message.includes('query'))).toHaveLength(0)
  })
})

describe('PROOF: Quality scoring is accurate', () => {
  it('gives reasonable score to well-structured HTML', () => {
    const html = `<!DOCTYPE html>
<html lang="en"><head><style>body{transition:all 0.3s}</style></head>
<body><main><header><nav></nav></header>
<button aria-label="test" onclick="foo()">Click</button>
<script>function foo(){try{console.log(1)}catch(e){}}</script>
</body></html>`
    const result = validateOutput(html, 'test app')
    expect(result.score).toBeGreaterThanOrEqual(75)
    expect(result.passed).toBe(true)
  })

  it('gives low score to minimal HTML', () => {
    const result = validateOutput('<p>hello</p>', 'test')
    expect(result.score).toBeLessThan(50)
    expect(result.passed).toBe(false)
  })

  it('detects blocked storage APIs (without polyfill false positive)', () => {
    const html = `<!DOCTYPE html><html><body>
      <script>localStorage.setItem('key', 'val');</script>
    </body></html>`
    const result = validateOutput(html, 'test')
    expect(result.checks.find(c => c.name === 'No blocked storage')?.passed).toBe(false)
  })

  it('does NOT flag polyfill as blocked storage', () => {
    const html = `<!DOCTYPE html><html><head>
      <script>// v26: In-memory polyfill for localStorage
      (function(){var _s={};var _l={getItem:function(k){return _s[k]||null}};Object.defineProperty(window,'localStorage',{value:_l})})();</script>
      </head><body><script>console.log(1)</script></body></html>`
    const result = validateOutput(html, 'test')
    expect(result.checks.find(c => c.name === 'No blocked storage')?.passed).toBe(true)
  })
})

describe('PROOF: HTML utilities work correctly', () => {
  it('stripCodeFences removes markdown fences', () => {
    const input = '```html\n<!DOCTYPE html><html></html>\n```'
    const result = stripCodeFences(input)
    expect(result).toContain('<!DOCTYPE html>')
    expect(result).not.toContain('```')
  })

  it('looksLikeHtml detects HTML', () => {
    expect(looksLikeHtml('<!DOCTYPE html>')).toBe(true)
    expect(looksLikeHtml('<html>')).toBe(true)
    expect(looksLikeHtml('print("hello")')).toBe(false)
  })

  it('injectCsp adds Content-Security-Policy', () => {
    const html = '<!DOCTYPE html><html><head></head><body></body></html>'
    const result = injectCsp(html)
    expect(result).toContain('Content-Security-Policy')
  })

  it('stripBlockedAPIs injects localStorage polyfill', () => {
    const html = '<!DOCTYPE html><html><head></head><body></body></html>'
    const result = stripBlockedAPIs(html)
    expect(result).toContain('_localStorage')
    expect(result).toContain('Object.defineProperty')
  })
})

describe('PROOF: Mission validation works', () => {
  it('accepts valid mission', () => {
    expect(validateMission('build a calculator').ok).toBe(true)
  })
  it('rejects empty mission', () => {
    expect(validateMission('').ok).toBe(false)
  })
  it('rejects too-short mission', () => {
    expect(validateMission('ab').ok).toBe(false)
  })
  it('rejects too-long mission (> 5000 chars)', () => {
    expect(validateMission('a'.repeat(5001)).ok).toBe(false)
  })
  it('accepts exactly 5000 chars (boundary)', () => {
    expect(validateMission('a'.repeat(5000)).ok).toBe(true)
  })
})

describe('PROOF: Token budget calculation', () => {
  it('returns 12000 for no plan', () => {
    expect(estimateTokenBudget(null)).toBe(12000)
  })
  it('calculates based on features', () => {
    expect(estimateTokenBudget({ features: ['a', 'b', 'c'] })).toBe(10000)
  })
  it('clamps to minimum 8000', () => {
    expect(estimateTokenBudget({ features: [] })).toBe(8000)
  })
  it('clamps to maximum 32000', () => {
    expect(estimateTokenBudget({ features: Array(20).fill('f') })).toBe(32000)
  })
})

describe('PROOF: CRC32 works', () => {
  const enc = new TextEncoder()
  it('produces consistent values', () => {
    const a = crc32(enc.encode('hello'))
    const b = crc32(enc.encode('hello'))
    expect(a).toBe(b)
  })
  it('produces different values for different inputs', () => {
    expect(crc32(enc.encode('hello'))).not.toBe(crc32(enc.encode('world')))
  })
  it('returns a number', () => {
    expect(typeof crc32(enc.encode('test'))).toBe('number')
  })
})

describe('PROOF: Mission normalization is word-order independent', () => {
  it('"build snake game" == "game snake build"', () => {
    expect(normalizeMission('build snake game')).toBe(normalizeMission('game snake build'))
  })
  it('is case insensitive', () => {
    expect(normalizeMission('Build A Calculator')).toBe(normalizeMission('build a calculator'))
  })
  it('strips punctuation', () => {
    expect(normalizeMission('build a calculator!')).toBe(normalizeMission('build a calculator'))
  })
})
