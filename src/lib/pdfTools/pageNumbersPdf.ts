/**
 * pageNumbersPdf.ts — Client-side Page Numbering & Bates Stamping for PDF documents.
 *
 * Provides vector-preserving page numbers, custom formats (Page X of Y, Bates),
 * anchor positioning (header/footer), Roman/Arabic numerals, custom fonts and colors.
 */

import { getPdfLib } from "../pdfLibs";
import { hexToRgb01, sanitizeWinAnsi } from "./watermarkPdf";

export type PageNumberPosition =
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "top-right"
  | "top-left";

export type PageNumberFormat =
  | "page-n-of-total" // Page 1 of 10
  | "n-of-total"      // 1 of 10
  | "n-slash-total"   // 1 / 10
  | "page-n"          // Page 1
  | "n"               // 1
  | "roman-lower"     // i, ii, iii
  | "roman-upper"     // I, II, III
  | "bates"           // BATES-000001
  | "custom";         // User-defined string pattern: e.g. "Draft - Page {n} of {total}"

export interface PageNumberOptions {
  format?: PageNumberFormat;
  customPattern?: string; // Tokens: {n}, {total}, {roman}, {ROMAN}
  position?: PageNumberPosition;
  startNumber?: number; // Starting counter value (default: 1)
  pageRange?: string; // e.g. "all", "2-", "2-10", "1, 3, 5" (1-based)
  fontFamily?: "Helvetica" | "TimesRoman" | "Courier";
  fontSize?: number; // default: 10
  colorHex?: string; // default: "#333333"
  opacity?: number; // 0.0 to 1.0 (default: 1.0)
  marginX?: number; // Points from left/right edge (default: 36 = 0.5 in)
  marginY?: number; // Points from top/bottom edge (default: 36 = 0.5 in)
  batesPrefix?: string; // e.g. "BATES-"
  batesDigits?: number; // e.g. 6 -> "000001"
  batesSuffix?: string; // e.g. "-CONFIDENTIAL"
  onProgress?: (pct: number) => void;
}

/**
 * Convert a positive integer to Roman numerals.
 */
export function toRomanNumeral(num: number): string {
  if (num <= 0 || !Number.isInteger(num)) return String(num);
  const romanMap: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let result = "";
  let remaining = num;
  for (const [val, sym] of romanMap) {
    while (remaining >= val) {
      result += sym;
      remaining -= val;
    }
  }
  return result;
}

/**
 * Generate formatted page number text based on configuration.
 */
export function formatPageNumber(
  n: number,
  total: number,
  format: PageNumberFormat = "page-n-of-total",
  customPattern?: string,
  batesPrefix: string = "",
  batesDigits: number = 6,
  batesSuffix: string = "",
): string {
  switch (format) {
    case "page-n-of-total":
      return `Page ${n} of ${total}`;
    case "n-of-total":
      return `${n} of ${total}`;
    case "n-slash-total":
      return `${n} / ${total}`;
    case "page-n":
      return `Page ${n}`;
    case "n":
      return String(n);
    case "roman-lower":
      return toRomanNumeral(n).toLowerCase();
    case "roman-upper":
      return toRomanNumeral(n);
    case "bates": {
      const padded = String(n).padStart(batesDigits, "0");
      return `${batesPrefix}${padded}${batesSuffix}`;
    }
    case "custom": {
      const pattern = customPattern || "Page {n} of {total}";
      return pattern
        .replace(/\{n\}/g, String(n))
        .replace(/\{total\}/g, String(total))
        .replace(/\{roman\}/g, toRomanNumeral(n).toLowerCase())
        .replace(/\{ROMAN\}/g, toRomanNumeral(n));
    }
    default:
      return `Page ${n} of ${total}`;
  }
}

/**
 * Calculate coordinates for placing page number text on a page.
 */
export function calculateNumberPosition(
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  textHeight: number,
  position: PageNumberPosition = "bottom-center",
  marginX: number = 36,
  marginY: number = 36,
  originX: number = 0,
  originY: number = 0,
): { x: number; y: number } {
  let x = originX;
  let y = originY;

  switch (position) {
    case "bottom-center":
      x = originX + (pageWidth - textWidth) / 2;
      y = originY + marginY;
      break;
    case "bottom-left":
      x = originX + marginX;
      y = originY + marginY;
      break;
    case "bottom-right":
      x = originX + pageWidth - marginX - textWidth;
      y = originY + marginY;
      break;
    case "top-center":
      x = originX + (pageWidth - textWidth) / 2;
      y = originY + pageHeight - marginY - textHeight;
      break;
    case "top-left":
      x = originX + marginX;
      y = originY + pageHeight - marginY - textHeight;
      break;
    case "top-right":
      x = originX + pageWidth - marginX - textWidth;
      y = originY + pageHeight - marginY - textHeight;
      break;
  }

  return { x, y };
}

