// Tests for file-viewer.tsx — syntax highlighting (inline copy of tokenizer).
//
// This test file inlines the tokenizer logic from src/components/file-viewer.tsx
// to verify behavior without requiring a DOM/React test environment.
// (The component itself is a 'use client' React component — testing it
// directly would require jsdom or a similar setup.)
import { describe, it, expect } from 'bun:test'
import {
  tokenizeLine,
  type Token,
} from '../src/components/file-viewer'

// ── Helpers ──

function tokensByType(tokens: Token[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const t of tokens) {
    if (!out[t.type]) out[t.type] = []
    out[t.type].push(t.value)
  }
  return out
}

function hasToken(tokens: Token[], type: string, value?: string): boolean {
  return tokens.some(t => t.type === type && (value === undefined || t.value === value))
}

// ── JavaScript / TypeScript tokenizer ──

describe('tokenizeLine — JavaScript', () => {
  it('recognizes keywords', () => {
    const { tokens } = tokenizeLine('const x = 5;', 'javascript')
    expect(hasToken(tokens, 'keyword', 'const')).toBe(true)
  })

  it('recognizes function calls', () => {
    const { tokens } = tokenizeLine('console.log("hi")', 'javascript')
    // 'log' should be a function (followed by `(`)
    expect(hasToken(tokens, 'function', 'log')).toBe(true)
  })

  it('recognizes string literals (double quotes)', () => {
    const { tokens } = tokenizeLine('const s = "hello"', 'javascript')
    expect(hasToken(tokens, 'string', '"hello"')).toBe(true)
  })

  it('recognizes string literals (single quotes)', () => {
    const { tokens } = tokenizeLine("const s = 'hi'", 'javascript')
    expect(hasToken(tokens, 'string', "'hi'")).toBe(true)
  })

  it('recognizes template literals (backticks)', () => {
    const { tokens } = tokenizeLine('const s = `hello`', 'javascript')
    expect(hasToken(tokens, 'string', '`hello`')).toBe(true)
  })

  it('recognizes line comments', () => {
    const { tokens } = tokenizeLine('code() // comment', 'javascript')
    expect(hasToken(tokens, 'comment', '// comment')).toBe(true)
  })

  it('recognizes block comment start', () => {
    const { tokens, inBlockComment } = tokenizeLine('/* start', 'javascript')
    expect(hasToken(tokens, 'comment', '/* start')).toBe(true)
    expect(inBlockComment).toBe(true)
  })

  it('continues block comment across lines', () => {
    const line1 = tokenizeLine('/* start', 'javascript')
    const line2 = tokenizeLine('still in comment', 'javascript', line1.inBlockComment)
    expect(hasToken(line2.tokens, 'comment', 'still in comment')).toBe(true)
    expect(line2.inBlockComment).toBe(true)
  })

  it('ends block comment with */', () => {
    const line1 = tokenizeLine('/* start', 'javascript')
    const line2 = tokenizeLine('end */ code()', 'javascript', line1.inBlockComment)
    expect(line2.inBlockComment).toBe(false)
  })

  it('recognizes numbers', () => {
    const { tokens } = tokenizeLine('const n = 42', 'javascript')
    expect(hasToken(tokens, 'number', '42')).toBe(true)
  })

  it('recognizes decimal numbers', () => {
    const { tokens } = tokenizeLine('const n = 3.14', 'javascript')
    expect(hasToken(tokens, 'number', '3.14')).toBe(true)
  })

  it('recognizes boolean keywords', () => {
    const { tokens } = tokenizeLine('const b = true', 'javascript')
    expect(hasToken(tokens, 'keyword', 'true')).toBe(true)
  })

  it('preserves whitespace indentation', () => {
    const { tokens } = tokenizeLine('  const x = 1', 'javascript')
    expect(tokens[0]).toBeDefined()
    expect(tokens[0]!.type).toBe('plain')
    expect(tokens[0]!.value).toMatch(/^ +/)
  })
})

describe('tokenizeLine — TypeScript', () => {
  it('recognizes TS keywords (interface, type)', () => {
    const { tokens } = tokenizeLine('interface Foo {}', 'typescript')
    expect(hasToken(tokens, 'keyword', 'interface')).toBe(true)
  })

  it('recognizes TS type keyword', () => {
    const { tokens } = tokenizeLine('type X = string', 'typescript')
    expect(hasToken(tokens, 'keyword', 'type')).toBe(true)
  })

  it('recognizes TS access modifiers', () => {
    const { tokens } = tokenizeLine('private x: number = 1', 'typescript')
    expect(hasToken(tokens, 'keyword', 'private')).toBe(true)
  })
})

