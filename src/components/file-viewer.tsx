'use client'

// FileViewer — multi-file code viewer for non-HTML LLM output.
//
// NOVA's primary mode is single-file HTML (previewed in a sandboxed iframe).
// But the LLM sometimes produces multi-file output: a React project (separate
// component files), a Python script with requirements.txt, or a Node.js app
// with package.json. These can't be previewed in an iframe, so we show them
// here with:
//
// - A recursive file tree (collapsible folders) on the left
// - The selected file's content on the right with syntax highlighting
// - Line numbers, char count, and a language badge
// - Per-file actions: copy, download single file
// - Project-level action: download all as ZIP (uses our dependency-free zip.ts)
//
// The syntax highlighter is a custom tokenizer (no external deps — avoids
// pulling in 200KB+ for prismjs/highlight.js). It supports 9 languages:
// HTML, CSS, JavaScript, TypeScript, JSX, Python, JSON, Markdown, Bash.
//
// All UI strings are user-visible (toasts, button labels). The component is
// client-only because it uses browser APIs (clipboard, Blob, URL.createObjectURL)
// and React state.

import { useState, useMemo, useCallback } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File as FileIcon,
  Copy,
  Download,
  Check,
  FileArchive,
  Play,
  Loader2,
  Terminal,
  X,
} from 'lucide-react'
import { createZip } from '@/lib/zip'
import { detectLanguage } from '@/lib/multi-file'

// ── Types ──

/** A single file entry — the minimum data needed to render a file in the viewer. */
export interface FileEntry {
  /** Path relative to project root, e.g. "src/App.tsx" or "index.html". */
  path: string
  /** Raw file content (UTF-8 string). */
  content: string
  /** Language identifier for syntax highlighting (e.g. "html", "typescript"). */
  language: string
}

interface FileViewerProps {
  /** Files to display. Order is preserved (tree is built from paths). */
  files: FileEntry[]
  /** Optional title shown above the tree. Default: "Files". */
  title?: string
  /** Optional className for the root container. */
  className?: string
}

// ── Syntax highlighting ──
//
// Tokenizer-based syntax highlighter. Returns an array of { type, value }
// tokens which the renderer maps to colored spans.
//
// Token types:
//   'keyword'    — language keywords (if, for, function, etc.)
//   'string'     — string literals (single/double/backtick)
//   'comment'    — comments (// and /* */ and #)
//   'number'     — numeric literals
//   'tag'        — HTML/XML tag names
//   'attr'       — HTML/XML attribute names
//   'punctuation'— brackets, parens, operators
//   'function'   — function call names (heuristic: identifier followed by `(`)
//   'plain'      — default text
//
// The tokenizer is intentionally simple — it doesn't do full AST parsing.
// False positives are fine (better to over-highlight than miss things).

export type TokenType =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'tag'
  | 'attr'
  | 'punctuation'
  | 'function'
  | 'plain'

export interface Token {
  type: TokenType
  value: string
}

