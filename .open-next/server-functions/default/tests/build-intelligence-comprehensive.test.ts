// Comprehensive tests for src/lib/build-intelligence.ts
// Covers enrichMission, validateOutput (30+ HTML samples), estimateTokenBudget,
// and analyzeQuality with edge cases and complex HTML.
import { describe, expect, test } from 'bun:test'
import {
  enrichMission,
  validateOutput,
  estimateTokenBudget,
  analyzeQuality,
} from '../src/lib/build-intelligence'

// ── Helpers ──
/** Build a minimal valid HTML document with optional body content. */
function makeHtml(opts: {
  doctype?: boolean
  htmlClose?: boolean
  bodyClose?: boolean
  head?: string
  body?: string
  size?: number // if set, pad body with `size - existing length` worth of spaces
}): string {
  const doctype = opts.doctype === false ? '' : '<!DOCTYPE html>'
  const head = opts.head ?? '<title>T</title>'
  const body = opts.body ?? '<div>hello</div>'
  let html = `${doctype}<html lang="en"><head>${head}</head><body>${body}`
  if (opts.bodyClose !== false) html += '</body>'
  if (opts.htmlClose !== false) html += '</html>'
  if (opts.size && html.length < opts.size) {
    html = html.replace('</body>', ' '.repeat(opts.size - html.length) + '</body>')
  }
  return html
}

