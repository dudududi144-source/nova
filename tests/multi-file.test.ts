// Tests for multi-file.ts — output type detection, language detection,
// preview inlining, and LLM output parsing.
import { describe, it, expect } from 'bun:test'
import {
  detectOutputType,
  detectLanguage,
  inlineForPreview,
  parseOutput,
  isPreviewable,
  findPrimaryFile,
  type OutputFile,
} from '../src/lib/multi-file'

describe('detectLanguage', () => {
  it('detects html from .html extension', () => {
    expect(detectLanguage('index.html')).toBe('html')
  })

  it('detects htm as html', () => {
    expect(detectLanguage('page.htm')).toBe('html')
  })

  it('detects CSS, JavaScript, TypeScript', () => {
    expect(detectLanguage('style.css')).toBe('css')
    expect(detectLanguage('app.js')).toBe('javascript')
    expect(detectLanguage('app.mjs')).toBe('javascript')
    expect(detectLanguage('app.cjs')).toBe('javascript')
    expect(detectLanguage('app.ts')).toBe('typescript')
  })

  it('detects JSX, TSX', () => {
    expect(detectLanguage('Component.jsx')).toBe('jsx')
    expect(detectLanguage('Component.tsx')).toBe('tsx')
  })

  it('detects Python', () => {
    expect(detectLanguage('main.py')).toBe('python')
  })

  it('detects JSON, Markdown, YAML, TOML', () => {
    expect(detectLanguage('package.json')).toBe('json')
    expect(detectLanguage('README.md')).toBe('markdown')
    expect(detectLanguage('config.yaml')).toBe('yaml')
    expect(detectLanguage('config.yml')).toBe('yaml')
    expect(detectLanguage('pyproject.toml')).toBe('toml')
  })

  it('detects Bash from .sh and .bash', () => {
    expect(detectLanguage('build.sh')).toBe('bash')
    expect(detectLanguage('deploy.bash')).toBe('bash')
  })

  it('detects XML and SVG', () => {
    expect(detectLanguage('data.xml')).toBe('xml')
    expect(detectLanguage('logo.svg')).toBe('xml')
  })

  it('handles query strings and fragments', () => {
    expect(detectLanguage('app.css?v=2')).toBe('css')
    expect(detectLanguage('script.js#main')).toBe('javascript')
  })

  it('returns text for unknown extensions', () => {
    expect(detectLanguage('readme.xyz')).toBe('text')
  })

  it('returns text for paths with no extension', () => {
    expect(detectLanguage('Makefile')).toBe('text')
  })

  it('returns text for empty path', () => {
    expect(detectLanguage('')).toBe('text')
  })

  it('returns text for paths ending with a dot', () => {
    expect(detectLanguage('weird.')).toBe('text')
  })

  it('is case-insensitive', () => {
    expect(detectLanguage('App.TSX')).toBe('tsx')
    expect(detectLanguage('README.MD')).toBe('markdown')
  })
})