// Keyword sets per language family. Keys are language identifiers (lowercase).
const KEYWORDS: Record<string, Set<string>> = {
  javascript: new Set([
    'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'typeof',
    'instanceof', 'in', 'of', 'this', 'super', 'class', 'extends', 'static',
    'get', 'set', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw',
    'import', 'export', 'from', 'default', 'as', 'void', 'null', 'undefined',
    'true', 'false', 'NaN', 'Infinity',
  ]),
  typescript: new Set([
    'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'typeof',
    'instanceof', 'in', 'of', 'this', 'super', 'class', 'extends', 'static',
    'get', 'set', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw',
    'import', 'export', 'from', 'default', 'as', 'void', 'null', 'undefined',
    'true', 'false', 'NaN', 'Infinity',
    // TypeScript-specific
    'type', 'interface', 'enum', 'namespace', 'public', 'private', 'protected',
    'readonly', 'abstract', 'declare', 'implements', 'keyof', 'infer', 'is',
    'never', 'unknown', 'any', 'string', 'number', 'boolean', 'object', 'symbol',
    'bigint',
  ]),
  jsx: new Set([
    'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'typeof',
    'instanceof', 'in', 'of', 'this', 'super', 'class', 'extends', 'static',
    'get', 'set', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw',
    'import', 'export', 'from', 'default', 'as', 'void', 'null', 'undefined',
    'true', 'false',
  ]),
  tsx: new Set([
    'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'typeof',
    'instanceof', 'in', 'of', 'this', 'super', 'class', 'extends', 'static',
    'get', 'set', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw',
    'import', 'export', 'from', 'default', 'as', 'void', 'null', 'undefined',
    'true', 'false', 'type', 'interface', 'enum', 'namespace', 'public',
    'private', 'protected', 'readonly', 'abstract', 'declare', 'implements',
  ]),
  python: new Set([
    'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break',
    'continue', 'pass', 'import', 'from', 'as', 'try', 'except', 'finally',
    'raise', 'with', 'yield', 'lambda', 'global', 'nonlocal', 'assert', 'del',
    'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None', 'self', 'cls',
    'async', 'await', 'print',
  ]),
  bash: new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case',
    'esac', 'function', 'return', 'exit', 'echo', 'export', 'local', 'readonly',
    'source', 'alias', 'unalias', 'true', 'false', 'cd', 'pwd', 'ls', 'mkdir',
    'rm', 'cp', 'mv', 'cat', 'grep', 'sed', 'awk', 'curl', 'wget', 'sudo',
    'npm', 'bun', 'node', 'python', 'python3', 'pip', 'git',
  ]),
}

// Languages that use // line comments and /* */ block comments.
const C_LIKE_COMMENTS = new Set(['javascript', 'typescript', 'jsx', 'tsx', 'css'])

/**
 * Tokenize a line of source code for syntax highlighting.
 *
 * The tokenizer processes one line at a time (no multi-line state except for
 * block comments, which are tracked via a flag passed by the caller).
 *
 * @param line The line of code to tokenize.
 * @param language The language identifier (lowercase).
 * @param inBlockComment Whether we're inside a slash-star-star-slash block
 *   comment that started on a previous line. Updated and returned for the
 *   next call.
 */
export function tokenizeLine(
  line: string,
  language: string,
  inBlockComment: boolean = false,
): { tokens: Token[]; inBlockComment: boolean } {
  const lang = (language || 'text').toLowerCase()
  const keywords = KEYWORDS[lang]
  const tokens: Token[] = []
  let i = 0
  let blockComment = inBlockComment

  // HTML / XML: handle tags, attributes, and embedded content separately.
  if (lang === 'html' || lang === 'xml') {
    return tokenizeHtml(line, blockComment)
  }

  // CSS: handle selectors, properties, values, and { } ; : ,
  if (lang === 'css') {
    return tokenizeCss(line, blockComment)
  }

  // JSON: handle keys, strings, numbers, and structural punctuation.
  if (lang === 'json') {
    return tokenizeJson(line)
  }

  // Markdown: headings, bold, italic, code, links, lists.
  if (lang === 'markdown') {
    return { tokens: tokenizeMarkdown(line), inBlockComment: false }
  }

  // C-like languages: JavaScript, TypeScript, JSX, TSX, Python, Bash.
  while (i < line.length) {
    // Continue block comment from previous line
    if (blockComment) {
      const endIdx = line.indexOf('*/', i)
      if (endIdx < 0) {
        tokens.push({ type: 'comment', value: line.slice(i) })
        return { tokens, inBlockComment: true }
      }
      tokens.push({ type: 'comment', value: line.slice(i, endIdx + 2) })
      i = endIdx + 2
      blockComment = false
      continue
    }

    const ch = line[i]

    // Whitespace — push as plain (preserves indentation)
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++
      tokens.push({ type: 'plain', value: line.slice(i, j) })
      i = j
      continue
    }

    // Line comments
    if (C_LIKE_COMMENTS.has(lang) && ch === '/' && line[i + 1] === '/') {
      tokens.push({ type: 'comment', value: line.slice(i) })
      i = line.length
      continue
    }
    if (lang === 'python' && ch === '#') {
      tokens.push({ type: 'comment', value: line.slice(i) })
      i = line.length
      continue
    }
    if (lang === 'bash' && ch === '#') {
      tokens.push({ type: 'comment', value: line.slice(i) })
      i = line.length
      continue
    }

    // Block comment start (C-like)
    if (C_LIKE_COMMENTS.has(lang) && ch === '/' && line[i + 1] === '*') {
      const endIdx = line.indexOf('*/', i + 2)
      if (endIdx < 0) {
        tokens.push({ type: 'comment', value: line.slice(i) })
        return { tokens, inBlockComment: true }
      }
      tokens.push({ type: 'comment', value: line.slice(i, endIdx + 2) })
      i = endIdx + 2
      continue
    }

    // String literals (single, double, backtick)
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue }
        if (line[j] === quote) { j++; break }
        j++
      }
      tokens.push({ type: 'string', value: line.slice(i, j) })
      i = j
      continue
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] ?? ''))) {
      let j = i + 1
      while (j < line.length && /[0-9a-fA-FxXoObB._]/.test(line[j] ?? '')) j++
      tokens.push({ type: 'number', value: line.slice(i, j) })
      i = j
      continue
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i + 1
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j] ?? '')) j++
      const word = line.slice(i, j)
      // Check if followed by `(` → function call
      let k = j
      while (k < line.length && (line[k] === ' ' || line[k] === '\t')) k++
      const isFunctionCall = line[k] === '('
      if (keywords && keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word })
      } else if (isFunctionCall) {
        tokens.push({ type: 'function', value: word })
      } else {
        tokens.push({ type: 'plain', value: word })
      }
      i = j
      continue
    }

    // Punctuation (single char)
    tokens.push({ type: 'punctuation', value: ch })
    i++
  }

  return { tokens, inBlockComment: blockComment }
}

