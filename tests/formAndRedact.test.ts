/**
 * formAndRedact.test.ts — Unit tests for PDF AcroForms and true redaction calculations.
 */

import { assertEquals } from "./assert.ts";
import {
  groupRedactionsByPage,
  transformVisualRectToPdf,
  type RedactionRegion,
} from "../src/lib/pdfTools/redactPdf.ts";

Deno.test("redactPdf: groupRedactionsByPage filters out-of-bounds regions and groups by page", () => {
  const regions: RedactionRegion[] = [
    { pageIndex: 0, x: 50, y: 500, width: 200, height: 30, reason: "PII" },
    { pageIndex: 0, x: 50, y: 400, width: 150, height: 25 },
    { pageIndex: 2, x: 100, y: 200, width: 80, height: 20, reason: "CONFIDENTIAL" },
    { pageIndex: 8, x: 50, y: 500, width: 200, height: 30 }, // Out of bounds for 4-page doc
    { pageIndex: 1, x: 50, y: 500, width: 0, height: 30 }, // Zero width
  ];

  const grouped = groupRedactionsByPage(regions, 4);

  assertEquals(grouped.size, 2);
  assertEquals(grouped.has(0), true);
  assertEquals(grouped.has(2), true);
  assertEquals(grouped.has(8), false); // Filtered out
  assertEquals(grouped.has(1), false); // Zero width filtered out

  const page0Redactions = grouped.get(0)!;
  assertEquals(page0Redactions.length, 2);
  assertEquals(page0Redactions[0].reason, "PII");
});

Deno.test("redactPdf: transformVisualRectToPdf properly sizes non-square regions at 90 and 270 degrees", () => {
  const pageWidth = 612;
  const pageHeight = 792;
  const visualX = 50;
  const visualY = 100;
  const visualWidth = 200; // non-square: width 200, height 40
  const visualHeight = 40;

  // 0 degrees: width stays 200, height stays 40
  const box0 = transformVisualRectToPdf(visualX, visualY, visualWidth, visualHeight, pageWidth, pageHeight, 0);
  assertEquals(box0.width, 200);
  assertEquals(box0.height, 40);
  assertEquals(box0.x, 50);
  assertEquals(box0.y, 652);

  // 90 degrees: quarter-turned, dimensions swap
  const box90 = transformVisualRectToPdf(visualX, visualY, visualWidth, visualHeight, pageWidth, pageHeight, 90);
  assertEquals(box90.width, 40);
  assertEquals(box90.height, 200);
  assertEquals(box90.x, 100);
  assertEquals(box90.y, 50);

  // 180 degrees: upside-down, dimensions remain
  const box180 = transformVisualRectToPdf(visualX, visualY, visualWidth, visualHeight, pageWidth, pageHeight, 180);
  assertEquals(box180.width, 200);
  assertEquals(box180.height, 40);
  assertEquals(box180.x, 362);
  assertEquals(box180.y, 100);

  // 270 degrees: quarter-turned, dimensions swap
  const box270 = transformVisualRectToPdf(visualX, visualY, visualWidth, visualHeight, pageWidth, pageHeight, 270);
  assertEquals(box270.width, 40);
  assertEquals(box270.height, 200);
  assertEquals(box270.x, 472);
  assertEquals(box270.y, 542);
});
