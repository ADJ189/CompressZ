/**
 * archives.test.ts — Unit tests for TAR, GZIP, and multi-file archive packing.
 */

import { assertEquals } from "./assert.ts";
import { writeTar, readTar, sanitizeTarPath } from "../src/lib/tar.ts";
import {
  createArchive,
  extractArchive,
  streamCompressBytes,
  streamDecompressBytes,
  gzipUncompressedSize,
  MAX_DECOMPRESSED_BYTES,
} from "../src/lib/archives.ts";

Deno.test("tar: writeTar and readTar round-trip multiple files with exact data", () => {
  const enc = new TextEncoder();
  const entries = [
    { name: "document.txt", data: enc.encode("Hello World, CompressZ TAR archive!") },
    { name: "nested/data.json", data: enc.encode(JSON.stringify({ hello: "world", count: 42 })) },
    { name: "empty.bin", data: new Uint8Array(0) },
  ];

  const tarBytes = writeTar(entries);
  assertEquals(tarBytes.length > 512 * 3, true);

  const restored = readTar(tarBytes);
  assertEquals(restored.length, 3);
  assertEquals(restored[0].name, "document.txt");
  assertEquals(new TextDecoder().decode(restored[0].data), "Hello World, CompressZ TAR archive!");
  assertEquals(restored[1].name, "nested/data.json");
  assertEquals(new TextDecoder().decode(restored[1].data), JSON.stringify({ hello: "world", count: 42 }));
  assertEquals(restored[2].name, "empty.bin");
  assertEquals(restored[2].data.length, 0);
});

Deno.test("archives: createArchive and extractArchive round-trip ZIP", async () => {
  const enc = new TextEncoder();
  const files = [
    { name: "a.txt", data: enc.encode("Alpha content") },
    { name: "b.txt", data: enc.encode("Beta content") },
  ];

  const archive = await createArchive(files, "zip", "test-bundle");
  assertEquals(archive.filename, "test-bundle.zip");
  assertEquals(archive.mimeType, "application/zip");
  assertEquals(archive.compressedBytes > 0, true);

  const extracted = await extractArchive(archive.data, archive.filename);
  assertEquals(extracted.length, 2);
  assertEquals(extracted.some((f) => f.name === "a.txt" && new TextDecoder().decode(f.data) === "Alpha content"), true);
  assertEquals(extracted.some((f) => f.name === "b.txt" && new TextDecoder().decode(f.data) === "Beta content"), true);
});

Deno.test("tar: readTar resets pendingName when followed by non-regular or symlink entries", () => {
  const enc = new TextEncoder();

  // 1. Create a GNU long name header ('L') for a symlink
  const longName = "skipped-symlink-long-target.txt";
  const longNameData = enc.encode(`${longName}\0`);
  const lHeader = new Uint8Array(512);
  lHeader.set(enc.encode("././@LongLink"), 0);
  // size octal at 124..135
  const lSizeOct = longNameData.length.toString(8).padStart(11, "0");
  lHeader.set(enc.encode(lSizeOct), 124);
  lHeader[156] = 0x4c; // 'L'
  lHeader.set(enc.encode("ustar\0"), 257);
  // Checksum
  lHeader.fill(0x20, 148, 156);
  let lSum = 0;
  for (let i = 0; i < 512; i++) lSum += lHeader[i];
  lHeader.set(enc.encode(lSum.toString(8).padStart(6, "0") + "\0 "), 148);

  const lPadding = new Uint8Array((512 - (longNameData.length % 512)) % 512);

  // 2. Create symlink entry (typeflag '2')
  const sHeader = new Uint8Array(512);
  sHeader.set(enc.encode("symlink-entry"), 0);
  sHeader.set(enc.encode("00000000000"), 124); // size 0
  sHeader[156] = 0x32; // '2' = symlink
  sHeader.set(enc.encode("ustar\0"), 257);
  sHeader.fill(0x20, 148, 156);
  let sSum = 0;
  for (let i = 0; i < 512; i++) sSum += sHeader[i];
  sHeader.set(enc.encode(sSum.toString(8).padStart(6, "0") + "\0 "), 148);

  // 3. Create regular file entry (typeflag '0')
  const rData = enc.encode("Real regular file content");
  const rHeader = new Uint8Array(512);
  rHeader.set(enc.encode("actual-regular-file.txt"), 0);
  const rSizeOct = rData.length.toString(8).padStart(11, "0");
  rHeader.set(enc.encode(rSizeOct), 124);
  rHeader[156] = 0x30; // '0' = regular file
  rHeader.set(enc.encode("ustar\0"), 257);
  rHeader.fill(0x20, 148, 156);
  let rSum = 0;
  for (let i = 0; i < 512; i++) rSum += rHeader[i];
  rHeader.set(enc.encode(rSum.toString(8).padStart(6, "0") + "\0 "), 148);

  const rPadding = new Uint8Array((512 - (rData.length % 512)) % 512);
  const terminator = new Uint8Array(1024);

  // Concatenate all chunks
  const totalLen =
    lHeader.length + longNameData.length + lPadding.length +
    sHeader.length +
    rHeader.length + rData.length + rPadding.length +
    terminator.length;
  const tarBytes = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of [lHeader, longNameData, lPadding, sHeader, rHeader, rData, rPadding, terminator]) {
    tarBytes.set(chunk, pos);
    pos += chunk.length;
  }

  const entries = readTar(tarBytes);
  assertEquals(entries.length, 1);
  assertEquals(entries[0].name, "actual-regular-file.txt", "Regular file must NOT inherit the long name of a skipped entry");
});