/** Tokenize an HTML line. Recognizes tags, attributes, strings, and comments. */
function tokenizeHtml(line: string, inBlockComment: boolean): { tokens: Token[]; inBlockComment: boolean } {
  const tokens: Token[] = []
  let i = 0
  let inTag = false
  let blockComment = inBlockComment

  while (i < line.length) {
    if (blockComment) {
      const endIdx = line.indexOf('-->', i)
      if (endIdx < 0) {
        tokens.push({ type: 'comment', value: line.slice(i) })
        return { tokens, inBlockComment: true }
      }
      tokens.push({ type: 'comment', value: line.slice(i, endIdx + 3) })
      i = endIdx + 3
      blockComment = false
      continue
    }

    // HTML comment
    if (line.startsWith('<!--', i)) {
      const endIdx = line.indexOf('-->', i + 4)
      if (endIdx < 0) {
        tokens.push({ type: 'comment', value: line.slice(i) })
        return { tokens, inBlockComment: true }
      }
      tokens.push({ type: 'comment', value: line.slice(i, endIdx + 3) })
      i = endIdx + 3
      continue
    }

    const ch = line[i]

    // Tag start
    if (ch === '<') {
      // Find end of tag
      const endIdx = line.indexOf('>', i)
      if (endIdx < 0) {
        // Malformed — push rest as plain
        tokens.push({ type: 'plain', value: line.slice(i) })
        i = line.length
        continue
      }
      const tag = line.slice(i, endIdx + 1)
      // Tokenize the tag content: <tagname attr="value" ...>
      const tagTokens = tokenizeHtmlTag(tag)
      tokens.push(...tagTokens)
      i = endIdx + 1
      inTag = false
      continue
    }

    // Whitespace
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++
      tokens.push({ type: 'plain', value: line.slice(i, j) })
      i = j
      continue
    }

    // Plain text content
    let j = i
    while (j < line.length && line[j] !== '<' && line[j] !== ' ' && line[j] !== '\t') j++
    if (j === i) j++ // ensure progress
    tokens.push({ type: 'plain', value: line.slice(i, j) })
    i = j
  }

  return { tokens, inBlockComment: blockComment }
}

