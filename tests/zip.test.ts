// Tests for zip.ts — createZip structure, signatures, content, edge cases.
import { describe, it, expect } from 'bun:test'
import { createZip, crc32, type ZipFile } from '../src/lib/zip'

// ── Helpers ──

function readUint16(buf: Uint8Array, offset: number): number {
  return (buf[offset]! | (buf[offset + 1]! << 8)) >>> 0
}

function readUint32(buf: Uint8Array, offset: number): number {
  return ((buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24))) >>> 0
}

// ZIP signatures (little-endian first 4 bytes)
const SIG_LOCAL_FILE = 0x04034b50       // PK\x03\x04
const SIG_CENTRAL_DIR = 0x02014b50      // PK\x01\x02
const SIG_END_CENTRAL_DIR = 0x06054b50  // PK\x05\x06

// PK header bytes (bytes 0,1 are 'PK' = 0x50 0x4b)
function isFirstPkPair(buf: Uint8Array, offset: number): boolean {
  return buf[offset] === 0x50 && buf[offset + 1] === 0x4b
}

const encoder = new TextEncoder()

function utf8(s: string): Uint8Array {
  return encoder.encode(s)
}

// ── Tests ──

describe('crc32', () => {
  it('returns 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('returns the known CRC for "hello"', () => {
    // CRC-32 of "hello" is 0x3610a686
    expect(crc32(utf8('hello'))).toBe(0x3610a686)
  })

  it('returns the known CRC for "123456789"', () => {
    // Standard CRC-32 test vector
    expect(crc32(utf8('123456789'))).toBe(0xCBF43926)
  })

  it('returns the known CRC for "The quick brown fox..."', () => {
    expect(crc32(utf8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })

  it('is deterministic', () => {
    const a = crc32(utf8('test'))
    const b = crc32(utf8('test'))
    expect(a).toBe(b)
  })

  it('returns different CRCs for different inputs', () => {
    expect(crc32(utf8('a'))).not.toBe(crc32(utf8('b')))
  })
})

describe('createZip — structure', () => {
  it('returns a Uint8Array', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('starts with the local file header signature PK\\x03\\x04', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    expect(isFirstPkPair(result, 0)).toBe(true)
    expect(result[2]).toBe(0x03)
    expect(result[3]).toBe(0x04)
  })

  it('ends with the end-of-central-directory signature PK\\x05\\x06', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const end = result.length - 22
    expect(isFirstPkPair(result, end)).toBe(true)
    expect(result[end + 2]).toBe(0x05)
    expect(result[end + 3]).toBe(0x06)
  })

  it('contains a central directory entry signature PK\\x01\\x02', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    // Find the central directory signature after the local file + data
    let found = false
    for (let i = 0; i < result.length - 4; i++) {
      if (isFirstPkPair(result, i) && result[i + 2] === 0x01 && result[i + 3] === 0x02) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it('empty ZIP is exactly 22 bytes (just the end record)', () => {
    const result = createZip([])
    expect(result.length).toBe(22)
    expect(isFirstPkPair(result, 0)).toBe(true)
    expect(result[2]).toBe(0x05)
    expect(result[3]).toBe(0x06)
  })
})

describe('createZip — single file', () => {
  it('stores the filename', () => {
    const result = createZip([{ name: 'hello.txt', content: 'hi' }])
    const nameLen = readUint16(result, 26)
    expect(nameLen).toBe('hello.txt'.length)
    // Filename follows the 30-byte local header
    const name = new TextDecoder().decode(result.slice(30, 30 + nameLen))
    expect(name).toBe('hello.txt')
  })

  it('stores the file content after the local header + name', () => {
    const content = 'Hello, World!'
    const result = createZip([{ name: 'a.txt', content }])
    const nameLen = readUint16(result, 26)
    const dataStart = 30 + nameLen
    const dataLen = readUint32(result, 18) // compressed size at offset 18
    expect(dataLen).toBe(content.length)
    const data = new TextDecoder().decode(result.slice(dataStart, dataStart + dataLen))
    expect(data).toBe(content)
  })

  it('stores the correct CRC in the local header', () => {
    const content = 'Hello, World!'
    const result = createZip([{ name: 'a.txt', content }])
    const expectedCrc = crc32(utf8(content))
    const storedCrc = readUint32(result, 14)
    expect(storedCrc).toBe(expectedCrc)
  })

  it('uses compression method 0 (STORE)', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const method = readUint16(result, 8)
    expect(method).toBe(0)
  })

  it('sets the UTF-8 flag (bit 11)', () => {
    const result = createZip([{ name: 'a.txt', content: 'hi' }])
    const flags = readUint16(result, 6)
    expect(flags & 0x0800).not.toBe(0)
  })
})

describe('createZip — multiple files', () => {
  it('writes all file contents in order', () => {
    const files: ZipFile[] = [
      { name: 'a.txt', content: 'aaa' },
      { name: 'b.txt', content: 'bbb' },
      { name: 'c.txt', content: 'ccc' },
    ]
    const result = createZip(files)
    // Convert to string and check all contents are present in order
    const text = new TextDecoder().decode(result)
    const aIdx = text.indexOf('aaa')
    const bIdx = text.indexOf('bbb')
    const cIdx = text.indexOf('ccc')
    expect(aIdx).toBeGreaterThanOrEqual(0)
    expect(bIdx).toBeGreaterThan(aIdx)
    expect(cIdx).toBeGreaterThan(bIdx)
  })

  it('end-of-central-directory record has correct file count', () => {
    const files: ZipFile[] = [
      { name: 'a.txt', content: 'aaa' },
      { name: 'b.txt', content: 'bbb' },
    ]
    const result = createZip(files)
    const endOffset = result.length - 22
    const numEntries = readUint16(result, endOffset + 8)
    const totalEntries = readUint16(result, endOffset + 10)
    expect(numEntries).toBe(2)
    expect(totalEntries).toBe(2)
  })

  it('handles empty file content', () => {
    const result = createZip([{ name: 'empty.txt', content: '' }])
    const size = readUint32(result, 18)
    expect(size).toBe(0)
  })

  it('handles binary content (Uint8Array)', () => {
    const bin = new Uint8Array([0, 1, 2, 3, 255, 254])
    const result = createZip([{ name: 'bin.dat', content: bin }])
    const size = readUint32(result, 18)
    expect(size).toBe(6)
  })

  it('handles UTF-8 filenames', () => {
    const result = createZip([{ name: 'café.txt', content: 'hi' }])
    const nameLen = readUint16(result, 26)
    // 'café.txt' = 4 + 2 (é is 2 bytes in UTF-8) + 4 = 9 UTF-8 bytes
    expect(nameLen).toBe(utf8('café.txt').length)
  })

  it('handles UTF-8 content', () => {
    const content = 'héllo wörld'
    const result = createZip([{ name: 'a.txt', content }])
    const nameLen = readUint16(result, 26)
    const dataLen = readUint32(result, 18)
    expect(dataLen).toBe(utf8(content).length)
    const data = new TextDecoder().decode(result.slice(30 + nameLen, 30 + nameLen + dataLen))
    expect(data).toBe(content)
  })

  it('handles subdirectory paths in filenames', () => {
    const result = createZip([
      { name: 'src/index.html', content: '<html/>' },
      { name: 'src/app.js', content: 'console.log()' },
    ])
    const text = new TextDecoder().decode(result)
    expect(text).toContain('src/index.html')
    expect(text).toContain('src/app.js')
  })
})

describe('createZip — edge cases', () => {
  it('throws on more than 65535 files', () => {
    // Don't actually create 65k files — just test the guard
    // Create an array with 65536 holes
    const files: ZipFile[] = new Array(65536).fill({ name: 'a', content: '' })
    expect(() => createZip(files)).toThrow(/65535/)
  })

  it('does not throw for exactly 1 file', () => {
    expect(() => createZip([{ name: 'a', content: 'x' }])).not.toThrow()
  })

  it('preserves content with special characters', () => {
    const content = '<html>\n\t<body>"quotes" & ampersands</body>\n</html>'
    const result = createZip([{ name: 'index.html', content }])
    const nameLen = readUint16(result, 26)
    const dataLen = readUint32(result, 18)
    const data = new TextDecoder().decode(result.slice(30 + nameLen, 30 + nameLen + dataLen))
    expect(data).toBe(content)
  })

  it('handles very large single file (>64KB)', () => {
    const content = 'x'.repeat(100_000)
    const result = createZip([{ name: 'big.txt', content }])
    const size = readUint32(result, 18)
    expect(size).toBe(100_000)
  })

  it('CRC is correct for binary content', () => {
    const bin = new Uint8Array([0, 1, 2, 3, 255, 254, 128, 64])
    const result = createZip([{ name: 'bin.dat', content: bin }])
    const storedCrc = readUint32(result, 14)
    expect(storedCrc).toBe(crc32(bin))
  })
})
