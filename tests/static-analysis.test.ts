// Tests for Static Analysis Engine
import { describe, it, expect } from 'bun:test'
import { analyzeHtml } from '../src/lib/static-analysis'

const cleanHtml = (js: string) => `<!DOCTYPE html>
<html lang="en">
<head><style>body { background: #0f172a; }</style></head>
<body>
<div id="counter">0</div>
<button id="increment">+</button>
<button id="decrement">-</button>
<canvas id="canvas" width="400" height="400"></canvas>
<script>
${js}
</script>
</body>
</html>`

describe('Static Analysis — getElementById checks', () => {
  it('passes when all getElementById calls reference existing IDs', () => {
    const html = cleanHtml(`
      const counter = document.getElementById('counter');
      const btn = document.getElementById('increment');
    `)
    const result = analyzeHtml(html)
    expect(result.issues.filter(i => i.type === 'missing-id')).toEqual([])
    expect(result.passed).toBe(true)
  })

  it('catches getElementById with typo in ID name', () => {
    const html = cleanHtml(`
      const counter = document.getElementById('counterr');
    `)
    const result = analyzeHtml(html)
    const missingIdIssues = result.issues.filter(i => i.type === 'missing-id')
    expect(missingIdIssues.length).toBe(1)
    expect(missingIdIssues[0].message).toContain("counterr")
    expect(missingIdIssues[0].fixHint).toContain("counter")
  })

  it('catches getElementById for ID that completely does not exist', () => {
    const html = cleanHtml(`
      const elem = document.getElementById('nonexistent');
    `)
    const result = analyzeHtml(html)
    const issues = result.issues.filter(i => i.type === 'missing-id')
    expect(issues.length).toBe(1)
    expect(issues[0].message).toContain('nonexistent')
  })

  it('suggests close match for typos', () => {
    const html = cleanHtml(`
      const c = document.getElementById('canvass');
    `)
    const result = analyzeHtml(html)
    const issue = result.issues.find(i => i.type === 'missing-id')
    expect(issue).toBeTruthy()
    expect(issue!.fixHint).toContain('canvas')
    expect(issue!.fixHint).toContain('Did you mean')
  })
})

describe('Static Analysis — addEventListener checks', () => {
  it('passes when addEventListener references defined functions', () => {
    const html = cleanHtml(`
      function handleClick() { console.log('clicked'); }
      document.getElementById('increment').addEventListener('click', handleClick);
    `)
    const result = analyzeHtml(html)
    expect(result.issues.filter(i => i.type === 'undefined-function')).toEqual([])
  })

  it('catches addEventListener referencing undefined function', () => {
    const html = cleanHtml(`
      document.getElementById('increment').addEventListener('click', undefinedHandler);
    `)
    const result = analyzeHtml(html)
    const issues = result.issues.filter(i => i.type === 'undefined-function')
    expect(issues.length).toBe(1)
    expect(issues[0].message).toContain('undefinedHandler')
  })

  it('passes when using arrow function in addEventListener', () => {
    const html = cleanHtml(`
      document.getElementById('increment').addEventListener('click', () => {
        console.log('clicked');
      });
    `)
    const result = analyzeHtml(html)
    // Arrow functions are inline — no named function reference to check
    expect(result.issues.filter(i => i.type === 'undefined-function')).toEqual([])
  })
})

describe('Static Analysis — undeclared variables', () => {
  it('catches variable assigned without declaration', () => {
    const html = cleanHtml(`
      function init() {
        isRunning = true;
      }
    `)
    const result = analyzeHtml(html)
    const issues = result.issues.filter(i => i.type === 'undeclared-variable')
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues.some(i => i.message.includes('isRunning'))).toBe(true)
  })

  it('passes when variables are declared', () => {
    const html = cleanHtml(`
      let isRunning = false;
      function init() {
        isRunning = true;
      }
    `)
    const result = analyzeHtml(html)
    expect(result.issues.filter(i => i.type === 'undeclared-variable' && i.message.includes('isRunning'))).toEqual([])
  })
})

describe('Static Analysis — real-world buggy HTML', () => {
  it('catches multiple bugs in a realistic snake game', () => {
    const buggyHtml = `<!DOCTYPE html>
<html lang="en">
<head></head>
<body>
<canvas id="gameCanvas" width="400" height="400"></canvas>
<div id="score">0</div>
<button id="startBtn">Start</button>
<script>
const canvas = document.getElementById('gameCanvass');
const ctx = canvas.getContext('2d');
document.getElementById('startBtn').addEventListener('click', startGame);

function startGame() {
  isRunning = true;
  gameLoop();
}

function gameLoop() {
  if (isRunning) {
    updatePosition();
    requestAnimationFrame(gameLoop);
  }
}
</script>
</body>
</html>`

    const result = analyzeHtml(buggyHtml)

    // Should catch: 'gameCanvass' typo (missing-id)
    expect(result.issues.some(i => i.type === 'missing-id' && i.message.includes('gameCanvass'))).toBe(true)

    // Should catch: 'isRunning' undeclared (undeclared-variable)
    expect(result.issues.some(i => i.type === 'undeclared-variable' && i.message.includes('isRunning'))).toBe(true)

    // Should NOT pass
    expect(result.passed).toBe(false)

    // Should have a summary
    expect(result.summary).toContain('error')
  })

  it('passes clean HTML with no bugs', () => {
    const cleanHtml = `<!DOCTYPE html>
<html lang="en">
<head></head>
<body>
<div id="counter">0</div>
<button id="btn">Click</button>
<script>
let count = 0;
const counterEl = document.getElementById('counter');
const btn = document.getElementById('btn');

function increment() {
  count++;
  counterEl.textContent = count;
}

btn.addEventListener('click', increment);
</script>
</body>
</html>`

    const result = analyzeHtml(cleanHtml)
    expect(result.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(result.passed).toBe(true)
  })
})

describe('Static Analysis — edge cases', () => {
  it('handles HTML with no script tags', () => {
    const html = '<!DOCTYPE html><html><body><p>Hello</p></body></html>'
    const result = analyzeHtml(html)
    expect(result.passed).toBe(true)
    expect(result.summary).toContain('No JavaScript')
  })

  it('handles empty script tag', () => {
    const html = '<!DOCTYPE html><html><body><script></script></body></html>'
    const result = analyzeHtml(html)
    expect(result.passed).toBe(true)
  })

  it('deduplicates identical issues', () => {
    const html = cleanHtml(`
      const a = document.getElementById('nonexistent');
      const b = document.getElementById('nonexistent');
    `)
    const result = analyzeHtml(html)
    const missingIdIssues = result.issues.filter(i => i.type === 'missing-id' && i.message.includes('nonexistent'))
    expect(missingIdIssues.length).toBe(1)
  })
})