Deno.test("archives: createArchive and extractArchive round-trip TAR", async () => {
  const enc = new TextEncoder();
  const files = [
    { name: "log1.txt", data: enc.encode("Log entry 1") },
    { name: "log2.txt", data: enc.encode("Log entry 2") },
  ];

  const archive = await createArchive(files, "tar", "logs");
  assertEquals(archive.filename, "logs.tar");
  assertEquals(archive.mimeType, "application/x-tar");

  const extracted = await extractArchive(archive.data, archive.filename);
  assertEquals(extracted.length, 2);
  assertEquals(extracted[0].name, "log1.txt");
  assertEquals(new TextDecoder().decode(extracted[0].data), "Log entry 1");
});

Deno.test("tar: readTar skips directories and respects typeflag", () => {
  const enc = new TextEncoder();
  // Build a synthetic TAR with a directory entry (typeflag '5') and a file entry (typeflag '0')
  const dirBlock = new Uint8Array(512);
  const fileBlock = new Uint8Array(512);
  const fileData = enc.encode("Hello from file");
  const dataBlock = new Uint8Array(512);
  dataBlock.set(fileData, 0);

  // Directory header
  dirBlock.set(enc.encode("mydir/"), 0);
  dirBlock[156] = "5".charCodeAt(0);

  // File header
  fileBlock.set(enc.encode("mydir/file.txt"), 0);
  fileBlock[156] = "0".charCodeAt(0);
  // size octal
  fileBlock.set(enc.encode(fileData.length.toString(8).padStart(11, "0") + " "), 124);

  const eof = new Uint8Array(1024);
  const tar = new Uint8Array(512 + 512 + 512 + 1024);
  tar.set(dirBlock, 0);
  tar.set(fileBlock, 512);
  tar.set(dataBlock, 1024);
  tar.set(eof, 1536);

  const parsed = readTar(tar);
  // Directory should be skipped, only regular file returned
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].name, "mydir/file.txt");
  assertEquals(new TextDecoder().decode(parsed[0].data), "Hello from file");
});

// ── Hardening: H1/H2 (malformed headers, caps) ────────────────

Deno.test("tar: negative size field throws instead of looping forever", () => {
  const enc = new TextEncoder();
  const block = new Uint8Array(512);
  block.set(enc.encode("bomb.txt"), 0);
  block[156] = 0x30; // regular file
  block.set(enc.encode("-00000001000"), 124); // -512 in octal, no terminator

  const started = Date.now();
  let message = "";
  try {
    readTar(block);
  } catch (err) {
    message = String((err as Error).message);
  }
  // A regression here would hang the process rather than fail, so assert the
  // throw *and* that it happened immediately.
  assertEquals(/not a nonnegative octal integer/.test(message), true);
  assertEquals(Date.now() - started < 1000, true);
});

Deno.test("tar: entry size pointing outside the archive is rejected", () => {
  const enc = new TextEncoder();
  const header = new Uint8Array(512);
  header.set(enc.encode("huge.bin"), 0);
  header[156] = 0x30;
  header.set(enc.encode("00000007777 "), 124); // 4095 bytes, only 512 present

  let message = "";
  try {
    readTar(header);
  } catch (err) {
    message = String((err as Error).message);
  }
  assertEquals(/outside the archive/.test(message), true);
});

