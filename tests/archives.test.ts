/**
 * archives.test.ts — Unit tests for TAR, GZIP, and multi-file archive packing.
 */

import { assertEquals } from "./assert.ts";
import { writeTar, readTar } from "../src/lib/tar.ts";
import { createArchive, extractArchive } from "../src/lib/archives.ts";

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
