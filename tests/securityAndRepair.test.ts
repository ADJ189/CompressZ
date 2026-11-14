/**
 * securityAndRepair.test.ts — Unit tests for PDF encryption and recovery engines.
 */

import { assertEquals } from "./assert.ts";
import {
  isQpdfLoaded,
  getQpdf,
  resetQpdfForTesting,
  runQpdfCommand,
} from "../src/lib/qpdfWasm.ts";
import {
  buildQpdfEncryptionArgs,
  type ProtectPdfOptions,
} from "../src/lib/pdfTools/securityPdf.ts";
import {
  salvagePdfObjects,
  buildSyntheticXrefTrailer,
  inspectAndRepairMp4Moov,
} from "../src/lib/pdfTools/repairPdf.ts";
import {
  encryptFileAesGcm,
  decryptFileAesGcm,
} from "../src/lib/fileEncryption.ts";

Deno.test("securityPdf: buildQpdfEncryptionArgs compiles AES-256 arguments and permission flags", () => {
  const options: ProtectPdfOptions = {
    userPassword: "user123",
    ownerPassword: "adminSecret",
    standard: "aes-256-r6",
    allowPrinting: false,
    allowCopying: false,
    allowModifying: false,
  };

  const args = buildQpdfEncryptionArgs(options, "in.pdf", "out.pdf");

  assertEquals(args.includes("--encrypt"), true);
  assertEquals(args.includes("user123"), true);
  assertEquals(args.includes("adminSecret"), true);
  assertEquals(args.includes("256"), true);
  assertEquals(args.includes("--print=none"), true);
  assertEquals(args.includes("--extract=n"), true);
  assertEquals(args.includes("--modify=none"), true);
  assertEquals(args.slice(-2), ["in.pdf", "out.pdf"]);
});

Deno.test("securityPdf: buildQpdfEncryptionArgs enforces --use-aes=y for 128-bit encryption", () => {
  const options: ProtectPdfOptions = {
    userPassword: "user123",
    keyLength: 128,
  };

  const args = buildQpdfEncryptionArgs(options, "in.pdf", "out.pdf");
  assertEquals(args.includes("--encrypt"), true);
  assertEquals(args.includes("128"), true);
  assertEquals(args.includes("--use-aes=y"), true);
});

Deno.test("fileEncryption: encryptFileAesGcm and decryptFileAesGcm round-trip correctly", async () => {
  const enc = new TextEncoder();
  const plainText = "CompressZ confidential payload with UTF-8 characters: 🔐 12345";
  const bytes = enc.encode(plainText);
  const password = "MasterStrongPassword2026!";

  const encrypted = await encryptFileAesGcm(bytes, password);
  assertEquals(encrypted.length > bytes.length, true);
  assertEquals(new TextDecoder().decode(encrypted.subarray(0, 4)), "CZ25");

  const decrypted = await decryptFileAesGcm(encrypted, password);
  assertEquals(new TextDecoder().decode(decrypted), plainText);
});

Deno.test("repairPdf: salvagePdfObjects locates objects and buildSyntheticXrefTrailer creates valid table", () => {
  const enc = new TextEncoder();
  const corruptPayload = enc.encode(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page >>\nendobj\n",
  );

  const { objectOffsets, hasHeader, hasEof } = salvagePdfObjects(corruptPayload);

  assertEquals(hasHeader, true);
  assertEquals(hasEof, false); // Truncated / missing EOF
  assertEquals(objectOffsets.size, 3);
  assertEquals(objectOffsets.has(1), true);
  assertEquals(objectOffsets.has(2), true);
  assertEquals(objectOffsets.has(3), true);

  const syntheticXref = buildSyntheticXrefTrailer(objectOffsets);
  assertEquals(syntheticXref.includes("xref"), true);
  assertEquals(syntheticXref.includes("trailer"), true);
  assertEquals(syntheticXref.includes("/Size 4"), true);
  assertEquals(syntheticXref.includes("/Root 1 0 R"), true);
});

Deno.test("repairPdf: inspectAndRepairMp4Moov detects missing atoms and repairs headers", () => {
  // Truncated video buffer: starts with mdat directly without ftyp or moov
  const mdatOnly = new Uint8Array([
    0x00, 0x00, 0x00, 0x20, // size 32
    0x6d, 0x64, 0x61, 0x74, // mdat
    0x01, 0x02, 0x03, 0x04,
  ]);

  const repairResult = inspectAndRepairMp4Moov(mdatOnly);
  assertEquals(repairResult.fixed, true);
  assertEquals(repairResult.repairedBytes.length > mdatOnly.length, true);

  // Repaired buffer now starts with ftyp
  const _dv = new DataView(repairResult.repairedBytes.buffer);
  const type = String.fromCharCode(
    repairResult.repairedBytes[4],
    repairResult.repairedBytes[5],
    repairResult.repairedBytes[6],
    repairResult.repairedBytes[7],
  );
  assertEquals(type, "ftyp");
});

Deno.test("qpdfWasm: loads module via custom/mock loader and runs command in virtual FS", async () => {
  resetQpdfForTesting();
  assertEquals(isQpdfLoaded(), false);

  const virtualFs = new Map<string, Uint8Array>();
  const mockQpdfInstance = {
    callMain: (args: string[]) => {
      const outTarget = args[args.length - 1];
      virtualFs.set(outTarget, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]));
      return 0;
    },
    FS: {
      writeFile: (name: string, data: Uint8Array) => virtualFs.set(name, data),
      readFile: (name: string) => virtualFs.get(name) || new Uint8Array(),
      analyzePath: (name: string) => ({ exists: virtualFs.has(name) }),
      unlink: (name: string) => virtualFs.delete(name),
    },
    print: () => {},
    printErr: () => {},
  };

  const loaded = await getQpdf(async () => mockQpdfInstance);
  assertEquals(loaded, mockQpdfInstance);
  assertEquals(isQpdfLoaded(), true);

  const result = await runQpdfCommand(["--check", "input.pdf", "output.pdf"], [
    { name: "input.pdf", data: new Uint8Array([1, 2, 3]) },
  ]);

  assertEquals(result.exitCode, 0);
  assertEquals(result.outputFiles.length, 1);
  assertEquals(result.outputFiles[0].name, "output.pdf");
  assertEquals(result.outputFiles[0].data[0], 0x25); // %PDF

  resetQpdfForTesting();
});
