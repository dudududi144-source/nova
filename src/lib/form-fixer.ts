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

  // v27: Inject save/cancel button handlers for modals
  // The LLM creates Save/Cancel buttons in modals but they often don't work
  // because the onclick handler is missing or broken.
  const hasModal = /class="modal"|id="[^"]*Modal"|data-modal/i.test(result)
  if (hasModal) {
    const buttonFix = `
<script>
// v27: Auto-injected save/cancel button handlers
(function() {
  document.querySelectorAll('button').forEach(function(btn) {
    var text = (btn.textContent || '').toLowerCase().trim();
    var isSaveBtn = text.includes('save') || text.includes('create') || text.includes('add task') || text.includes('submit');
    var isCancelBtn = text === 'cancel' || text === 'close' || text === '×' || text === '✕' || text.includes('dismiss');

    if (isSaveBtn || isCancelBtn) {
      // Clone to remove existing listeners
      var newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (isSaveBtn) {
          // Try to call common save functions
          var saveFns = ['saveTask', 'addTask', 'createTask', 'addItem', 'addTodo', 'addNote',
                         'saveNote', 'createNote', 'handleSave', 'handleSubmit', 'submitTask'];
          var called = false;
          for (var i = 0; i < saveFns.length; i++) {
            if (typeof window[saveFns[i]] === 'function') {
              try {
                window[saveFns[i]]();
                called = true;
                break;
              } catch(err) {
                try {
                  var input = newBtn.closest('form, .modal, [class*="modal"], [id*="Modal"]')
                    .querySelector('input[type="text"], input:not([type]), textarea');
                  if (input && input.value.trim()) {
                    window[saveFns[i]](input.value.trim());
                    called = true;
                    break;
                  }
                } catch(e2) {}
              }
            }
          }
          // If no function found, try onclick
          if (!called && newBtn.getAttribute('onclick')) {
            try { newBtn.onclick(); } catch(e3) {}
          }
        }

        // Close the modal after save or cancel
        setTimeout(function() {
          var modal = newBtn.closest('[class*="modal"], [id*="Modal"], [data-modal]');
          if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('show', 'active', 'open');
          }
          var backdrop = document.querySelector('.modal-backdrop, [data-backdrop], .overlay');
          if (backdrop) {
            backdrop.style.display = 'none';
            backdrop.classList.remove('show');
          }
        }, 50);
      });
    }
  });
})();
</script>`

    const bodyClose2 = result.match(/<\/body>/i)
    if (bodyClose2) {
      result = result.replace(/<\/body>/i, buttonFix + '\n</body>')
      fixesApplied++
      logger.info('postfix.form', { fix: 'Injected save/cancel button handlers' })
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