describe('detectOutputType', () => {
  it('returns code for empty array', () => {
    expect(detectOutputType([])).toBe('code')
  })

  it('detects html-app for single HTML file', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
    ]
    expect(detectOutputType(files)).toBe('html-app')
  })

  it('detects html-multi for HTML + CSS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
      { path: 'style.css', content: 'body {}', language: 'css' },
    ]
    expect(detectOutputType(files)).toBe('html-multi')
  })

  it('detects html-multi for HTML + JS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
      { path: 'app.js', content: 'console.log()', language: 'javascript' },
    ]
    expect(detectOutputType(files)).toBe('html-multi')
  })

  it('detects react for TSX files', () => {
    const files: OutputFile[] = [
      { path: 'App.tsx', content: 'export default () => <div/>', language: 'tsx' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })

  it('detects react for JSX files', () => {
    const files: OutputFile[] = [
      { path: 'App.jsx', content: 'export default () => <div/>', language: 'jsx' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })

  it('detects react when package.json mentions react', () => {
    const files: OutputFile[] = [
      { path: 'package.json', content: '{"dependencies":{"react":"18"}}', language: 'json' },
      { path: 'index.js', content: 'require("react")', language: 'javascript' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })

  it('detects python for .py files', () => {
    const files: OutputFile[] = [
      { path: 'main.py', content: 'print("hi")', language: 'python' },
    ]
    expect(detectOutputType(files)).toBe('python')
  })

  it('detects node for .js files without HTML', () => {
    const files: OutputFile[] = [
      { path: 'index.js', content: 'console.log()', language: 'javascript' },
    ]
    expect(detectOutputType(files)).toBe('node')
  })

  it('detects node for package.json without react', () => {
    const files: OutputFile[] = [
      { path: 'package.json', content: '{"name":"x"}', language: 'json' },
    ]
    expect(detectOutputType(files)).toBe('node')
  })

  it('detects code for single non-HTML file', () => {
    const files: OutputFile[] = [
      { path: 'README.md', content: '# hi', language: 'markdown' },
    ]
    expect(detectOutputType(files)).toBe('code')
  })

  it('react takes priority over html when both present', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
      { path: 'App.tsx', content: 'export default () => <div/>', language: 'tsx' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })
})

describe('isPreviewable', () => {
  it('returns true for html-app', () => {
    expect(isPreviewable('html-app')).toBe(true)
  })

  it('returns true for html-multi', () => {
    expect(isPreviewable('html-multi')).toBe(true)
  })

  it('returns false for react', () => {
    expect(isPreviewable('react')).toBe(false)
  })

  it('returns false for python', () => {
    expect(isPreviewable('python')).toBe(false)
  })

  it('returns false for node', () => {
    expect(isPreviewable('node')).toBe(false)
  })

  it('returns false for code', () => {
    expect(isPreviewable('code')).toBe(false)
  })
})

describe('findPrimaryFile', () => {
  it('returns the only file when there is one', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
    ]
    expect(findPrimaryFile(files, 'html-app')).toBe('index.html')
  })

  it('prefers index.html for html-app', () => {
    const files: OutputFile[] = [
      { path: 'page.html', content: '', language: 'html' },
      { path: 'index.html', content: '', language: 'html' },
    ]
    expect(findPrimaryFile(files, 'html-app')).toBe('index.html')
  })

  it('falls back to any .html file', () => {
    const files: OutputFile[] = [
      { path: 'page.html', content: '', language: 'html' },
    ]
    expect(findPrimaryFile(files, 'html-app')).toBe('page.html')
  })

  it('prefers App.tsx for react', () => {
    const files: OutputFile[] = [
      { path: 'main.tsx', content: '', language: 'tsx' },
      { path: 'App.tsx', content: '', language: 'tsx' },
    ]
    expect(findPrimaryFile(files, 'react')).toBe('App.tsx')
  })

  it('prefers main.py for python', () => {
    const files: OutputFile[] = [
      { path: 'util.py', content: '', language: 'python' },
      { path: 'main.py', content: '', language: 'python' },
    ]
    expect(findPrimaryFile(files, 'python')).toBe('main.py')
  })

  it('returns empty string for empty array', () => {
    expect(findPrimaryFile([], 'code')).toBe('')
  })
})

describe('inlineForPreview', () => {
  it('returns empty string for empty array', () => {
    expect(inlineForPreview([])).toBe('')
  })

  it('returns empty string when no HTML file', () => {
    const files: OutputFile[] = [
      { path: 'main.py', content: 'print("hi")', language: 'python' },
    ]
    expect(inlineForPreview(files)).toBe('')
  })

  it('inlines <link rel=stylesheet> from sibling CSS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>', language: 'html' },
      { path: 'style.css', content: 'body { color: red; }', language: 'css' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('<style>')
    expect(result).toContain('body { color: red; }')
    expect(result).not.toContain('href="style.css"')
  })

  it('inlines <script src=...> from sibling JS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><script src="app.js"></script></head><body></body></html>', language: 'html' },
      { path: 'app.js', content: 'console.log("hi")', language: 'javascript' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('console.log("hi")')
    expect(result).not.toContain('src="app.js"')
  })

  it('preserves type=module on inlined scripts', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><script type="module" src="app.js"></script></head><body></body></html>', language: 'html' },
      { path: 'app.js', content: 'export const x = 1', language: 'javascript' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('type="module"')
    expect(result).toContain('export const x = 1')
  })

  it('leaves broken references alone', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><link rel="stylesheet" href="missing.css"></head><body></body></html>', language: 'html' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('href="missing.css"')
    expect(result).not.toContain('<style>')
  })

  it('handles reversed attribute order (href before rel)', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><link href="style.css" rel="stylesheet"></head><body></body></html>', language: 'html' },
      { path: 'style.css', content: 'body { color: red; }', language: 'css' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('<style>')
    expect(result).toContain('body { color: red; }')
  })
})

