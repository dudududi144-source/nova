// Static Analysis Engine — catches real bugs in generated HTML BEFORE the user sees them.
//
// This runs on the SERVER, in <1ms, with no iframe needed. It catches:
// 1. getElementById() calls referencing IDs that don't exist in the HTML
// 2. addEventListener() referencing functions that aren't defined
// 3. Function calls to undefined functions
// 4. Variable assignments without declaration (missing let/const/var)
//
// This is NOVA's "pre-flight check" — bugs found here are fed to the LLM
// as targeted retry hints, before the result reaches the client.

export interface StaticAnalysisIssue {
  type: 'missing-id' | 'undefined-function' | 'undeclared-variable' | 'undefined-call'
  severity: 'error' | 'warning'
  message: string
  detail: string
  fixHint: string
}

export interface StaticAnalysisResult {
  issues: StaticAnalysisIssue[]
  passed: boolean
  summary: string
}

/**
 * Run static analysis on generated HTML.
 * Extracts all JS from <script> tags and checks for common bugs.
 *
 * @param html The complete HTML document
 * @returns StaticAnalysisResult with issues found and pass/fail status
 */
export function analyzeHtml(html: string): StaticAnalysisResult {
  const issues: StaticAnalysisIssue[] = []

  // 1. Extract all IDs defined in HTML (id="foo", id='foo', id=foo)
  const definedIds = new Set<string>()
  const idMatches = html.matchAll(/\sid=["']?([^"'\s>]+)["']?/g)
  for (const m of idMatches) {
    if (m[1] && m[1].length > 0) definedIds.add(m[1])
  }

  // 2. Extract all <script> content (inline JS)
  const scriptContents: string[] = []
  const scriptMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)
  for (const m of scriptMatches) {
    if (m[1] && m[1].trim()) scriptContents.push(m[1])
  }
  const js = scriptContents.join('\n')

  if (!js.trim()) {
    // v29.36: Even without <script>, check onclick handlers — they might reference
    // undefined functions that the LLM forgot to define
    const issues: StaticAnalysisIssue[] = []
    const eventAttrMatches = html.matchAll(/\son(?:click|change|input|submit|load|keydown|keyup|keypress|mouseover|mouseout|focus|blur)\s*=\s*["']([^"']+)["']/gi)
    for (const m of eventAttrMatches) {
      const handlerCode = m[1]
      const fnCallsInAttr = handlerCode.matchAll(/(?<!\.)\b(\w+)\s*\(/g)
      for (const fc of fnCallsInAttr) {
        const fnName = fc[1]
        if (BUILTIN_FUNCTIONS.has(fnName) || CONTROL_FLOW.has(fnName)) continue
        issues.push({
          type: 'undefined-function',
          severity: 'error',
          message: `onclick handler calls '${fnName}()' — function is not defined`,
          detail: `An HTML event handler calls function '${fnName}()', but there is no <script> section defining it.`,
          fixHint: `Add a <script> section with function '${fnName}()'.`,
        })
      }
    }
    return {
      issues,
      passed: issues.length === 0,
      summary: issues.length > 0
        ? `${issues.length} issue(s) in event handlers (no script section)`
        : 'No JavaScript found (static analysis skipped)',
    }
  }

  // 3. Extract all defined functions (function foo() {...} and const foo = () => {...})
  const definedFunctions = new Set<string>()
  // function declarations
  const fnDecls = js.matchAll(/function\s+(\w+)\s*\(/g)
  for (const m of fnDecls) definedFunctions.add(m[1])
  // const/let/var function expressions
  const fnExprs = js.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)/g)
  for (const m of fnExprs) definedFunctions.add(m[1])
  // object methods (obj.method = function, { method() {} })
  const objMethods = js.matchAll(/(?:^|\.)\s*(\w+)\s*=\s*function/gm)
  for (const m of objMethods) definedFunctions.add(m[1])

  // 3b. Extract object/class method names to avoid false positives on method calls
  const knownMethodNames = new Set<string>()
  // Object literal methods: { methodName() { ... } }
  const objLiteralMethods = js.matchAll(/[{,]\s*(\w+)\s*\(\s*\)\s*\{/g)
  for (const m of objLiteralMethods) knownMethodNames.add(m[1])
  // Class methods: extract class body with brace matching (not lazy regex)
  let classStart = 0
  while ((classStart = js.indexOf('class ', classStart)) !== -1) {
    const braceStart = js.indexOf('{', classStart)
    if (braceStart === -1) break
    // Find matching closing brace
    let depth = 1
    let pos = braceStart + 1
    while (depth > 0 && pos < js.length) {
      if (js[pos] === '{') depth++
      else if (js[pos] === '}') depth--
      pos++
    }
    const classBody = js.slice(braceStart + 1, pos - 1)
    const methods = classBody.matchAll(/(\w+)\s*\(\s*\)\s*\{/g)
    for (const m of methods) knownMethodNames.add(m[1])
    classStart = pos
  }
  // this.methodName assignments: this.method = function
  const thisMethods = js.matchAll(/this\.(\w+)\s*=\s*(?:function|\()/g)
  for (const m of thisMethods) knownMethodNames.add(m[1])

  // 4. Extract all declared variables (let/const/var)
  const declaredVars = new Set<string>()
  const varDecls = js.matchAll(/(?:let|const|var)\s+(\w+)/g)
  for (const m of varDecls) declaredVars.add(m[1])

  // 5. Check getElementById calls
  const getByIdCalls = js.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)
  for (const m of getByIdCalls) {
    const id = m[1]
    if (!definedIds.has(id)) {
      // Check for close matches (typos)
      const closeMatch = findCloseMatch(id, definedIds)
      issues.push({
        type: 'missing-id',
        severity: 'error',
        message: `getElementById('${id}') — element with id="${id}" does not exist in HTML`,
        detail: `The JavaScript tries to access an element by ID '${id}', but no HTML element has that ID.`,
        fixHint: closeMatch
          ? `Did you mean '${closeMatch}'? Similar ID found in HTML.`
          : `Add id="${id}" to an HTML element, or fix the ID name in JavaScript.`,
      })
    }
  }

  // 6. Check addEventListener function references
  const listenerMatches = js.matchAll(/addEventListener\(\s*["']([^"']+)["']\s*,\s*(\w+)\)/g)
  for (const m of listenerMatches) {
    const fnName = m[2]
    if (!definedFunctions.has(fnName) && !BUILTIN_FUNCTIONS.has(fnName)) {
      issues.push({
        type: 'undefined-function',
        severity: 'error',
        message: `addEventListener('${m[1]}', ${fnName}) — function '${fnName}' is not defined`,
        detail: `An event listener references function '${fnName}', but no function with that name is defined in the script.`,
        fixHint: `Define function '${fnName}()' or fix the function name.`,
      })
    }
  }

  // v29.36: Check onclick/onchange/oninput/onsubmit event handlers in HTML attributes
  // The LLM writes onclick="foo()" — if foo() is not defined, the button is dead
  const eventAttrMatches = html.matchAll(/\son(?:click|change|input|submit|load|keydown|keyup|keypress|mouseover|mouseout|focus|blur)\s*=\s*["']([^"']+)["']/gi)
  for (const m of eventAttrMatches) {
    // Extract function names from the attribute value
    const handlerCode = m[1]
    const fnCallsInAttr = handlerCode.matchAll(/(?<!\.)\b(\w+)\s*\(/g)
    for (const fc of fnCallsInAttr) {
      const fnName = fc[1]
      // Skip control flow and builtins
      if (BUILTIN_FUNCTIONS.has(fnName) || CONTROL_FLOW.has(fnName)) continue
      // Skip if defined
      if (definedFunctions.has(fnName) || declaredVars.has(fnName)) continue
      // Skip known methods
      if (knownMethodNames.has(fnName)) continue
      issues.push({
        type: 'undefined-function',
        severity: 'error',
        message: `onclick handler calls '${fnName}()' — function is not defined`,
        detail: `An HTML event handler (onclick/onchange/etc.) calls function '${fnName}()', but no function with that name is defined in the script.`,
        fixHint: `Define function '${fnName}()' in the <script> section.`,
      })
    }
  }

  // 7. Check function calls to undefined functions
  // v29.55: Strip strings first to prevent CSS functions in strings
  // ('var(--color)', 'rgba(0,0,0,0.3)') from being mistaken for JS calls
  const jsNoStrings = stripStrings(js)
  // Extract all function calls: foo() — but skip builtins, control flow, method calls, and declarations
  const fnCalls = jsNoStrings.matchAll(/(?<!\.)\b(\w+)\s*\(/g)
  const checkedCalls = new Set<string>()
  for (const m of fnCalls) {
    const fnName = m[1]
    // Skip builtins, control flow, and already-checked
    if (BUILTIN_FUNCTIONS.has(fnName) || CONTROL_FLOW.has(fnName) || checkedCalls.has(fnName)) continue
    checkedCalls.add(fnName)

    // Skip if it's a defined function or declared variable
    if (definedFunctions.has(fnName) || declaredVars.has(fnName)) continue

    // Skip if it's a known object/class method name
    if (knownMethodNames.has(fnName)) continue

    // Skip if it looks like a method call (preceded by .)
    const callPos = m.index ?? 0
    if (callPos > 0 && js[callPos - 1] === '.') continue

    // Skip object property definitions (obj: foo())
    if (callPos > 0 && js[callPos - 1] === ':') continue

    // Skip if preceded by 'function' (function declaration)
    const before = js.slice(Math.max(0, callPos - 12), callPos)
    if (before.includes('function ')) continue

    // Skip anonymous function expressions: 'function(' or 'function ('
    if (fnName === 'function') continue

    // Skip 'new ClassName()' — constructor calls, not function calls
    if (callPos >= 4 && js.slice(callPos - 4, callPos) === 'new ') continue

    // Skip class method definitions inside class body: 'methodName() {'
    // Check if the call is followed by '{' (definition, not call)
    const afterCall = js.slice(callPos + fnName.length, callPos + fnName.length + 20)
    if (afterCall.match(/^\s*\)/) && afterCall.slice(1).match(/^\s*\{/)) continue // 'methodName() {'

    // Only report as warning — could be a global function we can't see
    issues.push({
      type: 'undefined-call',
      severity: 'warning',
      message: `'${fnName}()' is called but not defined in the script`,
      detail: `Function '${fnName}' is called but no definition found. It may be a built-in or defined elsewhere.`,
      fixHint: `Define '${fnName}()' or verify it's a valid built-in function.`,
    })
  }

  // 8. Check for undeclared variable assignments
  // v29.55: Use jsNoStrings to prevent HTML attributes in template literals
  // (onclick="foo()") from being mistaken for variable assignments
  // v29.70: Also extract function parameters — assigning to a parameter
  // is valid (e.g., function filterItems(query) { query = query.trim(); })
  const functionParams = new Set<string>()
  // Match function declarations: function name(params)
  for (const pm of js.matchAll(/function\s+\w+\s*\(([^)]*)\)/g)) {
    for (const p of pm[1].split(',')) {
      const trimmed = p.trim().split('=')[0].trim()
      if (trimmed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
        functionParams.add(trimmed)
      }
    }
  }
  // Match arrow functions: (params) => {  (must have => to distinguish from if/for/while)
  for (const pm of js.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const p of pm[1].split(',')) {
      const trimmed = p.trim().split('=')[0].trim()
      if (trimmed && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
        functionParams.add(trimmed)
      }
    }
  }
  // Match: identifier = value (but not ==, ===, !=, !==, <=, >=)
  const assignmentMatches = jsNoStrings.matchAll(/^\s*(\w+)\s*=[^=]/gm)
  for (const m of assignmentMatches) {
    const varName = m[1]
    // Skip builtins, declared vars, function params, and common globals
    if (declaredVars.has(varName) || definedFunctions.has(varName)) continue
    if (functionParams.has(varName)) continue // v29.70: function parameters are valid
    if (BUILTIN_GLOBALS.has(varName) || JS_KEYWORDS.has(varName)) continue

    // Check if it's declared elsewhere (let/const/var x)
    const declaredElsewhere = js.includes(`let ${varName}`) || js.includes(`const ${varName}`) || js.includes(`var ${varName}`)
    if (declaredElsewhere) continue

    issues.push({
      type: 'undeclared-variable',
      severity: 'warning',
      message: `'${varName}' is assigned but never declared with let/const/var`,
      detail: `Variable '${varName}' is assigned a value without being declared. This creates an implicit global.`,
      fixHint: `Add 'let ${varName}' or 'const ${varName}' before the assignment.`,
    })
  }

  // Deduplicate issues
  const seen = new Set<string>()
  const uniqueIssues = issues.filter(i => {
    const key = `${i.type}:${i.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const errors = uniqueIssues.filter(i => i.severity === 'error')
  const warnings = uniqueIssues.filter(i => i.severity === 'warning')
  const passed = errors.length === 0

  const summary = errors.length === 0 && warnings.length === 0
    ? 'Static analysis passed — no issues found'
    : `${errors.length} error(s), ${warnings.length} warning(s)`

  return {
    issues: uniqueIssues,
    passed,
    summary,
  }
}

/**
 * Strip string literals and template literals from JavaScript code.
 * Replaces them with empty strings to prevent false positives in
 * function-call and variable-assignment checks.
 *
 * v29.55: Without this, CSS functions in strings ('var(--color)',
 * 'rgba(0,0,0,0.3)') and HTML attributes in template literals
 * (onclick="foo()") are mistaken for JS function calls and assignments.
 */
function stripStrings(js: string): string {
  // v29.69: Also strip comments — they can contain function-like patterns
  // e.g. "// Auto-injected save/cancel button handlers" → "handlers()" false positive
  // Remove single-line comments (// ...) — but not URLs (https://)
  let result = js.replace(/(^|[^:])\/\/.*$/gm, '$1')
  // Remove multi-line comments (/* ... */)
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove template literals (backtick strings) — these often contain
  // HTML with onclick= attributes that look like variable assignments
  result = result.replace(/`[^`]*`/g, '""')
  // Remove single-quoted strings
  result = result.replace(/'[^']*'/g, '""')
  // Remove double-quoted strings
  result = result.replace(/"[^"]*"/g, '""')
  return result
}

/**
 * Find the closest matching string from a set (simple Levenshtein distance).
 * Used to suggest "did you mean?" for typos in getElementById.
 */
function findCloseMatch(target: string, candidates: Set<string>): string | null {
  let best: string | null = null
  let bestDist = Infinity

  for (const candidate of candidates) {
    const dist = levenshtein(target, candidate)
    // Only suggest if distance is small (1-2 edits) and lengths are similar
    if (dist < bestDist && dist <= 2 && Math.abs(target.length - candidate.length) <= 2) {
      bestDist = dist
      best = candidate
    }
  }

  return best
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

// Built-in functions that don't need to be defined in the script
const BUILTIN_FUNCTIONS = new Set([
  'console', 'log', 'error', 'warn', 'info', 'debug',
  'document', 'window', 'alert', 'confirm', 'prompt',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'JSON', 'String', 'Number', 'Boolean', 'Array', 'Object',
  'Math', 'Date', 'RegExp', 'Error',
  'fetch', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'addEventListener', 'removeEventListener', 'querySelector', 'querySelectorAll',
  'getElementById', 'getElementsByClassName', 'getElementsByTagName',
  'createElement', 'createTextNode', 'createDocumentFragment',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'eval', 'Function', 'Symbol', 'Proxy', 'Reflect',
  'structuredClone', 'crypto', 'performance', 'localStorage', 'sessionStorage',
  // v29.56: Add more browser APIs that LLMs commonly use
  'getComputedStyle', 'getSelection', 'getBoundingClientRect',
  'scrollTo', 'scrollIntoView', 'scrollBy', 'focus', 'blur', 'click', 'select',
  'getContext', 'drawImage', 'fillRect', 'strokeRect', 'clearRect',
  'beginPath', 'moveTo', 'lineTo', 'arc', 'fill', 'stroke', 'closePath',
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform',
  'fillText', 'strokeText', 'measureText',
  'createLinearGradient', 'createRadialGradient', 'addColorStop',
  'drawCanvas', 'putImageData', 'getImageData', 'createImageData',
  'toDataURL', 'toBlob', 'transferControlToOffscreen',
  'requestPointerLock', 'exitPointerLock',
  'postMessage', 'setTimeout', 'setInterval',
  'open', 'close', 'stop', 'print', 'scroll', 'atob', 'btoa',
  'URL', 'URLSearchParams', 'FormData', 'Headers', 'Request', 'Response',
  'WebSocket', 'EventSource', 'XMLHttpRequest', 'AbortController',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'TouchEvent',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'history', 'location', 'navigator', 'screen', 'visualViewport',
])

// Control flow keywords that look like function calls
const CONTROL_FLOW = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return',
  'throw', 'try', 'catch', 'finally', 'new', 'typeof', 'instanceof',
  'void', 'delete', 'in', 'of', 'await', 'async', 'yield',
])

// Built-in global variables
const BUILTIN_GLOBALS = new Set([
  'document', 'window', 'console', 'navigator', 'location', 'history',
  'screen', 'performance', 'crypto', 'indexedDB', 'localStorage', 'sessionStorage',
  'this', 'self', 'globalThis', 'top', 'parent', 'frames',
  'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
  'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset',
  'event', 'arguments', 'module', 'exports', 'require', 'process',
  'undefined', 'NaN', 'Infinity', 'globalThis',
])

// JS keywords that shouldn't be flagged as variables
const JS_KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
  'this', 'arguments', 'class', 'extends', 'super', 'import', 'export',
  'default', 'from', 'as', 'static', 'get', 'set', 'async', 'await',
])