/** Tokenize a single HTML tag like `<div class="foo">` or `</div>`. */
function tokenizeHtmlTag(tag: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  // Opening < (and optional /)
  if (tag[i] === '<') {
    tokens.push({ type: 'punctuation', value: '<' })
    i++
    if (tag[i] === '/') {
      tokens.push({ type: 'punctuation', value: '/' })
      i++
    }
  }
  // Tag name
  let j = i
  while (j < tag.length && /[a-zA-Z0-9-]/.test(tag[j] ?? '')) j++
  if (j > i) {
    tokens.push({ type: 'tag', value: tag.slice(i, j) })
    i = j
  }
  // Attributes
  while (i < tag.length) {
    const ch = tag[i]
    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      let k = i + 1
      while (k < tag.length && (tag[k] === ' ' || tag[k] === '\t' || tag[k] === '\n')) k++
      tokens.push({ type: 'plain', value: tag.slice(i, k) })
      i = k
      continue
    }
    // End of tag
    if (ch === '>' || (ch === '/' && tag[i + 1] === '>')) {
      if (ch === '/') {
        tokens.push({ type: 'punctuation', value: '/>' })
        i += 2
      } else {
        tokens.push({ type: 'punctuation', value: '>' })
        i++
      }
      continue
    }
    // Attribute name = value
    let k = i
    while (k < tag.length && /[a-zA-Z0-9-:]/.test(tag[k] ?? '')) k++
    if (k > i) {
      tokens.push({ type: 'attr', value: tag.slice(i, k) })
      i = k
      continue
    }
    // = sign
    if (ch === '=') {
      tokens.push({ type: 'punctuation', value: '=' })
      i++
      continue
    }
    // String value
    if (ch === '"' || ch === "'") {
      const quote = ch
      let m = i + 1
      while (m < tag.length && tag[m] !== quote) m++
      if (m < tag.length) m++ // include closing quote
      tokens.push({ type: 'string', value: tag.slice(i, m) })
      i = m
      continue
    }
    // Fallback: single char
    tokens.push({ type: 'plain', value: ch })
    i++
  }
  return tokens
}

/** Tokenize a CSS line. */
function tokenizeCss(line: string, inBlockComment: boolean): { tokens: Token[]; inBlockComment: boolean } {
  const tokens: Token[] = []
  let i = 0
  let blockComment = inBlockComment

  while (i < line.length) {
    if (blockComment) {
      const endIdx = line.indexOf('*/', i)
      if (endIdx < 0) {
        tokens.push({ type: 'comment', value: line.slice(i) })
        return { tokens, inBlockComment: true }
      }
      tokens.push({ type: 'comment', value: line.slice(i, endIdx + 2) })
      i = endIdx + 2
      blockComment = false
      continue
    }

    const ch = line[i]

    // Block comment
    if (ch === '/' && line[i + 1] === '*') {
      const endIdx = line.indexOf('*/', i + 2)
      if (endIdx < 0) {
        tokens.push({ type: 'comment', value: line.slice(i) })
        return { tokens, inBlockComment: true }
      }
      tokens.push({ type: 'comment', value: line.slice(i, endIdx + 2) })
      i = endIdx + 2
      continue
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j += 2
        else j++
      }
      if (j < line.length) j++
      tokens.push({ type: 'string', value: line.slice(i, j) })
      i = j
      continue
    }

    // Numbers (with units like 12px, 1.5em, 100%)
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] ?? ''))) {
      let j = i + 1
      while (j < line.length && /[0-9a-z%]/i.test(line[j] ?? '')) j++
      tokens.push({ type: 'number', value: line.slice(i, j) })
      i = j
      continue
    }

    // Property/identifier: name followed by `:` is a property
    if (/[a-zA-Z-]/.test(ch)) {
      let j = i + 1
      while (j < line.length && /[a-zA-Z0-9-_]/.test(line[j] ?? '')) j++
      const word = line.slice(i, j)
      // Look ahead for `:` → property name
      let k = j
      while (k < line.length && line[k] === ' ') k++
      if (line[k] === ':') {
        tokens.push({ type: 'attr', value: word })
      } else {
        tokens.push({ type: 'plain', value: word })
      }
      i = j
      continue
    }

    // Hex colors (#abc123)
    if (ch === '#' && /[0-9a-fA-F]/.test(line[i + 1] ?? '')) {
      let j = i + 1
      while (j < line.length && /[0-9a-fA-F]/.test(line[j] ?? '')) j++
      tokens.push({ type: 'number', value: line.slice(i, j) })
      i = j
      continue
    }

    // Whitespace
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++
      tokens.push({ type: 'plain', value: line.slice(i, j) })
      i = j
      continue
    }

    // Punctuation
    tokens.push({ type: 'punctuation', value: ch })
    i++
  }

  return { tokens, inBlockComment: blockComment }
}

