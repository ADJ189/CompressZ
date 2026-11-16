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
