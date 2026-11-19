/**
 * searchablePdf.test.ts — the numeric part of the OCR text layer.
 *
 * `createSearchablePdfBuilder()` pulls pdf-lib and a Unicode font from a CDN,
 * so its round trip is verified in the browser (see AUDIT-PLAN.md §17, gate 2).
 * What is verified here is the part that is easy to get subtly wrong and hard
 * to see in a PDF viewer: pixel→point scaling and the top-left→bottom-left
 * flip. A test PDF with mis-placed invisible text still "looks" fine.
 */
import { assert, assertEquals } from "./assert.ts";
import {
  describeTextLayerGap,
  rasterPageSizePt,
  wordPlacementPt,
} from "../src/lib/searchablePdf.ts";

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

Deno.test("searchablePdf: raster pixels map to real page points", () => {
  // A4 at 300 DPI is 2480×3508 px, which must come back as ~595×842 pt —
  // not a 2480-point page.
  const a4 = rasterPageSizePt(2480, 3508, 300);
  assertEquals(near(a4.widthPt, 595.2), true, `A4 width was ${a4.widthPt}`);
  assertEquals(near(a4.heightPt, 841.92), true, `A4 height was ${a4.heightPt}`);

  // 96 DPI is the CSS-pixel case used for image inputs.
  assertEquals(rasterPageSizePt(960, 540, 96).widthPt, 720);
  assertEquals(rasterPageSizePt(960, 540, 96).heightPt, 405);
});

Deno.test("searchablePdf: word boxes flip from top-left to baseline coordinates", () => {
  // 1000 px tall page at 100 DPI → 720 pt tall, 0.72 pt per px.
  const box = { x: 100, y: 100, w: 200, h: 20 };
  const placed = wordPlacementPt(box, 1000, 100);

  assertEquals(near(placed.x, 72), true, `x was ${placed.x}`);
  // Bottom edge of the box is y+h = 120 px from the top → 880 px from the
  // bottom → 633.6 pt.
  assertEquals(near(placed.y, 633.6), true, `y was ${placed.y}`);
  assertEquals(near(placed.size, 14.4), true, `size was ${placed.size}`);
  assertEquals(near(placed.maxWidth, 144), true, `maxWidth was ${placed.maxWidth}`);

  // A box touching the bottom of the page must land at y≈0, and one touching
  // the top must land at y = pageHeight - boxHeight.
  assertEquals(near(wordPlacementPt({ x: 0, y: 980, w: 10, h: 20 }, 1000, 100).y, 0), true);
  assertEquals(near(wordPlacementPt({ x: 0, y: 0, w: 10, h: 20 }, 1000, 100).y, 705.6), true);
});

Deno.test("searchablePdf: placement never emits a zero or negative font size", () => {
  const tiny = wordPlacementPt({ x: 0, y: 0, w: 0.5, h: 0 }, 100, 300);
  assertEquals(tiny.size, 1, "Font size floor must be 1 pt");
  assert(tiny.maxWidth > 0, "maxWidth must stay positive");
});

Deno.test("searchablePdf: unsupported-script gap note is explicit and stable", () => {
  assertEquals(describeTextLayerGap([]), null, "No skipped glyphs means no note");

  const note = describeTextLayerGap([0x4e2d, 0x6587]);
  assert(note !== null, "Skipped glyphs must produce a note");
  assert(note!.includes("U+4E2D"), `Note should name the code point: ${note}`);
  assert(note!.includes("U+6587"), `Note should name the code point: ${note}`);
  assert(note!.includes("selection is unavailable"), "Note must state the user-visible consequence");

  const singular = describeTextLayerGap([0x05d0]);
  assert(singular !== null && /character\b/.test(singular), `Expected singular wording: ${singular}`);
});
