// Tests for detectLanguageFromContent with more edge cases.
// Tests language detection accuracy for various code patterns.

import { describe, expect, test } from 'bun:test'
import { detectLanguageFromContent, defaultFileNameForLanguage } from '../src/lib/multi-file'

describe('detectLanguageFromContent — edge cases', () => {
  test('detects Python with class and type hints', () => {
    const code = `class Calculator:
    def __init__(self, value: int = 0):
        self.value = value

    def add(self, x: int) -> int:
        return self.value + x

calc = Calculator(10)
print(calc.add(5))`
    expect(detectLanguageFromContent(code)).toBe('python')
  })

  test('detects Python with list comprehension', () => {
    const code = `numbers = [1, 2, 3, 4, 5]
squared = [x**2 for x in numbers]
print(squared)`
    expect(detectLanguageFromContent(code)).toBe('python')
  })

  test('detects Bash with case statement', () => {
    const code = `#!/bin/bash
case "$1" in
  start)
    echo "Starting..."
    ;;
  stop)
    echo "Stopping..."
    ;;
  *)
    echo "Usage: $0 {start|stop}"
    ;;
esac`
    expect(detectLanguageFromContent(code)).toBe('bash')
  })

  test('detects SQL with JOIN', () => {
    const code = `SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.active = 1
GROUP BY u.id
HAVING order_count > 5
ORDER BY order_count DESC;`
    expect(detectLanguageFromContent(code)).toBe('sql')
  })

  test('detects JSON array', () => {
    const code = `[
  {"name": "Alice", "age": 30},
  {"name": "Bob", "age": 25},
  {"name": "Charlie", "age": 35}
]`
    expect(detectLanguageFromContent(code)).toBe('json')
  })

  test('detects YAML with nested structure', () => {
    const code = `version: "3.8"
services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
    environment:
      - NGINX_HOST=example.com
  db:
    image: postgres:13
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  db_data:`
    expect(detectLanguageFromContent(code)).toBe('yaml')
  })

  test('detects TypeScript with generics', () => {
    const code = `function identity<T>(arg: T): T {
  return arg;
}

interface Box<T> {
  value: T;
}

const box: Box<string> = { value: "hello" };
console.log(box.value);`
    expect(detectLanguageFromContent(code)).toBe('typescript')
  })

  test('returns text for plain English', () => {
    expect(detectLanguageFromContent('This is just a plain text description.')).toBe('text')
  })

  test('returns text for empty string', () => {
    expect(detectLanguageFromContent('')).toBe('text')
  })

  test('strips leading :filename markers', () => {
    expect(detectLanguageFromContent(':server_config.json\n{"server": {"port": 8080}}')).toBe('json')
  })
})

describe('defaultFileNameForLanguage — all languages', () => {
  test('python → script.py', () => expect(defaultFileNameForLanguage('python')).toBe('script.py'))
  test('bash → script.sh', () => expect(defaultFileNameForLanguage('bash')).toBe('script.sh'))
  test('sql → query.sql', () => expect(defaultFileNameForLanguage('sql')).toBe('query.sql'))
  test('javascript → script.js', () => expect(defaultFileNameForLanguage('javascript')).toBe('script.js'))
  test('typescript → script.ts', () => expect(defaultFileNameForLanguage('typescript')).toBe('script.ts'))
  test('json → config.json', () => expect(defaultFileNameForLanguage('json')).toBe('config.json'))
  test('yaml → config.yaml', () => expect(defaultFileNameForLanguage('yaml')).toBe('config.yaml'))
  test('rust → main.rs', () => expect(defaultFileNameForLanguage('rust')).toBe('main.rs'))
  test('go → main.go', () => expect(defaultFileNameForLanguage('go')).toBe('main.go'))
  test('text → output.txt', () => expect(defaultFileNameForLanguage('text')).toBe('output.txt'))
  test('unknown → output.txt', () => expect(defaultFileNameForLanguage('unknown')).toBe('output.txt'))
})
