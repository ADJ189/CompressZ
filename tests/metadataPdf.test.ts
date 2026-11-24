/**
 * metadataPdf.test.ts — Unit tests for PDF metadata inspection and sanitization helpers.
 */

import { assertEquals } from "./assert.ts";
import {
  sanitizeMetadataString,
  formatPdfDate,
} from "../src/lib/pdfTools/metadataPdf.ts";

Deno.test("metadata: sanitizeMetadataString strips unprintable and control codes", () => {
  assertEquals(sanitizeMetadataString("Clean Title"), "Clean Title");
  assertEquals(sanitizeMetadataString("  Spaces Around  "), "Spaces Around");
  // Null bytes and control codes
  assertEquals(sanitizeMetadataString("Hello\x00World\x08"), "HelloWorld");
  assertEquals(sanitizeMetadataString(undefined), "");
  assertEquals(sanitizeMetadataString(""), "");
});

Deno.test("metadata: formatPdfDate formats valid Dates and handles invalid dates", () => {
  const d = new Date("2026-05-15T10:30:00.000Z");
  assertEquals(formatPdfDate(d), "2026-05-15T10:30:00.000Z");

  assertEquals(formatPdfDate(undefined), undefined);
  assertEquals(formatPdfDate(new Date("invalid")), undefined);
});
