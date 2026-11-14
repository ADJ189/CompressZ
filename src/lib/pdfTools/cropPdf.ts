/**
 * cropPdf.ts — Permanent, lossless PDF page cropping.
 *
 * Sets CropBox, MediaBox, BleedBox, and TrimBox coordinates on targeted pages
 * in accordance with the PDF ISO-32000 standard.
 */

import { getPdfLib } from "../pdfLibs";

export interface CropMargins {
  top: number; // in points (1 pt = 1/72 inch)
  right: number;
  bottom: number;
  left: number;
}

export interface CropBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropOptions {
  mode: "margins" | "box";
  margins?: CropMargins;
  box?: CropBoxRect;
  pages?: "all" | number[]; // 0-based page indices or "all"
}

/**
 * Pure calculation: compute new box coordinates given original dimensions and options.
 * Enforces minimum 20x20 dimensions and stays bounded within source dimensions.
 */
export function calculateCroppedBox(
  original: { x: number; y: number; width: number; height: number },
  options: CropOptions,
): CropBoxRect {
  if (options.mode === "box" && options.box) {
    const minW = Math.min(Math.max(20, options.box.width), original.width);
    const minH = Math.min(Math.max(20, options.box.height), original.height);
    const clampedX = Math.max(original.x, Math.min(options.box.x, original.x + original.width - minW));
    const clampedY = Math.max(original.y, Math.min(options.box.y, original.y + original.height - minH));
    return {
      x: clampedX,
      y: clampedY,
      width: minW,
      height: minH,
    };
  }

  // Margin mode
  const m = options.margins || { top: 0, right: 0, bottom: 0, left: 0 };
  const left = Math.max(0, m.left);
  const bottom = Math.max(0, m.bottom);
  const right = Math.max(0, m.right);
  const top = Math.max(0, m.top);

  const newW = original.width - left - right;
  const newH = original.height - top - bottom;

  if (newW < 20 || newH < 20) {
    throw new Error(
      `Crop margins (L:${left}, R:${right}, T:${top}, B:${bottom}) leave less than 20pt of visible content.`,
    );
  }

  return {
    x: original.x + left,
    y: original.y + bottom,
    width: newW,
    height: newH,
  };
}

/**
 * Apply crop to a PDF document buffer.
 */
export async function applyPdfCrop(
  pdfBytes: Uint8Array,
  options: CropOptions,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  onProgress?.(10);

  const { PDFDocument } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error("PDF document has 0 pages.");
  }

  const targetIndices =
    options.pages === undefined || options.pages === "all"
      ? Array.from({ length: totalPages }, (_, i) => i)
      : options.pages.filter((p) => p >= 0 && p < totalPages);

  for (let i = 0; i < targetIndices.length; i++) {
    const pageIndex = targetIndices[i];
    const page = pdfDoc.getPage(pageIndex);
    const origBox = page.getMediaBox();

    const cropped = calculateCroppedBox(
      {
        x: origBox.x,
        y: origBox.y,
        width: origBox.width,
        height: origBox.height,
      },
      options,
    );

    // Apply uniformly to all standard PDF bounding boxes for universal viewer compatibility
    page.setCropBox(cropped.x, cropped.y, cropped.width, cropped.height);
    page.setMediaBox(cropped.x, cropped.y, cropped.width, cropped.height);
    page.setBleedBox(cropped.x, cropped.y, cropped.width, cropped.height);
    page.setTrimBox(cropped.x, cropped.y, cropped.width, cropped.height);

    const pct = Math.round(15 + ((i + 1) / targetIndices.length) * 75);
    onProgress?.(pct);
  }

  const result = await pdfDoc.save();
  onProgress?.(100);
  return result;
}
