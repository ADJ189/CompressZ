/**
 * watermarkPdf.ts — Text and Image watermarking for PDF documents and images.
 *
 * Supports centered and tiled repeating grid overlays, custom rotations,
 * adjustable opacity, custom colors, and page range filtering.
 */

import { getPdfLib } from "../pdfLibs";

export interface WatermarkOptions {
  type: "text" | "image";
  text?: string;
  imageBytes?: Uint8Array;
  imageMime?: "image/png" | "image/jpeg";
  opacity?: number; // 0.0 to 1.0 (default 0.3)
  rotationDeg?: number; // default -45 degrees
  fontSize?: number; // default 42
  colorHex?: string; // default #666666
  tiled?: boolean; // repeating grid vs centered
  tileSpacing?: number; // default 220
  pages?: "all" | "first" | number[]; // 0-based page indices or "all" / "first"
}

/**
 * Convert #RRGGBB or #RGB hex string to normalized RGB values in [0, 1].
 */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace(/^#/, "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6) {
    return { r: 0.4, g: 0.4, b: 0.4 }; // fallback slate
  }
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return {
    r: isNaN(r) ? 0.4 : r,
    g: isNaN(g) ? 0.4 : g,
    b: isNaN(b) ? 0.4 : b,
  };
}

/**
 * Calculate watermark coordinates across a page.
 * If tiled: creates an even grid covering the full page width and height.
 * If centered: returns a single coordinate at the center.
 */
export function calculateWatermarkPositions(
  pageWidth: number,
  pageHeight: number,
  tiled: boolean,
  spacing: number = 220,
): { x: number; y: number }[] {
  if (!tiled) {
    return [{ x: pageWidth / 2, y: pageHeight / 2 }];
  }

  const step = Math.max(80, spacing);
  const positions: { x: number; y: number }[] = [];

  // Start with offset to cover edges gracefully
  for (let y = step / 2; y < pageHeight + step / 2; y += step) {
    for (let x = step / 2; x < pageWidth + step / 2; x += step) {
      positions.push({ x, y });
    }
  }

  return positions;
}

/**
 * Determine which page indices receive watermark based on option.
 */
export function resolveTargetPages(
  totalPages: number,
  pagesOption: WatermarkOptions["pages"],
): number[] {
  if (!pagesOption || pagesOption === "all") {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  if (pagesOption === "first") {
    return totalPages > 0 ? [0] : [];
  }
  return pagesOption.filter((p) => p >= 0 && p < totalPages);
}

/**
 * Apply watermark to a PDF document buffer.
 */
export async function applyPdfWatermark(
  pdfBytes: Uint8Array,
  options: WatermarkOptions,
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  onProgress?.(10);

  const { PDFDocument, rgb, degrees, StandardFonts } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error("PDF document has 0 pages.");
  }

  const targetIndices = resolveTargetPages(totalPages, options.pages);
  const opacity = Math.max(0.01, Math.min(1.0, options.opacity ?? 0.3));
  const rotation = options.rotationDeg ?? -45;
  const isTiled = !!options.tiled;
  const spacing = options.tileSpacing ?? 220;

  let embeddedFont: any = null;
  let embeddedImage: any = null;

  if (options.type === "image" && options.imageBytes) {
    if (options.imageMime === "image/png") {
      embeddedImage = await pdfDoc.embedPng(options.imageBytes);
    } else {
      embeddedImage = await pdfDoc.embedJpg(options.imageBytes);
    }
  } else {
    // Default to Helvetica StandardFont
    embeddedFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  const text = options.text?.trim() || "CONFIDENTIAL";
  const fontSize = options.fontSize ?? 42;
  const color = hexToRgb01(options.colorHex || "#666666");

  for (let i = 0; i < targetIndices.length; i++) {
    const pageIndex = targetIndices[i];
    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();
    const positions = calculateWatermarkPositions(width, height, isTiled, spacing);

    for (const pos of positions) {
      if (embeddedImage) {
        const imgDims = embeddedImage.scale(0.5);
        page.drawImage(embeddedImage, {
          x: pos.x - imgDims.width / 2,
          y: pos.y - imgDims.height / 2,
          width: imgDims.width,
          height: imgDims.height,
          opacity,
          rotate: degrees(rotation),
        });
      } else {
        const textWidth = embeddedFont.widthOfTextAtSize(text, fontSize);
        const textHeight = embeddedFont.heightAtSize(fontSize);
        // Center text box around position
        page.drawText(text, {
          x: pos.x - textWidth / 2,
          y: pos.y - textHeight / 4,
          size: fontSize,
          font: embeddedFont,
          color: rgb(color.r, color.g, color.b),
          opacity,
          rotate: degrees(rotation),
        });
      }
    }

    const pct = Math.round(15 + ((i + 1) / targetIndices.length) * 75);
    onProgress?.(pct);
  }

  const resultBytes = await pdfDoc.save();
  onProgress?.(100);
  return resultBytes;
}

/**
 * Apply canvas-based watermark overlay to raster image buffers.
 */
export function applyCanvasImageWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
): void {
  const opacity = Math.max(0.01, Math.min(1.0, options.opacity ?? 0.3));
  const rotation = ((options.rotationDeg ?? -45) * Math.PI) / 180;
  const fontSize = options.fontSize ?? Math.round(width * 0.05);
  const text = options.text?.trim() || "CONFIDENTIAL";
  const color = options.colorHex || "#666666";
  const isTiled = !!options.tiled;
  const positions = calculateWatermarkPositions(
    width,
    height,
    isTiled,
    options.tileSpacing ?? Math.max(150, width * 0.25),
  );

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const pos of positions) {
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(rotation);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}
