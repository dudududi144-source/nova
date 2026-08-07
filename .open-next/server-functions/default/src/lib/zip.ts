// Dependency-free ZIP encoder (STORE method, no compression).
//
// NOVA lets users download multi-file projects as a ZIP. Rather than pulling in
// jszip or fflate (60KB+ minified), we implement the minimal ZIP format:
//
// - STORE method (method 0): files are written as-is, no DEFLATE compression.
//   This is fine for HTML/CSS/JS — they're already small, and the user gets
//   the file instantly without waiting for compression.
// - CRC-32 checksum per file (required by the ZIP spec).
// - UTF-8 filenames and content (via TextEncoder).
// - Single central directory at the end.
//
// The output is a valid ZIP that all standard tools (unzip, 7-Zip, Windows
// Explorer, macOS Archive Utility) can extract.
//
// Spec: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

// ── Types ──

/** A file to include in the ZIP archive. */
export interface ZipFile {
  /** Path inside the archive, e.g. "index.html" or "src/app.tsx". */
  name: string
  /** File content — string (UTF-8 encoded) or raw bytes. */
  content: string | Uint8Array
}

// ── CRC-32 ──
// Standard CRC-32 with polynomial 0xEDB88320 (reflected form).
// Used by ZIP, gzip, PNG, Ethernet, etc.

/** Precomputed CRC-32 table (256 entries). */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      // If the low bit is set, XOR with the polynomial
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
})()

/**
 * Compute the CRC-32 checksum of a byte array.
 * Returns an unsigned 32-bit integer.
 */
export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ── ZIP structure ──
//
// A ZIP file is structured as:
//   [Local File Header 1][File Data 1]
//   [Local File Header 2][File Data 2]
//   ...
//   [Central Directory Entry 1]
//   [Central Directory Entry 2]
//   ...
//   [End of Central Directory Record]
//
// All multi-byte integers are little-endian.

/** Convert a string to UTF-8 bytes using TextEncoder. */
const encoder = new TextEncoder()

function utf8(s: string): Uint8Array {
  return encoder.encode(s)
}

/** Write a 16-bit little-endian uint into a Uint8Array at offset. */
function writeUint16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xFF
  buf[offset + 1] = (value >>> 8) & 0xFF
}

/** Write a 32-bit little-endian uint into a Uint8Array at offset. */
function writeUint32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xFF
  buf[offset + 1] = (value >>> 8) & 0xFF
  buf[offset + 2] = (value >>> 16) & 0xFF
  buf[offset + 3] = (value >>> 24) & 0xFF
}

// Signature constants (little-endian first 4 bytes)
const SIG_LOCAL_FILE = 0x04034b50       // PK\x03\x04
const SIG_CENTRAL_DIR = 0x02014b50      // PK\x01\x02
const SIG_END_CENTRAL_DIR = 0x06054b50  // PK\x05\x06

// Version needed to extract: 2.0 (supports basic ZIP features)
const VERSION_NEEDED = 0x0014  // 20 = 2.0

// General purpose bit flag: bit 11 = UTF-8 filename/comment
const FLAG_UTF8 = 0x0800

// Compression method: 0 = STORE (no compression)
const METHOD_STORE = 0

/**
 * Create a ZIP archive from a list of files.
 *
 * Uses the STORE method (no compression). Files are written in order, followed
 * by a central directory and end-of-central-directory record.
 *
 * @param files Array of { name, content } objects.
 * @returns Uint8Array containing the complete ZIP file.
 */
