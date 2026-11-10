/**
 * watermark.test.ts — Unit tests for watermark positioning and calculations.
 */

import { assertEquals } from "./assert.ts";
import {
  hexToRgb01,
  calculateWatermarkPositions,
  resolveTargetPages,
} from "../src/lib/pdfTools/watermarkPdf.ts";

Deno.test("watermark: hexToRgb01 converts hex to 0..1 RGB floats", () => {
  // #FFFFFF -> 1, 1, 1
  const white = hexToRgb01("#ffffff");
  assertEquals(white.r, 1);
  assertEquals(white.g, 1);
  assertEquals(white.b, 1);

  // #000000 -> 0, 0, 0
  const black = hexToRgb01("#000000");
  assertEquals(black.r, 0);
  assertEquals(black.g, 0);
  assertEquals(black.b, 0);

  // 3-digit hex #f00 -> 1, 0, 0
  const red = hexToRgb01("#f00");
  assertEquals(red.r, 1);
  assertEquals(red.g, 0);
  assertEquals(red.b, 0);
});

Deno.test("watermark: calculateWatermarkPositions centers when not tiled", () => {
  const pos = calculateWatermarkPositions(600, 800, false);
  assertEquals(pos.length, 1);
  assertEquals(pos[0], { x: 300, y: 400 });
});

Deno.test("watermark: calculateWatermarkPositions tiles grid across page", () => {
  const pos = calculateWatermarkPositions(400, 400, true, 200);
  // With width 400 and height 400, spacing 200 -> at least 4 positions
  assertEquals(pos.length >= 4, true);
  for (const p of pos) {
    assertEquals(p.x > 0 && p.x <= 400 + 100, true);
    assertEquals(p.y > 0 && p.y <= 400 + 100, true);
  }
});

Deno.test("watermark: resolveTargetPages filters target pages safely", () => {
  assertEquals(resolveTargetPages(5, "all"), [0, 1, 2, 3, 4]);
  assertEquals(resolveTargetPages(5, "first"), [0]);
  assertEquals(resolveTargetPages(5, [1, 3, 9]), [1, 3]); // 9 clamped out
});