/** Pad an HTML string to exactly `target` bytes by inserting spaces in body. */
function padTo(html: string, target: number): string {
  if (html.length >= target) return html
  return html.replace('</body>', ' '.repeat(target - html.length) + '</body>')
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichMission
// ─────────────────────────────────────────────────────────────────────────────

describe('enrichMission — type detection', () => {
  test('detects "snake" as game', () => {
    expect(enrichMission('Build a snake game').detectedType).toBe('game')
  })

  test('detects "game" as game', () => {
    expect(enrichMission('Build a game').detectedType).toBe('game')
  })

  test('detects "play" as game', () => {
    expect(enrichMission('Build something to play').detectedType).toBe('game')
  })

  test('detects "todo" as app', () => {
    expect(enrichMission('Build a todo app').detectedType).toBe('app')
  })

  test('detects "task" as app', () => {
    expect(enrichMission('Build a task tracker').detectedType).toBe('app')
  })

  test('detects "calculator" as tool', () => {
    expect(enrichMission('Build a calculator').detectedType).toBe('tool')
  })

  test('detects "calc" (short form) as tool', () => {
    expect(enrichMission('Build a calc').detectedType).toBe('tool')
  })

  test('detects "color palette" as tool', () => {
    expect(enrichMission('Build a color palette').detectedType).toBe('tool')
  })

  test('detects "palette" alone as tool', () => {
    expect(enrichMission('Build a palette generator').detectedType).toBe('tool')
  })

  test('detects "clock" as tool', () => {
    expect(enrichMission('Build a clock').detectedType).toBe('tool')
  })

  test('detects "timer" as tool', () => {
    expect(enrichMission('Build a timer').detectedType).toBe('tool')
  })

  test('detects "stopwatch" as tool', () => {
    expect(enrichMission('Build a stopwatch').detectedType).toBe('tool')
  })

  test('detects "markdown" as app', () => {
    expect(enrichMission('Build a markdown viewer').detectedType).toBe('app')
  })

  test('detects "editor" as app', () => {
    expect(enrichMission('Build a text editor').detectedType).toBe('app')
  })

  test('detects "music" as app', () => {
    // Use 'music' alone — 'player' contains 'play' which matches the game branch first
    expect(enrichMission('Build a music library').detectedType).toBe('app')
  })

  test('detects "player" as game (because "player" contains "play" — documented quirk)', () => {
    expect(enrichMission('Build a video player').detectedType).toBe('game')
  })

  test('unknown mission defaults to app', () => {
    expect(enrichMission('Build a quantum physics simulator').detectedType).toBe('app')
  })

  test('empty string defaults to app', () => {
    expect(enrichMission('').detectedType).toBe('app')
  })
})

describe('enrichMission — hint content', () => {
  test('game hints mention rendering method', () => {
    const r = enrichMission('Build a game')
    expect(r.hints.some(h => h.includes('rendering method'))).toBe(true)
  })

  test('game hints mention game-over state', () => {
    const r = enrichMission('Build a game')
    expect(r.hints.some(h => h.includes('game-over'))).toBe(true)
  })

  test('todo hints include filter tabs', () => {
    const r = enrichMission('Build a todo app')
    expect(r.hints).toContain('Filter tabs: All / Active / Completed')
  })

  test('todo hints include empty state message', () => {
    const r = enrichMission('Build a todo app')
    expect(r.hints).toContain('Empty state message when no tasks')
  })

  test('calculator hints include keyboard support', () => {
    const r = enrichMission('Build a calculator')
    expect(r.hints).toContain('Keyboard support for digits and operators')
  })

  test('calculator hints include division by zero handling', () => {
    const r = enrichMission('Build a calculator')
    expect(r.hints).toContain('Handle division by zero')
  })

  test('calculator hints include chain operations', () => {
    const r = enrichMission('Build a calculator')
    expect(r.hints).toContain('Chain operations (2+3*4=14)')
  })

  test('color hints include copy-to-clipboard', () => {
    const r = enrichMission('Build a color palette')
    expect(r.hints.some(h => h.includes('copy-to-clipboard'))).toBe(true)
  })

  test('color hints include complementary color', () => {
    const r = enrichMission('Build a color palette')
    expect(r.hints.some(h => h.includes('complementary'))).toBe(true)
  })

  test('timer hints mention 100ms setInterval', () => {
    const r = enrichMission('Build a stopwatch')
    expect(r.hints.some(h => h.includes('100ms'))).toBe(true)
  })

  test('markdown hints mention split view', () => {
    const r = enrichMission('Build a markdown editor')
    expect(r.hints).toContain('Split view: input on left, preview on right')
  })

  test('music hints mention Web Audio API', () => {
    // Use 'music' alone — 'player' would match the game branch
    const r = enrichMission('Build a music library')
    expect(r.hints.some(h => h.includes('Web Audio'))).toBe(true)
  })
})

describe('enrichMission — general hints inclusion', () => {
  test('always includes dark theme hint', () => {
    const r = enrichMission('Build a game')
    expect(r.hints).toContain('Dark theme: #0f172a background, #1e293b cards, #e2e8f0 text')
  })

  test('always includes responsive layout hint', () => {
    const r = enrichMission('Build something unknown')
    expect(r.hints).toContain('Responsive layout with CSS Flexbox or Grid')
  })

  test('always includes CSS transitions hint', () => {
    const r = enrichMission('unknown mission')
    expect(r.hints).toContain('Add CSS transitions on interactive elements')
  })

  test('general hints are present even when no specific match is found', () => {
    const r = enrichMission('Build a quantum physics simulator')
    expect(r.hints.length).toBeGreaterThanOrEqual(3)
    expect(r.enriched).toContain('Dark theme')
    expect(r.enriched).toContain('Responsive layout')
    expect(r.enriched).toContain('CSS transitions')
  })
})

describe('enrichMission — enriched text', () => {
  test('enriched text starts with the original mission', () => {
    const r = enrichMission('Build a calculator')
    expect(r.enriched.startsWith('Build a calculator')).toBe(true)
  })

  test('enriched text includes Implementation hints section', () => {
    const r = enrichMission('Build a snake game')
    expect(r.enriched).toContain('Implementation hints:')
  })

  test('each hint is prefixed with "- "', () => {
    const r = enrichMission('Build a todo app')
    for (const h of r.hints) {
      expect(r.enriched).toContain(`- ${h}`)
    }
  })

  test('original field is preserved exactly', () => {
    const mission = '  Build a  weird  calculator  '
    expect(enrichMission(mission).original).toBe(mission)
  })
})

describe('enrichMission — word boundary checks', () => {
  test('detects "calc" before punctuation', () => {
    expect(enrichMission('Build a calc, please').detectedType).toBe('tool')
  })

  test('detects "calc" at end of sentence', () => {
    expect(enrichMission('Build a calc').detectedType).toBe('tool')
  })

  test('does NOT match "calc" as substring of "calculation"', () => {
    expect(enrichMission('Build a calculation tool').detectedType).not.toBe('tool')
  })

  test('does NOT match "calc" as substring of "local"', () => {
    expect(enrichMission('Build a local tool').detectedType).not.toBe('tool')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateOutput — 30+ HTML samples
// ─────────────────────────────────────────────────────────────────────────────

describe('validateOutput — valid HTML samples', () => {
  test('passes complete snake game HTML', () => {
    const html = makeHtml({
      body: `<canvas id="g"></canvas><script>
        let score=0; function init(){requestAnimationFrame(loop);} function loop(){requestAnimationFrame(loop);}
        document.addEventListener('keydown',init); init(); try{}catch(e){}
      </script>`,
      size: 2500,
    })
    const r = validateOutput(html, 'Build a snake game')
    expect(r.score).toBeGreaterThanOrEqual(70)
    expect(r.passed).toBe(true)
  })

  test('passes complete todo HTML', () => {
    const html = makeHtml({
      body: `<main><input id="i"><button id="add">Add</button><ul id="list"></ul></main>
        <script>document.addEventListener('click',()=>{}); try{}catch(e){}</script>`,
      size: 2500,
    })
    const r = validateOutput(html, 'Build a todo app')
    expect(r.passed).toBe(true)
  })

  test('passes complete calculator HTML with 10+ buttons', () => {
    const body = Array.from({ length: 12 }, (_, i) => `<button>${i}</button>`).join('')
    const html = makeHtml({
      body: `<main>${body}</main><script>try{}catch(e){}</script>`,
      size: 2500,
    })
    const r = validateOutput(html, 'Build a calculator')
    expect(r.passed).toBe(true)
  })

  test('passes generic app with interactivity', () => {
    const html = makeHtml({
      body: `<main><button onclick="x()">click</button></main><script>
        document.addEventListener('click',()=>{}); try{}catch(e){}
      </script>`,
      size: 2500,
    })
    const r = validateOutput(html, 'Build a landing page')
    expect(r.passed).toBe(true)
  })

  test('passes generic app with onclick handler', () => {
    const html = makeHtml({
      body: `<main><button onclick="doStuff()">click</button></main><script>try{}catch(e){}</script>`,
      size: 2500,
    })
    const r = validateOutput(html, 'Build a landing page')
    expect(r.passed).toBe(true)
  })
})

describe('validateOutput — DOCTYPE checks', () => {
  test('fails when DOCTYPE is missing', () => {
    const html = '<html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>'
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'DOCTYPE')
    expect(check?.passed).toBe(false)
  })

  test('passes when DOCTYPE is present (lowercase)', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'DOCTYPE')
    expect(check?.passed).toBe(true)
  })

  test('passes when DOCTYPE is uppercase', () => {
    const html = padTo('<!DOCTYPE HTML><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'DOCTYPE')
    expect(check?.passed).toBe(true)
  })

  test('passes when DOCTYPE has mixed case', () => {
    const html = padTo('<!DoCtYpE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'DOCTYPE')
    expect(check?.passed).toBe(true)
  })
})

describe('validateOutput — closing tags checks', () => {
  test('fails when both </body> and </html> are missing', () => {
    const html = '<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script>'
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Closing tags')
    expect(check?.passed).toBe(false)
  })

  test('fails when only </body> is present', () => {
    const html = '<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body>'
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Closing tags')
    expect(check?.passed).toBe(false)
  })

  test('fails when only </html> is present', () => {
    const html = '<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></html>'
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Closing tags')
    expect(check?.passed).toBe(false)
  })

  test('passes when both </body> and </html> are present', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Closing tags')
    expect(check?.passed).toBe(true)
  })
})

describe('validateOutput — size check', () => {
  test('fails when HTML is below 2000 bytes', () => {
    const html = '<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>'
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Size')
    expect(check?.passed).toBe(false)
  })

  test('passes when HTML is exactly 2001 bytes (boundary)', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2001)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Size')
    expect(check?.passed).toBe(true)
  })

  test('fails when HTML is exactly 2000 bytes (boundary, < 2000 fails)', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2000)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Size')
    expect(check?.passed).toBe(false)
  })

  test('size detail message contains the byte count', () => {
    const r = validateOutput('short', 'Build an app')
    const check = r.checks.find(c => c.name === 'Size')
    expect(check?.detail).toContain('bytes')
  })
})

