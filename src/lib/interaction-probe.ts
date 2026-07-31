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
  summary: string
}

export interface ProbeError {
  type: string  // 'error' | 'promise' | 'console.error'
  msg: string
  line: number
  col: number
  stack?: string
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

    // Create a hidden iframe
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.top = '-9999px'
    iframe.style.left = '-9999px'
    iframe.style.width = '1280px'
    iframe.style.height = '720px'
    iframe.sandbox = 'allow-scripts'
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
      const summary = errors.length === 0
        ? `${interactions} interactions, 0 errors`
        : `${interactions} interactions, ${errors.length} error(s)`

      return {
        errors,
        interactions,
        buttonsClicked,
        inputsTested,
        gameKeysDispatched,
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
            // Click every button
            const buttons = doc.querySelectorAll('button')
            buttons.forEach((btn, i) => {
              if (i >= 10) return // Limit to 10 buttons
              try {
                (btn as HTMLButtonElement).click()
                buttonsClicked++
                interactions++
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
                const iframeErrors = (iframe.contentWindow as any)?.__novaGetErrors?.()
                if (Array.isArray(iframeErrors)) {
                  iframeErrors.forEach((err: ProbeError) => {
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
