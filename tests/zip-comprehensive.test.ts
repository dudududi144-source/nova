// Comprehensive tests for src/lib/zip.ts
// Tests createZip with various file sets: empty files, large files, unicode
// filenames, binary content, deep paths, CRC32 correctness, and edge cases.
import { describe, expect, test } from 'bun:test'
import { createZip, crc32, type ZipFile } from '../src/lib/zip'

// ── Helpers ──

function readUint16(buf: Uint8Array, offset: number): number {
  return (buf[offset]! | (buf[offset + 1]! << 8)) >>> 0
}

function readUint32(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24))) >>> 0
}

const SIG_LOCAL_FILE = 0x04034b50
const SIG_CENTRAL_DIR = 0x02014b50
const SIG_END_CENTRAL_DIR = 0x06054b50

function isFirstPkPair(buf: Uint8Array, offset: number): boolean {
  return buf[offset] === 0x50 && buf[offset + 1] === 0x4b
}

const encoder = new TextEncoder()
function utf8(s: string): Uint8Array {
  return encoder.encode(s)
}

/** Extract filename from a local file header at the given offset. */
function readLocalFileName(buf: Uint8Array, headerOffset: number): string {
  const nameLen = readUint16(buf, headerOffset + 26)
  return new TextDecoder().decode(buf.slice(headerOffset + 30, headerOffset + 30 + nameLen))
}

/** Find the offset of the central directory (first PK\x01\x02 signature). */
function findCentralDir(buf: Uint8Array): number {
  for (let i = 0; i < buf.length - 4; i++) {
    if (isFirstPkPair(buf, i) && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
      return i
    }
  }
  return -1
}

/** Find the offset of the end-of-central-directory record. */
function findEndOfCentralDir(buf: Uint8Array): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (isFirstPkPair(buf, i) && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      return i
    }
  }
  return -1
}

// ─────────────────────────────────────────────────────────────────────────────
// crc32
// ─────────────────────────────────────────────────────────────────────────────

