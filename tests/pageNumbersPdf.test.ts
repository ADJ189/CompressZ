/**
 * pageNumbersPdf.test.ts — Unit tests for PDF page numbering and Bates stamping logic.
 */

import { assertEquals } from "./assert.ts";
import {
  toRomanNumeral,
  formatPageNumber,
  calculateNumberPosition,
  parseTargetPages,
} from "../src/lib/pdfTools/pageNumbersPdf.ts";

Deno.test("pageNumbers: toRomanNumeral converts integers accurately", () => {
  assertEquals(toRomanNumeral(1), "I");
  assertEquals(toRomanNumeral(3), "III");
  assertEquals(toRomanNumeral(4), "IV");
  assertEquals(toRomanNumeral(9), "IX");
  assertEquals(toRomanNumeral(14), "XIV");
  assertEquals(toRomanNumeral(42), "XLII");
  assertEquals(toRomanNumeral(99), "XCIX");
  assertEquals(toRomanNumeral(2026), "MMXXVI");
  assertEquals(toRomanNumeral(0), "0");
  assertEquals(toRomanNumeral(-5), "-5");
});

Deno.test("pageNumbers: formatPageNumber generates standard formats", () => {
  assertEquals(formatPageNumber(1, 10, "page-n-of-total"), "Page 1 of 10");
  assertEquals(formatPageNumber(2, 5, "n-of-total"), "2 of 5");
  assertEquals(formatPageNumber(3, 8, "n-slash-total"), "3 / 8");
  assertEquals(formatPageNumber(4, 12, "page-n"), "Page 4");
  assertEquals(formatPageNumber(5, 20, "n"), "5");
  assertEquals(formatPageNumber(4, 10, "roman-lower"), "iv");
  assertEquals(formatPageNumber(9, 10, "roman-upper"), "IX");
});

Deno.test("pageNumbers: formatPageNumber generates Bates stamping with prefixes and padding", () => {
  assertEquals(
    formatPageNumber(1, 100, "bates", undefined, "BATES-", 6, ""),
    "BATES-000001",
  );
  assertEquals(
    formatPageNumber(42, 100, "bates", undefined, "CASE-2026-", 8, "-CONFIDENTIAL"),
    "CASE-2026-00000042-CONFIDENTIAL",
  );
});

Deno.test("pageNumbers: formatPageNumber supports custom pattern tokens", () => {
  assertEquals(
    formatPageNumber(3, 10, "custom", "Doc #{n} of {total} (Part {ROMAN})"),
    "Doc #3 of 10 (Part III)",
  );
  assertEquals(
    formatPageNumber(5, 12, "custom", "Draft p.{roman}"),
    "Draft p.v",
  );
});

Deno.test("pageNumbers: calculateNumberPosition computes correct anchor points", () => {
  const width = 600;
  const height = 800;
  const textWidth = 60;
  const textHeight = 10;
  const marginX = 40;
  const marginY = 30;

  // Bottom Center: centered horizontally, marginY from bottom
  const bCenter = calculateNumberPosition(
    width,
    height,
    textWidth,
    textHeight,
    "bottom-center",
    marginX,
    marginY,
    0,
    0,
  );
  assertEquals(bCenter.x, (600 - 60) / 2); // 270
  assertEquals(bCenter.y, 30);

  // Bottom Left
  const bLeft = calculateNumberPosition(
    width,
    height,
    textWidth,
    textHeight,
    "bottom-left",
    marginX,
    marginY,
    0,
    0,
  );
  assertEquals(bLeft.x, 40);
  assertEquals(bLeft.y, 30);

  // Bottom Right
  const bRight = calculateNumberPosition(
    width,
    height,
    textWidth,
    textHeight,
    "bottom-right",
    marginX,
    marginY,
    0,
    0,
  );
  assertEquals(bRight.x, 600 - 40 - 60); // 500
  assertEquals(bRight.y, 30);

  // Top Center: centered horizontally, marginY from top
  const tCenter = calculateNumberPosition(
    width,
    height,
    textWidth,
    textHeight,
    "top-center",
    marginX,
    marginY,
    0,
    0,
  );
  assertEquals(tCenter.x, 270);
  assertEquals(tCenter.y, 800 - 30 - 10); // 760

  // Top Left
  const tLeft = calculateNumberPosition(
    width,
    height,
    textWidth,
    textHeight,
    "top-left",
    marginX,
    marginY,
    0,
    0,
  );
  assertEquals(tLeft.x, 40);
  assertEquals(tLeft.y, 760);

  // With CropBox offset (originX = 50, originY = 100)
  const offsetPos = calculateNumberPosition(
    width,
    height,
    textWidth,
    textHeight,
    "bottom-center",
    marginX,
    marginY,
    50,
    100,
  );
  assertEquals(offsetPos.x, 50 + 270); // 320
  assertEquals(offsetPos.y, 100 + 30); // 130
});

Deno.test("pageNumbers: parseTargetPages resolves ranges and keywords", () => {
  // All pages
  assertEquals(parseTargetPages("all", 5), [0, 1, 2, 3, 4]);
  assertEquals(parseTargetPages("", 3), [0, 1, 2]);

  // Odd / Even (0-based: odd pages in 1-based are 1, 3, 5 -> 0, 2, 4)
  assertEquals(parseTargetPages("odd", 5), [0, 2, 4]);
  assertEquals(parseTargetPages("even", 5), [1, 3]);

  // Range syntax: "2-" (pages 2 to 5 -> 1, 2, 3, 4)
  assertEquals(parseTargetPages("2-", 5), [1, 2, 3, 4]);

  // Specific range: "2-4" -> 1, 2, 3
  assertEquals(parseTargetPages("2-4", 6), [1, 2, 3]);

  // Discrete list: "1, 3, 5" -> 0, 2, 4
  assertEquals(parseTargetPages("1, 3, 5", 6), [0, 2, 4]);

  // Out of bounds clamped
  assertEquals(parseTargetPages("1-99", 3), [0, 1, 2]);
  assertEquals(parseTargetPages("0", 3), []);
});