Deno.test("tar: readTar enforces the entry-count safety cap", () => {
  const enc = new TextEncoder();
  const entries = Array.from({ length: 4 }, (_, i) => ({
    name: `f${i}.txt`,
    data: enc.encode("x"),
  }));
  const tar = writeTar(entries);

  let message = "";
  try {
    readTar(tar, { maxEntries: 2 });
  } catch (err) {
    message = String((err as Error).message);
  }
  assertEquals(/safety limit/.test(message), true);
});

Deno.test("tar: readTar enforces the total-size safety cap", () => {
  const enc = new TextEncoder();
  const tar = writeTar([
    { name: "a.bin", data: enc.encode("aa") },
    { name: "b.bin", data: enc.encode("bb") },
  ]);

  let message = "";
  try {
    readTar(tar, { maxTotalBytes: 1 });
  } catch (err) {
    message = String((err as Error).message);
  }
  assertEquals(/Decompressed data exceeds/.test(message), true);
});

Deno.test("tar: entry names are sanitized on write and on read", () => {
  const enc = new TextEncoder();

  // Write side: this is what writeTar actually puts in the header.
  const written = readTar(writeTar([{ name: "../../etc/passwd", data: enc.encode("x") }]));
  assertEquals(written[0].name, "etc/passwd");

  assertEquals(sanitizeTarPath("C:\\Windows\\system32\\evil.dll"), "Windows/system32/evil.dll");
  assertEquals(sanitizeTarPath("/abs/../x.txt"), "abs/x.txt");
  assertEquals(sanitizeTarPath(""), "file");

  // Read side: hand-build a header so writeTar's own sanitising cannot mask a
  // missing sanitise in readTar.
  const header = new Uint8Array(512);
  header.set(enc.encode("../../escape.txt"), 0);
  header[156] = 0x30;
  header.set(enc.encode("00000000001 "), 124);
  const tar = new Uint8Array(1024);
  tar.set(header, 0);
  tar[512] = 0x41;
  assertEquals(readTar(tar)[0].name, "escape.txt");
});

// ── Hardening: H3 (gzip bomb) ─────────────────────────────────

Deno.test("archives: decompression cancels once the output limit is exceeded", async () => {
  const big = new Uint8Array(2 * 1024 * 1024); // zero-filled → tiny gzip payload
  const gz = await streamCompressBytes(big, "gzip");
  assertEquals(gz.length < big.length, true);

  let message = "";
  try {
    await streamDecompressBytes(gz, "gzip", 64 * 1024);
  } catch (err) {
    message = String((err as Error).message);
  }
  assertEquals(/exceeds/.test(message), true);
});

Deno.test("archives: gzip pre-check rejects a declared size above the limit", async () => {
  const gz = await streamCompressBytes(new TextEncoder().encode("tiny"), "gzip");
  assertEquals(gzipUncompressedSize(gz), 4);

  const dv = new DataView(gz.buffer, gz.byteOffset, gz.byteLength);
  dv.setUint32(gz.length - 4, 0x7fffffff, true); // lie about ISIZE

  let message = "";
  try {
    await extractArchive(gz, "bomb.gz");
  } catch (err) {
    message = String((err as Error).message);
  }
  assertEquals(/exceeds/.test(message), true);
});

Deno.test("archives: plain tar extraction enforces MAX_DECOMPRESSED_BYTES limit", async () => {
  const fakeTar = new Uint8Array(MAX_DECOMPRESSED_BYTES + 1024);
  let message = "";
  try {
    await extractArchive(fakeTar, "huge.tar");
  } catch (err) {
    message = String((err as Error).message);
  }
  assertEquals(/exceeds 256 MB limit/.test(message), true);
});

Deno.test("archives: streamCompressBytes propagates writer errors when stream aborts", async () => {
  const origCS = globalThis.CompressionStream;
  try {
    (globalThis as any).CompressionStream = class MockFailingCompressionStream {
      writable = {
        getWriter: () => ({
          write: () => Promise.reject(new Error("Writer stream disk failure")),
          close: () => Promise.resolve(),
          abort: () => Promise.resolve(),
        }),
      };
      readable = {
        getReader: () => ({
          read: () => Promise.resolve({ done: true, value: undefined }),
        }),
      };
    };

    let caughtError = false;
    try {
      await streamCompressBytes(new Uint8Array([1, 2, 3, 4]));
    } catch (err: any) {
      caughtError = true;
      assertEquals(err.message, "Writer stream disk failure");
    }
    assertEquals(caughtError, true);
  } finally {
    globalThis.CompressionStream = origCS;
  }
});
