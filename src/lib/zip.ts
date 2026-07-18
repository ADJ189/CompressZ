/**
 * zip.ts — minimal in-memory ZIP reader/writer.
 *
 * Uses the native CompressionStream/DecompressionStream('deflate-raw') APIs
 * instead of pulling in a JS zip library, matching this project's
 * zero-dependency architecture. Supported in all current browser engines
 * (Chrome/Edge 80+, Firefox 113+, Safari 16.4+); callers should feature-
 * detect via `zipSupported()` before relying on it.
 *
 * Round-trip and cross-compatibility verified against the system `zip`/
 * `unzip` tools — files written here open with any standard ZIP tool, and
 * files produced by other tools (DOCX/PPTX/XLSX are just ZIP containers)
 * read correctly here.
 */

export function zipSupported(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

// ── CRC32 ─────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const cs     = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes as BufferSource); writer.close();
  return readAll(cs.readable);
}
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds     = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes as BufferSource); writer.close();
  return readAll(ds.readable);
}
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return concat(out);
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

export interface ZipEntryIn { name: string; data: Uint8Array; }

// ── Writer ────────────────────────────────────────────────────
export async function writeZip(entries: ZipEntryIn[]): Promise<Uint8Array> {
  const { time, date } = dosDateTime();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc        = crc32(data);
    const compressed  = await deflateRaw(data);
    const useStore    = compressed.length >= data.length;
    const payload      = useStore ? data : compressed;
    const method        = useStore ? 0 : 8;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    chunks.push(new Uint8Array(local.buffer), nameBytes, payload);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, payload.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + payload.length;
  }

  const centralStart = offset;
  const centralSize   = central.reduce((s, c) => s + c.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);

  return concat([...chunks, ...central, new Uint8Array(eocd.buffer)]);
}

export async function zipToBlob(entries: ZipEntryIn[]): Promise<Blob> {
  const bytes = await writeZip(entries);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
}

// ── Reader ────────────────────────────────────────────────────
export async function readZip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const dv    = new DataView(buf);

  let eocdOffset = -1;
  const scanFrom = Math.max(0, bytes.length - 22 - 65536);
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('Not a valid ZIP file (end-of-central-directory not found)');

  const entryCount   = dv.getUint16(eocdOffset + 10, true);
  const centralStart = dv.getUint32(eocdOffset + 16, true);

  const out = new Map<string, Uint8Array>();
  let p = centralStart;
  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method       = dv.getUint16(p + 10, true);
    const compSize     = dv.getUint32(p + 20, true);
    const nameLen      = dv.getUint16(p + 28, true);
    const extraLen     = dv.getUint16(p + 30, true);
    const commentLen   = dv.getUint16(p + 32, true);
    const localOffset  = dv.getUint32(p + 42, true);
    const name         = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    const lNameLen  = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw       = bytes.subarray(dataStart, dataStart + compSize);

    if (!name.endsWith('/')) {
      out.set(name, method === 8 ? await inflateRaw(raw) : new Uint8Array(raw));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
