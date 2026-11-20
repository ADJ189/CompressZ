/**
 * tar.ts — Lightweight, streaming POSIX UStar tar archive pack & unpack.
 *
 * Implements standard POSIX 1003.1 ustar header layout with zero external dependencies.
 * Designed to pipe directly into native CompressionStream('gzip') for .tar.gz / .tgz bundles.
 */

export interface TarEntry {
  name: string;
  data: Uint8Array;
  mtime?: number;
}

export interface ReadTarOptions {
  /** Maximum number of file entries to return. */
  maxEntries?: number;
  /** Maximum number of uncompressed bytes across all returned entries. */
  maxTotalBytes?: number;
}

/**
 * Sanitize a TAR entry path to prevent directory traversal or absolute path
 * injection. Mirrors `sanitizeZipPath()` in zip.ts: entry names are
 * attacker-controlled, and a caller may write them back to disk.
 */
export function sanitizeTarPath(raw: string): string {
  let safe = raw.replace(/^[a-zA-Z]:[\\/]/, "").replace(/^[\\/]+/, "");
  safe = safe
    .split(/[\\/]/)
    .filter((part) => part !== ".." && part !== "." && part.length > 0)
    .join("/");
  return safe || "file";
}

function writeString(buf: Uint8Array, offset: number, str: string, length: number): void {
  const enc = new TextEncoder();
  const encoded = enc.encode(str);
  const copyLen = Math.min(encoded.length, length);
  buf.set(encoded.subarray(0, copyLen), offset);
}

function writeOctal(buf: Uint8Array, offset: number, val: number, length: number): void {
  const octal = Math.floor(val).toString(8).padStart(length - 1, "0");
  writeString(buf, offset, octal, length - 1);
  buf[offset + length - 1] = 0; // null terminator
}

/**
 * Creates a standard 512-byte POSIX UStar header block for a file entry.
 */
export function createUstarHeader(name: string, size: number, mtime: number = Date.now()): Uint8Array {
  const header = new Uint8Array(512);

  // File name (0..99)
  writeString(header, 0, name.slice(0, 100), 100);

  // File mode (100..107): standard 0644
  writeOctal(header, 100, 0o644, 8);

  // Owner UID & GID (108..123): 0
  writeOctal(header, 108, 0, 8);
  writeOctal(header, 116, 0, 8);

  // File size in octal (124..135): 12 bytes
  writeOctal(header, 124, size, 12);

  // Modification time in seconds (136..147): 12 bytes
  const mtimeSec = Math.floor(mtime / 1000);
  writeOctal(header, 136, mtimeSec, 12);

  // Checksum placeholder: 8 spaces (0x20) at (148..155)
  header.fill(0x20, 148, 156);

  // Type flag (156): '0' = regular file
  header[156] = 0x30;

  // Magic & Version (257..264): "ustar\000"
  writeString(header, 257, "ustar\0", 6);
  header[263] = 0x30;
  header[264] = 0x30;

  // Compute checksum: unsigned sum of all 512 bytes with 8 spaces in checksum field
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += header[i];
  }

  // Write checksum (148..154) as 6-digit octal + null + space
  const octSum = sum.toString(8).padStart(6, "0");
  writeString(header, 148, octSum, 6);
  header[154] = 0;
  header[155] = 0x20;

  return header;
}

/**
 * Bundles multiple entries into a standard POSIX UStar tarball byte array.
 */
export function writeTar(entries: TarEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (const entry of entries) {
    const cleanName = sanitizeTarPath(entry.name);
    const header = createUstarHeader(cleanName, entry.data.length, entry.mtime);
    chunks.push(header);
    totalLength += 512;

    if (entry.data.length > 0) {
      chunks.push(entry.data);
      totalLength += entry.data.length;

      // 512-byte block padding
      const remainder = entry.data.length % 512;
      if (remainder > 0) {
        const padSize = 512 - remainder;
        chunks.push(new Uint8Array(padSize));
        totalLength += padSize;
      }
    }
  }

  // Tar terminator: two 512-byte zero blocks (1024 bytes)
  const terminator = new Uint8Array(1024);
  chunks.push(terminator);
  totalLength += 1024;

  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}

/**
 * Unpacks a POSIX UStar tar byte array into entries.
 *
 * Entry sizes are validated before they reach the offset math: a negative or
 * non-octal size field used to make the next header offset equal the current
 * one, which hung the tab in a synchronous infinite loop. Entry count and total
 * size are bounded as well, mirroring the ZIP reader's bomb limits.
 */
