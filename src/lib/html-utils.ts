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
 * Returns the first non-empty fence block, or the trimmed text if no fences.
 */
export function stripCodeFences(text: string): string {
  // Find all fence blocks. Allow any language identifier (or none).
  // Handles 3+ backticks (``` or ```` or more).
  // Language identifier is matched permissively: [a-zA-Z0-9_-]*
  const fenceRegex = /`{3,}\s*[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?`{3,}/g
  let match
  while ((match = fenceRegex.exec(text)) !== null) {
    const content = match[1].trim()
    if (content) return content
  }
  return text.trim()
}

/**
 * Check if text looks like a complete HTML document.
 * Must start (after optional whitespace) with <!doctype or <html>.
 * Rejects HTML fragments, conversational text, JSON, markdown.
 */
export function looksLikeHtml(text: string): boolean {
  // Strip UTF-8 BOM (\uFEFF) if present — some proxies/LLMs prepend it.
  const lower = text.replace(/^\uFEFF/, '').trimStart().toLowerCase()
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
  if (/<meta\s+http-equiv=["']?content-security-policy["']?/i.test(html)) {
    return html
  }
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
  // Match <head> or <head ...> but NOT <header> — use lookahead to ensure the next char
  // is whitespace or '>'. Without this, /<head[^>]*>/i matches <header> too.
  const headMatch = html.match(/<head(?=[\s>])[^>]*>/i)
  if (headMatch) {
    return html.replace(/<head(?=[\s>])[^>]*>/i, `${headMatch[0]}\n${cspMeta}`)
  }
  const htmlTagMatch = html.match(/<html[^>]*>/i)
  if (htmlTagMatch) {
    return html.replace(/<html[^>]*>/i, `${htmlTagMatch[0]}<head>${cspMeta}</head>`)
  }
  return `${cspMeta}\n${html}`
}
