/**
 * securityAndRepair.test.ts — Unit tests for PDF encryption and recovery engines.
 */

import { assertEquals } from "./assert.ts";
import {
  isQpdfLoaded,
  getQpdf,
  resetQpdfForTesting,
  setQpdfInstance,
  runQpdfCommand,
} from "../src/lib/qpdfWasm.ts";
import {
  buildQpdfEncryptionArgs,
  type ProtectPdfOptions,
} from "../src/lib/pdfTools/securityPdf.ts";
import {
  salvagePdfObjects,
  buildSyntheticXrefTrailer,
  repairCorruptPdf,
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

Deno.test("securityPdf: buildQpdfEncryptionArgs adds --force-R5 and generates distinct owner password when omitted", () => {
  const options: ProtectPdfOptions = {
    userPassword: "secretUserPass",
    standard: "aes-256-r5",
  };

  const args = buildQpdfEncryptionArgs(options, "in.pdf", "out.pdf");
  assertEquals(args.includes("--encrypt"), true);
  assertEquals(args.includes("256"), true);
  assertEquals(args.includes("--force-R5"), true);
  
  // Owner password must NOT match user password when user only supplies userPassword
  const userIdx = args.indexOf("secretUserPass");
  const ownerPass = args[userIdx + 1];
  assertEquals(ownerPass !== "secretUserPass", true);
  assertEquals(ownerPass.length > 8, true);
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

  const { objectOffsets, hasHeader, hasEof, rootObject } = salvagePdfObjects(corruptPayload);

  assertEquals(hasHeader, true);
  assertEquals(hasEof, false); // Truncated / missing EOF
  assertEquals(objectOffsets.size, 3);
  assertEquals(objectOffsets.has(1), true);
  assertEquals(objectOffsets.has(2), true);
  assertEquals(objectOffsets.has(3), true);
  assertEquals(rootObject, 1);

  const syntheticXref = buildSyntheticXrefTrailer(objectOffsets);
  assertEquals(syntheticXref.includes("xref"), true);
  assertEquals(syntheticXref.includes("trailer"), true);
  assertEquals(syntheticXref.includes("/Size 4"), true);
  assertEquals(syntheticXref.includes("/Root 1 0 R"), true);
});

Deno.test("repairPdf: salvage prefers the newest object and shifts offsets for a prepended header", () => {
  const enc = new TextEncoder();
  const first = enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const second = enc.encode("1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n");
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first, 0);
  bytes.set(second, first.length);

  const { objectOffsets, hasHeader, rootObject } = salvagePdfObjects(bytes);
  assertEquals(hasHeader, false); // no %PDF header at all
  assertEquals(rootObject, 1);
  // Incremental update: the later definition wins.
  assertEquals(objectOffsets.get(1), first.length);

  // A prepended header moves every object; the xref must reflect that.
  const headerLen = 9;
  const xref = buildSyntheticXrefTrailer(objectOffsets, rootObject!, headerLen);
  assertEquals(xref.includes("/Root 1 0 R"), true);
  const expected = String(first.length + headerLen).padStart(10, "0");
  assertEquals(xref.includes(`${expected} 00000 n`), true);
});

Deno.test("repairPdf: js salvage refuses to build a file with no catalog", async () => {
  resetQpdfForTesting();
  // Force the QPDF path to fail so the JS salvage branch runs, without a CDN import.
  setQpdfInstance({
    callMain: () => {
      throw new Error("qpdf unavailable in test");
    },
    FS: {
      writeFile: () => {},
      unlink: () => {},
      analyzePath: () => ({ exists: false }),
      readFile: () => new Uint8Array(0),
    },
    print: () => {},
    printErr: () => {},
  });
  const bytes = new TextEncoder().encode("1 0 obj\n<< /Type /Page >>\nendobj\n");

  let message = "";
  try {
    await repairCorruptPdf(bytes);
  } catch (err) {
    message = String((err as Error).message);
  } finally {
    resetQpdfForTesting();
  }
  assertEquals(/catalog/i.test(message), true);
});

