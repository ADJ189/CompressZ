/**
 * cropPdf.test.ts — Unit tests for PDF crop calculations.
 */

import { assertEquals, assertThrows } from "./assert.ts";
import {
  calculateCroppedBox,
} from "../src/lib/pdfTools/cropPdf.ts";

Deno.test("cropPdf: calculateCroppedBox calculates margin-based bounds", () => {
  const orig = { x: 0, y: 0, width: 600, height: 800 };
  const cropped = calculateCroppedBox(orig, {
    mode: "margins",
    margins: { top: 50, bottom: 40, left: 30, right: 20 },
  });

  assertEquals(cropped.x, 30);
  assertEquals(cropped.y, 40);
  assertEquals(cropped.width, 550); // 600 - 30 - 20
  assertEquals(cropped.height, 710); // 800 - 50 - 40
});

Deno.test("cropPdf: calculateCroppedBox rejects excessive margins", () => {
  const orig = { x: 0, y: 0, width: 200, height: 200 };
  assertThrows(() =>
    calculateCroppedBox(orig, {
      mode: "margins",
      margins: { top: 100, bottom: 100, left: 10, right: 10 },
    })
  );
});

Deno.test("cropPdf: calculateCroppedBox clamps explicit box within original bounds", () => {
  const orig = { x: 0, y: 0, width: 500, height: 500 };
  const cropped = calculateCroppedBox(orig, {
    mode: "box",
    box: { x: 50, y: 50, width: 300, height: 300 },
  });

  assertEquals(cropped.x, 50);
  assertEquals(cropped.y, 50);
  assertEquals(cropped.width, 300);
  assertEquals(cropped.height, 300);
});
