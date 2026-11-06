import { assert, assertEquals } from "./assert.ts";
import { writeZip, readZip, sanitizeZipPath } from "../src/lib/zip.ts";

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
