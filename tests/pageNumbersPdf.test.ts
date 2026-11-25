/**
 * pageNumbersPdf.test.ts — Unit tests for PDF page numbering and Bates stamping logic.
 */

import { assertEquals, assertThrows, assertRejects } from "./assert.ts";
import {
  toRomanNumeral,
  formatPageNumber,
  calculateNumberPosition,
  calculateRotatedNumberPlacement,
  parseTargetPages,
  applyPdfPageNumbers,
  MAX_PAGE_NUMBER_START,
  MAX_ROMAN_NUMERAL,
} from "../src/lib/pdfTools/pageNumbersPdf.ts";
import { setPdfLibForTesting, resetPdfLibForTesting } from "../src/lib/pdfLibs.ts";

Deno.test("pageNumbers: toRomanNumeral converts integers accurately and bounds out-of-range values", () => {
  assertEquals(toRomanNumeral(1), "I");
  assertEquals(toRomanNumeral(3), "III");
  assertEquals(toRomanNumeral(4), "IV");
  assertEquals(toRomanNumeral(9), "IX");
  assertEquals(toRomanNumeral(14), "XIV");
  assertEquals(toRomanNumeral(42), "XLII");
  assertEquals(toRomanNumeral(99), "XCIX");
  assertEquals(toRomanNumeral(2026), "MMXXVI");
  assertEquals(toRomanNumeral(MAX_ROMAN_NUMERAL), "MMMCMXCIX");
  assertEquals(toRomanNumeral(MAX_ROMAN_NUMERAL + 1), String(MAX_ROMAN_NUMERAL + 1));
  assertEquals(toRomanNumeral(0), "0");
  assertEquals(toRomanNumeral(-5), "-5");
  assertEquals(toRomanNumeral(10_000_000), "10000000");
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
  assertEquals(parseTargetPages("99", 3), []);

  // Invalid / non-positive tokens throw visibly (both wholly invalid and mixed)
  assertThrows(() => parseTargetPages("0", 3), "Page numbers must be 1 or greater");
  assertThrows(() => parseTargetPages("abc", 5), "Unrecognized page range token");
  assertThrows(() => parseTargetPages("-3", 5), "Unrecognized page range token");
  assertThrows(() => parseTargetPages("1, abc, 3", 5), "Unrecognized page range token");
  assertThrows(() => parseTargetPages("2-4, xyz", 5), "Unrecognized page range token");
  assertThrows(() => parseTargetPages("5-2", 5), "start page cannot exceed end page");
});

Deno.test("pageNumbers: calculateRotatedNumberPlacement maps visual anchors and text angles for 0, 90, 180, 270", () => {
  const box = { x: 10, y: 20, width: 600, height: 800 };
  const textW = 50;
  const textH = 10;
  const mx = 30;
  const my = 40;

  // 0 degrees
  const p0 = calculateRotatedNumberPlacement(box, 0, textW, textH, "bottom-center", mx, my);
  assertEquals(p0, { x: 10 + (600 - 50) / 2, y: 20 + 40, textAngle: 0 });

  // 90 degrees CW: visual width is 800, visual height is 600
  const p90BottomCenter = calculateRotatedNumberPlacement(box, 90, textW, textH, "bottom-center", mx, my);
  assertEquals(p90BottomCenter, {
    x: 10 + 600 - 40,
    y: 20 + (800 - 50) / 2,
    textAngle: 90,
  });
  const p90TopLeft = calculateRotatedNumberPlacement(box, 90, textW, textH, "top-left", mx, my);
  assertEquals(p90TopLeft, {
    x: 10 + 600 - (600 - 40 - 10),
    y: 20 + 30,
    textAngle: 90,
  });

  // 180 degrees CW
  const p180BottomCenter = calculateRotatedNumberPlacement(box, 180, textW, textH, "bottom-center", mx, my);
  assertEquals(p180BottomCenter, {
    x: 10 + 600 - (600 - 50) / 2,
    y: 20 + 800 - 40,
    textAngle: 180,
  });
  const p180TopRight = calculateRotatedNumberPlacement(box, 180, textW, textH, "top-right", mx, my);
  assertEquals(p180TopRight, {
    x: 10 + 600 - (600 - 30 - 50),
    y: 20 + 800 - (800 - 40 - 10),
    textAngle: 180,
  });

  // 270 degrees CW: visual width is 800, visual height is 600
  const p270BottomCenter = calculateRotatedNumberPlacement(box, 270, textW, textH, "bottom-center", mx, my);
  assertEquals(p270BottomCenter, {
    x: 10 + 40,
    y: 20 + 800 - (800 - 50) / 2,
    textAngle: 270,
  });
  const p270BottomRight = calculateRotatedNumberPlacement(box, 270, textW, textH, "bottom-right", mx, my);
  assertEquals(p270BottomRight, {
    x: 10 + 40,
    y: 20 + 800 - (800 - 30 - 50),
    textAngle: 270,
  });
});

Deno.test("pageNumbers: applyPdfPageNumbers rejects invalid/empty ranges and passes rotation to drawText", async () => {
  const drawn: Array<{ text: string; x: number; y: number; rotate?: number }> = [];
  const mockLib = {
    StandardFonts: { Helvetica: "Helvetica", TimesRoman: "TimesRoman", Courier: "Courier" },
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
    degrees: (a: number) => ({ angle: a }),
    PDFDocument: {
      load: async () => ({
        isEncrypted: false,
        getPageCount: () => 2,
        embedFont: async () => ({
          widthOfTextAtSize: () => 40,
          heightAtSize: () => 10,
        }),
        getPage: (idx: number) => ({
          getCropBox: () => ({ x: 0, y: 0, width: 600, height: 800 }),
          getRotation: () => ({ angle: idx === 0 ? 90 : 270 }),
          drawText: (text: string, opts: { x: number; y: number; rotate?: { angle: number } }) => {
            drawn.push({ text, x: opts.x, y: opts.y, rotate: opts.rotate?.angle });
          },
        }),
        save: async () => new Uint8Array([1, 2, 3]),
      }),
    },
  };

  setPdfLibForTesting(mockLib);
  try {
    await assertRejects(
      () => applyPdfPageNumbers(new Uint8Array([1]), { pageRange: "invalid" }),
      "Unrecognized page range token",
    );
    await assertRejects(
      () => applyPdfPageNumbers(new Uint8Array([1]), { pageRange: "1, bad" }),
      "Unrecognized page range token",
    );
    await assertRejects(
      () => applyPdfPageNumbers(new Uint8Array([1]), { pageRange: "99" }),
      "No valid pages matched",
    );

    await applyPdfPageNumbers(new Uint8Array([1]), { pageRange: "all", position: "bottom-center" });
    assertEquals(drawn.length, 2);
    assertEquals(drawn[0].rotate, 90);
    assertEquals(drawn[1].rotate, 270);

    // Enforces startNumber bounds before processing pages
    await assertRejects(
      () => applyPdfPageNumbers(new Uint8Array([1]), { startNumber: 0 }),
      "Start number must be a whole number",
    );
    await assertRejects(
      () => applyPdfPageNumbers(new Uint8Array([1]), { startNumber: MAX_PAGE_NUMBER_START + 1 }),
      "Start number must be a whole number",
    );

    // Custom pattern without Roman tokens works at high startNumber cleanly
    drawn.length = 0;
    await applyPdfPageNumbers(new Uint8Array([1]), {
      format: "custom",
      customPattern: "Doc #{n}",
      startNumber: 5000,
    });
    assertEquals(drawn[0].text, "Doc #5000");
  } finally {
    resetPdfLibForTesting();
  }
});
