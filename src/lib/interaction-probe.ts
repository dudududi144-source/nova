// Interaction probe — programmatically tests the generated app for runtime errors.
//
// After the build completes, this module:
// 1. Injects the app into a hidden iframe
// 2. Clicks every button
// 3. Types into every input
// 4. For games: dispatches arrow key events
// 5. Captures any runtime errors
// 6. Returns a structured report of what works and what doesn't
//
// This is NOVA's "Potemkin interface" detector — it catches apps that look right
// but crash on interaction. Inspired by Replit Agent's REPL-based verification.
//
// All probing happens in the browser (client-side), not on the server.

export interface ProbeResult {
  errors: ProbeError[]
  interactions: number
  buttonsClicked: number
  inputsTested: number
  gameKeysDispatched: boolean
  stateChanges: StateChange[]
  /** v25: Functional score — what % of clicks actually changed something */
  functionalScore: number
  /** v25: Dead clicks — buttons that did nothing */
  deadClicks: number
  /** v25: Functional clicks — buttons that caused a visible change */
  functionalClicks: number
  summary: string
}

export interface ProbeError {
  type: string  // 'error' | 'promise' | 'console.error'
  msg: string
  line: number
  col: number
  stack?: string
}

export interface StateChange {
  selector: string
  before: string
  after: string
  changed: boolean
}

/**
 * Probe a generated HTML app for runtime errors.
 * Creates a hidden iframe, loads the HTML, interacts with it, captures errors.
 *
 * @param html The complete HTML document to probe
 * @param isGame Whether the app is a game (dispatches arrow keys)
 * @returns Promise<ProbeResult> with errors found and interactions performed
 */