export function readTar(tarBytes: Uint8Array, options: ReadTarOptions = {}): TarEntry[] {
  const { maxEntries = 10_000, maxTotalBytes = 512 * 1024 * 1024 } = options;
  const entries: TarEntry[] = [];
  let offset = 0;
  let headerCount = 0;
  let totalBytes = 0;
  const dec = new TextDecoder();
  let pendingName: string | null = null;

  while (offset + 512 <= tarBytes.length) {
    // A zero block ends the archive (EOF is two, but one is conclusive).
    let isZero = true;
    for (let i = 0; i < 512; i++) {
      if (tarBytes[offset + i] !== 0) {
        isZero = false;
        break;
      }
    }
    if (isZero) break;

    headerCount++;
    if (headerCount > maxEntries * 2) {
      throw new Error(
        `TAR contains more than ${maxEntries} entries, exceeding the safety limit.`,
      );
    }

    // Read name (0..100)
    let nameEnd = offset;
    while (nameEnd < offset + 100 && tarBytes[nameEnd] !== 0) nameEnd++;
    let name = dec.decode(tarBytes.subarray(offset, nameEnd)).trim();

    // Read size (octal at 124..135)
    let sizeEnd = offset + 124;
    while (sizeEnd < offset + 136 && tarBytes[sizeEnd] !== 0 && tarBytes[sizeEnd] !== 0x20) sizeEnd++;
    const sizeStr = dec.decode(tarBytes.subarray(offset + 124, sizeEnd)).trim();

    // POSIX octal. An empty field is treated as 0 only because some historic
    // writers leave it blank; anything else malformed is rejected outright.
    if (sizeStr !== "" && !/^[0-7]+$/.test(sizeStr)) {
      throw new Error(
        `Invalid TAR header: size field "${sizeStr}" is not a nonnegative octal integer.`,
      );
    }
    const size = sizeStr === "" ? 0 : Number.parseInt(sizeStr, 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(
        `Invalid TAR header: size field "${sizeStr}" is not a nonnegative integer.`,
      );
    }

    // Read typeflag (byte 156)
    const typeflagByte = tarBytes[offset + 156];
    const typeflag = String.fromCharCode(typeflagByte);

    // Read ustar magic (257..262) & prefix (345..499)
    let magicEnd = offset + 257;
    while (magicEnd < offset + 262 && tarBytes[magicEnd] !== 0 && tarBytes[magicEnd] !== 0x20) magicEnd++;
    const magic = dec.decode(tarBytes.subarray(offset + 257, magicEnd)).trim();
    if (magic === "ustar") {
      let prefixEnd = offset + 345;
      while (prefixEnd < offset + 500 && tarBytes[prefixEnd] !== 0) prefixEnd++;
      const prefix = dec.decode(tarBytes.subarray(offset + 345, prefixEnd)).trim();
      if (prefix && name) {
        name = `${prefix}/${name}`;
      }
    }

    const dataOffset = offset + 512;
    const padding = (512 - (size % 512)) % 512;
    const nextHeaderOffset = dataOffset + size + padding;

    // Every header must advance and stay inside the buffer. Without this a
    // crafted size can point backwards (or nowhere), looping forever.
    if (nextHeaderOffset <= offset || nextHeaderOffset > tarBytes.length) {
      throw new Error("Corrupt TAR: entry size points outside the archive.");
    }

    // GNU long filename extension ('L')
    if (typeflag === "L") {
      const rawLongName = dec.decode(tarBytes.subarray(dataOffset, dataOffset + size));
      const nul = rawLongName.indexOf("\0");
      pendingName = (nul === -1 ? rawLongName : rawLongName.slice(0, nul)).trim();
      offset = nextHeaderOffset;
      continue;
    }

    // PAX extended header ('x')
    if (typeflag === "x") {
      const paxText = dec.decode(tarBytes.subarray(dataOffset, dataOffset + size));
      for (const line of paxText.split("\n")) {
        const match = /^\d+\s+path=(.*)$/.exec(line);
        if (match) {
          pendingName = match[1].trim();
        }
      }
      offset = nextHeaderOffset;
      continue;
    }

    // Global PAX extended header ('g') - ignore
    if (typeflag === "g") {
      offset = nextHeaderOffset;
      continue;
    }

    // Directory ('5') - skip while still advancing past data
    if (typeflag === "5") {
      pendingName = null;
      offset = nextHeaderOffset;
      continue;
    }

    // Regular file: '0' (0x30) or NUL (0x00)
    if (typeflag === "0" || typeflagByte === 0) {
      const rawName = pendingName || name;
      pendingName = null;
      if (rawName) {
        if (entries.length >= maxEntries) {
          throw new Error(
            `TAR contains more than ${maxEntries} entries, exceeding the safety limit.`,
          );
        }
        totalBytes += size;
        if (totalBytes > maxTotalBytes) {
          throw new Error(
            `Decompressed data exceeds ${Math.round(maxTotalBytes / (1024 * 1024))} MB limit.`,
          );
        }
        entries.push({
          name: sanitizeTarPath(rawName),
          data: new Uint8Array(tarBytes.subarray(dataOffset, dataOffset + size)),
        });
      }
    } else {
      // Any other non-regular entry (symlink, hardlink, fifo, etc.) skips without leaking pending name
      pendingName = null;
    }

    offset = nextHeaderOffset;
  }

  return entries;
}