/**
 * Parse a page number range string (1-based) into 0-based page indices.
 * Supports: "all", "2-", "2-10", "1, 3, 5", "odd", "even".
 */
export function parseTargetPages(
  rangeStr: string | undefined,
  totalPages: number,
): number[] {
  if (totalPages <= 0) return [];
  const clean = (rangeStr || "all").trim().toLowerCase();

  if (clean === "all" || !clean) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  if (clean === "odd") {
    return Array.from({ length: totalPages }, (_, i) => i).filter((i) => i % 2 === 0);
  }
  if (clean === "even") {
    return Array.from({ length: totalPages }, (_, i) => i).filter((i) => i % 2 === 1);
  }

  const indices = new Set<number>();
  const parts = clean.split(/[,;\s]+/);

  for (const part of parts) {
    if (!part) continue;
    if (part.includes("-")) {
      const [startRaw, endRaw] = part.split("-");
      const start = Number.parseInt(startRaw, 10);
      const end = endRaw ? Number.parseInt(endRaw, 10) : totalPages;
      if (!Number.isNaN(start)) {
        const lo = Math.max(1, start);
        const hi = Number.isNaN(end) ? totalPages : Math.min(totalPages, end);
        for (let i = lo; i <= hi; i++) {
          indices.add(i - 1);
        }
      }
    } else {
      const num = Number.parseInt(part, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= totalPages) {
        indices.add(num - 1);
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Apply page numbering or Bates stamping to a PDF document.
 */
export async function applyPdfPageNumbers(
  pdfBytes: Uint8Array,
  options: PageNumberOptions = {},
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (pdfDoc.isEncrypted) {
    throw new Error("The PDF is encrypted with a password. Please unlock or decrypt it in PDF Protect / Unlock before adding page numbers.");
  }
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) return pdfBytes;

  const targetIndices = parseTargetPages(options.pageRange, totalPages);
  if (targetIndices.length === 0) return pdfBytes;

  // Resolve standard font
  let fontKey = StandardFonts.Helvetica;
  if (options.fontFamily === "TimesRoman") {
    fontKey = StandardFonts.TimesRoman;
  } else if (options.fontFamily === "Courier") {
    fontKey = StandardFonts.Courier;
  }
  const embeddedFont = await pdfDoc.embedFont(fontKey);

  const fontSize = options.fontSize ?? 10;
  const color = hexToRgb01(options.colorHex || "#333333");
  const opacity = Math.max(0, Math.min(1, options.opacity ?? 1.0));
  const position = options.position || "bottom-center";
  const marginX = options.marginX ?? 36;
  const marginY = options.marginY ?? 36;
  const startCounter = options.startNumber ?? 1;

  for (let i = 0; i < targetIndices.length; i++) {
    const pageIndex = targetIndices[i];
    const page = pdfDoc.getPage(pageIndex);
    const box = page.getCropBox();

    // Current page counter value (relative to startCounter)
    const currentNum = startCounter + i;
    const text = formatPageNumber(
      currentNum,
      totalPages,
      options.format,
      options.customPattern,
      options.batesPrefix,
      options.batesDigits,
      options.batesSuffix,
    );
    const safeText = sanitizeWinAnsi(text);

    const textWidth = embeddedFont.widthOfTextAtSize(safeText, fontSize);
    const textHeight = embeddedFont.heightAtSize(fontSize);

    const coords = calculateNumberPosition(
      box.width,
      box.height,
      textWidth,
      textHeight,
      position,
      marginX,
      marginY,
      box.x,
      box.y,
    );

    page.drawText(safeText, {
      x: coords.x,
      y: coords.y,
      size: fontSize,
      font: embeddedFont,
      color: rgb(color.r, color.g, color.b),
      opacity,
    });

    const pct = Math.round(15 + ((i + 1) / targetIndices.length) * 80);
    options.onProgress?.(pct);
  }

  options.onProgress?.(100);
  return await pdfDoc.save();
}
