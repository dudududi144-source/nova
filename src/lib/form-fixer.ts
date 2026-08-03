// v27: Form fixer — post-processing that ensures forms work correctly.
// The LLM often creates <form> elements but forgets to:
// 1. Call preventDefault on submit
// 2. Wire the submit handler
// 3. Clear the input after adding
//
// This module scans the HTML and injects fixes for common form issues.

import { logger } from './logger'

/**
 * Fix common form issues in generated HTML.
 * Returns the fixed HTML.
 */
export function fixForms(html: string): string {
  let result = html
  let fixesApplied = 0

  // Extract all script content
  const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []
  const scriptText = scriptMatch.map(s => s.replace(/<\/?script[^>]*>/gi, '')).join('\n')

  // 1. Check if there are <form> elements without submit handlers
  const formCount = (html.match(/<form[^>]*>/gi) || []).length
  if (formCount === 0) return result

  // 2. Check if any form has a submit listener
  const hasSubmitListener = /addEventListener\s*\(\s*['"]submit['"]/.test(scriptText)

  if (!hasSubmitListener && formCount > 0) {
    // Inject a generic form submit handler that:
    // - Prevents default navigation
    // - Finds the first input and passes its value to addTask/addItem function
    // - Clears the input after
    const formFix = `
<script>
// v27: Auto-injected form submit handler
(function() {
  document.querySelectorAll('form').forEach(function(form) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      // Find the first text input in this form
      var input = form.querySelector('input[type="text"], input:not([type]), textarea');
      if (!input) return;
      var value = input.value.trim();
      if (!value) return;

      // Try to call common add functions
      var addFns = ['addTask', 'addItem', 'addTodo', 'addNote', 'createTask', 'handleAdd', 'submitTask', 'handleSubmit'];
      var called = false;
      for (var i = 0; i < addFns.length; i++) {
        if (typeof window[addFns[i]] === 'function') {
          try {
            window[addFns[i]](value);
            called = true;
            break;
          } catch(err) {
            console.error('Form fix: ' + addFns[i] + ' failed:', err);
          }
        }
      }

      // If no add function found, try to find a button with onclick and click it
      if (!called) {
        var btn = form.querySelector('button[type="submit"], button:not([type])');
        if (btn && btn.onclick) {
          btn.onclick();
        }
      }

      // Clear the input
      input.value = '';
      input.focus();
    });
  });
})();
</script>`

    // Inject before </body>
    const bodyClose = result.match(/<\/body>/i)
    if (bodyClose) {
      result = result.replace(/<\/body>/i, formFix + '\n</body>')
      fixesApplied++
      logger.info('postfix.form', { fix: 'Injected submit handler for form(s)' })
    }
  }

  // 3. Check for buttons inside forms that don't have type="button"
  // A <button> inside a <form> without type="button" defaults to type="submit"
  // which can cause unexpected form submissions
  if (/<button(?![^>]*type=)/i.test(result)) {
    // Add type="button" to buttons that don't have a type attribute
    // but ONLY if they're not inside a form context that expects submit
    // This is tricky — only fix buttons with onclick handlers
    result = result.replace(/<button(?![^>]*type=)([^>]*onclick=[^>]*)>/gi, '<button type="button"$1>')
    if (result !== html) {
      fixesApplied++
      logger.info('postfix.form', { fix: 'Added type="button" to buttons with onclick' })
    }
  }

  if (fixesApplied > 0) {
    logger.info('postfix.forms_applied', { count: fixesApplied })
  }

  return result
}