export function probeApp(html: string, isGame: boolean): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const errors: ProbeError[] = []
    let interactions = 0
    let buttonsClicked = 0
    let inputsTested = 0
    let gameKeysDispatched = false
    let stateChanges: StateChange[] = []
    let deadClicks = 0 // v25: track buttons that did nothing
    let functionalClicks = 0 // v25: track buttons that changed something

    // Create a hidden iframe
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.top = '-9999px'
    iframe.style.left = '-9999px'
    iframe.style.width = '1280px'
    iframe.style.height = '720px'
    // v25: allow-same-origin is needed so the probe can access contentDocument
    // to click buttons and check state. Without it, the sandbox blocks all access
    // and the probe silently reports "0 errors" without actually testing anything.
    iframe.sandbox = 'allow-scripts allow-same-origin'
    iframe.title = 'Probe (hidden)'

    // Listen for error messages from the iframe
    const messageHandler = (e: MessageEvent) => {
      if (e.data?.source !== 'nova-preview') return
      if (e.data.kind === 'error' && errors.length < 20) {
        errors.push(e.data.error)
      }
    }
    window.addEventListener('message', messageHandler)

    // Set a timeout — don't wait forever
    const timeout = setTimeout(() => {
      cleanup()
      resolve(buildResult())
    }, 3000)

    function cleanup() {
      clearTimeout(timeout)
      window.removeEventListener('message', messageHandler)
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }

    function buildResult(): ProbeResult {
      const errorCount = errors.length
      const stateChangeCount = stateChanges.length
      // v25: Functional score = % of clicks that changed something (0-100)
      const functionalScore = buttonsClicked > 0
        ? Math.round((functionalClicks / buttonsClicked) * 100)
        : 0
      const parts: string[] = [`${interactions} interactions`]
      if (errorCount > 0) parts.push(`${errorCount} error(s)`)
      if (stateChangeCount > 0) parts.push(`${stateChangeCount} state change(s)`)
      if (deadClicks > 0) parts.push(`${deadClicks} dead click(s)`)
      if (errorCount === 0) parts.push('0 errors')
      parts.push(`${functionalScore}% functional`)

      const summary = parts.join(', ')

      return {
        errors,
        interactions,
        buttonsClicked,
        inputsTested,
        gameKeysDispatched,
        stateChanges,
        functionalScore,
        deadClicks,
        functionalClicks,
        summary,
      }
    }

    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc) {
          cleanup()
          resolve(buildResult())
          return
        }

        // Wait a bit for the app's own scripts to initialize
        setTimeout(() => {
          try {
            // ═══ STATE CHANGE VERIFICATION ═══
            // Before clicking each button, read the DOM state of key elements.
            // After clicking, read again. If nothing changed, the button might not work.

            // Find elements that likely hold state (text content that might change)
            // v29: Added more common state selectors that LLMs actually use
            const stateSelectors = ['#counter', '#score', '#result', '#output', '#display',
                                    '.counter', '.score', '.result', '.output', '.display',
                                    '[data-state]', '#count', '#value', '#total',
                                    '#counterValue', '#counter-value', '#number', '#num',
                                    '#timer', '#time', '#elapsed', '#status', '#message',
                                    '.value', '.count', '.number', '.timer', '.time',
                                    'h1', 'h2', '.title', '.heading']
            const stateEls: { selector: string, el: Element }[] = []
            for (const sel of stateSelectors) {
              const el = doc.querySelector(sel)
              if (el) stateEls.push({ selector: sel, el })
            }

            // Click every button — with state change tracking
            // v25: Track DOM mutations (elements added/removed/changed)
            const buttons = doc.querySelectorAll('button')
            buttons.forEach((btn, i) => {
              if (i >= 10) return // Limit to 10 buttons

              // v25: Capture full DOM state before click (innerHTML hash + element count)
              const beforeHTML = doc.body?.innerHTML?.length ?? 0
              const beforeElementCount = doc.querySelectorAll('*').length
              // Also check specific state selectors
              const before = stateEls.map(s => ({ sel: s.selector, val: s.el.textContent?.trim().slice(0, 100) ?? '' }))
              // v29: Capture style/attribute state (display, className, disabled)
              const beforeStyles = stateEls.map(s => {
                const el = s.el as HTMLElement
                return {
                  display: el.style?.display ?? '',
                  className: el.className ?? '',
                  disabled: (el as HTMLButtonElement).disabled ?? false,
                }
              })
              // v29: Capture modal/overlay display states
              const beforeModals = Array.from(doc.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="dialog"], [class*="popup"]')).map(el => ({
                el: el as HTMLElement,
                display: (el as HTMLElement).style?.display ?? '',
              }))

              try {
                // v29: Dispatch full interaction sequence: mousedown → mouseup → click
                // Many apps use mousedown/mouseup instead of click (e.g., long-press support)
                const btnEl = btn as HTMLButtonElement
                try {
                  btnEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
                  btnEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }))
                } catch { /* MouseEvent may not be available */ }
                btnEl.click()
                buttonsClicked++
                interactions++

                // v25: Check if ANYTHING changed — DOM size, innerHTML, or state selectors
                const afterHTML = doc.body?.innerHTML?.length ?? 0
                const afterElementCount = doc.querySelectorAll('*').length
                const after = stateEls.map(s => ({ sel: s.selector, val: s.el.textContent?.trim().slice(0, 100) ?? '' }))

                let somethingChanged = false

                // Check state selector text changes
                for (let j = 0; j < before.length; j++) {
                  if (before[j].val !== after[j].val) {
                    stateChanges.push({
                      selector: before[j].sel,
                      before: before[j].val,
                      after: after[j].val,
                      changed: true,
                    })
                    somethingChanged = true
                  }
                }

                // v29: Check style/attribute changes (display, className, disabled)
                const afterStyles = stateEls.map(s => {
                  const el = s.el as HTMLElement
                  return {
                    display: el.style?.display ?? '',
                    className: el.className ?? '',
                    disabled: (el as HTMLButtonElement).disabled ?? false,
                  }
                })
                for (let j = 0; j < beforeStyles.length; j++) {
                  if (beforeStyles[j].display !== afterStyles[j]?.display ||
                      beforeStyles[j].className !== afterStyles[j]?.className ||
                      beforeStyles[j].disabled !== afterStyles[j]?.disabled) {
                    somethingChanged = true
                  }
                }

                // v29: Check modal display changes (display:none → display:flex means button works)
                const afterModals = beforeModals.map(m => ({
                  display: (m.el as HTMLElement).style?.display ?? '',
                }))
                for (let j = 0; j < beforeModals.length; j++) {
                  if (beforeModals[j].display !== afterModals[j]?.display) {
                    somethingChanged = true
                  }
                }

                // v25: Check DOM changes (element count or HTML length changed)
                if (afterElementCount !== beforeElementCount || Math.abs(afterHTML - beforeHTML) > 10) {
                  somethingChanged = true
                }

                if (somethingChanged) {
                  functionalClicks++
                } else {
                  deadClicks++
                }
              } catch (e) {
                errors.push({
                  type: 'click-error',
                  msg: `Button ${i} click failed: ${e instanceof Error ? e.message : String(e)}`,
                  line: 0, col: 0,
                })
              }
            })

            // Type into every input — use appropriate value based on input type
            const inputs = doc.querySelectorAll('input[type="text"], input:not([type]), textarea, input[type="email"], input[type="number"], input[type="search"]')
            inputs.forEach((input, i) => {
              if (i >= 5) return // Limit to 5 inputs
              try {
                const el = input as HTMLInputElement
                // Use appropriate test value based on input type
                const inputType = el.type || 'text'
                if (inputType === 'number') el.value = '42'
                else if (inputType === 'email') el.value = 'test@example.com'
                else if (inputType === 'search') el.value = 'test'
                else el.value = 'test input'
                el.dispatchEvent(new Event('input', { bubbles: true }))
                el.dispatchEvent(new Event('change', { bubbles: true }))
                inputsTested++
                interactions++
              } catch (e) {
                errors.push({
                  type: 'input-error',
                  msg: `Input ${i} type failed: ${e instanceof Error ? e.message : String(e)}`,
                  line: 0, col: 0,
                })
              }
            })

            // For games: dispatch arrow keys
            if (isGame) {
              try {
                const keyEvents = ['keydown', 'keyup']
                const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']
                keys.forEach(key => {
                  keyEvents.forEach(eventType => {
                    doc.dispatchEvent(new KeyboardEvent(eventType, {
                      key, bubbles: true, cancelable: true,
                    }))
                  })
                })
                gameKeysDispatched = true
                interactions += keys.length
              } catch (e) {
                errors.push({
                  type: 'key-error',
                  msg: `Key dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
                  line: 0, col: 0,
                })
              }
            }

            // Wait a bit more for async errors
            setTimeout(() => {
              // Also check the iframe's own error capture
              try {
                const iframeErrors = (iframe.contentWindow as Window & { __novaGetErrors?: () => ProbeError[] })?.__novaGetErrors?.()
                if (Array.isArray(iframeErrors)) {
                  iframeErrors.forEach((err) => {
                    if (!errors.find(e => e.msg === err.msg)) {
                      errors.push(err)
                    }
                  })
                }
              } catch {}

              cleanup()
              resolve(buildResult())
            }, 500)
          } catch (e) {
            errors.push({
              type: 'probe-error',
              msg: `Probe failed: ${e instanceof Error ? e.message : String(e)}`,
              line: 0, col: 0,
            })
            cleanup()
            resolve(buildResult())
          }
        }, 500)
      } catch (e) {
        errors.push({
          type: 'iframe-error',
          msg: `iframe access failed: ${e instanceof Error ? e.message : String(e)}`,
          line: 0, col: 0,
        })
        cleanup()
        resolve(buildResult())
      }
    }

    // Load the HTML into the iframe
    document.body.appendChild(iframe)
    iframe.srcdoc = html
  })
}

/**
 * Format probe errors into a hint string for the LLM fix call.
 */
export function formatProbeErrors(probe: ProbeResult): string {
  if (probe.errors.length === 0) return ''

  const lines = probe.errors.map((err, i) => {
    const location = err.line ? ` (line ${err.line}:${err.col})` : ''
    const stack = err.stack ? `\n  Stack: ${err.stack.slice(0, 200)}` : ''
    return `${i + 1}. [${err.type}]${location}: ${err.msg}${stack}`
  })

  return `Runtime errors found when testing the app (${probe.interactions} interactions performed):\n${lines.join('\n')}`
}
