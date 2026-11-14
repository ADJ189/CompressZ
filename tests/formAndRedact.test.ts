/**
 * formAndRedact.test.ts — Unit tests for PDF AcroForms and true redaction calculations.
 */

import { assertEquals } from "./assert.ts";
import {
  groupRedactionsByPage,
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
