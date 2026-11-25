/**
 * nupPdf.test.ts — Unit tests for multi-page N-Up layout math and slot allocation.
 */

import { assertEquals } from "./assert.ts";
import {
  calculateFittedDimensions,
  planNupGrid,
  planRotatedNupDraw,
  chunkPages,
  createNupPdf,
  STANDARD_SHEET_SIZES,
} from "../src/lib/pdfTools/nupPdf.ts";
import { setPdfLibForTesting, resetPdfLibForTesting } from "../src/lib/pdfLibs.ts";

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

Deno.test("nup: planRotatedNupDraw fits rotated 90/180/270 pages within slot bounds", () => {
  const slot = { x: 20, y: 30, width: 300, height: 200 };

  // 200x400 unrotated page rotated 90 deg becomes 400x200 visual -> fits 300x150 inside 300x200
  const p90 = planRotatedNupDraw(200, 400, 90, slot);
  assertEquals(p90.visualWidth, 300);
  assertEquals(p90.visualHeight, 150);
  assertEquals(p90.rotateDeg, -90);
  assertEquals(p90.x, p90.visualX);
  assertEquals(p90.y, p90.visualY + p90.visualHeight);
  assertEquals(p90.width, 150);
  assertEquals(p90.height, 300);

  // 180 deg preserves aspect ratio and anchors at top-right of visual rect
  const p180 = planRotatedNupDraw(400, 200, 180, slot);
  assertEquals(p180.visualWidth, 300);
  assertEquals(p180.visualHeight, 150);
  assertEquals(p180.rotateDeg, -180);
  assertEquals(p180.x, p180.visualX + p180.visualWidth);
  assertEquals(p180.y, p180.visualY + p180.visualHeight);

  // 270 deg swaps dimensions and anchors at bottom-right of visual rect
  const p270 = planRotatedNupDraw(200, 400, 270, slot);
  assertEquals(p270.visualWidth, 300);
  assertEquals(p270.visualHeight, 150);
  assertEquals(p270.rotateDeg, -270);
  assertEquals(p270.x, p270.visualX + p270.visualWidth);
  assertEquals(p270.y, p270.visualY);
});

Deno.test("nup: createNupPdf passes CropBox bounding box to embedPage and preserves rotated orientations", async () => {
  const embedCalls: Array<{ bbox: unknown; pageIndex: number }> = [];
  const drawCalls: Array<{
    embeddedWidth: number;
    embeddedHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
    rotate?: number;
  }> = [];

  const pages = [
    {
      idx: 0,
      cropBox: { x: 50, y: 100, width: 300, height: 400 },
      mediaBox: { x: 0, y: 0, width: 600, height: 800 },
      rotation: 90,
      insideText: "VISIBLE_CROPPED_TEXT",
      outsideText: "CLIPPED_OUTSIDE_TEXT",
    },
    {
      idx: 1,
      cropBox: { x: 0, y: 0, width: 400, height: 600 },
      mediaBox: { x: 0, y: 0, width: 400, height: 600 },
      rotation: 180,
      insideText: "PAGE2_INSIDE",
    },
    {
      idx: 2,
      cropBox: { x: 10, y: 20, width: 300, height: 500 },
      mediaBox: { x: 0, y: 0, width: 500, height: 700 },
      rotation: 270,
      insideText: "PAGE3_INSIDE",
    },
  ];

  const mockLib = {
    rgb: (r: number, g: number, b: number) => ({ r, g, b }),
    degrees: (a: number) => ({ angle: a }),
    PDFDocument: {
      load: async () => ({
        isEncrypted: false,
        getPageCount: () => pages.length,
        getPage: (idx: number) => ({
          _idx: idx,
          getCropBox: () => pages[idx].cropBox,
          getMediaBox: () => pages[idx].mediaBox,
          getRotation: () => ({ angle: pages[idx].rotation }),
        }),
      }),
      create: async () => ({
        addPage: () => ({
          drawPage: (
            emb: { width: number; height: number },
            opts: { x: number; y: number; width: number; height: number; rotate?: { angle: number } },
          ) => {
            drawCalls.push({
              embeddedWidth: emb.width,
              embeddedHeight: emb.height,
              x: opts.x,
              y: opts.y,
              width: opts.width,
              height: opts.height,
              rotate: opts.rotate?.angle,
            });
          },
          drawRectangle: () => {},
        }),
        embedPage: async (
          page: { _idx: number },
          bbox?: { left: number; bottom: number; right: number; top: number },
        ) => {
          embedCalls.push({ bbox, pageIndex: page._idx });
          const w = bbox ? bbox.right - bbox.left : pages[page._idx].mediaBox.width;
          const h = bbox ? bbox.top - bbox.bottom : pages[page._idx].mediaBox.height;
          return { width: w, height: h };
        },
        save: async () => new Uint8Array([1, 2, 3]),
      }),
    },
  };

  setPdfLibForTesting(mockLib);
  try {
    await createNupPdf(new Uint8Array([1]), { pagesPerSheet: 4, sheetSize: "a4" });
    assertEquals(embedCalls.length, 3);
    // Page 0 CropBox [50, 100, 350, 500] passed to embedPage so clipped content outside is excluded
    assertEquals(embedCalls[0].bbox, { left: 50, bottom: 100, right: 350, top: 500 });
    assertEquals(drawCalls[0].embeddedWidth, 300);
    assertEquals(drawCalls[0].embeddedHeight, 400);
    assertEquals(drawCalls[0].rotate, -90);
    assertEquals(drawCalls[1].rotate, -180);
    assertEquals(drawCalls[2].rotate, -270);
  } finally {
    resetPdfLibForTesting();
  }
});