describe('validateOutput — JavaScript checks', () => {
  test('detects multiple <script> tags', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script><script>a()</script><script>b()</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'JavaScript')
    expect(check?.passed).toBe(true)
    expect(check?.detail).toContain('3')
  })

  test('fails when no <script> tag present', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><div>no script</div></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'JavaScript')
    expect(check?.passed).toBe(false)
  })

  test('passes when try-catch is present', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try { doThing(); } catch(e) {}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Error handling')
    expect(check?.passed).toBe(true)
  })

  test('fails when try-catch is absent', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>doThing();</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Error handling')
    expect(check?.passed).toBe(false)
  })
})

describe('validateOutput — CSS checks', () => {
  test('passes when <style> tag is present', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{color:red}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'CSS')
    expect(check?.passed).toBe(true)
  })

  test('fails when no <style> tag', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'CSS')
    expect(check?.passed).toBe(false)
  })

  test('detects CSS transition', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all 0.3s}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Transitions/Animations')
    expect(check?.passed).toBe(true)
  })

  test('detects CSS animation', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>@keyframes a{from{}to{}}x{animation:a 1s}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Transitions/Animations')
    expect(check?.passed).toBe(true)
  })

  test('fails when no transitions/animations', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{color:red}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Transitions/Animations')
    expect(check?.passed).toBe(false)
  })
})

