// Comprehensive tests for src/lib/multi-file.ts
// Tests: parseOutput (all output types), detectLanguageFromContent (30+ samples),
// inlineForPreview, detectOutputType, findPrimaryFile, defaultFileNameForLanguage, isPreviewable
import { describe, expect, test } from 'bun:test'
import {
  parseOutput,
  detectOutputType,
  detectLanguage,
  detectLanguageFromContent,
  defaultFileNameForLanguage,
  findPrimaryFile,
  inlineForPreview,
  isPreviewable,
  type OutputFile,
  type OutputType,
} from '../src/lib/multi-file'

// ──────────────────────────────────────────────────────────────────────────────
// parseOutput — all output types
// ──────────────────────────────────────────────────────────────────────────────

describe('parseOutput — raw HTML', () => {
  test('parses <!DOCTYPE html> as html-app', () => {
    const result = parseOutput('<!DOCTYPE html><html><body></body></html>')
    expect(result.type).toBe('html-app')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('index.html')
    expect(result.files[0]!.language).toBe('html')
    expect(result.previewable).toBe(true)
    expect(result.primaryFile).toBe('index.html')
  })

  test('parses <html> without doctype as html-app', () => {
    const result = parseOutput('<html><body>hi</body></html>')
    expect(result.type).toBe('html-app')
    expect(result.previewable).toBe(true)
  })

  test('parses uppercase <HTML> as html-app', () => {
    const result = parseOutput('<HTML><BODY>hi</BODY></HTML>')
    expect(result.type).toBe('html-app')
  })

  test('parses HTML wrapped in ```html code fence', () => {
    const wrapped = '```html\n<!DOCTYPE html><html></html>\n```'
    const result = parseOutput(wrapped)
    expect(result.type).toBe('html-app')
    expect(result.files).toHaveLength(1)
  })
})