function mp4Box(type: string, payload = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);
  return out;
}

function mp4Join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

Deno.test("repairPdf: inspectAndRepairMp4Moov refuses to fake-repair a moov-less recording", () => {
  const mdatOnly = mp4Join(mp4Box("mdat", new Uint8Array(8)));
  const mdatResult = inspectAndRepairMp4Moov(mdatOnly);
  assertEquals(mdatResult.ok, false);
  assertEquals(mdatResult.ok === false && /MOOV/.test(mdatResult.reason), true);

  // Nothing usable at all.
  const garbage = inspectAndRepairMp4Moov(new Uint8Array(16));
  assertEquals(garbage.ok, false);
  assertEquals(garbage.ok === false && /mdat/.test(garbage.reason), true);

  // A finalized container that only lost its ftyp box is genuinely fixable.
  const noFtyp = mp4Join(mp4Box("moov", new Uint8Array(8)), mp4Box("mdat", new Uint8Array(8)));
  const fixed = inspectAndRepairMp4Moov(noFtyp);
  assertEquals(fixed.ok, true);
  if (fixed.ok) {
    assertEquals(fixed.repairedBytes.length, noFtyp.length + 24);
    assertEquals(
      String.fromCharCode(...fixed.repairedBytes.subarray(4, 8)),
      "ftyp",
    );
  }

  // An already-valid file is reported as such, never re-downloaded.
  const valid = mp4Join(mp4Box("ftyp"), mp4Box("moov"), mp4Box("mdat"));
  const already = inspectAndRepairMp4Moov(valid);
  assertEquals(already.ok, false);
  assertEquals(already.ok === false && already.alreadyValid, true);
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

Deno.test("qpdfWasm: captures stdout/stderr and restores the instance handlers", async () => {
  resetQpdfForTesting();

  const originalCalls: string[] = [];
  const virtualFs = new Map<string, Uint8Array>();
  const consoleErrorBefore = console.error;
  type MockQpdf = {
    callMain: () => number;
    FS: {
      writeFile: (name: string, data: Uint8Array) => void;
      readFile: (name: string) => Uint8Array;
      analyzePath: (name: string) => { exists: boolean };
      unlink: (name: string) => void;
    };
    print: (text: string) => void;
    printErr: (text: string) => void;
  };
  const mock: MockQpdf = {
    callMain: () => {
      mock.print("hello from qpdf");
      mock.printErr("warning from qpdf");
      // qpdf-wasm 0.3.0 writes here regardless of the init options.
      console.error("this.program: can't find startxref");
      return 0;
    },
    FS: {
      writeFile: (name: string, data: Uint8Array) => virtualFs.set(name, data),
      readFile: (name: string) => virtualFs.get(name) || new Uint8Array(),
      analyzePath: (name: string) => ({ exists: virtualFs.has(name) }),
      unlink: (name: string) => virtualFs.delete(name),
    },
    print: (text: string) => originalCalls.push(text),
    printErr: (text: string) => originalCalls.push(text),
  };

  await getQpdf(async () => mock);
  const result = await runQpdfCommand(["input.pdf", "output.pdf"], [
    { name: "input.pdf", data: new Uint8Array([1]) },
  ]);

  // Commands written during the run must land in `stdout`, not the instance's
  // own handler — that is the regression this guards.
  assertEquals(result.stdout.includes("hello from qpdf"), true);
  assertEquals(result.stdout.includes("warning from qpdf"), true);
  assertEquals(result.stdout.includes("can't find startxref"), true);
  assertEquals(originalCalls.length, 0);
  assertEquals(console.error === consoleErrorBefore, true);

  // The instance handler is put back afterwards.
  mock.print("after");
  assertEquals(originalCalls.length, 1);

  resetQpdfForTesting();
});