describe('validateOutput — security checks', () => {
  test('fails when localStorage is used', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>localStorage.setItem("a","b"); try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'No blocked storage')
    expect(check?.passed).toBe(false)
  })

  test('fails when sessionStorage is used', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>sessionStorage.getItem("a"); try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'No blocked storage')
    expect(check?.passed).toBe(false)
  })

  test('fails when document.cookie is used', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>document.cookie="a=b"; try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'No blocked storage')
    expect(check?.passed).toBe(false)
  })

  test('passes when no blocked storage APIs are used', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'No blocked storage')
    expect(check?.passed).toBe(true)
  })
})

describe('validateOutput — accessibility checks', () => {
  test('detects aria-labels on interactive elements', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><button aria-label="save">s</button><button aria-label="load">l</button><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'ARIA labels')
    expect(check?.passed).toBe(true)
  })

  test('fails when interactive elements have no aria-labels', () => {
    const buttons = '<button>x</button>'.repeat(6)
    const html = padTo(`<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body>${buttons}<script>try{}catch(e){}</script></body></html>`, 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'ARIA labels')
    expect(check?.passed).toBe(false)
  })

  test('passes when there are no interactive elements (vacuously)', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><div>static</div><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'ARIA labels')
    expect(check?.passed).toBe(true)
  })

  test('detects 2+ semantic tags', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><main><header><section></section></header></main><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Semantic HTML')
    expect(check?.passed).toBe(true)
  })

  test('fails when fewer than 2 semantic tags', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><main>just main</main><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Semantic HTML')
    expect(check?.passed).toBe(false)
  })

  test('passes when lang attribute is on <html>', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Language attribute')
    expect(check?.passed).toBe(true)
  })

  test('fails when <html> has no lang attribute', () => {
    const html = padTo('<!DOCTYPE html><html><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Language attribute')
    expect(check?.passed).toBe(false)
  })

  test('passes when lang attribute uses single quotes', () => {
    const html = padTo("<!DOCTYPE html><html lang='en'><head><style>x{}</style></head><body><script>try{}catch(e){}</script></body></html>", 2500)
    const r = validateOutput(html, 'Build an app')
    const check = r.checks.find(c => c.name === 'Language attribute')
    expect(check?.passed).toBe(true)
  })
})

