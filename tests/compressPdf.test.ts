import { assertEquals, assert } from "./assert.ts";
import {
  calculateImageDrawnSizes,
  calculateEffectiveDpi,
  calculateDpiScale,
  calculateTargetQuality,
} from "../src/lib/compressPdf.ts";

Deno.test("compressPdf: calculateImageDrawnSizes extracts drawn dimensions from CTM", () => {
  const stream = `
    q
    100 0 0 200 50 80 cm
    /Im1 Do
    Q
    q
    0 300 -150 0 20 40 cm
    /Im2 Do
    Q
  `;
  const drawn = calculateImageDrawnSizes(stream);
  assertEquals(drawn.has("Im1"), true);
  const im1 = drawn.get("Im1")!;
  assertEquals(im1.length, 1);
  assertEquals(Math.round(im1[0].widthPt), 100);
  assertEquals(Math.round(im1[0].heightPt), 200);

  assertEquals(drawn.has("Im2"), true);
  const im2 = drawn.get("Im2")!;
  assertEquals(im2.length, 1);
  assertEquals(Math.round(im2[0].widthPt), 300);
  assertEquals(Math.round(im2[0].heightPt), 150);
});

Deno.test("compressPdf: calculateImageDrawnSizes ignores strings and comments", () => {
  const stream = `
    % /ImFake Do
    (Some text with /ImFake Do and 100 0 0 200 0 0 cm) Tj
    q
    120 0 0 240 0 0 cm
    /ImReal Do
    Q
  `;
  const drawn = calculateImageDrawnSizes(stream);
  assertEquals(drawn.has("ImFake"), false);
  assertEquals(drawn.has("ImReal"), true);
  const imReal = drawn.get("ImReal")!;
  assertEquals(Math.round(imReal[0].widthPt), 120);
  assertEquals(Math.round(imReal[0].heightPt), 240);
});

Deno.test("compressPdf: effective DPI and dpiScale avoids blanket 300 DPI assumption", () => {
  // An image of 300x300 displayed at 300x300 points (4.17 x 4.17 inches):
  // effDpi = 300 / (300 / 72) = 72 DPI.
  // If targetDpi is 150, effDpi (72) <= targetDpi (150).
  // dpiScale MUST be 1 (no downsampling!), unlike old blanket targetDpi/300 which gave 0.5.
  const effDpi = calculateEffectiveDpi(300, 300, 300, 300);
  assertEquals(Math.round(effDpi), 72);

  const scale = calculateDpiScale(effDpi, 150);
  assertEquals(scale, 1);
});

Deno.test("compressPdf: effective DPI downsamples only when exceeding targetDpi", () => {
  // An image of 1200x1200 displayed at 144x144 points (2 x 2 inches):
  // effDpi = 1200 / (144 / 72) = 600 DPI.
  // If targetDpi is 150: dpiScale = 150 / 600 = 0.25.
  const effDpi = calculateEffectiveDpi(1200, 1200, 144, 144);
  assertEquals(Math.round(effDpi), 600);

  const scale = calculateDpiScale(effDpi, 150);
  assertEquals(scale, 0.25);
});

Deno.test("compressPdf: effective DPI falls back to page bound when displayed size unavailable", () => {
  // Page is 612 x 792 pt. max(origW, origH) = 1584.
  // Page size in inches = 792 / 72 = 11 inches.
  // effDpi = 1584 / 11 = 144 DPI.
  const effDpi = calculateEffectiveDpi(1584, 1224, undefined, undefined, 612, 792);
  assertEquals(Math.round(effDpi), 144);

  // If target is 150, 144 <= 150, so scale is 1
  const scale = calculateDpiScale(effDpi, 150);
  assertEquals(scale, 1);
});

Deno.test("compressPdf: calculateTargetQuality does not scale quality by pixel area ratio", () => {
  const baseQuality = 0.75;
  // targetSizeKB = 500, originalSize = 1000KB -> sizeRatio = 0.5
  // Downscaling from 1000x1000 to 500x500 is area ratio 0.25.
  // Old formula did: 0.75 * 0.25 = 0.1875 -> clamped to 0.2 floor!
  // New formula derives quality from target size vs original size and does not multiply by area ratio.
  const quality = calculateTargetQuality(baseQuality, 500, 1000 * 1024);
  // Quality should be based on sizeRatio (e.g. 0.75 * 0.5 = 0.375), well above the 0.2 floor
  assert(quality > 0.3, `Quality ${quality} should be above 0.3 and not crushed to 0.2 floor`);
  assertEquals(Math.round(quality * 100) / 100, 0.38);

  // If targetSizeKB is not set (<= 0), quality remains baseQuality
  const unconstrainedQuality = calculateTargetQuality(baseQuality, 0, 1000 * 1024);
  assertEquals(unconstrainedQuality, baseQuality);
});
