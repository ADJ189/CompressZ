/**
 * securityAndRepair.test.ts — Unit tests for PDF encryption and recovery engines.
 */

import { assertEquals } from "./assert.ts";
import {
  buildQpdfEncryptionArgs,
  type ProtectPdfOptions,
} from "../src/lib/pdfTools/securityPdf.ts";
import {
  salvagePdfObjects,
  buildSyntheticXrefTrailer,
  inspectAndRepairMp4Moov,
} from "../src/lib/pdfTools/repairPdf.ts";

Deno.test("securityPdf: buildQpdfEncryptionArgs compiles AES-256 arguments and permission flags", () => {
  const options: ProtectPdfOptions = {
    userPassword: "user123",
    ownerPassword: "adminSecret",
    keyLength: 256,
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