/** Tokenize a JSON line. */
function tokenizeJson(line: string): { tokens: Token[]; inBlockComment: boolean } {
  const tokens: Token[] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    // Strings (also detect keys followed by `:`)
    if (ch === '"') {
      let j = i + 1
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue }
        if (line[j] === '"') { j++; break }
        j++
      }
      // Look ahead for `:` (skipping whitespace) → it's a key
      let k = j
      while (k < line.length && (line[k] === ' ' || line[k] === '\t')) k++
      const type = line[k] === ':' ? 'attr' : 'string'
      tokens.push({ type, value: line.slice(i, j) })
      i = j
      continue
    }
    // Numbers (including negative and scientific)
    if (/[0-9-]/.test(ch) && (/[0-9]/.test(line[i + 1] ?? '') || (ch === '-' && /[0-9]/.test(line[i + 1] ?? '')))) {
      let j = i + 1
      while (j < line.length && /[0-9eE+\-.]/.test(line[j] ?? '')) j++
      tokens.push({ type: 'number', value: line.slice(i, j) })
      i = j
      continue
    }
    // Keywords: true, false, null
    if (/[a-z]/.test(ch)) {
      let j = i + 1
      while (j < line.length && /[a-z]/.test(line[j] ?? '')) j++
      const word = line.slice(i, j)
      if (word === 'true' || word === 'false' || word === 'null') {
        tokens.push({ type: 'keyword', value: word })
      } else {
        tokens.push({ type: 'plain', value: word })
      }
      i = j
      continue
    }
    // Whitespace
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++
      tokens.push({ type: 'plain', value: line.slice(i, j) })
      i = j
      continue
    }
    // Punctuation
    tokens.push({ type: 'punctuation', value: ch })
    i++
  }
  return { tokens, inBlockComment: false }
}

/** Tokenize a Markdown line. */
function tokenizeMarkdown(line: string): Token[] {
  const tokens: Token[] = []
  // Heading
  if (/^#{1,6}\s/.test(line)) {
    const match = line.match(/^(#{1,6})(\s+.*)$/)
    if (match) {
      tokens.push({ type: 'keyword', value: match[1] })
      tokens.push({ type: 'plain', value: match[2] })
      return tokens
    }
  }
  // List items
  if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) {
    const match = line.match(/^([-*+]|\d+\.)\s(.*)$/)
    if (match) {
      tokens.push({ type: 'punctuation', value: match[1] })
      tokens.push({ type: 'plain', value: ' ' })
      tokens.push(...tokenizeMarkdownInline(match[2]))
      return tokens
    }
  }
  // Default: inline
  return tokenizeMarkdownInline(line)
}

/** Tokenize inline markdown (bold, italic, code, links). */
function tokenizeMarkdownInline(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    // Inline code: `code`
    if (text[i] === '`') {
      const endIdx = text.indexOf('`', i + 1)
      if (endIdx > 0) {
        tokens.push({ type: 'string', value: text.slice(i, endIdx + 1) })
        i = endIdx + 1
        continue
      }
    }
    // Bold: **text**
    if (text.startsWith('**', i)) {
      const endIdx = text.indexOf('**', i + 2)
      if (endIdx > 0) {
        tokens.push({ type: 'keyword', value: text.slice(i, endIdx + 2) })
        i = endIdx + 2
        continue
      }
    }
    // Italic: *text*
    if (text[i] === '*') {
      const endIdx = text.indexOf('*', i + 1)
      if (endIdx > 0) {
        tokens.push({ type: 'attr', value: text.slice(i, endIdx + 1) })
        i = endIdx + 1
        continue
      }
    }
    // Plain text until next special char
    let j = i + 1
    while (j < text.length && text[j] !== '`' && text[j] !== '*') j++
    tokens.push({ type: 'plain', value: text.slice(i, j) })
    i = j
  }
  return tokens
}

