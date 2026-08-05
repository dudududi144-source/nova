// v28: Smart post-build suggestions
// Analyzes the generated HTML and suggests specific improvements
// that the user can apply with one click.

export interface Suggestion {
  id: string
  type: 'design' | 'functionality' | 'accessibility' | 'performance'
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  action: string // the refine message to send
  icon: string
}

export function generateSuggestions(html: string, mission: string): Suggestion[] {
  const suggestions: Suggestion[] = []
  const lower = html.toLowerCase()
  const scriptText = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [])
    .map(s => s.replace(/<\/?script[^>]*>/gi, '')).join('\n')

  // Design suggestions
  if (!/box-shadow/i.test(html)) {
    suggestions.push({
      id: 'add-shadows',
      type: 'design',
      priority: 'medium',
      title: 'Add depth with shadows',
      description: 'No box-shadows found. Adding subtle shadows will make the UI feel more polished and professional.',
      action: 'Add subtle box-shadows to cards, buttons, and modals for visual depth. Use values like: box-shadow: 0 2px 8px rgba(0,0,0,0.1);',
      icon: '🎨',
    })
  }

  if (!/transition/i.test(html)) {
    suggestions.push({
      id: 'add-transitions',
      type: 'design',
      priority: 'high',
      title: 'Add smooth transitions',
      description: 'No CSS transitions found. Adding transitions on hover/click makes the app feel responsive and premium.',
      action: 'Add CSS transitions to all interactive elements. Example: transition: all 0.2s ease; Add hover effects like scale(1.02) on buttons.',
      icon: '✨',
    })
  }

  if (!/@media/i.test(html)) {
    suggestions.push({
      id: 'add-responsive',
      type: 'design',
      priority: 'high',
      title: 'Add responsive design',
      description: 'No media queries found. The app may look broken on mobile devices.',
      action: 'Add responsive media queries for mobile (max-width: 768px) and tablet (max-width: 1024px). Adjust font sizes, padding, and layout for smaller screens.',
      icon: '📱',
    })
  }

  // Functionality suggestions
  const buttonCount = (html.match(/<button/gi) || []).length
  const onclickCount = (html.match(/onclick=/gi) || []).length
  const listenerCount = (scriptText.match(/addEventListener/g) || []).length
  const totalHandlers = onclickCount + listenerCount

  if (buttonCount > totalHandlers) {
    suggestions.push({
      id: 'fix-dead-buttons',
      type: 'functionality',
      priority: 'high',
      title: `${buttonCount - totalHandlers} button(s) without handlers`,
      description: 'Some buttons have no click handler. They appear clickable but do nothing when clicked.',
      action: 'Check every button — each one must have either an onclick attribute or an addEventListener. Remove buttons that have no purpose.',
      icon: '🔧',
    })
  }

  if (!/aria-label/i.test(html)) {
    suggestions.push({
      id: 'add-aria',
      type: 'accessibility',
      priority: 'medium',
      title: 'Add aria-labels',
      description: 'No aria-labels found. Screen readers cannot understand what buttons do.',
      action: 'Add aria-label attributes to all interactive elements (buttons, inputs, links). Example: <button aria-label="Add new task">+</button>',
      icon: '♿',
    })
  }

  if (!/semantic|<main|<nav|<header|<section|<article/i.test(html)) {
    suggestions.push({
      id: 'add-semantic',
      type: 'accessibility',
      priority: 'low',
      title: 'Use semantic HTML',
      description: 'No semantic HTML tags found. Using <main>, <nav>, <header> improves accessibility and SEO.',
      action: 'Replace generic <div> wrappers with semantic tags: <main> for main content, <nav> for navigation, <header> for headers, <section> for sections.',
      icon: '🏗️',
    })
  }

  // App-specific suggestions
  if (/todo|task/i.test(mission)) {
    if (!/drag/i.test(lower)) {
      suggestions.push({
        id: 'add-drag',
        type: 'functionality',
        priority: 'medium',
        title: 'Add drag-and-drop reordering',
        description: 'Todo apps feel more premium when you can drag tasks to reorder them.',
        action: 'Add drag-and-drop reordering for tasks. Use the HTML5 drag API: set draggable=true on task items, handle dragstart, dragover, and drop events.',
        icon: '🖱️',
      })
    }
    if (!/categor|tag|label/i.test(lower)) {
      suggestions.push({
        id: 'add-categories',
        type: 'functionality',
        priority: 'low',
        title: 'Add task categories',
        description: 'Categories help users organize their tasks better.',
        action: 'Add a category/tag system. Let users assign categories like Work, Personal, Shopping to each task. Add a filter dropdown.',
        icon: '🏷️',
      })
    }
  }

  if (/game|snake|tetris|arcade/i.test(mission)) {
    if (!/high.?score/i.test(lower)) {
      suggestions.push({
        id: 'add-highscore',
        type: 'functionality',
        priority: 'medium',
        title: 'Add high score tracking',
        description: 'Games feel more engaging when players can track their best score.',
        action: 'Add a high score display that updates when the player beats their previous best. Show it prominently at the top.',
        icon: '🏆',
      })
    }
    if (!/sound|audio|beep/i.test(lower)) {
      suggestions.push({
        id: 'add-sound',
        type: 'functionality',
        priority: 'low',
        title: 'Add sound effects',
        description: 'Sound effects make games more immersive.',
        action: 'Add simple sound effects using Web Audio API. Play a beep when eating food, a different sound for game over.',
        icon: '🔊',
      })
    }
  }

  if (/dashboard|chart|analytics/i.test(mission)) {
    if (!/dark.?mode|theme.?toggle/i.test(lower)) {
      suggestions.push({
        id: 'add-dark-mode',
        type: 'functionality',
        priority: 'medium',
        title: 'Add dark mode toggle',
        description: 'Dashboards are often used for long periods. Dark mode reduces eye strain.',
        action: 'Add a dark/light mode toggle button. Use CSS variables to switch between themes. Store the preference.',
        icon: '🌙',
      })
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return suggestions.slice(0, 5) // Return top 5
}
