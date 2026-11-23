import { assert, assertEquals } from "./assert.ts";
import { writeZip, readZip, sanitizeZipPath, estimateZipArchiveSize } from "../src/lib/zip.ts";

Deno.test("zip: sanitizeZipPath strips directory traversal and leading slashes", () => {
  assertEquals(sanitizeZipPath("../secret.txt"), "secret.txt");
  assertEquals(sanitizeZipPath("../../etc/passwd"), "etc/passwd");
  assertEquals(sanitizeZipPath("/root/file.md"), "root/file.md");
  assertEquals(sanitizeZipPath("C:\\Windows\\System32\\calc.exe"), "Windows/System32/calc.exe");
  assertEquals(sanitizeZipPath("safe/path/document.md"), "safe/path/document.md");
});

Deno.test("zip: writeZip and readZip round-trip files correctly", async () => {
  const file1 = new TextEncoder().encode("# Hello World\nTesting ZIP export.");
  const file2 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  const zipBytes = await writeZip([
    { name: "document.md", data: file1 },
    { name: "assets/data.bin", data: file2 },
  ]);

  assert(zipBytes.length > 0);

  const archive = await readZip(zipBytes.buffer as ArrayBuffer);
  assertEquals(archive.has("document.md"), true);
  assertEquals(archive.has("assets/data.bin"), true);

  const readText = new TextDecoder().decode(archive.get("document.md")!);
  assertEquals(readText, "# Hello World\nTesting ZIP export.");

  const readBin = archive.get("assets/data.bin")!;
  assertEquals(Array.from(readBin), [1, 2, 3, 4, 5, 6, 7, 8]);
});

Deno.test("zip: writeZip de-duplicates names that sanitise to the same path", async () => {
  const zipBytes = await writeZip([
    { name: "b.txt", data: new TextEncoder().encode("first") },
    { name: "./b.txt", data: new TextEncoder().encode("second") },
  ]);

  const names = [...(await readZip(zipBytes.buffer as ArrayBuffer)).keys()];
  assertEquals(names.length, 2, `Expected two distinct entries, got ${names.join(", ")}`);
  assert(names.includes("b.txt"), `Missing b.txt in ${names.join(", ")}`);
  assert(names.includes("b (2).txt"), `Missing de-duplicated name in ${names.join(", ")}`);
});

Deno.test("zip: readZip sanitises traversal names coming from the archive", async () => {
  // Written normally, then the writer's sanitisation is bypassed by patching the
  // central-directory name bytes — this is the attacker-controlled path.
  const payload = new TextEncoder().encode("pwned");
  const zipBytes = await writeZip([{ name: "placeholder.txt", data: payload }]);

  const hostile = new TextEncoder().encode("../../etc/a.txt");
  const original = new TextEncoder().encode("placeholder.txt");
  assertEquals(hostile.length, original.length, "fixture needs equal-length names");

  const patched = new Uint8Array(zipBytes);
  const haystack = new TextDecoder("latin1").decode(patched);
  let idx = haystack.indexOf("placeholder.txt");
  assert(idx >= 0, "fixture name not found");
  while (idx >= 0) {
    patched.set(hostile, idx);
    idx = haystack.indexOf("placeholder.txt", idx + 1);
  }

  const archive = await readZip(patched.buffer as ArrayBuffer);
  assertEquals(archive.has("etc/a.txt"), true, "Traversal name must be sanitised");
  assertEquals(archive.has("../../etc/a.txt"), false, "Raw traversal name must not survive");
});

Deno.test("zip: stored entry exceeding maxEntryBytes is rejected before allocation", async () => {
  const data = new TextEncoder().encode("Hello Stored ZIP Entry");
  const zipBytes = await writeZip([{ name: "test.txt", data }]);

  let message = "";
  try {
    await readZip(zipBytes.buffer as ArrayBuffer, { maxEntryBytes: 5 });
  } catch (err) {
    message = String((err as Error).message);
  }
  assertEquals(/safety limit/.test(message), true);
});

Deno.test("zip: estimateZipArchiveSize accurately accounts for deduplicated filename lengths", () => {
  const items = [
    { name: "report.pdf", size: 100 },
    { name: "report.pdf", size: 200 },
    { name: "./report.pdf", size: 300 },
  ];
  // Deduplicated names will be: "report.pdf", "report (2).pdf", "report (3).pdf"
  const estimated = estimateZipArchiveSize(items);
  const baseLen = new TextEncoder().encode("report.pdf").length; // 10
  const dup1Len = new TextEncoder().encode("report (2).pdf").length; // 14
  const dup2Len = new TextEncoder().encode("report (3).pdf").length; // 14
  const expectedTotal =
    22 /* EOCD */ +
    (100 + 76 + 2 * baseLen) +
    (200 + 76 + 2 * dup1Len) +
    (300 + 76 + 2 * dup2Len);
  assertEquals(estimated, expectedTotal);
});

Deno.test("zip: writeZip rejects archive with 65535 or more entries to prevent 16-bit truncation", async () => {
  // Array of 65535 entries (0xffff)
  const dummyData = new Uint8Array(0);
  const entries = new Array(0xffff).fill(null).map((_, i) => ({
    name: `f${i}.txt`,
    data: dummyData,
  }));

  let message = "";
  try {
    await writeZip(entries);
  } catch (err) {
    message = String((err as Error)?.message || err);
  }
  assert(/65534 entries/i.test(message) || /65535 entries/i.test(message), `Expected 16-bit limit error, got: "${message}"`);
});