// ── Token → CSS color mapping ──

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: '#c084fc',       // purple-400
  string: '#86efac',       // green-300
  comment: '#64748b',      // slate-500 (muted)
  number: '#fbbf24',       // amber-400
  tag: '#f87171',          // red-400
  attr: '#fbbf24',         // amber-400
  punctuation: '#94a3b8',  // slate-400
  function: '#60a5fa',     // blue-400
  plain: '#e2e8f0',        // slate-200 (default text)
}

// ── File tree builder ──

interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
  file?: FileEntry
}

/**
 * Build a tree from a flat list of file paths.
 * Folders are created on-the-fly from path segments.
 */
function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isFolder: true, children: [] }

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isLeaf = i === parts.length - 1
      const fullPath = parts.slice(0, i + 1).join('/')
      let child = node.children.find(c => c.name === part)
      if (!child) {
        child = {
          name: part,
          path: fullPath,
          isFolder: !isLeaf,
          children: [],
          file: isLeaf ? file : undefined,
        }
        node.children.push(child)
      }
      node = child
    }
  }

  // Sort: folders first, then files, alphabetically
  const sortNode = (n: TreeNode): void => {
    n.children.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    n.children.forEach(sortNode)
  }
  sortNode(root)

  return root
}

// ── FileViewer component ──

