// v27: CSS fixer — fixes common CSS issues in generated apps.
// The LLM often creates modals with broken positioning (covering the whole page)
// or buttons with position:fixed that block all clicks.

import { logger } from './logger'

/**
 * Fix common CSS issues in generated HTML.
 */
export function fixCss(html: string): string {
  let result = html
  let fixesApplied = 0

  // 1. Fix modal CSS: ensure modals are hidden by default and positioned correctly
  // The LLM often creates modals with display:block or position:fixed that cover everything
  const modalFix = `
<style>
/* v27: Auto-injected modal fixes */
[data-modal], .modal, #addTaskModal, #addNoteModal, #editModal, #modal {
  display: none !important;
  position: fixed !important;
  top: 50% !important;
  left: 50% !important;
  transform: translate(-50%, -50%) !important;
  z-index: 1000 !important;
  max-width: 90vw !important;
  max-height: 90vh !important;
  overflow-y: auto !important;
  background: var(--color-card, #1e293b) !important;
  border-radius: 12px !important;
  padding: 24px !important;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5) !important;
}
[data-modal].show, .modal.show, .modal.active, [data-modal].active,
#addTaskModal.show, #addNoteModal.show, #editModal.show,
#addTaskModal.active, #addNoteModal.active, #editModal.active {
  display: flex !important;
  flex-direction: column !important;
  gap: 16px !important;
}
/* Backdrop for modals */
.modal-backdrop, [data-backdrop] {
  display: none;
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.6);
  z-index: 999;
}
.modal-backdrop.show, [data-backdrop].show {
  display: block;
}
/* Fix buttons that accidentally cover the page */
button[style*="position: fixed"],
button[style*="position:fixed"] {
  position: relative !important;
}
</style>`

  // Check if there are modal-like elements
  const hasModal = /id="addTaskModal"|id="addNoteModal"|id="editModal"|class="modal"|data-modal/i.test(result)
  if (hasModal) {
    const headMatch = result.match(/<\/head>/i)
    if (headMatch) {
      result = result.replace(/<\/head>/i, modalFix + '\n</head>')
      fixesApplied++
      logger.info('postfix.css', { fix: 'Injected modal CSS fixes' })
    }
  }

  // 2. Fix search inputs: ensure they have proper event listeners
  // The LLM often uses 'change' event instead of 'input' event for search
  // We can't fix the JS directly, but we can add an input listener
  const hasSearch = /type="search"|placeholder="[^"]*search/i.test(result)
  const scriptText = (result.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [])
    .map(s => s.replace(/<\/?script[^>]*>/gi, '')).join('\n')
  const hasInputListener = /addEventListener\s*\(\s*['"]input['"]/.test(scriptText)

  // v27: Always inject search handler — even if LLM created one, it may not work.
  // Our handler is a catch-all that filters any list-like elements.
  if (hasSearch) {
    const searchFix = `
<script>
// v27: Auto-injected search handler (catch-all)
(function() {
  function filterItems(query) {
    query = query.toLowerCase().trim();
    // Try multiple selectors for task/note/card items
    // v27: Also look for divs/sections that contain headings (task titles)
    var selectors = ['li', '.task-item', '.note-item', '[data-task]', '.card', '.task', '.item', '[data-id]',
                     'div > h3', 'div > h4', 'section > h3', 'article', '[class*="task"]', '[class*="note"]', '[class*="card"]'];
    var items = [];
    selectors.forEach(function(sel) {
      document.querySelectorAll(sel).forEach(function(el) {
        // For heading-based selectors, get the parent element
        var item = el.tagName === 'H3' || el.tagName === 'H4' ? el.parentElement : el;
        if (item && items.indexOf(item) === -1) items.push(item);
      });
    });
    // Dedupe
    items = items.filter(function(item, idx, self) { return self.indexOf(item) === idx; });
    items.forEach(function(item) {
      // Skip items inside the search form/header/nav
      if (item.closest('form, header, nav, .search, .filter')) return;
      // Skip items that are too small (probably not task cards)
      if (item.textContent.length < 5) return;
      var text = (item.textContent || '').toLowerCase();
      if (query === '' || text.includes(query)) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }
  document.querySelectorAll('input[type="search"], input[placeholder*="search" i], input[placeholder*="Search"]').forEach(function(input) {
    // Remove existing listeners by cloning
    var newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newInput.addEventListener('input', function() {
      filterItems(newInput.value);
    });
  });
})();
</script>`

    const bodyClose = result.match(/<\/body>/i)
    if (bodyClose) {
      result = result.replace(/<\/body>/i, searchFix + '\n</body>')
      fixesApplied++
      logger.info('postfix.css', { fix: 'Injected catch-all search handler' })
    }
  }

  // 3. Fix addTaskBtn that covers the page
  // The LLM sometimes creates a floating add button with position:fixed that blocks clicks
  if (/id="addTaskBtn"[^>]*style="[^"]*position:\s*fixed/i.test(result)) {
    result = result.replace(/(id="addTaskBtn"[^>]*style="[^"]*)position:\s*fixed/gi, '$1position: relative')
    fixesApplied++
    logger.info('postfix.css', { fix: 'Fixed addTaskBtn position:fixed → relative' })
  }

  if (fixesApplied > 0) {
    logger.info('postfix.css_applied', { count: fixesApplied })
  }

  return result
}