describe('parseOutput', () => {
  it('parses raw HTML as html-app', () => {
    const result = parseOutput('<!DOCTYPE html><html><body></body></html>')
    expect(result.type).toBe('html-app')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('index.html')
    expect(result.previewable).toBe(true)
  })

  it('parses <html> without doctype as html-app', () => {
    const result = parseOutput('<html><body>hi</body></html>')
    expect(result.type).toBe('html-app')
    expect(result.previewable).toBe(true)
  })

  it('parses JSON envelope with files array', () => {
    const json = JSON.stringify({
      files: [
        { path: 'index.html', content: '<html></html>' },
        { path: 'style.css', content: 'body {}' },
      ],
    })
    const result = parseOutput(json)
    expect(result.type).toBe('html-multi')
    expect(result.files).toHaveLength(2)
    expect(result.previewable).toBe(true)
  })

  it('parses JSON envelope with single "file" key (array form)', () => {
    const json = JSON.stringify({
      file: [{ path: 'main.py', content: 'print("hi")' }],
    })
    const result = parseOutput(json)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('main.py')
    expect(result.files[0]!.language).toBe('python')
  })

  it('auto-detects language from path when missing', () => {
    const json = JSON.stringify({
      files: [{ path: 'App.tsx', content: 'export default () => <div/>' }],
    })
    const result = parseOutput(json)
    expect(result.files[0]!.language).toBe('tsx')
    expect(result.type).toBe('react')
  })

  it('handles JSON wrapped in markdown code fence', () => {
    const wrapped = '```json\n' + JSON.stringify({
      files: [{ path: 'index.html', content: '<html></html>' }],
    }) + '\n```'
    const result = parseOutput(wrapped)
    expect(result.type).toBe('html-app')
    expect(result.files).toHaveLength(1)
  })

  it('handles HTML wrapped in markdown code fence', () => {
    const wrapped = '```html\n<!DOCTYPE html><html></html>\n```'
    const result = parseOutput(wrapped)
    expect(result.type).toBe('html-app')
  })

  it('returns empty result for empty input', () => {
    const result = parseOutput('')
    expect(result.type).toBe('code')
    expect(result.files).toHaveLength(0)
    expect(result.previewable).toBe(false)
  })

  it('returns empty result for whitespace-only input', () => {
    const result = parseOutput('   \n\n  ')
    expect(result.files).toHaveLength(0)
  })

  it('falls back to single code file for non-HTML text', () => {
    const result = parseOutput('Just some prose text')
    expect(result.type).toBe('code')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('output.txt')
    expect(result.previewable).toBe(false)
  })

  it('extracts balanced JSON from surrounding prose', () => {
    const text = 'Here is the project:\n' + JSON.stringify({
      files: [{ path: 'main.py', content: 'print("hi")' }],
    }) + '\nLet me know if you need anything else.'
    const result = parseOutput(text)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('main.py')
  })

  it('handles JSON with name field instead of path', () => {
    const json = JSON.stringify({
      files: [{ name: 'app.js', content: 'console.log()' }],
    })
    const result = parseOutput(json)
    expect(result.files[0]!.path).toBe('app.js')
    expect(result.files[0]!.language).toBe('javascript')
  })

  it('skips file entries missing path', () => {
    const json = JSON.stringify({
      files: [
        { content: 'no path here' },
        { path: 'app.js', content: 'console.log()' },
      ],
    })
    const result = parseOutput(json)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('app.js')
  })

  it('skips non-object file entries', () => {
    const json = JSON.stringify({
      files: [
        'not an object',
        { path: 'app.js', content: 'console.log()' },
      ],
    })
    const result = parseOutput(json)
    expect(result.files).toHaveLength(1)
  })
})
