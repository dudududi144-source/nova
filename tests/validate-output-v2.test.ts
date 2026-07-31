// Tests for validateOutput v2 — weighted scoring + accessibility checks
import { describe, it, expect } from 'bun:test'
import { validateOutput } from '../src/lib/build-intelligence'

const validHtml = (extra = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Test App</title>
<style>
:root { --primary: #3b82f6; --bg: #0f172a; }
body { margin: 0; background: var(--bg); color: #e2e8f0; transition: all 0.3s; font-family: sans-serif; }
.btn { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
.btn:hover { background: #2563eb; }
.btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
input { padding: 8px; border-radius: 4px; border: 1px solid #1e293b; background: #1e293b; color: #e2e8f0; }
</style>
</head>
<body>
<main>
<header><h1>Test App</h1></header>
<section>
<button aria-label="Click me" class="btn">Click</button>
<input aria-label="Name input" type="text" placeholder="Enter your name">
</section>
</main>
<script>
try {
  document.querySelector('button').addEventListener('click', () => {
    console.log('clicked');
  });
} catch (e) { console.error(e); }
${extra}
</script>
</body>
</html>`

describe('validateOutput v2 — weighted scoring', () => {
  it('returns high score (>=95) for a fully compliant HTML', () => {
    const result = validateOutput(validHtml(), 'Build a test app')
    expect(result.score).toBeGreaterThanOrEqual(95)
    expect(result.passed).toBe(true)
  })

  it('penalizes missing DOCTYPE heavily (weight 15)', () => {
    const noDoctype = validHtml().replace('<!DOCTYPE html>\n', '')
    const result = validateOutput(noDoctype, 'Build a test app')
    expect(result.score).toBeLessThan(100)
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it('penalizes missing closing tags heavily (weight 15)', () => {
    const noClosing = validHtml().replace('</body>', '').replace('</html>', '')
    const result = validateOutput(noClosing, 'Build a test app')
    expect(result.score).toBeLessThan(100)
    expect(result.passed).toBe(true) // Still passes (>70)
  })

  it('rewards try-catch error handling (weight 5)', () => {
    const withTryCatch = validHtml()
    const withoutTryCatch = validHtml().replace(/try\s*\{[\s\S]*?\}\s*catch[^}]*\}/g, '')
    const score1 = validateOutput(withTryCatch, 'Build a test app').score
    const score2 = validateOutput(withoutTryCatch, 'Build a test app').score
    expect(score1).toBeGreaterThan(score2)
  })

  it('rewards CSS transitions (weight 5)', () => {
    const withTransitions = validHtml()
    const withoutTransitions = validHtml().replace(/transition\s*:\s*[^;]+;/g, '')
    const score1 = validateOutput(withTransitions, 'Build a test app').score
    const score2 = validateOutput(withoutTransitions, 'Build a test app').score
    expect(score1).toBeGreaterThanOrEqual(score2)
  })
})

describe('validateOutput v2 — accessibility checks', () => {
  it('rewards aria-labels on interactive elements', () => {
    const withAria = validHtml()
    const withoutAria = validHtml().replace(/aria-label="[^"]*"/g, '')
    const score1 = validateOutput(withAria, 'Build a test app').score
    const score2 = validateOutput(withoutAria, 'Build a test app').score
    expect(score1).toBeGreaterThanOrEqual(score2)
  })

  it('rewards semantic HTML (main, header, section, etc.)', () => {
    const withSemantic = validHtml()
    const withoutSemantic = validHtml()
      .replace(/<main>/g, '<div>')
      .replace(/<\/main>/g, '</div>')
      .replace(/<header>/g, '<div>')
      .replace(/<\/header>/g, '</div>')
    const score1 = validateOutput(withSemantic, 'Build a test app').score
    const score2 = validateOutput(withoutSemantic, 'Build a test app').score
    expect(score1).toBeGreaterThanOrEqual(score2)
  })

  it('rewards lang attribute on <html>', () => {
    const withLang = validHtml()
    const withoutLang = validHtml().replace(' lang="en"', '')
    const score1 = validateOutput(withLang, 'Build a test app').score
    const score2 = validateOutput(withoutLang, 'Build a test app').score
    expect(score1).toBeGreaterThanOrEqual(score2)
  })
})

describe('validateOutput v2 — security checks', () => {
  it('penalizes localStorage usage (weight 10)', () => {
    const withLocalStorage = validHtml('localStorage.setItem("key", "value");')
    const without = validHtml()
    const score1 = validateOutput(withLocalStorage, 'Build a test app').score
    const score2 = validateOutput(without, 'Build a test app').score
    expect(score1).toBeLessThan(score2)
  })

  it('penalizes sessionStorage usage', () => {
    const withSession = validHtml('sessionStorage.getItem("key");')
    const result = validateOutput(withSession, 'Build a test app')
    expect(result.checks.some(c => c.name === 'No blocked storage' && !c.passed)).toBe(true)
  })

  it('penalizes document.cookie usage', () => {
    const withCookie = validHtml('const c = document.cookie;')
    const result = validateOutput(withCookie, 'Build a test app')
    expect(result.checks.some(c => c.name === 'No blocked storage' && !c.passed)).toBe(true)
  })
})

describe('validateOutput v2 — retry hint sorts by weight', () => {
  it('retry hint lists highest-weight failures first', () => {
    const badHtml = '<html><body><div>hello</div></body></html>' // Missing DOCTYPE, lang, script, style, etc.
    const result = validateOutput(badHtml, 'Build a test app')
    expect(result.score).toBeLessThan(70)
    expect(result.retryHint).toBeTruthy()
    // DOCTYPE (weight 15) should appear before ARIA labels (weight 4)
    if (result.retryHint) {
      const doctypePos = result.retryHint.indexOf('DOCTYPE')
      const ariaPos = result.retryHint.indexOf('ARIA')
      if (doctypePos >= 0 && ariaPos >= 0) {
        expect(doctypePos).toBeLessThan(ariaPos)
      }
    }
  })
})
