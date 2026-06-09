/**
 * Minimal, dependency-free ZIP reader/writer — just enough for the dev-mode
 * "download/upload archive" backup of a Pod's `granergize/` collection.
 *
 * Entries are written with the STORED method (no compression): the archive is a
 * round-trip backup, not a distribution format, and storing keeps this code small
 * and the round-trip exact (no inflate/deflate). {@link readZip} parses the
 * central directory and therefore also reads STORED entries produced elsewhere; a
 * compressed (DEFLATE) entry is rejected with a clear error rather than silently
 * corrupting data. Filenames are UTF-8 (general-purpose flag bit 11 set).
 *
 * Pure (no DOM / Pod access) so it stays hermetically unit-testable.
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive, e.g. `granergize/buildings/x.ttl`. */
  path: string;
  data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800; // general-purpose bit 11: filename is UTF-8
const METHOD_STORED = 0;

// ── CRC-32 (IEEE 802.3) ─────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 checksum of `bytes`, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Write ────────────────────────────────────────────────────────────────────

/** Build a ZIP archive (STORED, no compression) from `entries`. */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = entry.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, METHOD_STORED, true);
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);

    chunks.push(local, data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, METHOD_STORED, true);
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // disk with CD start
  ev.setUint16(8, entries.length, true); // entries this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // CD offset
  ev.setUint16(20, 0, true); // comment length

  return concat([...chunks, ...central, eocd]);
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Parse a ZIP archive into its entries via the central directory. Throws on a
 * malformed archive or a compressed (non-STORED) entry.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  const total = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true); // central directory offset

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < total; i++) {
    if (view.getUint32(ptr, true) !== CENTRAL_SIG) {
      throw new Error("Corrupt ZIP: bad central directory signature");
    }
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const path = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    if (method !== METHOD_STORED) {
      throw new Error(`Unsupported compression in ZIP entry "${path}" (method ${method})`);
    }

    // The local header repeats name/extra lengths; the data starts after them.
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new Error(`Corrupt ZIP: bad local header for "${path}"`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    entries.push({ path, data });

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Scan backwards for the End-Of-Central-Directory record (it has a variable
 * trailing comment, so it isn't at a fixed offset). */
function findEocd(bytes: Uint8Array, view: DataView): number {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new Error("Corrupt ZIP: no end-of-central-directory record");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
