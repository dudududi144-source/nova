// Runtime error capture script — injected into the preview iframe.
//
// This script captures JavaScript errors, unhandled promise rejections, and console.error
// calls, then sends them to the parent window via postMessage. The parent (NOVA UI) listens
// for these messages and can feed them back to the LLM for auto-fixing.
//
// This is the single most important quality improvement: it converts invisible runtime
// failures into line-numbered fix instructions. Without this, NOVA ships "Potemkin
// interfaces" — apps that look right but don't work.
//
// The script is injected BEFORE the app's own <script> tags, so it catches errors from
// the very beginning. It's designed to be minimal — no external dependencies, no DOM
// manipulation, just error capture and reporting.

export const RUNTIME_ERROR_SCRIPT = `<script>
(function() {
  var errors = [];
  var MAX_ERRORS = 20;

  function sendError(type, msg, line, col, stack) {
    if (errors.length >= MAX_ERRORS) return;
    var err = { type: type, msg: String(msg).slice(0, 1000), line: 0, col: 0, stack: stack ? String(stack).slice(0, 2000) : undefined };
    errors.push(err);
    try {
      parent.postMessage({ source: 'nova-preview', kind: 'error', error: err }, '*');
    } catch (e) { /* parent may be gone */ }
  }

  // Capture uncaught errors
  // NOTE: line/col numbers are unreliable because design tokens + CSP + this script
  // are injected before the app's code, shifting line numbers by ~140 lines.
  // We set line/col to 0 and rely on the error message + stack trace instead.
  window.addEventListener('error', function(e) {
    sendError('error', e.message, 0, 0, e.error && e.error.stack);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason;
    if (msg && msg.message) msg = msg.message;
    sendError('promise', msg, 0, 0, e.reason && e.reason.stack);
  });

  // Capture console.error — many apps log errors instead of throwing
  var origConsoleError = console.error;
  console.error = function() {
    var args = Array.prototype.slice.call(arguments);
    var msg = args.map(function(a) {
      if (a && a.stack) return a.stack;
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch (e) { return String(a); }
    }).join(' ');
    sendError('console.error', msg, 0, 0);
    origConsoleError.apply(console, args);
  };

  // Signal that the error capture is ready
  try {
    parent.postMessage({ source: 'nova-preview', kind: 'ready', errorCount: 0 }, '*');
  } catch (e) {}

  // Expose a function for the interaction probe to call
  window.__novaGetErrors = function() { return errors; };
  window.__novaClearErrors = function() { errors = []; };
})();
</script>`

/**
 * Inject the runtime error capture script into HTML, right after <head>.
 * This ensures it runs before the app's own scripts.
 */
export function injectRuntimeErrorCapture(html: string): string {
  // Don't inject twice
  if (html.includes('__novaGetErrors')) return html

  // Inject right after <head> tag (or after <html> if no <head>)
  const headMatch = html.match(/<head[^>]*>/i)
  if (headMatch) {
    return html.replace(/<head[^>]*>/i, `${headMatch[0]}\n${RUNTIME_ERROR_SCRIPT}`)
  }
  const htmlTagMatch = html.match(/<html[^>]*>/i)
  if (htmlTagMatch) {
    return html.replace(/<html[^>]*>/i, `${htmlTagMatch[0]}<head>${RUNTIME_ERROR_SCRIPT}</head>`)
  }
  return `${RUNTIME_ERROR_SCRIPT}\n${html}`
}