export function createZip(files: ZipFile[]): Uint8Array {
  if (!files || files.length === 0) {
    // Empty ZIP — just the end-of-central-directory record (22 bytes)
    const empty = new Uint8Array(22)
    writeUint32(empty, 0, SIG_END_CENTRAL_DIR)
    // disk number, disk with CD, num entries on disk, num entries total: all 0
    // CD size, CD offset: all 0
    // Comment length: 0
    return empty
  }

  // Cap at 65535 files (ZIP spec limit for the end-of-central-directory record)
  if (files.length > 65535) {
    throw new Error(`ZIP archive cannot contain more than 65535 files (got ${files.length})`)
  }

  // Encode all filenames and contents up front so we know the sizes.
  const encoded: Array<{ name: Uint8Array; data: Uint8Array }> = files.map(f => ({
    name: utf8(f.name),
    data: typeof f.content === 'string' ? utf8(f.content) : f.content,
  }))

  // Calculate total size to allocate the output buffer in one shot.
  // Local file header = 30 bytes + name length
  // File data = data length
  // Central dir entry = 46 bytes + name length
  // End of central dir = 22 bytes
  let totalSize = 0
  for (const f of encoded) {
    totalSize += 30 + f.name.length + f.data.length
  }
  for (const f of encoded) {
    totalSize += 46 + f.name.length
  }
  totalSize += 22

  const out = new Uint8Array(totalSize)
  let offset = 0

  // Track file metadata for the central directory
  const fileMeta: Array<{ name: Uint8Array; crc: number; size: number; localHeaderOffset: number }> = []

  // Write local file headers + file data
  for (const f of encoded) {
    const crc = crc32(f.data)
    const size = f.data.length
    const localHeaderOffset = offset

    // Local file header (30 bytes + variable-length name + extra field)
    writeUint32(out, offset, SIG_LOCAL_FILE); offset += 4
    writeUint16(out, offset, VERSION_NEEDED); offset += 2     // Version needed
    writeUint16(out, offset, FLAG_UTF8); offset += 2          // General purpose bit flag (UTF-8)
    writeUint16(out, offset, METHOD_STORE); offset += 2       // Compression method (STORE)
    writeUint16(out, offset, 0); offset += 2                  // File mod time (00:00:00)
    writeUint16(out, offset, 0); offset += 2                  // File mod date (1980-01-01)
    writeUint32(out, offset, crc); offset += 4                // CRC-32
    writeUint32(out, offset, size); offset += 4               // Compressed size (== uncompressed for STORE)
    writeUint32(out, offset, size); offset += 4               // Uncompressed size
    writeUint16(out, offset, f.name.length); offset += 2      // Filename length
    writeUint16(out, offset, 0); offset += 2                  // Extra field length

    // Filename
    out.set(f.name, offset); offset += f.name.length

    // File data
    out.set(f.data, offset); offset += f.data.length

    fileMeta.push({ name: f.name, crc, size, localHeaderOffset })
  }

  // Write central directory
  const centralDirOffset = offset
  for (const meta of fileMeta) {
    // Central directory file header (46 bytes + variable-length name + extra + comment)
    writeUint32(out, offset, SIG_CENTRAL_DIR); offset += 4
    writeUint16(out, offset, 0x0014); offset += 2              // Version made by (2.0, FAT filesystem)
    writeUint16(out, offset, VERSION_NEEDED); offset += 2      // Version needed to extract
    writeUint16(out, offset, FLAG_UTF8); offset += 2           // General purpose bit flag
    writeUint16(out, offset, METHOD_STORE); offset += 2        // Compression method
    writeUint16(out, offset, 0); offset += 2                   // File mod time
    writeUint16(out, offset, 0); offset += 2                   // File mod date
    writeUint32(out, offset, meta.crc); offset += 4            // CRC-32
    writeUint32(out, offset, meta.size); offset += 4           // Compressed size
    writeUint32(out, offset, meta.size); offset += 4           // Uncompressed size
    writeUint16(out, offset, meta.name.length); offset += 2    // Filename length
    writeUint16(out, offset, 0); offset += 2                   // Extra field length
    writeUint16(out, offset, 0); offset += 2                   // File comment length
    writeUint16(out, offset, 0); offset += 2                   // Disk number where file starts
    writeUint16(out, offset, 0); offset += 2                   // Internal file attributes
    writeUint32(out, offset, 0); offset += 4                   // External file attributes
    writeUint32(out, offset, meta.localHeaderOffset); offset += 4 // Relative offset of local header

    // Filename
    out.set(meta.name, offset); offset += meta.name.length
  }
  const centralDirSize = offset - centralDirOffset

  // Write end of central directory record (22 bytes)
  writeUint32(out, offset, SIG_END_CENTRAL_DIR); offset += 4
  writeUint16(out, offset, 0); offset += 2                     // Number of this disk
  writeUint16(out, offset, 0); offset += 2                     // Disk where central directory starts
  writeUint16(out, offset, files.length); offset += 2          // Number of central directory records on this disk
  writeUint16(out, offset, files.length); offset += 2          // Total number of central directory records
  writeUint32(out, offset, centralDirSize); offset += 4        // Size of central directory
  writeUint32(out, offset, centralDirOffset); offset += 4      // Offset of start of central directory
  writeUint16(out, offset, 0); offset += 2                     // Comment length

  // Sanity check: we should have filled the buffer exactly
  if (offset !== totalSize) {
    // This is a bug in our size calculation — return what we have (still valid ZIP)
    return out.subarray(0, offset)
  }

  return out
}