describe('validateOutput — mission-specific checks', () => {
  test('snake mission: detects canvas, rAF, listeners, score', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><canvas></canvas><script>let score=0; function l(){requestAnimationFrame(l);} document.addEventListener("keydown",l); try{}catch(e){} l();</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a snake game')
    const names = r.checks.map(c => c.name)
    expect(names).toContain('Canvas')
    expect(names).toContain('Game loop')
    expect(names).toContain('Event listeners')
    expect(names).toContain('Score')
  })

  test('snake mission: fails canvas check when no canvas', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><script>let score=0; function l(){requestAnimationFrame(l);} document.addEventListener("keydown",l); try{}catch(e){} l();</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a snake game')
    const check = r.checks.find(c => c.name === 'Canvas')
    expect(check?.passed).toBe(false)
  })

  test('snake mission: passes game loop with setInterval (alternative to rAF)', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><canvas></canvas><script>let score=0; setInterval(function(){},100); document.addEventListener("keydown",function(){}); try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a snake game')
    const check = r.checks.find(c => c.name === 'Game loop')
    expect(check?.passed).toBe(true)
  })

  test('snake mission: fails game loop when neither rAF nor setInterval', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><canvas></canvas><script>let score=0; document.addEventListener("keydown",function(){}); try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a snake game')
    const check = r.checks.find(c => c.name === 'Game loop')
    expect(check?.passed).toBe(false)
  })

  test('todo mission: detects input and buttons', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><input><button>Add</button><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a todo app')
    const input = r.checks.find(c => c.name === 'Input')
    const btn = r.checks.find(c => c.name === 'Buttons')
    expect(input?.passed).toBe(true)
    expect(btn?.passed).toBe(true)
  })

  test('todo mission: fails input check when no input/textarea', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><button>Add</button><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a todo app')
    const check = r.checks.find(c => c.name === 'Input')
    expect(check?.passed).toBe(false)
  })

  test('todo mission: passes input check with textarea', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><textarea></textarea><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a todo app')
    const check = r.checks.find(c => c.name === 'Input')
    expect(check?.passed).toBe(true)
  })

  test('calculator mission: passes with 10+ buttons', () => {
    const buttons = '<button>1</button>'.repeat(10)
    const html = padTo(`<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body>${buttons}<script>try{}catch(e){}</script></body></html>`, 2500)
    const r = validateOutput(html, 'Build a calculator')
    const check = r.checks.find(c => c.name === 'Calculator buttons')
    expect(check?.passed).toBe(true)
  })

  test('calculator mission: fails with 9 buttons (just under threshold)', () => {
    const buttons = '<button>1</button>'.repeat(9)
    const html = padTo(`<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body>${buttons}<script>try{}catch(e){}</script></body></html>`, 2500)
    const r = validateOutput(html, 'Build a calculator')
    const check = r.checks.find(c => c.name === 'Calculator buttons')
    expect(check?.passed).toBe(false)
  })

  test('generic mission: detects addEventListener', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><script>document.addEventListener("click",function(){}); try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a landing page')
    const check = r.checks.find(c => c.name === 'Interactivity')
    expect(check?.passed).toBe(true)
  })

  test('generic mission: detects onclick', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><button onclick="x()">go</button><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a landing page')
    const check = r.checks.find(c => c.name === 'Interactivity')
    expect(check?.passed).toBe(true)
  })

  test('generic mission: fails when no interactivity', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><div>static</div><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build a landing page')
    const check = r.checks.find(c => c.name === 'Interactivity')
    expect(check?.passed).toBe(false)
  })
})

