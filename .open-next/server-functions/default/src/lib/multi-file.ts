// Multi-file output format support.
//
// NOVA's primary mode is single-file HTML (everything inline). But sometimes the
// LLM emits a multi-file project — e.g. a React app with separate component files,
// a Python script with a requirements.txt, or a Node project with package.json.
//
// This module:
// - Parses LLM output that may be raw HTML OR a JSON envelope with a `files` array
// - Detects the project type (html-app, html-multi, react, python, node, code)
// - Detects the language of a file from its extension
// - Inlines external CSS/JS references into a single HTML doc for iframe preview
//
// All functions are pure (no I/O, no LLM calls) and safe to use in tests.

import { looksLikeHtml, stripCodeFences } from './html-utils'

// ── Types ──

/** A single output file produced by the LLM. */
export interface OutputFile {
  /** Path relative to project root, e.g. "src/App.tsx" or "index.html". */
  path: string
  /** Raw file content (UTF-8 string). */
  content: string
  /** Language identifier for syntax highlighting, e.g. "html", "css", "typescript". */
  language: string
}

/** The kind of project the LLM produced. */
export type OutputType =
  | 'html-app'       // Single self-contained HTML file (NOVA's primary mode)
  | 'html-multi'     // HTML + separate CSS/JS files (still previewable)
  | 'react'          // React/TSX project (not directly previewable)
  | 'python'         // Python script(s)
  | 'node'           // Node.js project (has package.json or .js files)
  | 'code'           // Generic code (single non-HTML file)

/** Result of parsing LLM output into a normalized multi-file shape. */
export interface MultiFileResult {
  type: OutputType
  files: OutputFile[]
  /** Path of the primary file (entry point / file to open first). */
  primaryFile: string
  /** Whether the result can be previewed in NOVA's sandboxed iframe. */
  previewable: boolean
}

// ── Language detection ──

/** Map of file extension → language identifier. */
const EXTENSION_MAP: Record<string, string> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
  txt: 'text',
}

/**
 * Detect the language of a file from its path/extension.
 * Falls back to 'text' for unknown extensions.
 */
export function detectLanguage(filePath: string): string {
  if (!filePath) return 'text'
  // Strip query strings (e.g. "app.css?v=2") and fragments
  const cleanPath = filePath.split('?')[0]?.split('#')[0] ?? filePath
  const basename = cleanPath.split('/').pop() ?? cleanPath
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === basename.length - 1) return 'text'
  const ext = basename.slice(dotIndex + 1).toLowerCase()
  return EXTENSION_MAP[ext] ?? 'text'
}

// ── Content-based language detection ──

/**
 * Detect programming language from raw code content (heuristic).
 * Used when the LLM emits raw code without any path/extension info.
 * Much more accurate than guessing from mission keywords.
 */
