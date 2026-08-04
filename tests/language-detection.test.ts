// Tests for detectLanguageFromContent and defaultFileNameForLanguage.

import { describe, expect, test } from 'bun:test'
import { detectLanguageFromContent, defaultFileNameForLanguage } from '../src/lib/multi-file'

describe('detectLanguageFromContent', () => {
  test('detects Python with def and print', () => {
    expect(detectLanguageFromContent('def hello():\n    print("hi")\n\nhello()')).toBe('python')
  })
  test('detects Python with import', () => {
    expect(detectLanguageFromContent('import os\nprint(os.getcwd())')).toBe('python')
  })
  test('detects Python with if __name__', () => {
    expect(detectLanguageFromContent("if __name__ == '__main__':\n    print('running')")).toBe('python')
  })
  test('detects Bash with shebang', () => {
    expect(detectLanguageFromContent('#!/bin/bash\nset -e\necho "Hello"\nfor i in 1 2 3; do\n  echo $i\ndone')).toBe('bash')
  })
  test('detects Bash with if/fi', () => {
    expect(detectLanguageFromContent('if [ -f /etc/passwd ]; then\n  echo "exists"\nfi')).toBe('bash')
  })
  test('detects Bash with export', () => {
    expect(detectLanguageFromContent('export PATH=/usr/local/bin:$PATH\necho $PATH')).toBe('bash')
  })
  test('detects SQL SELECT', () => {
    expect(detectLanguageFromContent('SELECT * FROM users WHERE age > 18 ORDER BY name;')).toBe('sql')
  })
  test('detects SQL CREATE TABLE', () => {
    expect(detectLanguageFromContent('CREATE TABLE customers (\n  id INT PRIMARY KEY,\n  name VARCHAR(100)\n);')).toBe('sql')
  })
  test('detects JSON object', () => {
    expect(detectLanguageFromContent('{"name": "nova", "version": 1}')).toBe('json')
  })
  test('detects YAML', () => {
    expect(detectLanguageFromContent('version: "3"\nservices:\n  web:\n    image: nginx')).toBe('yaml')
  })
  test('detects JavaScript with const and require', () => {
    expect(detectLanguageFromContent('const express = require("express");\nconst app = express();')).toBe('javascript')
  })
  test('detects JavaScript with console.log', () => {
    expect(detectLanguageFromContent('function add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));')).toBe('javascript')
  })
  test('detects TypeScript with interface', () => {
    expect(detectLanguageFromContent('interface User {\n  name: string;\n  age: number;\n}\nconst u: User = { name: "a", age: 1 };')).toBe('typescript')
  })
  test('returns text for empty', () => {
    expect(detectLanguageFromContent('')).toBe('text')
  })
  test('returns text for plain English', () => {
    expect(detectLanguageFromContent('This is just plain text.')).toBe('text')
  })
  test('strips leading :filename markers', () => {
    expect(detectLanguageFromContent(':server_config.json\n{"server": {"port": 8080}}')).toBe('json')
  })
})

describe('defaultFileNameForLanguage', () => {
  test('python → script.py', () => {
    expect(defaultFileNameForLanguage('python')).toBe('script.py')
  })
  test('bash → script.sh', () => {
    expect(defaultFileNameForLanguage('bash')).toBe('script.sh')
  })
  test('sql → query.sql', () => {
    expect(defaultFileNameForLanguage('sql')).toBe('query.sql')
  })
  test('json → config.json', () => {
    expect(defaultFileNameForLanguage('json')).toBe('config.json')
  })
  test('text → output.txt', () => {
    expect(defaultFileNameForLanguage('text')).toBe('output.txt')
  })
  test('unknown → output.txt', () => {
    expect(defaultFileNameForLanguage('unknown')).toBe('output.txt')
  })
})