describe('validateOutput — score & retry hint', () => {
  test('score is in 0-100 range', () => {
    const r1 = validateOutput('', 'Build an app')
    const r2 = validateOutput(padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><main><header></header></main><script>try{}catch(e){}</script></body></html>', 2500), 'Build an app')
    expect(r1.score).toBeGreaterThanOrEqual(0)
    expect(r1.score).toBeLessThanOrEqual(100)
    expect(r2.score).toBeGreaterThanOrEqual(0)
    expect(r2.score).toBeLessThanOrEqual(100)
  })

  test('retryHint is generated when score < 70', () => {
    const r = validateOutput('<html><body>hi</body></html>', 'Build an app')
    expect(r.score).toBeLessThan(70)
    expect(r.retryHint).toBeTruthy()
    expect(typeof r.retryHint).toBe('string')
  })

  test('retryHint mentions the highest-weight failed check first', () => {
    // 'hi' alone fails DOCTYPE (15), Closing tags (15), Interactivity (15) — all weight 15
    const r = validateOutput('hi', 'Build an app')
    expect(r.retryHint).toBeTruthy()
    expect(r.retryHint!).toContain('DOCTYPE')
    expect(r.retryHint!).toContain('Closing tags')
    expect(r.retryHint!).toContain('Interactivity')
  })

  test('retryHint is undefined when score >= 70', () => {
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><main><header></header></main><script>try{}catch(e){}</script></body></html>', 2500)
    const r = validateOutput(html, 'Build an app')
    expect(r.score).toBeGreaterThanOrEqual(70)
    expect(r.retryHint).toBeUndefined()
  })

  test('passed is true iff score >= 70', () => {
    const bad = validateOutput('bad', 'Build an app')
    expect(bad.passed).toBe(bad.score >= 70)
    const html = padTo('<!DOCTYPE html><html lang="en"><head><style>x{transition:all}</style></head><body><main><header></header></main><script>try{}catch(e){}</script></body></html>', 2500)
    const good = validateOutput(html, 'Build an app')
    expect(good.passed).toBe(good.score >= 70)
  })

  test('checks array contains all expected check names', () => {
    const r = validateOutput('<html></html>', 'Build an app')
    const names = r.checks.map(c => c.name)
    expect(names).toContain('DOCTYPE')
    expect(names).toContain('Closing tags')
    expect(names).toContain('Size')
    expect(names).toContain('JavaScript')
    expect(names).toContain('Error handling')
    expect(names).toContain('CSS')
    expect(names).toContain('Transitions/Animations')
    expect(names).toContain('No blocked storage')
    expect(names).toContain('ARIA labels')
    expect(names).toContain('Semantic HTML')
    expect(names).toContain('Language attribute')
    expect(names).toContain('Interactivity')
  })

  test('each check has a non-empty detail', () => {
    const r = validateOutput('<html></html>', 'Build an app')
    for (const c of r.checks) {
      expect(c.detail.length).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// estimateTokenBudget
// ─────────────────────────────────────────────────────────────────────────────

describe('estimateTokenBudget — invalid inputs', () => {
  test('returns 6000 for null', () => {
    expect(estimateTokenBudget(null)).toBe(6000)
  })

  test('returns 6000 for undefined', () => {
    expect(estimateTokenBudget(undefined)).toBe(6000)
  })

  test('returns 6000 for string', () => {
    expect(estimateTokenBudget('not a plan')).toBe(6000)
  })

  test('returns 6000 for number', () => {
    expect(estimateTokenBudget(42)).toBe(6000)
  })

  test('arrays are objects in JS — defaults are used (features=3, functions=2)', () => {
    // typeof [] === 'object' so the early-return guard doesn't trip.
    // Then p.features is undefined → default 3, p.keyFunctions is undefined → default 2.
    // 3*1500 + 2*800 + 1000 = 7100
    expect(estimateTokenBudget([1, 2, 3])).toBe(7100)
  })

  test('returns 6000 for boolean', () => {
    expect(estimateTokenBudget(true)).toBe(6000)
  })
})

describe('estimateTokenBudget — valid plan structures', () => {
  test('empty object uses defaults (3 features, 2 functions)', () => {
    // 3*1500 + 2*800 + 1000 = 7100
    expect(estimateTokenBudget({})).toBe(7100)
  })

  test('features only', () => {
    // 2*1500 + 2*800 + 1000 = 5600 (keyFunctions defaults to 2)
    expect(estimateTokenBudget({ features: ['a', 'b'] })).toBe(5600)
  })

  test('keyFunctions only', () => {
    // 3*1500 + 4*800 + 1000 = 8700
    expect(estimateTokenBudget({ keyFunctions: ['a', 'b', 'c', 'd'] })).toBe(8700)
  })

  test('both features and keyFunctions', () => {
    // 4*1500 + 3*800 + 1000 = 9400
    expect(estimateTokenBudget({ features: ['a', 'b', 'c', 'd'], keyFunctions: ['x', 'y', 'z'] })).toBe(9400)
  })

  test('snake_case: key_features', () => {
    // 2*1500 + 2*800 + 1000 = 5600
    expect(estimateTokenBudget({ key_features: ['a', 'b'] })).toBe(5600)
  })

  test('snake_case: key_functions', () => {
    expect(estimateTokenBudget({ key_functions: ['a', 'b', 'c', 'd'] })).toBe(8700)
  })

  test('snake_case: both key_features and key_functions', () => {
    expect(estimateTokenBudget({ key_features: ['a', 'b', 'c', 'd'], key_functions: ['x', 'y', 'z'] })).toBe(9400)
  })

  test('camelCase takes precedence when both present', () => {
    // features array (camelCase) should win over key_features
    const plan = { features: ['a', 'b'], key_features: ['x', 'y', 'z', 'w'] }
    // 2*1500 + 2*800 + 1000 = 5600 (uses camelCase features length=2)
    expect(estimateTokenBudget(plan)).toBe(5600)
  })

  test('plan with other fields but no features/functions uses defaults', () => {
    expect(estimateTokenBudget({ title: 'App', type: 'tool', layout: 'grid' })).toBe(7100)
  })
})

describe('estimateTokenBudget — clamping', () => {
  test('clamps to minimum 5000 for empty arrays', () => {
    // 0*1500 + 0*800 + 1000 = 1000, clamped to 5000
    expect(estimateTokenBudget({ features: [], keyFunctions: [] })).toBe(5000)
  })

  test('clamps to minimum 5000 for empty snake_case arrays', () => {
    expect(estimateTokenBudget({ key_features: [], key_functions: [] })).toBe(5000)
  })

  test('clamps to maximum 16000 for many features', () => {
    expect(estimateTokenBudget({ features: Array(20).fill('f'), keyFunctions: [] })).toBe(16000)
  })

  test('clamps to maximum 16000 for many functions', () => {
    expect(estimateTokenBudget({ features: [], keyFunctions: Array(30).fill('f') })).toBe(16000)
  })

  test('clamps to maximum 16000 for many features AND functions', () => {
    expect(estimateTokenBudget({ features: Array(20).fill('f'), keyFunctions: Array(20).fill('fn') })).toBe(16000)
  })

  test('does NOT clamp for moderate plan', () => {
    // 5*1500 + 4*800 + 1000 = 11700 (within 5000-16000)
    expect(estimateTokenBudget({ features: Array(5).fill('f'), keyFunctions: Array(4).fill('fn') })).toBe(11700)
  })

  test('non-array features field is ignored (falls back to default 3)', () => {
    expect(estimateTokenBudget({ features: 'not-an-array' })).toBe(7100)
  })

  test('non-array keyFunctions field is ignored (falls back to default 2)', () => {
    expect(estimateTokenBudget({ keyFunctions: { a: 1 } })).toBe(7100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// analyzeQuality
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeQuality — basic metrics', () => {
  test('empty HTML returns 0 bytes, 1 line', () => {
    const m = analyzeQuality('')
    expect(m.bytes).toBe(0)
    expect(m.lines).toBe(1)
    expect(m.functions).toBe(0)
    expect(m.eventListeners).toBe(0)
    expect(m.cssRules).toBe(0)
    expect(m.domElements).toBe(0)
    expect(m.hasCanvas).toBe(false)
    expect(m.hasAnimations).toBe(false)
  })

  test('counts lines correctly (single line)', () => {
    expect(analyzeQuality('<html></html>').lines).toBe(1)
  })

  test('counts lines correctly (multi-line)', () => {
    const html = '<html>\n<head>\n</head>\n<body>\n</body>\n</html>'
    expect(analyzeQuality(html).lines).toBe(6)
  })

  test('bytes counts string length', () => {
    const html = '<html>abc</html>'
    expect(analyzeQuality(html).bytes).toBe(html.length)
  })
})

describe('analyzeQuality — function detection', () => {
  test('detects function declarations', () => {
    const html = '<script>function foo() {} function bar() {}</script>'
    expect(analyzeQuality(html).functions).toBe(2)
  })

  test('detects arrow functions with block body (const x = () => {)', () => {
    const html = '<script>const f = () => { return 1; }</script>'
    expect(analyzeQuality(html).functions).toBeGreaterThanOrEqual(1)
  })

  test('detects const arrow assignment pattern (const x = () => {)', () => {
    const html = '<script>const f = () => {}</script>'
    expect(analyzeQuality(html).functions).toBeGreaterThanOrEqual(1)
  })

  test('does NOT count empty script as function', () => {
    const html = '<script></script>'
    expect(analyzeQuality(html).functions).toBe(0)
  })

  test('detects multiple function patterns', () => {
    const html = '<script>function a(){} const b = () => {}; function c(){}</script>'
    const m = analyzeQuality(html)
    expect(m.functions).toBeGreaterThanOrEqual(3)
  })
})

describe('analyzeQuality — event listeners', () => {
  test('counts addEventListener calls', () => {
    const html = '<script>addEventListener("a",x); addEventListener("b",y); addEventListener("c",z);</script>'
    expect(analyzeQuality(html).eventListeners).toBe(3)
  })

  test('is case-insensitive for addEventListener', () => {
    const html = '<script>AdDeVeNtLiStEnEr("a",x);</script>'
    expect(analyzeQuality(html).eventListeners).toBe(1)
  })

  test('returns 0 when no addEventListener', () => {
    expect(analyzeQuality('<script>function a(){}</script>').eventListeners).toBe(0)
  })
})

describe('analyzeQuality — CSS rules', () => {
  test('counts rules inside <style> blocks', () => {
    const html = '<style>body { color: red; } .btn { background: blue; } #id { margin: 0; }</style>'
    expect(analyzeQuality(html).cssRules).toBe(3)
  })

  test('counts rules across multiple <style> blocks', () => {
    const html = '<style>a {}</style><style>b {}</style><style>c {}</style>'
    expect(analyzeQuality(html).cssRules).toBe(3)
  })

  test('does NOT count JS object literals outside <style> as CSS rules', () => {
    const html = '<script>const obj = { a: 1, b: 2 }; const obj2 = { c: 3 };</script>'
    expect(analyzeQuality(html).cssRules).toBe(0)
  })

  test('does NOT count braces in template literals', () => {
    const html = '<script>const t = `hello ${name} world`;</script>'
    expect(analyzeQuality(html).cssRules).toBe(0)
  })

  test('returns 0 when no <style> block', () => {
    expect(analyzeQuality('<html><body>hi</body></html>').cssRules).toBe(0)
  })

  test('handles <style> with attributes', () => {
    const html = '<style type="text/css">a {color:red;}</style>'
    expect(analyzeQuality(html).cssRules).toBe(1)
  })
})

describe('analyzeQuality — DOM elements', () => {
  test('counts opening tags', () => {
    const html = '<html><head><title>T</title></head><body><div><span></span></div></body></html>'
    // <html>, <head>, <title>, <body>, <div>, <span> = 6
    expect(analyzeQuality(html).domElements).toBe(6)
  })

  test('counts self-closing tags', () => {
    const html = '<html><body><br><img><hr></body></html>'
    expect(analyzeQuality(html).domElements).toBe(5)
  })

  test('returns 0 for plain text', () => {
    expect(analyzeQuality('just text').domElements).toBe(0)
  })
})

describe('analyzeQuality — canvas & animations', () => {
  test('detects canvas element', () => {
    expect(analyzeQuality('<canvas></canvas>').hasCanvas).toBe(true)
  })

  test('detects canvas with attributes', () => {
    expect(analyzeQuality('<canvas id="g" width="100"></canvas>').hasCanvas).toBe(true)
  })

  test('detects uppercase CANVAS', () => {
    expect(analyzeQuality('<CANVAS></CANVAS>').hasCanvas).toBe(true)
  })

  test('returns false when no canvas', () => {
    expect(analyzeQuality('<div>no canvas</div>').hasCanvas).toBe(false)
  })

  test('detects requestAnimationFrame as animation', () => {
    expect(analyzeQuality('<script>requestAnimationFrame(function(){})</script>').hasAnimations).toBe(true)
  })

  test('detects transition as animation', () => {
    expect(analyzeQuality('<style>x{transition:all 0.3s}</style>').hasAnimations).toBe(true)
  })

  test('detects animation as animation', () => {
    expect(analyzeQuality('<style>x{animation:1s ease}</style>').hasAnimations).toBe(true)
  })

  test('returns false for no animation keywords', () => {
    expect(analyzeQuality('<div>plain</div>').hasAnimations).toBe(false)
  })
})

describe('analyzeQuality — summary', () => {
  test('summary contains "lines"', () => {
    expect(analyzeQuality('<html></html>').summary).toContain('lines')
  })

  test('summary contains "functions"', () => {
    expect(analyzeQuality('<html></html>').summary).toContain('functions')
  })

  test('summary contains "listeners"', () => {
    expect(analyzeQuality('<html></html>').summary).toContain('listeners')
  })

  test('summary contains "CSS rules"', () => {
    expect(analyzeQuality('<html></html>').summary).toContain('CSS rules')
  })

  test('summary contains the line count', () => {
    const html = '<html>\n<body>\n</body>\n</html>'
    expect(analyzeQuality(html).summary).toContain('4 lines')
  })

  test('summary contains the function count', () => {
    const html = '<script>function a(){} function b(){}</script>'
    expect(analyzeQuality(html).summary).toContain('2 functions')
  })
})

describe('analyzeQuality — complex HTML', () => {
  test('analyzes a complete app correctly', () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<style>
  body { margin: 0; transition: all 0.3s; }
  .btn { color: red; animation: 1s ease; }
  #main { display: flex; }
</style>
</head>
<body>
<canvas id="game"></canvas>
<header><nav><main><section><article></article></section></main></nav></header>
<button>Start</button>
<script>
function init() { console.log('init'); }
function loop() { requestAnimationFrame(loop); }
const start = () => { init(); loop(); };
document.addEventListener('keydown', start);
document.addEventListener('click', () => {});
try { start(); } catch(e) {}
</script>
</body>
</html>`
    const m = analyzeQuality(html)
    expect(m.lines).toBeGreaterThan(15)
    expect(m.bytes).toBeGreaterThan(400)
    expect(m.functions).toBeGreaterThanOrEqual(3)
    expect(m.eventListeners).toBe(2)
    expect(m.cssRules).toBe(3)
    expect(m.domElements).toBeGreaterThanOrEqual(10)
    expect(m.hasCanvas).toBe(true)
    expect(m.hasAnimations).toBe(true)
    expect(m.summary).toContain('lines')
    expect(m.summary).toContain('functions')
    expect(m.summary).toContain('listeners')
    expect(m.summary).toContain('CSS rules')
  })
})
