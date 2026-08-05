// Pure HTML utility functions — no LLM dependencies.
//
// These are separated from llm.ts so that mocking the LLM module
// (for route tests) does NOT break these pure functions.
//
// All functions here are synchronous, side-effect-free, and testable
// in isolation without any module mocking concerns.

/**
 * Strip markdown code fences from LLM output.
 * Handles: ```html, ```, 4+ backtick fences, empty first block, whitespace,
 * and any language identifier (javascript, css, etc. — not just html/htm).
 * v29: Also handles file path identifiers like ```file:server_config.json
 *      and ```file:src/App.tsx — the LLM uses these for multi-file output.
 * Returns the first non-empty fence block, or the trimmed text if no fences.
 */
export function stripCodeFences(text: string): string {
  // Find all fence blocks. Allow any language identifier (or none).
  // Handles 3+ backticks (``` or ```` or more).
  // v10.3: Also handles prose before/after fences (Qwen adds explanations)
  // v29: Extended character class to allow `:`, `.`, `/` for file:path identifiers
  const fenceRegex = /`{3,}\s*[a-zA-Z0-9_:/.\-]*\s*\n?([\s\S]*?)\n?`{3,}/g
  let match
  while ((match = fenceRegex.exec(text)) !== null) {
    const content = match[1].trim()
    if (content) return content
  }
  // v10.3: No fences found — try to extract HTML directly from prose
  // Look for <!DOCTYPE or <html anywhere in the text
  const htmlStart = text.search(/<!DOCTYPE\s+html/i)
  if (htmlStart >= 0) {
    const htmlEnd = text.search(/<\/html>\s*$/i)
    if (htmlEnd >= 0) {
      return text.slice(htmlStart, htmlEnd + 7).trim()
    }
    return text.slice(htmlStart).trim()
  }
  return text.trim()
}

/**
 * Check if text looks like a complete HTML document.
 * Must start (after optional whitespace) with <!doctype or <html>.
 * Rejects HTML fragments, conversational text, JSON, markdown.
 */
export function looksLikeHtml(text: string): boolean {
  // Strip UTF-8 BOM (\uFEFF) and leading HTML comments — some LLMs prepend them
  // despite instructions not to. Without this, a leading <!-- comment --> causes
  // the build to fail with "invalid output" even though the HTML is fine.
  const lower = text
    .replace(/^\uFEFF/, '')
    .replace(/^<!--[\s\S]*?-->\s*/i, '')
    .trimStart()
    .toLowerCase()
  return lower.startsWith('<!doctype') || lower.startsWith('<html')
}

/**
 * Content-Security-Policy for preview iframes.
 * Blocks all external network requests (fetch, XHR, websocket, img, script).
 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'unsafe-inline' data:",
  "font-src 'unsafe-inline' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * Inject a CSP meta tag into the HTML <head>.
 * - If a CSP meta already exists (case-insensitive), don't override it.
 * - If there's no <head>, inject one after <html>.
 * - If there's no <html>, prepend the meta.
 */
export function injectCsp(html: string): string {
  // SECURITY: Always strip any existing CSP meta tags the LLM may have emitted.
  // If we respected an existing CSP, the LLM could ship a permissive one (e.g.,
  // default-src *) and bypass NOVA's lockdown CSP. Always enforce our CSP.
  const stripped = html.replace(/<meta\s+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
  // Match <head> or <head ...> but NOT <header> — use lookahead to ensure the next char
  // is whitespace or '>'. Without this, /<head[^>]*>/i matches <header> too.
  const headMatch = stripped.match(/<head(?=[\s>])[^>]*>/i)
  if (headMatch) {
    return stripped.replace(/<head(?=[\s>])[^>]*>/i, `${headMatch[0]}\n${cspMeta}`)
  }
  const htmlTagMatch = stripped.match(/<html[^>]*>/i)
  if (htmlTagMatch) {
    return stripped.replace(/<html[^>]*>/i, `${htmlTagMatch[0]}<head>${cspMeta}</head>`)
  }
  return `${cspMeta}\n${stripped}`
}

/**
 * v26: Strip blocked APIs from generated HTML.
 * The LLM sometimes uses localStorage/sessionStorage/cookies despite instructions.
 * This post-processing step removes them so the app doesn't crash.
 * Replaces with in-memory Map equivalents where possible.
 */
export function stripBlockedAPIs(html: string): string {
  // Replace localStorage.getItem('key') with null (simulates empty storage)
  // Replace localStorage.setItem('key', val) with nothing (no-op)
  // Replace localStorage.removeItem('key') with nothing
  let result = html

  // Replace localStorage usage with a polyfill that uses in-memory Map
  const polyfill = `
<script>
// v26: In-memory polyfill for localStorage (blocked in sandbox)
(function() {
  var _store = {};
  var _localStorage = {
    getItem: function(k) { return _store[k] !== undefined ? _store[k] : null; },
    setItem: function(k, v) { _store[k] = String(v); },
    removeItem: function(k) { delete _store[k]; },
    clear: function() { _store = {}; },
    key: function(i) { return Object.keys(_store)[i] || null; },
    get length() { return Object.keys(_store).length; }
  };
  try {
    Object.defineProperty(window, 'localStorage', { value: _localStorage, writable: false, configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: _localStorage, writable: false, configurable: true });
  } catch(e) {}
})();
</script>`

  // Inject polyfill right after <head>, or after <html>, or at the start
  const headMatch = result.match(/<head[^>]*>/i)
  if (headMatch) {
    result = result.replace(/<head[^>]*>/i, headMatch[0] + polyfill)
  } else {
    const htmlMatch = result.match(/<html[^>]*>/i)
    if (htmlMatch) {
      result = result.replace(/<html[^>]*>/i, htmlMatch[0] + polyfill)
    } else {
      result = polyfill + result
    }
  }

  return result
}