export function detectLanguageFromContent(code: string): string {
  if (!code || !code.trim()) return 'text'
  const cleaned = code.replace(/^[\s\n]*:[^\n]*\n/, '').trim()
  const trimmed = cleaned
  const lines = trimmed.split('\n')
  const lower = trimmed.toLowerCase()

  // Shebang lines — strongest signal
  if (trimmed.startsWith('#!')) {
    if (lower.includes('python')) return 'python'
    if (lower.includes('bash') || lower.includes('/sh')) return 'bash'
    if (lower.includes('node')) return 'javascript'
    if (lower.includes('ruby')) return 'ruby'
    if (lower.includes('perl')) return 'perl'
  }

  // JSON — try to parse
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { JSON.parse(trimmed); return 'json' } catch { /* not valid JSON */ }
  }

  // HTML
  if (lower.startsWith('<!doctype') || lower.startsWith('<html')) return 'html'

  // Bash — check BEFORE Python (bash has elif, print, etc.)
  const bashOnlySignals = [
    /^\s*set\s+-[a-z]/m, /^\s*export\s+\w+=/m, /\$\(\s*[\w'"]/m, /\$\{\w+[^}]*\}/m,
    /\$\w+/m, /^\s*if\s+\[\s+/m, /^\s*while\s+\[\s+/m, /^\s*fi\s*$/m,
    /^\s*done\s*$/m, /^\s*esac\s*$/m, /^\s*then\s*$/m, /^\s*case\s+\w+\s+in\s*$/m,
    /`\w+\s+[^`]*`/m, /^\s*echo\s+["'']?/m, /^\s*printf\s+/m,
  ]
  let bashScore = 0
  for (const re of bashOnlySignals) if (re.test(trimmed)) bashScore++
  const veryDistinctBash = /^\s*(fi|done|esac)\s*$/m.test(trimmed) || /^\s*export\s+\w+=/m.test(trimmed) || /\$\(\s*[\w'"]/m.test(trimmed)
  // v29.34: echo alone is a strong bash signal — lower threshold to 1
  if (veryDistinctBash || bashScore >= 2 || /^\s*echo\s+/m.test(trimmed)) return 'bash'

  // Python
  const pythonSignals = [
    /^\s*def\s+\w+\s*\(/m, /^\s*class\s+\w+\s*[\(:]/m, /^\s*import\s+\w+/m,
    /^\s*from\s+\w+\s+import\s+/m, /^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:/m,
    /^\s*print\s*\(/m, /^\s*with\s+open\s*\(/m, /^\s*elif\s+\w+.*:\s*$/m,
    /^\s*raise\s+\w+/m, /^\s*lambda\s+/m,
    /\[\s*[\w\s*+\-\/]*\s+for\s+\w+\s+in\s+/m, // list comprehension: [x**2 for x in ...]
  ]
  let pythonScore = 0
  for (const re of pythonSignals) if (re.test(trimmed)) pythonScore++
  // v29.34: print() or def alone are strong Python signals — lower threshold to 1
  if (pythonScore >= 2 || /^\s*print\s*\(/m.test(trimmed) || /^\s*def\s+\w+/m.test(trimmed)) return 'python'

  // SQL
  const sqlStrongRegex = /\b(create\s+table|drop\s+table|alter\s+table|create\s+index|create\s+view|insert\s+into|delete\s+from|update\s+\w+\s+set)\b/i
  if (sqlStrongRegex.test(trimmed)) return 'sql'
  const sqlRegex = /\b(select)\b/i
  if (sqlRegex.test(trimmed)) {
    // v29.34: SELECT alone is enough for SQL
    return 'sql'
  }

  // Rust
  const rustSignals = [/^\s*fn\s+\w+\s*\(/m, /^\s*let\s+mut\s+/m, /^\s*pub\s+fn\s+/m, /^\s*use\s+std::/m, /^\s*impl\s+\w+/m]
  let rustScore = 0
  for (const re of rustSignals) if (re.test(trimmed)) rustScore++
  if (rustScore >= 2) return 'rust'

  // Go
  const goSignals = [/^\s*package\s+\w+/m, /^\s*func\s+\w+\s*\(/m, /^\s*import\s*\(/m, /^\s*type\s+\w+\s+struct\s*\{/m]
  let goScore = 0
  for (const re of goSignals) if (re.test(trimmed)) goScore++
  if (goScore >= 2) return 'go'

  // YAML
  const yamlLines = lines.filter(l => /^\s*[\w-]+\s*:\s*\S*/.test(l) && !l.includes('{') && !l.includes('}'))
  if (yamlLines.length >= 3 && !trimmed.includes(';') && !trimmed.includes('/*') && !trimmed.includes('//')) {
    const hasPythonIndent = /^(\s{4}|\t)\s*\w+\s*:/m.test(trimmed)
    if (!hasPythonIndent || pythonScore === 0) return 'yaml'
  }

  // TypeScript vs JavaScript
  const tsSignals = [/:\s*(string|number|boolean|any|void|never|unknown)\b/g, /interface\s+\w+/g, /type\s+\w+\s*=/g, /<\w+>.*\(/g, /\bas\s+\w+/g]
  let tsScore = 0
  for (const re of tsSignals) if (re.test(trimmed)) tsScore++
  const jsSignals = [/^\s*const\s+\w+\s*=/m, /^\s*let\s+\w+\s*=/m, /^\s*function\s+\w+\s*\(/m, /=>\s*[{(]/m, /require\s*\(/m, /console\.(log|error|warn|info)\s*\(/m, /^\s*import\s+.*\s+from\s+['"]/m]
  let jsScore = 0
  for (const re of jsSignals) if (re.test(trimmed)) jsScore++
  if (tsScore >= 2 && jsScore >= 1) return 'typescript'
  if (tsScore >= 1) return 'typescript'
  // v29.34: function keyword alone is enough for JS
  if (jsScore >= 2 || /^\s*function\s+\w+/m.test(trimmed)) return 'javascript'
  if (/console\.(log|error|warn|info)\s*\(/m.test(trimmed)) return 'javascript'

  // Markdown
  if (/^#{1,6}\s+\w+/m.test(trimmed) && /\*\*[^*]+\*\*/m.test(trimmed)) return 'markdown'

  // CSS
  if (/[\w-]+\s*:\s*[^;]+;/.test(trimmed) && /[.#]?[\w-]+\s*\{/.test(trimmed)) return 'css'

  return 'text'
}

/**
 * Pick a sensible filename for a single-file code output based on language.
 */
export function defaultFileNameForLanguage(language: string): string {
  const map: Record<string, string> = {
    python: 'script.py', sql: 'query.sql', bash: 'script.sh',
    javascript: 'script.js', typescript: 'script.ts', json: 'config.json',
    yaml: 'config.yaml', rust: 'main.rs', go: 'main.go', java: 'Main.java',
    c: 'main.c', cpp: 'main.cpp', csharp: 'Program.cs', php: 'script.php',
    ruby: 'script.rb', markdown: 'README.md', css: 'styles.css',
    html: 'index.html', text: 'output.txt',
  }
  return map[language] ?? 'output.txt'
}

// ── Output type detection ──

/**
 * Detect the output type from a list of files.
 *
 * Rules (checked in order):
 * 1. No files → 'code' (caller should treat as fallback)
 * 2. Single .html file → 'html-app'
 * 3. .html + .css/.js siblings → 'html-multi'
 * 4. Any .tsx/.jsx file, or package.json + react dep → 'react'
 * 5. package.json or .js files (without .html) → 'node'
 * 6. Any .py file → 'python'
 * 7. Single non-HTML file → 'code'
 */
export function detectOutputType(files: OutputFile[]): OutputType {
  if (!files || files.length === 0) return 'code'

  const paths = files.map(f => f.path.toLowerCase())
  const hasHtml = paths.some(p => p.endsWith('.html') || p.endsWith('.htm'))
  const hasCss = paths.some(p => p.endsWith('.css'))
  const hasJs = paths.some(p => p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs'))
  const hasTsx = paths.some(p => p.endsWith('.tsx'))
  const hasJsx = paths.some(p => p.endsWith('.jsx'))
  const hasPy = paths.some(p => p.endsWith('.py'))
  const hasPackageJson = paths.some(p => p.endsWith('package.json'))

  // Check package.json for react dependency
  let packageHasReact = false
  if (hasPackageJson) {
    const pkg = files.find(f => f.path.toLowerCase().endsWith('package.json'))
    if (pkg) {
      const lower = pkg.content.toLowerCase()
      packageHasReact = lower.includes('"react"') || lower.includes("'react'")
    }
  }

  // 4. React (check before node — package.json + react, or any tsx/jsx)
  if (hasTsx || hasJsx || packageHasReact) return 'react'

  // 2/3. HTML variants
  if (hasHtml) {
    if (files.length === 1) return 'html-app'
    if (hasCss || hasJs) return 'html-multi'
    // HTML + other files (not CSS/JS) — treat as html-app for preview
    return 'html-app'
  }

  // 6. Python
  if (hasPy) return 'python'

  // 5. Node (package.json or .js files, no HTML)
  if (hasPackageJson || hasJs) return 'node'

  // 7. Single non-HTML file
  return 'code'
}

/**
 * Find the primary file (entry point) for a project.
 * - html-app/html-multi → the .html file
 * - react → index.tsx, App.tsx, main.tsx, or first tsx/jsx
 * - python → main.py, app.py, index.py, or first .py
 * - node → package.json, index.js, server.js, or first .js
 * - code → the first (only) file
 */
export function findPrimaryFile(files: OutputFile[], type: OutputType): string {
  if (files.length === 0) return ''
  if (files.length === 1) return files[0]!.path

  const findByName = (names: string[]): string | undefined => {
    for (const name of names) {
      const found = files.find(f => f.path.toLowerCase().endsWith('/' + name) || f.path.toLowerCase() === name)
      if (found) return found.path
    }
    return undefined
  }
  const findByExt = (ext: string): string | undefined => {
    const found = files.find(f => f.path.toLowerCase().endsWith(ext))
    return found?.path
  }

  switch (type) {
    case 'html-app':
    case 'html-multi':
      return findByName(['index.html', 'app.html', 'main.html']) ?? findByExt('.html') ?? findByExt('.htm') ?? files[0]!.path
    case 'react':
      return findByName(['index.tsx', 'app.tsx', 'main.tsx', 'index.jsx', 'app.jsx', 'main.jsx'])
        ?? findByExt('.tsx') ?? findByExt('.jsx') ?? files[0]!.path
    case 'python':
      return findByName(['main.py', 'app.py', 'index.py', 'run.py'])
        ?? findByExt('.py') ?? files[0]!.path
    case 'node':
      return findByName(['package.json', 'index.js', 'server.js', 'app.js', 'main.js'])
        ?? findByExt('.js') ?? files[0]!.path
    case 'code':
    default:
      return files[0]!.path
  }
}

/**
 * Determine whether a given output type can be previewed in NOVA's sandboxed iframe.
 * Only HTML-based outputs can be previewed (they don't need a build step).
 */
export function isPreviewable(type: OutputType): boolean {
  return type === 'html-app' || type === 'html-multi'
}

// ── Inline for preview ──

/**
 * Inline external CSS and JS file references into a single HTML document.
 *
 * For html-multi projects, the HTML references external files via:
 *   <link rel="stylesheet" href="style.css">
 *   <script src="script.js"></script>
 *
 * NOVA's preview iframe uses srcdoc (no server), so external references won't load.
 * This function reads each referenced file's content and inlines it:
 *   <link rel="stylesheet" href="style.css">  →  <style>...</style>
 *   <script src="script.js"></script>          →  <script>...</script>
 *
 * If a referenced file is missing, the tag is left as-is (so the user can see
 * the broken reference in the preview and we don't silently drop content).
 *
 * Returns the inlined HTML string. Pure function — no I/O.
 */
export function inlineForPreview(files: OutputFile[]): string {
  if (!files || files.length === 0) return ''

  // Find the HTML file
  const htmlFile = files.find(f => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm'))
  if (!htmlFile) return ''

  // Build a lookup table: basename → content (most HTML refs are relative)
  const byBasename = new Map<string, string>()
  const byPath = new Map<string, string>()
  for (const f of files) {
    const basename = f.path.split('/').pop() ?? f.path
    byBasename.set(basename.toLowerCase(), f.content)
    byPath.set(f.path.toLowerCase(), f.content)
  }

  const lookup = (ref: string): string | undefined => {
    const lower = ref.toLowerCase()
    return byPath.get(lower) ?? byBasename.get(lower.split('/').pop() ?? lower)
  }

  let html = htmlFile.content

  // Inline <link rel="stylesheet" href="...">
  // v29.44: Removed redundant second regex — the first regex's [^>]*? already
  // matches both attribute orders (rel-then-href AND href-then-rel).
  html = html.replace(/<link\s+[^>]*?rel=["']stylesheet["'][^>]*?>/gi, (tag) => {
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i)
    if (!hrefMatch?.[1]) return tag
    const content = lookup(hrefMatch[1])
    if (content === undefined) return tag
    return `<style>\n${content}\n</style>`
  })

  // Inline <script src="..."></script>
  html = html.replace(/<script\s+[^>]*?src=["']([^"']+)["'][^>]*?><\/script>/gi, (tag, src) => {
    const content = lookup(src)
    if (content === undefined) return tag
    // Preserve type attribute if it's a non-JS type (e.g. type="module")
    const typeMatch = tag.match(/type=["']([^"']+)["']/i)
    const typeAttr = typeMatch ? ` type="${typeMatch[1]}"` : ''
    return `<script${typeAttr}>\n${content}\n</script>`
  })

  return html
}

// ── Output parsing ──

/**
 * Parse LLM output into a normalized MultiFileResult.
 *
 * Accepted shapes:
 * 1. Raw HTML (starts with <!doctype or <html) → single-file html-app
 * 2. JSON envelope: { "files": [{ "path": "...", "content": "..." }, ...] }
 * 3. JSON envelope with single "file" key (shorthand)
 * 4. Markdown code fences containing either of the above (stripped first)
 * 5. Anything else → returned as a single 'code' file with the raw text
 *
 * The function is forgiving — LLMs wrap output in prose, fences, or omit fields.
 * Missing `language` is auto-detected from the path.
 */
export function parseOutput(text: string): MultiFileResult {
  if (!text || !text.trim()) {
    return { type: 'code', files: [], primaryFile: '', previewable: false }
  }

  // Strip code fences (handles ```json\n{...}\n``` and ```html\n...```)
  // v29.44: Extract ALL ```file:path fences — LLM may emit multiple files.
  // Previous code only extracted the FIRST fence, silently dropping the rest.
  const fileFenceRegex = /```file:([^\n]+)\n([\s\S]*?)```/gi
  const fileFences: { path: string; content: string }[] = []
  let fenceMatch: RegExpExecArray | null
  while ((fenceMatch = fileFenceRegex.exec(text)) !== null) {
    const fp = fenceMatch[1]?.trim()
    const fc = fenceMatch[2] ?? ''
    if (fp && fc.trim()) {
      fileFences.push({ path: fp, content: fc })
    }
  }

  // v29.44: If we have file fences, build a multi-file result from all of them
  if (fileFences.length > 0) {
    const langToType: Record<string, OutputType> = {
      python: 'python', javascript: 'node', typescript: 'node',
      bash: 'code', sql: 'code', json: 'code', yaml: 'code',
      rust: 'code', go: 'code', markdown: 'code', css: 'code',
    }
    const files: OutputFile[] = fileFences.map(f => {
      const detectedLanguage = detectLanguageFromContent(f.content)
      return {
        path: f.path,
        content: f.content,
        language: detectLanguage(f.path) || detectedLanguage,
      }
    })
    const fileType = langToType[files[0]!.language] ?? 'code'
    // Find primary file (main.py, app.js, index.js, etc.)
    const primaryFile = findPrimaryFile(files, fileType) || files[0]!.path
    return {
      type: fileType,
      files,
      primaryFile,
      previewable: false,
    }
  }

  const stripped = stripCodeFences(text)

  // Case 1: Raw HTML
  if (looksLikeHtml(stripped)) {
    const file: OutputFile = { path: 'index.html', content: stripped, language: 'html' }
    return {
      type: 'html-app',
      files: [file],
      primaryFile: 'index.html',
      previewable: true,
    }
  }

  // Case 2/3: JSON envelope
  // Try to extract a balanced JSON object from the stripped text.
  let parsed: unknown = null
  try {
    // Fast path: direct parse if it's pure JSON
    parsed = JSON.parse(stripped)
  } catch {
    // Slow path: extract the first balanced {...} block
    try {
      const start = stripped.indexOf('{')
      if (start >= 0) {
        // Walk with brace depth tracking (respecting strings)
        let depth = 0
        let inStr = false
        let escaped = false
        let end = -1
        for (let i = start; i < stripped.length; i++) {
          const ch = stripped[i]
          if (escaped) { escaped = false; continue }
          if (ch === '\\' && inStr) { escaped = true; continue }
          if (ch === '"') { inStr = !inStr; continue }
          if (inStr) continue
          if (ch === '{') depth++
          else if (ch === '}') {
            depth--
            if (depth === 0) { end = i; break }
          }
        }
        if (end >= 0) {
          parsed = JSON.parse(stripped.slice(start, end + 1))
        }
      }
    } catch {
      parsed = null
    }
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const filesRaw = obj.files ?? obj.file
    if (Array.isArray(filesRaw)) {
      const files: OutputFile[] = filesRaw
        .map((f: unknown): OutputFile | null => {
          if (!f || typeof f !== 'object') return null
          const fo = f as Record<string, unknown>
          const path = typeof fo.path === 'string' ? fo.path : (typeof fo.name === 'string' ? fo.name : '')
          const content = typeof fo.content === 'string' ? fo.content : ''
          if (!path) return null
          const language = typeof fo.language === 'string' && fo.language
            ? fo.language
            : detectLanguage(path)
          return { path, content, language }
        })
        .filter((f: OutputFile | null): f is OutputFile => f !== null)

      if (files.length > 0) {
        const type = detectOutputType(files)
        const primaryFile = findPrimaryFile(files, type)
        return { type, files, primaryFile, previewable: isPreviewable(type) }
      }
    }
  }

  // Case 5: Fallback — treat as a single code file
  // v29: Use content-based language detection so Python/SQL/Bash/etc. get proper
  // syntax highlighting instead of being labeled as 'text'.
  const detectedLanguage = detectLanguageFromContent(stripped)
  const fileName = defaultFileNameForLanguage(detectedLanguage)
  const file: OutputFile = { path: fileName, content: stripped, language: detectedLanguage }
  // Map detected language to an output type
  const langToType: Record<string, OutputType> = {
    python: 'python',
    javascript: 'node',
    typescript: 'node',
    bash: 'code',
    sql: 'code',
    json: 'code',
    yaml: 'code',
    rust: 'code',
    go: 'code',
    markdown: 'code',
    css: 'code',
  }
  const fallbackType = langToType[detectedLanguage] ?? 'code'
  return {
    type: fallbackType,
    files: [file],
    primaryFile: fileName,
    previewable: false,
  }
}
