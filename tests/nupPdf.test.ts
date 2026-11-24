/**
 * nupPdf.test.ts — Unit tests for multi-page N-Up layout math and slot allocation.
 */

import { assertEquals } from "./assert.ts";
import {
  calculateFittedDimensions,
  planNupGrid,
  chunkPages,
  STANDARD_SHEET_SIZES,
} from "../src/lib/pdfTools/nupPdf.ts";

Deno.test("nup: calculateFittedDimensions preserves aspect ratio", () => {
  // Portrait in Landscape slot: 400x600 into 400x400 slot -> scales to 266.66 x 400
  const fit1 = calculateFittedDimensions(400, 600, 400, 400);
  assertEquals(fit1.height, 400);
  assertEquals(Math.round(fit1.width), 267);
  assertEquals(fit1.scale < 1, true);
  assertEquals(fit1.offsetY, 0);
  assertEquals(fit1.offsetX > 0, true);

  // Landscape into Landscape slot: 800x400 into 400x400 -> scales to 400 x 200
  const fit2 = calculateFittedDimensions(800, 400, 400, 400);
  assertEquals(fit2.width, 400);
  assertEquals(fit2.height, 200);
  assertEquals(fit2.offsetX, 0);
  assertEquals(fit2.offsetY, 100);

  // Zero dimensions handled safely
  assertEquals(calculateFittedDimensions(0, 100, 200, 200), {
    width: 0,
    height: 0,
    scale: 0,
    offsetX: 0,
    offsetY: 0,
  });
});

Deno.test("nup: planNupGrid creates correct slot counts and orientations", () => {
  // 2-Up defaults to landscape on A4
  const grid2 = planNupGrid(2, "a4", "auto", 24, 16);
  assertEquals(grid2.sheetWidth, STANDARD_SHEET_SIZES.a4.height); // 841.89
  assertEquals(grid2.sheetHeight, STANDARD_SHEET_SIZES.a4.width); // 595.28
  assertEquals(grid2.rows, 1);
  assertEquals(grid2.cols, 2);
  assertEquals(grid2.slots.length, 2);

  // Left slot comes before right slot
  assertEquals(grid2.slots[0].x < grid2.slots[1].x, true);
  assertEquals(grid2.slots[0].y, grid2.slots[1].y);

  // 4-Up creates 4 slots in 2x2 grid
  const grid4 = planNupGrid(4, "a4", "portrait", 20, 10);
  assertEquals(grid4.rows, 2);
  assertEquals(grid4.cols, 2);
  assertEquals(grid4.slots.length, 4);

  // Top row Y is higher than bottom row Y
  assertEquals(grid4.slots[0].y > grid4.slots[2].y, true);
  assertEquals(grid4.slots[1].y > grid4.slots[3].y, true);

  // 9-Up creates 9 slots in 3x3 grid
  const grid9 = planNupGrid(9, "letter", "landscape", 10, 5);
  assertEquals(grid9.rows, 3);
  assertEquals(grid9.cols, 3);
  assertEquals(grid9.slots.length, 9);
});

Deno.test("nup: chunkPages breaks total pages into expected sheet groups", () => {
  // 5 pages with 2-up -> [ [0,1], [2,3], [4] ]
  const c2 = chunkPages(5, 2);
  assertEquals(c2, [[0, 1], [2, 3], [4]]);

  // 4 pages with 4-up -> [ [0,1,2,3] ]
  const c4 = chunkPages(4, 4);
  assertEquals(c4, [[0, 1, 2, 3]]);

  // 0 pages -> []
  assertEquals(chunkPages(0, 2), []);
});