export function FileViewer({ files, title = 'Files', className = '' }: FileViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    files[0]?.path ?? null,
  )
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  // v29: Run panel state — for executing Python/Node/Bash code
  const [runResult, setRunResult] = useState<{
    stdout: string; stderr: string; exitCode: number; ms: number; timedOut: boolean
  } | null>(null)
  const [running, setRunning] = useState(false)
  const [showRunPanel, setShowRunPanel] = useState(false)

  const tree = useMemo(() => buildTree(files), [files])

  const selectedFile = useMemo(
    () => files.find(f => f.path === selectedPath) ?? files[0] ?? null,
    [files, selectedPath],
  )

  // v29: Check if the selected file is executable (python/javascript/bash)
  const isExecutable = useMemo(() => {
    if (!selectedFile) return false
    const lang = selectedFile.language || detectLanguage(selectedFile.path)
    return ['python', 'javascript', 'js', 'node', 'bash', 'sh', 'shell'].includes(lang)
  }, [selectedFile])

  const toggleFolder = useCallback((path: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleCopy = useCallback(async (file: FileEntry) => {
    try {
      await navigator.clipboard.writeText(file.content)
      setCopiedPath(file.path)
      setTimeout(() => setCopiedPath(null), 1500)
    } catch {
      // Clipboard may be unavailable (SSR, insecure context). Fail silently.
    }
  }, [])

  const handleDownloadFile = useCallback((file: FileEntry) => {
    try {
      const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.path.split('/').pop() ?? 'file.txt'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // Fail silently — download is best-effort
    }
  }, [])

  const handleDownloadZip = useCallback(() => {
    try {
      const zipBytes = createZip(
        files.map(f => ({ name: f.path, content: f.content })),
      )
      const blob = new Blob([zipBytes as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'nova-project.zip'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // Fail silently
    }
  }, [files])

  // v29: Run the selected file's code via /api/run endpoint.
  // For multi-file projects, send ALL files so imports work.
  const handleRun = useCallback(async () => {
    if (!selectedFile || running) return
    const lang = selectedFile.language || detectLanguage(selectedFile.path)
    setRunning(true)
    setShowRunPanel(true)
    setRunResult(null)
    try {
      const payload: Record<string, unknown> = {
        language: lang === 'javascript' || lang === 'js' || lang === 'node' ? 'javascript' : lang,
      }
      if (files.length > 1) {
        payload.files = files.map(f => ({ path: f.path, content: f.content }))
        payload.primaryFile = selectedFile.path
      } else {
        payload.code = selectedFile.content
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.ok === true || typeof data.stdout === 'string') {
        setRunResult({
          stdout: data.stdout ?? '', stderr: data.stderr ?? '',
          exitCode: data.exitCode ?? 0, ms: data.ms ?? 0, timedOut: data.timedOut ?? false,
        })
      } else {
        setRunResult({
          stdout: '', stderr: data.error ?? 'Unknown error',
          exitCode: -1, ms: 0, timedOut: false,
        })
      }
    } catch (err) {
      setRunResult({
        stdout: '', stderr: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: -1, ms: 0, timedOut: false,
      })
    } finally {
      setRunning(false)
    }
  }, [selectedFile, running, files])

  if (!files || files.length === 0) {
    return (
      <div className={`flex items-center justify-center p-8 text-sm text-muted-foreground ${className}`}>
        No files to display
      </div>
    )
  }

  return (
    <div className={`flex h-full min-h-[300px] flex-col overflow-hidden rounded-md border border-border/40 bg-card/30 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 bg-card/60 px-3 py-2">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <div className="flex items-center gap-1">
          {isExecutable && (
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
              title="Run code (execute in sandbox)"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {running ? 'Running...' : 'Run'}
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadZip}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            title="Download all as ZIP"
          >
            <FileArchive className="h-3 w-3" />
            ZIP
          </button>
        </div>
      </div>

      {/* Body: tree + content */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* File tree */}
        <div className="md:w-56 md:min-w-56 md:border-r border-border/40 overflow-auto max-h-40 md:max-h-none">
          <TreeView
            node={tree}
            level={0}
            selectedPath={selectedPath}
            collapsedFolders={collapsedFolders}
            onSelect={setSelectedPath}
            onToggle={toggleFolder}
          />
        </div>

        {/* File content + Run panel */}
        {selectedFile ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <FileHeader
              file={selectedFile}
              copied={copiedPath === selectedFile.path}
              onCopy={() => handleCopy(selectedFile)}
              onDownload={() => handleDownloadFile(selectedFile)}
              isExecutable={isExecutable}
              onRun={handleRun}
              running={running}
            />
            <div className="flex min-h-0 flex-1 flex-col">
              <FileContent file={selectedFile} />
              {showRunPanel && (
                <RunPanel
                  result={runResult}
                  running={running}
                  onClose={() => { setShowRunPanel(false); setRunResult(null) }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a file
          </div>
        )}
      </div>
    </div>
  )
}

// ── Run panel — shows stdout/stderr from code execution ──

interface RunPanelProps {
  result: {
    stdout: string; stderr: string; exitCode: number; ms: number; timedOut: boolean
  } | null
  running: boolean
  onClose: () => void
}

function RunPanel({ result, running, onClose }: RunPanelProps) {
  const hasOutput = result && (result.stdout || result.stderr)
  const success = result && result.exitCode === 0
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!result) return
    try {
      const text = result.stdout + (result.stderr ? '\n--- stderr ---\n' + result.stderr : '')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }, [result])

  return (
    <div className="flex max-h-[40%] min-h-[160px] flex-col border-t border-border/40 bg-neutral-950">
      <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3 w-3 text-emerald-400" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {running ? 'Running...' : 'Output'}
          </span>
          {result && !running && (
            <>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {success ? 'SUCCESS' : result.timedOut ? 'TIMEOUT' : `EXIT ${result.exitCode}`}
              </span>
              <span className="text-[10px] text-muted-foreground/60">{result.ms}ms</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasOutput && !running && (
            <button
              type="button"
              onClick={handleCopy}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              title="Copy output"
              aria-label="Copy output"
            >
              {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            title="Close output panel"
            aria-label="Close output panel"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
        {running ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
            <span>Executing code in sandbox...</span>
          </div>
        ) : !hasOutput ? (
          <div className="text-muted-foreground/60">
            {success ? '(no output — script ran successfully but printed nothing)' : 'No output.'}
          </div>
        ) : (
          <>
            {result!.stdout && (
              <pre className="whitespace-pre-wrap break-words text-emerald-300">{result!.stdout}</pre>
            )}
            {result!.stderr && (
              <pre className="whitespace-pre-wrap break-words text-red-400">{result!.stderr}</pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Tree view (recursive) ──

interface TreeViewProps {
  node: TreeNode
  level: number
  selectedPath: string | null
  collapsedFolders: Set<string>
  onSelect: (path: string) => void
  onToggle: (path: string) => void
}

function TreeView({ node, level, selectedPath, collapsedFolders, onSelect, onToggle }: TreeViewProps) {
  return (
    <ul className="py-1 text-xs">
      {node.children.map(child => (
        <TreeItem
          key={child.path}
          node={child}
          level={level}
          selectedPath={selectedPath}
          collapsedFolders={collapsedFolders}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </ul>
  )
}

interface TreeItemProps extends TreeViewProps {
  node: TreeNode
}

function TreeItem({ node, level, selectedPath, collapsedFolders, onSelect, onToggle }: TreeItemProps) {
  const isSelected = node.path === selectedPath
  const isCollapsed = collapsedFolders.has(node.path)
  const padLeft = 8 + level * 12

  if (node.isFolder) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="flex w-full items-center gap-1 py-0.5 pr-2 text-left text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          style={{ paddingLeft: padLeft }}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" />
          )}
          {isCollapsed ? (
            <Folder className="h-3 w-3 shrink-0" />
          ) : (
            <FolderOpen className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {!isCollapsed && (
          <TreeView
            node={node}
            level={level + 1}
            selectedPath={selectedPath}
            collapsedFolders={collapsedFolders}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        )}
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={`flex w-full items-center gap-1 py-0.5 pr-2 text-left transition-colors ${
          isSelected
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
        }`}
        style={{ paddingLeft: padLeft + 16 }}
      >
        <FileIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    </li>
  )
}

// ── File header (badge, char count, actions) ──

interface FileHeaderProps {
  file: FileEntry
  copied: boolean
  onCopy: () => void
  onDownload: () => void
  // v29: Run button props — only shown for executable languages
  isExecutable?: boolean
  onRun?: () => void
  running?: boolean
}

function FileHeader({ file, copied, onCopy, onDownload, isExecutable, onRun, running }: FileHeaderProps) {
  const lineCount = file.content.split('\n').length
  const charCount = file.content.length
  const detected = detectLanguage(file.path)

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-card/40 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-[11px] text-foreground">{file.path}</span>
        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase text-primary">
          {file.language || detected}
        </span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
          {lineCount} lines · {charCount.toLocaleString()} chars
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isExecutable && onRun && (
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
            title="Run code (execute in sandbox)"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {running ? 'Running...' : 'Run'}
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          title="Copy file content"
          aria-label="Copy file content"
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          title="Download file"
          aria-label="Download file"
        >
          <Download className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ── File content (syntax highlighted, with line numbers) ──

interface FileContentProps {
  file: FileEntry
}

function FileContent({ file }: FileContentProps) {
  const lines = file.content.split('\n')

  // Pre-tokenize all lines, threading block-comment state across lines.
  const tokenized = useMemo(() => {
    const out: Token[][] = []
    let inBlockComment = false
    for (const line of lines) {
      const result = tokenizeLine(line, file.language, inBlockComment)
      inBlockComment = result.inBlockComment
      out.push(result.tokens)
    }
    return out
  }, [lines, file.language])

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-background/60 font-mono text-[12px] leading-relaxed">
      <table className="w-full border-collapse">
        <tbody>
          {tokenized.map((tokens, idx) => (
            <tr key={idx} className="hover:bg-muted/10">
              <td className="select-none border-r border-border/30 px-2 text-right align-top text-[10px] text-muted-foreground/60" style={{ minWidth: 32 }}>
                {idx + 1}
              </td>
              <td className="whitespace-pre-wrap break-words px-3 align-top">
                {tokens.length === 0 ? (
                  '\u00A0'
                ) : (
                  tokens.map((tok, ti) => (
                    <span key={ti} style={{ color: TOKEN_COLORS[tok.type] }}>
                      {tok.value}
                    </span>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
