/**
 * nupPdf.ts — Client-side Multi-Page per Sheet (N-Up / 2-Up / 4-Up) layout generator.
 *
 * Combines multiple pages into grids on single sheets (handouts, booklet prep, eco-printing)
 * while preserving high-resolution vector text, lines, and embedded objects without rasterization.
 */

import { getPdfLib } from "../pdfLibs";

export type NupPagesPerSheet = 2 | 4 | 9;

export interface NupOptions {
  pagesPerSheet?: NupPagesPerSheet; // 2, 4, or 9
  sheetSize?: "a4" | "letter" | "source"; // default "a4"
  orientation?: "portrait" | "landscape" | "auto"; // default "auto"
  margin?: number; // Outer page margin in points (default: 24)
  spacing?: number; // Gap between slots in points (default: 16)
  drawBorder?: boolean; // Draw subtle hairline border around each mini-page (default: false)
  onProgress?: (pct: number) => void;
}

export interface NupSlot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NupGridSpec {
  sheetWidth: number;
  sheetHeight: number;
  rows: number;
  cols: number;
  slots: NupSlot[];
}

/**
 * Standard page point dimensions (72 points per inch).
 */
export const STANDARD_SHEET_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612.0, height: 792.0 },
};

/**
 * Calculate fitted dimensions preserving aspect ratio within a target bounding box.
 */
export function calculateFittedDimensions(
  sourceW: number,
  sourceH: number,
  targetW: number,
  targetH: number,
): { width: number; height: number; scale: number; offsetX: number; offsetY: number } {
  if (sourceW <= 0 || sourceH <= 0 || targetW <= 0 || targetH <= 0) {
    return { width: 0, height: 0, scale: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(targetW / sourceW, targetH / sourceH);
  const width = sourceW * scale;
  const height = sourceH * scale;
  const offsetX = (targetW - width) / 2;
  const offsetY = (targetH - height) / 2;
  return { width, height, scale, offsetX, offsetY };
}

/**
 * Determine grid layout configuration (rows, cols, sheet dimensions, and slot coordinates).
 */
export function planNupGrid(
  pagesPerSheet: NupPagesPerSheet = 2,
  sheetSize: "a4" | "letter" | "source" = "a4",
  orientation: "portrait" | "landscape" | "auto" = "auto",
  margin: number = 24,
  spacing: number = 16,
  sourceSampleW?: number,
  sourceSampleH?: number,
): NupGridSpec {
  let baseWidth = STANDARD_SHEET_SIZES.a4.width;
  let baseHeight = STANDARD_SHEET_SIZES.a4.height;

  if (sheetSize === "letter") {
    baseWidth = STANDARD_SHEET_SIZES.letter.width;
    baseHeight = STANDARD_SHEET_SIZES.letter.height;
  } else if (sheetSize === "source" && sourceSampleW && sourceSampleH) {
    baseWidth = sourceSampleW;
    baseHeight = sourceSampleH;
  }

  let rows = 1;
  let cols = 2;
  let isLandscape = false;

  if (pagesPerSheet === 2) {
    // 2-Up is best presented in landscape (2 columns side-by-side)
    rows = 1;
    cols = 2;
    isLandscape = orientation === "auto" ? true : orientation === "landscape";
  } else if (pagesPerSheet === 4) {
    // 4-Up: 2x2 grid (portrait or landscape based on preference)
    rows = 2;
    cols = 2;
    isLandscape = orientation === "landscape";
  } else if (pagesPerSheet === 9) {
    // 9-Up: 3x3 grid
    rows = 3;
    cols = 3;
    isLandscape = orientation === "landscape";
  }

  if (orientation === "portrait") isLandscape = false;
  if (orientation === "landscape") isLandscape = true;

  const sheetWidth = isLandscape ? Math.max(baseWidth, baseHeight) : Math.min(baseWidth, baseHeight);
  const sheetHeight = isLandscape ? Math.min(baseWidth, baseHeight) : Math.max(baseWidth, baseHeight);

  const availableW = sheetWidth - 2 * margin - (cols - 1) * spacing;
  const availableH = sheetHeight - 2 * margin - (rows - 1) * spacing;
  const slotWidth = Math.max(10, availableW / cols);
  const slotHeight = Math.max(10, availableH / rows);

  const slots: NupSlot[] = [];
  // PDF origin (0,0) is bottom-left, so rows go from top (row 0) to bottom
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + c * (slotWidth + spacing);
      // Top-to-bottom reading order: top row has largest Y
      const y = sheetHeight - margin - (r + 1) * slotHeight - r * spacing;
      slots.push({ x, y, width: slotWidth, height: slotHeight });
    }
  }

  return { sheetWidth, sheetHeight, rows, cols, slots };
}

/**
 * Split page count into chunks for each output sheet.
 */
export function chunkPages(totalPages: number, chunkSize: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < totalPages; i += chunkSize) {
    const chunk: number[] = [];
    for (let j = i; j < Math.min(i + chunkSize, totalPages); j++) {
      chunk.push(j);
    }
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Generate a new PDF combining N input pages per sheet.
 */
export async function createNupPdf(
  pdfBytes: Uint8Array,
  options: NupOptions = {},
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await getPdfLib();
  const sourceDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (sourceDoc.isEncrypted) {
    throw new Error("The PDF is encrypted with a password. Please unlock or decrypt it in PDF Protect / Unlock before creating N-Up pages.");
  }
  const totalPages = sourceDoc.getPageCount();

  if (totalPages === 0) return pdfBytes;

  const nUp = options.pagesPerSheet ?? 2;
  const margin = options.margin ?? 24;
  const spacing = options.spacing ?? 16;
  const drawBorder = options.drawBorder ?? false;

  // Sample first page for dimensions if source mode chosen
  const firstPage = sourceDoc.getPage(0);
  const sampleBox = firstPage.getCropBox();

  const grid = planNupGrid(
    nUp,
    options.sheetSize ?? "a4",
    options.orientation ?? "auto",
    margin,
    spacing,
    sampleBox.width,
    sampleBox.height,
  );

  const outputDoc = await PDFDocument.create();
  const chunks = chunkPages(totalPages, nUp);

  for (let c = 0; c < chunks.length; c++) {
    const pageIndices = chunks[c];
    const sheet = outputDoc.addPage([grid.sheetWidth, grid.sheetHeight]);

    for (let s = 0; s < pageIndices.length; s++) {
      const pageIndex = pageIndices[s];
      const slot = grid.slots[s];
      const sourcePage = sourceDoc.getPage(pageIndex);
      const sourceBox = sourcePage.getCropBox();

      // Embed source page into output document
      const embedded = await outputDoc.embedPage(sourcePage);
      const fit = calculateFittedDimensions(
        sourceBox.width,
        sourceBox.height,
        slot.width,
        slot.height,
      );

      const drawX = slot.x + fit.offsetX;
      const drawY = slot.y + fit.offsetY;

      sheet.drawPage(embedded, {
        x: drawX,
        y: drawY,
        width: fit.width,
        height: fit.height,
      });

      // Optional subtle hairline border around the mini-page
      if (drawBorder) {
        sheet.drawRectangle({
          x: drawX,
          y: drawY,
          width: fit.width,
          height: fit.height,
          borderWidth: 0.5,
          borderColor: rgb(0.7, 0.7, 0.7),
          opacity: 0.8,
        });
      }
    }

    const pct = Math.round(15 + ((c + 1) / chunks.length) * 80);
    options.onProgress?.(pct);
  }

  options.onProgress?.(100);
  return await outputDoc.save();
}