describe('parseOutput — JSON envelope', () => {
  test('parses JSON envelope with files array (html-multi)', () => {
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

  test('parses JSON envelope with single "file" key (array form)', () => {
    const json = JSON.stringify({
      file: [{ path: 'main.py', content: 'print("hi")' }],
    })
    const result = parseOutput(json)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('main.py')
    expect(result.files[0]!.language).toBe('python')
  })

  test('auto-detects language from path when missing', () => {
    const json = JSON.stringify({
      files: [{ path: 'App.tsx', content: 'export default () => <div/>' }],
    })
    const result = parseOutput(json)
    expect(result.files[0]!.language).toBe('tsx')
    expect(result.type).toBe('react')
  })

  test('respects explicit language field over auto-detection', () => {
    const json = JSON.stringify({
      files: [{ path: 'App.tsx', content: '<div/>', language: 'jsx' }],
    })
    const result = parseOutput(json)
    expect(result.files[0]!.language).toBe('jsx')
  })

  test('handles JSON wrapped in ```json code fence', () => {
    const wrapped = '```json\n' + JSON.stringify({
      files: [{ path: 'index.html', content: '<html></html>' }],
    }) + '\n```'
    const result = parseOutput(wrapped)
    expect(result.type).toBe('html-app')
    expect(result.files).toHaveLength(1)
  })

  test('extracts balanced JSON from surrounding prose', () => {
    const text = 'Here is the project:\n' + JSON.stringify({
      files: [{ path: 'main.py', content: 'print("hi")' }],
    }) + '\nLet me know if you need anything else.'
    const result = parseOutput(text)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('main.py')
  })

  test('handles JSON with "name" field instead of "path"', () => {
    const json = JSON.stringify({
      files: [{ name: 'app.js', content: 'console.log()' }],
    })
    const result = parseOutput(json)
    expect(result.files[0]!.path).toBe('app.js')
    expect(result.files[0]!.language).toBe('javascript')
  })

  test('skips file entries missing path', () => {
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

  test('skips non-object file entries', () => {
    const json = JSON.stringify({
      files: [
        'not an object',
        42,
        null,
        { path: 'app.js', content: 'console.log()' },
      ],
    })
    const result = parseOutput(json)
    expect(result.files).toHaveLength(1)
  })

  test('handles empty content field gracefully', () => {
    const json = JSON.stringify({
      files: [{ path: 'empty.txt', content: '' }],
    })
    const result = parseOutput(json)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.content).toBe('')
  })
})

describe('parseOutput — react output', () => {
  test('detects react from tsx files', () => {
    const json = JSON.stringify({
      files: [
        { path: 'App.tsx', content: 'export default () => <div/>' },
        { path: 'index.html', content: '<html></html>' },
      ],
    })
    const result = parseOutput(json)
    expect(result.type).toBe('react')
    expect(result.previewable).toBe(false)
  })

  test('detects react from package.json with react dependency', () => {
    const json = JSON.stringify({
      files: [
        { path: 'package.json', content: '{"dependencies":{"react":"18"}}' },
        { path: 'index.js', content: 'require("react")' },
      ],
    })
    const result = parseOutput(json)
    expect(result.type).toBe('react')
  })
})

describe('parseOutput — python output', () => {
  test('detects python from .py files', () => {
    const json = JSON.stringify({
      files: [{ path: 'main.py', content: 'print("hi")' }],
    })
    const result = parseOutput(json)
    expect(result.type).toBe('python')
    expect(result.previewable).toBe(false)
  })
})

describe('parseOutput — node output', () => {
  test('detects node from package.json without react', () => {
    const json = JSON.stringify({
      files: [{ path: 'package.json', content: '{"name":"x"}' }],
    })
    const result = parseOutput(json)
    expect(result.type).toBe('node')
    expect(result.previewable).toBe(false)
  })

  test('detects node from .js file', () => {
    const json = JSON.stringify({
      files: [{ path: 'index.js', content: 'console.log()' }],
    })
    const result = parseOutput(json)
    expect(result.type).toBe('node')
  })
})

describe('parseOutput — code fallback', () => {
  test('returns empty result for empty input', () => {
    const result = parseOutput('')
    expect(result.type).toBe('code')
    expect(result.files).toHaveLength(0)
    expect(result.previewable).toBe(false)
    expect(result.primaryFile).toBe('')
  })

  test('returns empty result for whitespace-only input', () => {
    const result = parseOutput('   \n\n  ')
    expect(result.files).toHaveLength(0)
  })

  test('falls back to single code file for non-HTML prose', () => {
    const result = parseOutput('Just some prose text')
    expect(result.type).toBe('code')
    expect(result.files).toHaveLength(1)
    expect(result.previewable).toBe(false)
  })

  test('detects python from content (not path) in fallback', () => {
    const result = parseOutput('def hello():\n    print("Hello, World!")')
    expect(result.type).toBe('python')
    expect(result.files[0]!.language).toBe('python')
    expect(result.files[0]!.path).toBe('script.py')
  })

  test('detects javascript from content in fallback', () => {
    const result = parseOutput('const x = 42;\nconsole.log(x);')
    expect(result.type).toBe('node')
    expect(result.files[0]!.language).toBe('javascript')
  })

  test('detects sql from content in fallback', () => {
    const result = parseOutput('CREATE TABLE users (id INT, name VARCHAR(255));')
    expect(result.type).toBe('code')
    expect(result.files[0]!.language).toBe('sql')
    expect(result.files[0]!.path).toBe('query.sql')
  })

  test('detects bash from content in fallback', () => {
    const result = parseOutput('#!/bin/bash\nset -e\nexport PATH=/usr/bin')
    expect(result.files[0]!.language).toBe('bash')
    expect(result.files[0]!.path).toBe('script.sh')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// detectLanguageFromContent — 30+ code samples
// ──────────────────────────────────────────────────────────────────────────────

describe('detectLanguageFromContent — Python', () => {
  test('detects Python from def + print', () => {
    expect(detectLanguageFromContent('def hello():\n    print("hi")')).toBe('python')
  })

  test('detects Python from import + class', () => {
    expect(detectLanguageFromContent('import os\nclass Foo:\n    pass')).toBe('python')
  })

  test('detects Python from from-import + print', () => {
    expect(detectLanguageFromContent('from collections import defaultdict\nprint(defaultdict)')).toBe('python')
  })

  test('detects Python from __main__ check + def', () => {
    expect(detectLanguageFromContent('def main():\n    pass\n\nif __name__ == "__main__":\n    main()')).toBe('python')
  })

  test('detects Python from list comprehension + print', () => {
    expect(detectLanguageFromContent('squares = [x**2 for x in range(10)]\nprint(squares)')).toBe('python')
  })

  test('detects Python from with open + print', () => {
    expect(detectLanguageFromContent('with open("file.txt") as f:\n    data = f.read()\nprint(data)')).toBe('python')
  })

  test('detects Python from raise + def', () => {
    expect(detectLanguageFromContent('def check(x):\n    if x < 0:\n        raise ValueError("negative")')).toBe('python')
  })

  test('detects Python from lambda in a function + print', () => {
    expect(detectLanguageFromContent('def make_squarer():\n    return lambda x: x**2\nprint(make_squarer()(5))')).toBe('python')
  })

  test('detects Python from elif + def', () => {
    expect(detectLanguageFromContent('def classify(x):\n    if x > 0:\n        return "pos"\n    elif x < 0:\n        return "neg"')).toBe('python')
  })
})

describe('detectLanguageFromContent — Bash', () => {
  test('detects Bash from #!/bin/bash shebang', () => {
    expect(detectLanguageFromContent('#!/bin/bash\necho "hello"')).toBe('bash')
  })

  test('detects Bash from #!/bin/sh shebang', () => {
    expect(detectLanguageFromContent('#!/bin/sh\nset -e\necho done')).toBe('bash')
  })

  test('detects Bash from set -e + export', () => {
    expect(detectLanguageFromContent('set -e\nexport FOO=bar')).toBe('bash')
  })

  test('detects Bash from if [ ] + fi + echo', () => {
    expect(detectLanguageFromContent('if [ -f file ]; then\n  echo "yes"\nfi')).toBe('bash')
  })

  test('detects Bash from case/esac', () => {
    expect(detectLanguageFromContent('case $mode in\n  start) echo "start" ;;\nesac')).toBe('bash')
  })

  test('detects Bash from $() command substitution', () => {
    expect(detectLanguageFromContent('name=$(whoami)\necho "Hello, $name"')).toBe('bash')
  })

  test('detects Bash from while [ ] + done', () => {
    expect(detectLanguageFromContent('while [ $i -lt 10 ]; do\n  echo $i\n  i=$((i+1))\ndone')).toBe('bash')
  })

  test('detects Bash from ${} variable expansion', () => {
    expect(detectLanguageFromContent('echo "${HOME}/.bashrc"')).toBe('bash')
  })
})

describe('detectLanguageFromContent — JSON', () => {
  test('detects JSON object', () => {
    expect(detectLanguageFromContent('{"name": "test", "value": 123}')).toBe('json')
  })

  test('detects JSON array', () => {
    expect(detectLanguageFromContent('[1, 2, 3, "four"]')).toBe('json')
  })

  test('detects nested JSON', () => {
    expect(detectLanguageFromContent('{"nested": {"key": [1, 2]}}')).toBe('json')
  })

  test('does not detect malformed object as JSON', () => {
    // { at start, } at end, but not valid JSON — should fall through to other detectors
    const result = detectLanguageFromContent('{ this is not valid json }')
    // Should not be 'json'
    expect(result).not.toBe('json')
  })
})

describe('detectLanguageFromContent — HTML', () => {
  test('detects HTML with <!DOCTYPE>', () => {
    expect(detectLanguageFromContent('<!DOCTYPE html><html><body></body></html>')).toBe('html')
  })

  test('detects HTML with <html> tag (no doctype)', () => {
    expect(detectLanguageFromContent('<html><head></head><body></body></html>')).toBe('html')
  })

  test('detects HTML with uppercase <HTML>', () => {
    expect(detectLanguageFromContent('<HTML><BODY></BODY></HTML>')).toBe('html')
  })
})

describe('detectLanguageFromContent — SQL', () => {
  test('detects SQL from CREATE TABLE', () => {
    expect(detectLanguageFromContent('CREATE TABLE users (id INT, name VARCHAR(255));')).toBe('sql')
  })

  test('detects SQL from INSERT INTO', () => {
    expect(detectLanguageFromContent("INSERT INTO users (id, name) VALUES (1, 'John');")).toBe('sql')
  })

  test('detects SQL from SELECT + FROM + WHERE', () => {
    expect(detectLanguageFromContent('SELECT * FROM users WHERE id = 1;')).toBe('sql')
  })

  test('detects SQL from DROP TABLE', () => {
    expect(detectLanguageFromContent('DROP TABLE old_data;')).toBe('sql')
  })
})

describe('detectLanguageFromContent — Rust', () => {
  test('detects Rust from fn + let mut', () => {
    expect(detectLanguageFromContent('fn main() {\n    let mut x = 5;\n    println!("{}", x);\n}')).toBe('rust')
  })

  test('detects Rust from use std + pub fn', () => {
    expect(detectLanguageFromContent('use std::collections::HashMap;\npub fn new_map() -> HashMap<String, i32> {\n    HashMap::new()\n}')).toBe('rust')
  })

  test('detects Rust from impl + fn', () => {
    expect(detectLanguageFromContent('impl MyStruct {\n    fn method(&self) -> i32 {\n        42\n    }\n}')).toBe('rust')
  })
})

describe('detectLanguageFromContent — Go', () => {
  test('detects Go from package + func', () => {
    expect(detectLanguageFromContent('package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}')).toBe('go')
  })

  test('detects Go from package + type struct', () => {
    expect(detectLanguageFromContent('package models\n\ntype User struct {\n    ID int\n    Name string\n}')).toBe('go')
  })
})

describe('detectLanguageFromContent — TypeScript', () => {
  test('detects TypeScript from interface + types', () => {
    expect(detectLanguageFromContent('interface User {\n  name: string;\n  age: number;\n}')).toBe('typescript')
  })

  test('detects TypeScript from type alias', () => {
    expect(detectLanguageFromContent('type Status = "active" | "inactive";')).toBe('typescript')
  })

  test('detects TypeScript from generic function', () => {
    expect(detectLanguageFromContent('function identity<T>(arg: T): T {\n  return arg;\n}')).toBe('typescript')
  })
})

describe('detectLanguageFromContent — JavaScript', () => {
  test('detects JavaScript from const + console.log', () => {
    expect(detectLanguageFromContent('const x = 42;\nconsole.log(x);')).toBe('javascript')
  })

  test('detects JavaScript from function + console.log', () => {
    expect(detectLanguageFromContent('function add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));')).toBe('javascript')
  })

  test('detects JavaScript from const arrow + console.log', () => {
    expect(detectLanguageFromContent('const greet = (name) => {\n  console.log("Hello, " + name);\n};')).toBe('javascript')
  })

  test('detects JavaScript from require + const', () => {
    expect(detectLanguageFromContent('const fs = require("fs");\nfs.readFile("file.txt");')).toBe('javascript')
  })
})

describe('detectLanguageFromContent — YAML / Markdown / CSS', () => {
  test('detects YAML from key: value lines', () => {
    expect(detectLanguageFromContent('name: my-app\nversion: 1.0.0\ndescription: A sample app\nauthor: test')).toBe('yaml')
  })

  test('detects Markdown from # heading + **bold**', () => {
    expect(detectLanguageFromContent('# Hello World\n\nThis is **bold** text.')).toBe('markdown')
  })

  test('detects CSS from selector + properties', () => {
    expect(detectLanguageFromContent('body {\n  color: red;\n  background: white;\n}')).toBe('css')
  })
})

describe('detectLanguageFromContent — shebangs', () => {
  test('detects Python from #!/usr/bin/env python3', () => {
    expect(detectLanguageFromContent('#!/usr/bin/env python3\nprint("hi")')).toBe('python')
  })

  test('detects Bash from #!/usr/bin/env bash', () => {
    expect(detectLanguageFromContent('#!/usr/bin/env bash\necho hi')).toBe('bash')
  })

  test('detects JavaScript from #!/usr/bin/env node', () => {
    expect(detectLanguageFromContent('#!/usr/bin/env node\nconsole.log("hi")')).toBe('javascript')
  })

  test('detects Ruby from #!/usr/bin/env ruby', () => {
    expect(detectLanguageFromContent('#!/usr/bin/env ruby\nputs "hi"')).toBe('ruby')
  })

  test('detects Perl from #!/usr/bin/perl', () => {
    expect(detectLanguageFromContent('#!/usr/bin/perl\nprint "hi";')).toBe('perl')
  })
})

describe('detectLanguageFromContent — edge cases', () => {
  test('returns text for empty string', () => {
    expect(detectLanguageFromContent('')).toBe('text')
  })

  test('returns text for whitespace-only string', () => {
    expect(detectLanguageFromContent('   \n\n  ')).toBe('text')
  })

  test('returns text for plain prose without code signals', () => {
    expect(detectLanguageFromContent('Just a regular sentence with no code.')).toBe('text')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// detectOutputType — all output types
// ──────────────────────────────────────────────────────────────────────────────

describe('detectOutputType — all types', () => {
  test('returns code for empty array', () => {
    expect(detectOutputType([])).toBe('code')
  })

  test('detects html-app for single HTML file', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
    ]
    expect(detectOutputType(files)).toBe('html-app')
  })

  test('detects html-multi for HTML + CSS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
      { path: 'style.css', content: 'body {}', language: 'css' },
    ]
    expect(detectOutputType(files)).toBe('html-multi')
  })

  test('detects html-multi for HTML + JS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
      { path: 'app.js', content: 'console.log()', language: 'javascript' },
    ]
    expect(detectOutputType(files)).toBe('html-multi')
  })

  test('detects react for TSX files', () => {
    const files: OutputFile[] = [
      { path: 'App.tsx', content: 'export default () => <div/>', language: 'tsx' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })

  test('detects react for JSX files', () => {
    const files: OutputFile[] = [
      { path: 'App.jsx', content: 'export default () => <div/>', language: 'jsx' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })

  test('detects react when package.json mentions react', () => {
    const files: OutputFile[] = [
      { path: 'package.json', content: '{"dependencies":{"react":"18"}}', language: 'json' },
      { path: 'index.js', content: 'require("react")', language: 'javascript' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })

  test('detects python for .py files', () => {
    const files: OutputFile[] = [
      { path: 'main.py', content: 'print("hi")', language: 'python' },
    ]
    expect(detectOutputType(files)).toBe('python')
  })

  test('detects node for .js files without HTML', () => {
    const files: OutputFile[] = [
      { path: 'index.js', content: 'console.log()', language: 'javascript' },
    ]
    expect(detectOutputType(files)).toBe('node')
  })

  test('detects node for package.json without react', () => {
    const files: OutputFile[] = [
      { path: 'package.json', content: '{"name":"x"}', language: 'json' },
    ]
    expect(detectOutputType(files)).toBe('node')
  })

  test('detects code for single non-HTML file', () => {
    const files: OutputFile[] = [
      { path: 'README.md', content: '# hi', language: 'markdown' },
    ]
    expect(detectOutputType(files)).toBe('code')
  })

  test('react takes priority over html when both present', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
      { path: 'App.tsx', content: 'export default () => <div/>', language: 'tsx' },
    ]
    expect(detectOutputType(files)).toBe('react')
  })

  test('html + only non-CSS/JS files → html-app', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
      { path: 'README.md', content: '# hi', language: 'markdown' },
    ]
    expect(detectOutputType(files)).toBe('html-app')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// findPrimaryFile — all output types
// ──────────────────────────────────────────────────────────────────────────────

describe('findPrimaryFile — all types', () => {
  test('returns empty string for empty array', () => {
    expect(findPrimaryFile([], 'code')).toBe('')
  })

  test('returns the only file when there is one', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html></html>', language: 'html' },
    ]
    expect(findPrimaryFile(files, 'html-app')).toBe('index.html')
  })

  test('prefers index.html for html-app', () => {
    const files: OutputFile[] = [
      { path: 'page.html', content: '', language: 'html' },
      { path: 'index.html', content: '', language: 'html' },
    ]
    expect(findPrimaryFile(files, 'html-app')).toBe('index.html')
  })

  test('prefers app.html for html-multi (after index.html)', () => {
    const files: OutputFile[] = [
      { path: 'page.html', content: '', language: 'html' },
      { path: 'app.html', content: '', language: 'html' },
    ]
    expect(findPrimaryFile(files, 'html-multi')).toBe('app.html')
  })

  test('falls back to any .html file', () => {
    const files: OutputFile[] = [
      { path: 'page.html', content: '', language: 'html' },
    ]
    expect(findPrimaryFile(files, 'html-app')).toBe('page.html')
  })

  test('prefers App.tsx for react', () => {
    const files: OutputFile[] = [
      { path: 'main.tsx', content: '', language: 'tsx' },
      { path: 'App.tsx', content: '', language: 'tsx' },
    ]
    expect(findPrimaryFile(files, 'react')).toBe('App.tsx')
  })

  test('falls back to first .tsx for react', () => {
    const files: OutputFile[] = [
      { path: 'Component.tsx', content: '', language: 'tsx' },
    ]
    expect(findPrimaryFile(files, 'react')).toBe('Component.tsx')
  })

  test('prefers main.py for python', () => {
    const files: OutputFile[] = [
      { path: 'util.py', content: '', language: 'python' },
      { path: 'main.py', content: '', language: 'python' },
    ]
    expect(findPrimaryFile(files, 'python')).toBe('main.py')
  })

  test('prefers app.py for python (after main.py)', () => {
    const files: OutputFile[] = [
      { path: 'util.py', content: '', language: 'python' },
      { path: 'app.py', content: '', language: 'python' },
    ]
    expect(findPrimaryFile(files, 'python')).toBe('app.py')
  })

  test('prefers package.json for node', () => {
    const files: OutputFile[] = [
      { path: 'index.js', content: '', language: 'javascript' },
      { path: 'package.json', content: '{}', language: 'json' },
    ]
    expect(findPrimaryFile(files, 'node')).toBe('package.json')
  })

  test('prefers index.js for node (after package.json)', () => {
    const files: OutputFile[] = [
      { path: 'server.js', content: '', language: 'javascript' },
      { path: 'index.js', content: '', language: 'javascript' },
    ]
    expect(findPrimaryFile(files, 'node')).toBe('index.js')
  })

  test('returns first file for code type', () => {
    const files: OutputFile[] = [
      { path: 'README.md', content: '', language: 'markdown' },
    ]
    expect(findPrimaryFile(files, 'code')).toBe('README.md')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// inlineForPreview
// ──────────────────────────────────────────────────────────────────────────────

describe('inlineForPreview', () => {
  test('returns empty string for empty array', () => {
    expect(inlineForPreview([])).toBe('')
  })

  test('returns empty string when no HTML file', () => {
    const files: OutputFile[] = [
      { path: 'main.py', content: 'print("hi")', language: 'python' },
    ]
    expect(inlineForPreview(files)).toBe('')
  })

  test('inlines <link rel=stylesheet> from sibling CSS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>', language: 'html' },
      { path: 'style.css', content: 'body { color: red; }', language: 'css' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('<style>')
    expect(result).toContain('body { color: red; }')
    expect(result).not.toContain('href="style.css"')
  })

  test('inlines <script src=...> from sibling JS', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><script src="app.js"></script></head><body></body></html>', language: 'html' },
      { path: 'app.js', content: 'console.log("hi")', language: 'javascript' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('console.log("hi")')
    expect(result).not.toContain('src="app.js"')
  })

  test('preserves type=module on inlined scripts', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><script type="module" src="app.js"></script></head><body></body></html>', language: 'html' },
      { path: 'app.js', content: 'export const x = 1', language: 'javascript' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('type="module"')
    expect(result).toContain('export const x = 1')
  })

  test('leaves broken references alone', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><link rel="stylesheet" href="missing.css"></head><body></body></html>', language: 'html' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('href="missing.css"')
    expect(result).not.toContain('<style>')
  })

  test('handles reversed attribute order (href before rel)', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><link href="style.css" rel="stylesheet"></head><body></body></html>', language: 'html' },
      { path: 'style.css', content: 'body { color: red; }', language: 'css' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('<style>')
    expect(result).toContain('body { color: red; }')
  })

  test('inlines multiple stylesheets', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css"></head><body></body></html>', language: 'html' },
      { path: 'a.css', content: '.a { color: red; }', language: 'css' },
      { path: 'b.css', content: '.b { color: blue; }', language: 'css' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('.a { color: red; }')
    expect(result).toContain('.b { color: blue; }')
  })

  test('inlines multiple scripts', () => {
    const files: OutputFile[] = [
      { path: 'index.html', content: '<html><head><script src="a.js"></script><script src="b.js"></script></head><body></body></html>', language: 'html' },
      { path: 'a.js', content: 'var a = 1;', language: 'javascript' },
      { path: 'b.js', content: 'var b = 2;', language: 'javascript' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('var a = 1;')
    expect(result).toContain('var b = 2;')
  })

  test('handles single-quoted attributes', () => {
    const files: OutputFile[] = [
      { path: "index.html", content: "<html><head><link rel='stylesheet' href='style.css'></head><body></body></html>", language: 'html' },
      { path: 'style.css', content: 'body { color: red; }', language: 'css' },
    ]
    const result = inlineForPreview(files)
    expect(result).toContain('<style>')
    expect(result).toContain('body { color: red; }')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// defaultFileNameForLanguage + isPreviewable
// ──────────────────────────────────────────────────────────────────────────────

describe('defaultFileNameForLanguage', () => {
  test('returns script.py for python', () => {
    expect(defaultFileNameForLanguage('python')).toBe('script.py')
  })

  test('returns query.sql for sql', () => {
    expect(defaultFileNameForLanguage('sql')).toBe('query.sql')
  })

  test('returns script.sh for bash', () => {
    expect(defaultFileNameForLanguage('bash')).toBe('script.sh')
  })

  test('returns script.js for javascript', () => {
    expect(defaultFileNameForLanguage('javascript')).toBe('script.js')
  })

  test('returns script.ts for typescript', () => {
    expect(defaultFileNameForLanguage('typescript')).toBe('script.ts')
  })

  test('returns index.html for html', () => {
    expect(defaultFileNameForLanguage('html')).toBe('index.html')
  })

  test('returns styles.css for css', () => {
    expect(defaultFileNameForLanguage('css')).toBe('styles.css')
  })

  test('returns README.md for markdown', () => {
    expect(defaultFileNameForLanguage('markdown')).toBe('README.md')
  })

  test('returns config.json for json', () => {
    expect(defaultFileNameForLanguage('json')).toBe('config.json')
  })

  test('returns main.rs for rust', () => {
    expect(defaultFileNameForLanguage('rust')).toBe('main.rs')
  })

  test('returns main.go for go', () => {
    expect(defaultFileNameForLanguage('go')).toBe('main.go')
  })

  test('returns output.txt for unknown language', () => {
    expect(defaultFileNameForLanguage('unknown')).toBe('output.txt')
  })

  test('returns output.txt for text', () => {
    expect(defaultFileNameForLanguage('text')).toBe('output.txt')
  })
})

describe('isPreviewable', () => {
  test('returns true for html-app', () => {
    expect(isPreviewable('html-app')).toBe(true)
  })

  test('returns true for html-multi', () => {
    expect(isPreviewable('html-multi')).toBe(true)
  })

  test('returns false for react', () => {
    expect(isPreviewable('react')).toBe(false)
  })

  test('returns false for python', () => {
    expect(isPreviewable('python')).toBe(false)
  })

  test('returns false for node', () => {
    expect(isPreviewable('node')).toBe(false)
  })

  test('returns false for code', () => {
    expect(isPreviewable('code')).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// detectLanguage (extension-based) — additional edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe('detectLanguage — extension-based edge cases', () => {
  test('handles nested paths', () => {
    expect(detectLanguage('src/components/Button.tsx')).toBe('tsx')
    expect(detectLanguage('public/assets/logo.svg')).toBe('xml')
  })

  test('handles paths with multiple dots', () => {
    expect(detectLanguage('app.test.js')).toBe('javascript')
    expect(detectLanguage('config.dev.json')).toBe('json')
  })

  test('handles paths with dots in directory names', () => {
    expect(detectLanguage('v2.0/index.html')).toBe('html')
  })
})