describe('tokenizeLine — Python', () => {
  it('recognizes def keyword', () => {
    const { tokens } = tokenizeLine('def main():', 'python')
    expect(hasToken(tokens, 'keyword', 'def')).toBe(true)
  })

  it('recognizes class keyword', () => {
    const { tokens } = tokenizeLine('class Foo:', 'python')
    expect(hasToken(tokens, 'keyword', 'class')).toBe(true)
  })

  it('recognizes # comments', () => {
    const { tokens } = tokenizeLine('x = 1  # comment', 'python')
    expect(hasToken(tokens, 'comment', '# comment')).toBe(true)
  })

  it('recognizes return keyword', () => {
    const { tokens } = tokenizeLine('return 42', 'python')
    expect(hasToken(tokens, 'keyword', 'return')).toBe(true)
  })

  it('recognizes True/False/None', () => {
    const { tokens } = tokenizeLine('x = True or False or None', 'python')
    expect(hasToken(tokens, 'keyword', 'True')).toBe(true)
    expect(hasToken(tokens, 'keyword', 'False')).toBe(true)
    expect(hasToken(tokens, 'keyword', 'None')).toBe(true)
  })

  it('recognizes triple-quoted strings as part of one line', () => {
    // Single-line triple-quote string
    const { tokens } = tokenizeLine('"""docstring"""', 'python')
    expect(hasToken(tokens, 'string')).toBe(true)
  })
})

describe('tokenizeLine — HTML', () => {
  it('recognizes tag names', () => {
    const { tokens } = tokenizeLine('<div class="x">', 'html')
    expect(hasToken(tokens, 'tag', 'div')).toBe(true)
  })

  it('recognizes closing tags', () => {
    const { tokens } = tokenizeLine('</div>', 'html')
    expect(hasToken(tokens, 'tag', 'div')).toBe(true)
  })

  it('recognizes attributes', () => {
    const { tokens } = tokenizeLine('<a href="x">', 'html')
    expect(hasToken(tokens, 'attr', 'href')).toBe(true)
  })

  it('recognizes attribute string values', () => {
    const { tokens } = tokenizeLine('<a href="link">', 'html')
    expect(hasToken(tokens, 'string', '"link"')).toBe(true)
  })

  it('recognizes HTML comments', () => {
    const { tokens } = tokenizeLine('<!-- comment -->', 'html')
    expect(hasToken(tokens, 'comment', '<!-- comment -->')).toBe(true)
  })

  it('handles self-closing tags', () => {
    const { tokens } = tokenizeLine('<img src="x" />', 'html')
    expect(hasToken(tokens, 'tag', 'img')).toBe(true)
  })
})

describe('tokenizeLine — CSS', () => {
  it('recognizes property names (followed by :)', () => {
    const { tokens } = tokenizeLine('color: red;', 'css')
    expect(hasToken(tokens, 'attr', 'color')).toBe(true)
  })

  it('recognizes hex colors', () => {
    const { tokens } = tokenizeLine('color: #ff0000;', 'css')
    expect(hasToken(tokens, 'number', '#ff0000')).toBe(true)
  })

  it('recognizes sizes with units', () => {
    const { tokens } = tokenizeLine('margin: 12px;', 'css')
    expect(hasToken(tokens, 'number', '12px')).toBe(true)
  })

  it('recognizes block comments', () => {
    const { tokens } = tokenizeLine('/* comment */', 'css')
    expect(hasToken(tokens, 'comment', '/* comment */')).toBe(true)
  })

  it('recognizes string values', () => {
    const { tokens } = tokenizeLine('content: "hi";', 'css')
    expect(hasToken(tokens, 'string', '"hi"')).toBe(true)
  })
})

describe('tokenizeLine — JSON', () => {
  it('recognizes object keys (strings followed by colon)', () => {
    const { tokens } = tokenizeLine('"name": "Alice"', 'json')
    expect(hasToken(tokens, 'attr', '"name"')).toBe(true)
  })

  it('recognizes string values', () => {
    const { tokens } = tokenizeLine('"name": "Alice"', 'json')
    expect(hasToken(tokens, 'string', '"Alice"')).toBe(true)
  })

  it('recognizes numbers', () => {
    const { tokens } = tokenizeLine('"age": 30', 'json')
    expect(hasToken(tokens, 'number', '30')).toBe(true)
  })

  it('recognizes true/false/null keywords', () => {
    const { tokens } = tokenizeLine('"active": true', 'json')
    expect(hasToken(tokens, 'keyword', 'true')).toBe(true)
  })

  it('recognizes negative numbers', () => {
    const { tokens } = tokenizeLine('"x": -42', 'json')
    expect(hasToken(tokens, 'number', '-42')).toBe(true)
  })
})