describe('crc32 — known values', () => {
  test('empty input → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  test('"hello" → 0x3610a686', () => {
    expect(crc32(utf8('hello'))).toBe(0x3610a686)
  })

  test('"123456789" → 0xCBF43926 (standard test vector)', () => {
    expect(crc32(utf8('123456789'))).toBe(0xCBF43926)
  })

  test('"The quick brown fox..." → 0x414fa339', () => {
    expect(crc32(utf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })

  test('single byte \\x00 → 0xd202ef8d', () => {
    expect(crc32(new Uint8Array([0]))).toBe(0xd202ef8d)
  })

  test('single byte \\xff → 0xff000000 (actually 0xffffff)', () => {
    // Standard CRC-32 of 0xFF
    expect(crc32(new Uint8Array([0xff]))).toBe(0xff000000)
  })

  test('is deterministic', () => {
    expect(crc32(utf8('test'))).toBe(crc32(utf8('test')))
  })

  test('returns different CRCs for different inputs', () => {
    expect(crc32(utf8('a'))).not.toBe(crc32(utf8('b')))
  })

  test('handles all byte values 0-255 without crashing', () => {
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i++) all[i] = i
    expect(() => crc32(all)).not.toThrow()
    expect(typeof crc32(all)).toBe('number')
  })

  test('returns unsigned 32-bit integer (no negative)', () => {
    const result = crc32(utf8('test'))
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(0xFFFFFFFF)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createZip — empty / single file
// ─────────────────────────────────────────────────────────────────────────────

describe('createZip — empty archive', () => {
  test('empty array produces 22-byte end-of-central-directory record', () => {
    const result = createZip([])
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(22)
  })

  test('null input produces 22-byte end-of-central-directory record', () => {
    const result = createZip(null as unknown as ZipFile[])
    expect(result.length).toBe(22)
  })

  test('undefined input produces 22-byte end-of-central-directory record', () => {
    const result = createZip(undefined as unknown as ZipFile[])
    expect(result.length).toBe(22)
  })

  test('empty archive starts with PK\\x05\\x06 signature', () => {
    const result = createZip([])
    expect(isFirstPkPair(result, 0)).toBe(true)
    expect(result[2]).toBe(0x05)
    expect(result[3]).toBe(0x06)
  })

  test('empty archive reports 0 entries', () => {
    const result = createZip([])
    const numEntries = readUint16(result, 8)
    expect(numEntries).toBe(0)
  })
})

describe('createZip — single file', () => {
  test('returns a Uint8Array', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    expect(result).toBeInstanceOf(Uint8Array)
  })

  test('starts with local file header signature PK\\x03\\x04', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    expect(isFirstPkPair(result, 0)).toBe(true)
    expect(result[2]).toBe(0x03)
    expect(result[3]).toBe(0x04)
  })

  test('ends with end-of-central-directory signature PK\\x05\\x06', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const end = result.length - 22
    expect(isFirstPkPair(result, end)).toBe(true)
    expect(result[end + 2]).toBe(0x05)
    expect(result[end + 3]).toBe(0x06)
  })

  test('contains central directory entry signature PK\\x01\\x02', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    expect(findCentralDir(result)).toBeGreaterThan(0)
  })

  test('stores the filename', () => {
    const result = createZip([{ name: 'hello.txt', content: 'hi' }])
    expect(readLocalFileName(result, 0)).toBe('hello.txt')
  })

  test('stores the file content after the local header + name', () => {
    const content = 'Hello, World!'
    const result = createZip([{ name: 'a.txt', content }])
    const nameLen = readUint16(result, 26)
    const dataStart = 30 + nameLen
    const dataLen = readUint32(result, 18)
    expect(dataLen).toBe(content.length)
    const data = new TextDecoder().decode(result.slice(dataStart, dataStart + dataLen))
    expect(data).toBe(content)
  })

  test('stores correct CRC in local header', () => {
    const content = 'Hello, World!'
    const result = createZip([{ name: 'a.txt', content }])
    const expectedCrc = crc32(utf8(content))
    const storedCrc = readUint32(result, 14)
    expect(storedCrc).toBe(expectedCrc)
  })

  test('uses compression method 0 (STORE)', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const method = readUint16(result, 8)
    expect(method).toBe(0)
  })

  test('sets UTF-8 flag (bit 11)', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const flags = readUint16(result, 6)
    expect(flags & 0x0800).not.toBe(0)
  })

  test('end-of-central-directory reports 1 entry', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const endOffset = findEndOfCentralDir(result)
    expect(readUint16(result, endOffset + 8)).toBe(1)
    expect(readUint16(result, endOffset + 10)).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createZip — multiple files
// ─────────────────────────────────────────────────────────────────────────────

describe('createZip — multiple files', () => {
  test('writes all file contents in order', () => {
    const files: ZipFile[] = [
      { name: 'a.txt', content: 'aaa' },
      { name: 'b.txt', content: 'bbb' },
      { name: 'c.txt', content: 'ccc' },
    ]
    const result = createZip(files)
    const text = new TextDecoder().decode(result)
    const aIdx = text.indexOf('aaa')
    const bIdx = text.indexOf('bbb')
    const cIdx = text.indexOf('ccc')
    expect(aIdx).toBeGreaterThanOrEqual(0)
    expect(bIdx).toBeGreaterThan(aIdx)
    expect(cIdx).toBeGreaterThan(bIdx)
  })

  test('end-of-central-directory record has correct file count (5 files)', () => {
    const files: ZipFile[] = Array.from({ length: 5 }, (_, i) => ({
      name: `file${i}.txt`,
      content: `content${i}`,
    }))
    const result = createZip(files)
    const endOffset = findEndOfCentralDir(result)
    expect(readUint16(result, endOffset + 8)).toBe(5)
    expect(readUint16(result, endOffset + 10)).toBe(5)
  })

  test('handles 100 files', () => {
    const files: ZipFile[] = Array.from({ length: 100 }, (_, i) => ({
      name: `file${i}.txt`,
      content: `content${i}`,
    }))
    const result = createZip(files)
    const endOffset = findEndOfCentralDir(result)
    expect(readUint16(result, endOffset + 8)).toBe(100)
    expect(result.length).toBeGreaterThan(1000)
  })

  test('preserves order of files as given', () => {
    const files: ZipFile[] = [
      { name: 'z.txt', content: 'zzz' },
      { name: 'a.txt', content: 'aaa' },
      { name: 'm.txt', content: 'mmm' },
    ]
    const result = createZip(files)
    const text = new TextDecoder().decode(result)
    expect(text.indexOf('zzz')).toBeLessThan(text.indexOf('aaa'))
    expect(text.indexOf('aaa')).toBeLessThan(text.indexOf('mmm'))
  })

  test('files with same name are stored verbatim (no dedup)', () => {
    const files: ZipFile[] = [
      { name: 'dup.txt', content: 'first' },
      { name: 'dup.txt', content: 'second' },
    ]
    const result = createZip(files)
    const text = new TextDecoder().decode(result)
    expect(text).toContain('first')
    expect(text).toContain('second')
    const endOffset = findEndOfCentralDir(result)
    expect(readUint16(result, endOffset + 8)).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createZip — content types
// ─────────────────────────────────────────────────────────────────────────────

describe('createZip — content types', () => {
  test('handles empty file content', () => {
    const result = createZip([{ name: 'empty.txt', content: '' }])
    const size = readUint32(result, 18)
    expect(size).toBe(0)
  })

  test('handles single-byte content', () => {
    const result = createZip([{ name: 'one.txt', content: 'X' }])
    expect(readUint32(result, 18)).toBe(1)
  })

  test('handles binary content (Uint8Array)', () => {
    const bin = new Uint8Array([0, 1, 2, 3, 255, 254, 128, 64])
    const result = createZip([{ name: 'bin.dat', content: bin }])
    expect(readUint32(result, 18)).toBe(8)
  })

  test('CRC is correct for binary content', () => {
    const bin = new Uint8Array([0, 1, 2, 3, 255, 254, 128, 64])
    const result = createZip([{ name: 'bin.dat', content: bin }])
    const storedCrc = readUint32(result, 14)
    expect(storedCrc).toBe(crc32(bin))
  })

  test('handles content with all byte values 0-255', () => {
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i++) all[i] = i
    const result = createZip([{ name: 'all.dat', content: all }])
    expect(readUint32(result, 18)).toBe(256)
    const storedCrc = readUint32(result, 14)
    expect(storedCrc).toBe(crc32(all))
  })

  test('handles content with HTML special characters', () => {
    const content = '<html>\n\t<body>"quotes" & ampersands</body>\n</html>'
    const result = createZip([{ name: 'index.html', content }])
    const nameLen = readUint16(result, 26)
    const dataLen = readUint32(result, 18)
    const data = new TextDecoder().decode(result.slice(30 + nameLen, 30 + nameLen + dataLen))
    expect(data).toBe(content)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createZip — large files
// ─────────────────────────────────────────────────────────────────────────────

describe('createZip — large files', () => {
  test('handles very large single file (>64KB)', () => {
    const content = 'x'.repeat(100_000)
    const result = createZip([{ name: 'big.txt', content }])
    const size = readUint32(result, 18)
    expect(size).toBe(100_000)
  })

  test('CRC is correct for large file', () => {
    const content = 'x'.repeat(100_000)
    const result = createZip([{ name: 'big.txt', content }])
    const storedCrc = readUint32(result, 14)
    expect(storedCrc).toBe(crc32(utf8(content)))
  })

  test('handles file just under 4GB limit boundary (logical check)', () => {
    // We can't actually allocate 4GB in a test — just verify size field is 32-bit
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const size = readUint32(result, 18)
    expect(size).toBeLessThanOrEqual(0xFFFFFFFF)
  })

  test('multiple medium files total > 100KB', () => {
    const files: ZipFile[] = Array.from({ length: 10 }, (_, i) => ({
      name: `file${i}.txt`,
      content: 'y'.repeat(10_000),
    }))
    const result = createZip(files)
    expect(result.length).toBeGreaterThan(100_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createZip — unicode & special filenames
// ─────────────────────────────────────────────────────────────────────────────

describe('createZip — unicode & special filenames', () => {
  test('handles UTF-8 filenames (café.txt)', () => {
    const result = createZip([{ name: 'café.txt', content: 'hi' }])
    const nameLen = readUint16(result, 26)
    expect(nameLen).toBe(utf8('café.txt').length)
    expect(readLocalFileName(result, 0)).toBe('café.txt')
  })

  test('handles Japanese filenames', () => {
    const result = createZip([{ name: 'ファイル.txt', content: 'hi' }])
    expect(readLocalFileName(result, 0)).toBe('ファイル.txt')
  })

  test('handles emoji filenames', () => {
    const result = createZip([{ name: '🎮.txt', content: 'hi' }])
    expect(readLocalFileName(result, 0)).toBe('🎮.txt')
  })

  test('handles filenames with spaces', () => {
    const result = createZip([{ name: 'my file.txt', content: 'hi' }])
    expect(readLocalFileName(result, 0)).toBe('my file.txt')
  })

  test('handles filenames with parentheses', () => {
    const result = createZip([{ name: 'file(1).txt', content: 'hi' }])
    expect(readLocalFileName(result, 0)).toBe('file(1).txt')
  })

  test('handles filenames with special characters', () => {
    const result = createZip([{ name: 'file@#$%.txt', content: 'hi' }])
    expect(readLocalFileName(result, 0)).toBe('file@#$%.txt')
  })

  test('handles UTF-8 content (héllo wörld)', () => {
    const content = 'héllo wörld'
    const result = createZip([{ name: 'a.txt', content }])
    const nameLen = readUint16(result, 26)
    const dataLen = readUint32(result, 18)
    expect(dataLen).toBe(utf8(content).length)
    const data = new TextDecoder().decode(result.slice(30 + nameLen, 30 + nameLen + dataLen))
    expect(data).toBe(content)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createZip — paths & directory structure
// ─────────────────────────────────────────────────────────────────────────────

describe('createZip — paths & directory structure', () => {
  test('handles subdirectory paths in filenames', () => {
    const result = createZip([
      { name: 'src/index.html', content: '<html/>' },
      { name: 'src/app.js', content: 'console.log()' },
    ])
    const text = new TextDecoder().decode(result)
    expect(text).toContain('src/index.html')
    expect(text).toContain('src/app.js')
  })

  test('handles deep nested paths', () => {
    const result = createZip([{ name: 'a/b/c/d/e/f.txt', content: 'deep' }])
    expect(readLocalFileName(result, 0)).toBe('a/b/c/d/e/f.txt')
  })

  test('handles mixed flat and nested files', () => {
    const result = createZip([
      { name: 'root.txt', content: 'root' },
      { name: 'src/app.js', content: 'app' },
      { name: 'src/utils/helper.ts', content: 'helper' },
    ])
    const text = new TextDecoder().decode(result)
    expect(text).toContain('root.txt')
    expect(text).toContain('src/app.js')
    expect(text).toContain('src/utils/helper.ts')
  })

  test('handles filenames with multiple dots', () => {
    const result = createZip([{ name: 'file.tar.gz', content: 'archive' }])
    expect(readLocalFileName(result, 0)).toBe('file.tar.gz')
  })

  test('handles filenames with no extension', () => {
    const result = createZip([{ name: 'README', content: 'readme' }])
    expect(readLocalFileName(result, 0)).toBe('README')
  })

  test('handles hidden Unix-style filenames', () => {
    const result = createZip([{ name: '.env', content: 'SECRET=123' }])
    expect(readLocalFileName(result, 0)).toBe('.env')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createZip — guard rails
// ─────────────────────────────────────────────────────────────────────────────

describe('createZip — guard rails', () => {
  test('throws on more than 65535 files', () => {
    const files: ZipFile[] = new Array(65536).fill({ name: 'a', content: '' })
    expect(() => createZip(files)).toThrow(/65535/)
  })

  test('does not throw for exactly 1 file', () => {
    expect(() => createZip([{ name: 'a', content: 'x' }])).not.toThrow()
  })

  test('does not throw for empty array', () => {
    expect(() => createZip([])).not.toThrow()
  })

  test('error message includes the actual file count', () => {
    const files: ZipFile[] = new Array(65536).fill({ name: 'a', content: '' })
    try {
      createZip(files)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('65535')
      expect((e as Error).message).toContain('65536')
    }
  })
})
