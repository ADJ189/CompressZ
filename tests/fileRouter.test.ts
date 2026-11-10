/**
 * fileRouter.test.ts — Unit tests for magic bytes detection and action routing.
 */

import { assertEquals } from "./assert.ts";
import {
  identifyHeader,
  detectFileTypeAndActions,
} from "../src/lib/fileRouter.ts";

Deno.test("fileRouter: identifyHeader detects binary magic signatures", () => {
  // PDF: %PDF-
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  assertEquals(identifyHeader(pdfBytes), "pdf");

  // PNG: \x89PNG\r\n\x1a\n
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assertEquals(identifyHeader(pngBytes), "image");

  // JPEG: \xFF\xD8\xFF
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assertEquals(identifyHeader(jpegBytes), "image");

  // GIF: GIF89a
  const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  assertEquals(identifyHeader(gifBytes), "image");

  // WebP: RIFF....WEBP
  const webpBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x20, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, // WEBP
  ]);
  assertEquals(identifyHeader(webpBytes), "image");

  // WAV: RIFF....WAVE
  const wavBytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x20, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, // WAVE
  ]);
  assertEquals(identifyHeader(wavBytes), "audio");

  // MP3: ID3
  const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
  assertEquals(identifyHeader(mp3Bytes), "audio");

  // FLAC: fLaC
  const flacBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00]);
  assertEquals(identifyHeader(flacBytes), "audio");

  // OGG: OggS
  const oggBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
  assertEquals(identifyHeader(oggBytes), "audio");

  // MP4: ....ftypmp42
  const mp4Bytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70, // ftyp
    0x6d, 0x70, 0x34, 0x32, // mp42
  ]);
  assertEquals(identifyHeader(mp4Bytes), "video");

  // WebM / MKV: \x1A\x45\xDF\xA3
  const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
  assertEquals(identifyHeader(webmBytes), "video");

  // Too short
  assertEquals(identifyHeader(new Uint8Array([0x01, 0x02])), "unknown");
});

Deno.test("fileRouter: detectFileTypeAndActions routes PDF with full suite of actions", () => {
  const file = new File(["test pdf content"], "sample.pdf", {
    type: "application/pdf",
  });
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const result = detectFileTypeAndActions(file, pdfBytes);

  assertEquals(result.category, "pdf");
  assertEquals(result.mime, "application/pdf");
  assertEquals(result.actions.length > 5, true);

  // Verifying core PDF actions are present
  const actionIds = result.actions.map((a) => a.id);
  assertEquals(actionIds.includes("split-pdf"), true);
  assertEquals(actionIds.includes("compress-pdf"), true);
  assertEquals(actionIds.includes("edit-sign"), true);
  assertEquals(actionIds.includes("repair-pdf"), true);
  assertEquals(actionIds.includes("pdf-to-word"), true);
});

Deno.test("fileRouter: detectFileTypeAndActions handles Office documents", () => {
  const docxFile = new File(["dummy docx"], "report.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const docxResult = detectFileTypeAndActions(docxFile);
  assertEquals(docxResult.category, "docx");
  assertEquals(docxResult.actions.some((a) => a.id === "docx-to-pdf"), true);

  const xlsxFile = new File(["dummy xlsx"], "sheet.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const xlsxResult = detectFileTypeAndActions(xlsxFile);
  assertEquals(xlsxResult.category, "xlsx");
  assertEquals(xlsxResult.actions.some((a) => a.id === "xlsx-to-pdf"), true);

  const pptxFile = new File(["dummy pptx"], "slides.pptx", {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const pptxResult = detectFileTypeAndActions(pptxFile);
  assertEquals(pptxResult.category, "pptx");
  assertEquals(pptxResult.actions.some((a) => a.id === "pptx-to-pdf"), true);
});