describe('tokenizeLine — Markdown', () => {
  it('recognizes headings', () => {
    const { tokens } = tokenizeLine('# Hello', 'markdown')
    expect(hasToken(tokens, 'keyword', '#')).toBe(true)
  })

  it('recognizes level-2 headings', () => {
    const { tokens } = tokenizeLine('## Subheading', 'markdown')
    expect(hasToken(tokens, 'keyword', '##')).toBe(true)
  })

  it('recognizes inline code', () => {
    const { tokens } = tokenizeLine('Use `const` to declare', 'markdown')
    expect(hasToken(tokens, 'string', '`const`')).toBe(true)
  })

  it('recognizes bold', () => {
    const { tokens } = tokenizeLine('**bold** text', 'markdown')
    expect(hasToken(tokens, 'keyword', '**bold**')).toBe(true)
  })

  it('recognizes list items', () => {
    const { tokens } = tokenizeLine('- item one', 'markdown')
    expect(hasToken(tokens, 'punctuation', '-')).toBe(true)
  })

  it('recognizes numbered list items', () => {
    const { tokens } = tokenizeLine('1. first', 'markdown')
    expect(hasToken(tokens, 'punctuation', '1.')).toBe(true)
  })
})

describe('tokenizeLine — Bash', () => {
  it('recognizes # comments', () => {
    const { tokens } = tokenizeLine('echo hi # comment', 'bash')
    expect(hasToken(tokens, 'comment', '# comment')).toBe(true)
  })

  it('recognizes if/then/fi keywords', () => {
    const { tokens } = tokenizeLine('if true; then', 'bash')
    expect(hasToken(tokens, 'keyword', 'if')).toBe(true)
    expect(hasToken(tokens, 'keyword', 'then')).toBe(true)
  })

  it('recognizes echo keyword', () => {
    const { tokens } = tokenizeLine('echo "hi"', 'bash')
    expect(hasToken(tokens, 'keyword', 'echo')).toBe(true)
  })

  it('recognizes string literals', () => {
    const { tokens } = tokenizeLine('echo "hello world"', 'bash')
    expect(hasToken(tokens, 'string', '"hello world"')).toBe(true)
  })
})

describe('tokenizeLine — edge cases', () => {
  it('handles empty line', () => {
    const { tokens } = tokenizeLine('', 'javascript')
    expect(tokens).toEqual([])
  })

  it('handles whitespace-only line', () => {
    const { tokens } = tokenizeLine('   ', 'javascript')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.type).toBe('plain')
  })

  it('handles unknown language as text (no keywords)', () => {
    const { tokens } = tokenizeLine('def main():', 'cobol')
    // No keyword recognition — just plain tokens
    expect(tokens.some(t => t.type === 'keyword')).toBe(false)
  })

  it('handles mixed content (keyword + string + comment)', () => {
    const { tokens } = tokenizeLine('const s = "hi" // done', 'javascript')
    const byType = tokensByType(tokens)
    expect(byType.keyword).toContain('const')
    expect(byType.string).toContain('"hi"')
    expect(byType.comment).toContain('// done')
  })

  it('does not break on strings containing special chars', () => {
    const { tokens } = tokenizeLine('const s = "hello \"world\""', 'javascript')
    expect(hasToken(tokens, 'string')).toBe(true)
  })

  it('handles block comment ending mid-line', () => {
    const line1 = tokenizeLine('/* start', 'javascript')
    const line2 = tokenizeLine('end */ const x = 1', 'javascript', line1.inBlockComment)
    expect(line2.inBlockComment).toBe(false)
    expect(hasToken(line2.tokens, 'keyword', 'const')).toBe(true)
  })

  it('preserves the order of tokens', () => {
    const { tokens } = tokenizeLine('const x = 1;', 'javascript')
    const types = tokens.map(t => t.type)
    // const (keyword) → x (plain) → = (punct) → 1 (number) → ; (punct)
    expect(types.indexOf('keyword')).toBeLessThan(types.indexOf('punctuation'))
  })

  it('handles JSX/TSX same as JS for basic syntax', () => {
    const r1 = tokenizeLine('const x = 1', 'jsx')
    const r2 = tokenizeLine('const x = 1', 'tsx')
    const r3 = tokenizeLine('const x = 1', 'javascript')
    // Same keyword recognition
    expect(hasToken(r1.tokens, 'keyword', 'const')).toBe(true)
    expect(hasToken(r2.tokens, 'keyword', 'const')).toBe(true)
    expect(hasToken(r3.tokens, 'keyword', 'const')).toBe(true)
  })
})
