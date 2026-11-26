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

export const MAX_PAGE_NUMBER_START = 999_999;
export const MAX_ROMAN_NUMERAL = 3999;
export const MAX_BATES_DIGITS = 12;

/**
 * Convert a positive integer within the standard Roman numeral range (1–3999)
 * to Roman numerals, falling back cleanly to base-10 string outside range.
 */
export function toRomanNumeral(num: number): string {
  if (num <= 0 || num > MAX_ROMAN_NUMERAL || !Number.isInteger(num)) {
    return String(num);
  }
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
      let out = pattern
        .replace(/\{n\}/g, String(n))
        .replace(/\{total\}/g, String(total));
      if (out.includes("{roman}") || out.includes("{ROMAN}")) {
        const roman = toRomanNumeral(n);
        out = out
          .replace(/\{roman\}/g, roman.toLowerCase())
          .replace(/\{ROMAN\}/g, roman);
      }
      return out;
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
 * Calculate coordinates and rotation angle for placing page number text on a
 * possibly rotated page, mapping visual coordinates back into unrotated PDF space.
 */
export function calculateRotatedNumberPlacement(
  box: { x: number; y: number; width: number; height: number },
  rotationDeg: number,
  textWidth: number,
  textHeight: number,
  position: PageNumberPosition = "bottom-center",
  marginX: number = 36,
  marginY: number = 36,
): { x: number; y: number; textAngle: number } {
  const rot = ((rotationDeg % 360) + 360) % 360;
  const isQuarterTurn = rot === 90 || rot === 270;
  const visW = isQuarterTurn ? box.height : box.width;
  const visH = isQuarterTurn ? box.width : box.height;

  const vis = calculateNumberPosition(
    visW,
    visH,
    textWidth,
    textHeight,
    position,
    marginX,
    marginY,
    0,
    0,
  );

  switch (rot) {
    case 90:
      return {
        x: box.x + box.width - vis.y,
        y: box.y + vis.x,
        textAngle: 90,
      };
    case 180:
      return {
        x: box.x + box.width - vis.x,
        y: box.y + box.height - vis.y,
        textAngle: 180,
      };
    case 270:
      return {
        x: box.x + vis.y,
        y: box.y + box.height - vis.x,
        textAngle: 270,
      };
    case 0:
    default:
      return {
        x: box.x + vis.x,
        y: box.y + vis.y,
        textAngle: 0,
      };
  }
}

/**
 * Normalize whitespace around range dashes without backtracking regexes.
 */
function normalizePageRangeDashes(input: string): string {
  const parts = input.split(/([-–—])/);
  let normalized = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "-" || part === "–" || part === "—") {
      const prevTrimmed = normalized.trimEnd();
      const nextPart = parts[i + 1] ?? "";
      const nextTrimmed = nextPart.trimStart();
      if (
        prevTrimmed.length > 0 &&
        /\d$/.test(prevTrimmed) &&
        (nextTrimmed.length === 0 || /^\d/.test(nextTrimmed))
      ) {
        normalized = prevTrimmed + "-";
        parts[i + 1] = nextTrimmed;
        continue;
      }
    }
    normalized += part;
  }
  return normalized;
}

/**
 * Parse a page number range string (1-based) into 0-based page indices.
 * Supports: "all", "2-", "2-10", "1, 3, 5", "odd", "even".
 * Rejects unrecognized tokens or non-positive page numbers with an Error.
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

  const normalized = normalizePageRangeDashes(clean);
  const indices = new Set<number>();
  const parts = normalized.split(/[,;\s\n]+/).filter(Boolean);

  for (const part of parts) {
    const openMatch = part.match(/^(\d+)-$/);
    if (openMatch) {
      const start = Number.parseInt(openMatch[1], 10);
      if (start <= 0) {
        throw new Error(`Page numbers must be 1 or greater (got "${part}").`);
      }
      for (let i = start; i <= totalPages; i++) {
        indices.add(i - 1);
      }
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (start <= 0 || end <= 0) {
        throw new Error(`Page numbers must be 1 or greater (got "${part}").`);
      }
      if (start > end) {
        throw new Error(`Invalid page range "${part}": start page cannot exceed end page.`);
      }
      const hi = Math.min(totalPages, end);
      for (let i = start; i <= hi; i++) {
        indices.add(i - 1);
      }
      continue;
    }

    const singleMatch = part.match(/^(\d+)$/);
    if (singleMatch) {
      const num = Number.parseInt(singleMatch[1], 10);
      if (num <= 0) {
        throw new Error(`Page numbers must be 1 or greater (got "${part}").`);
      }
      if (num <= totalPages) {
        indices.add(num - 1);
      }
      continue;
    }

    throw new Error(
      `Unrecognized page range token: "${part}". Use "all", "odd", "even", a page number, or a range like "2-5" or "2-".`,
    );
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
  const startCounter = options.startNumber ?? 1;
  if (
    typeof startCounter !== "number" ||
    !Number.isInteger(startCounter) ||
    startCounter < 1 ||
    startCounter > MAX_PAGE_NUMBER_START
  ) {
    throw new Error(
      `Start number must be a whole number between 1 and ${MAX_PAGE_NUMBER_START}.`,
    );
  }

  if (options.format === "bates") {
    const digits = options.batesDigits ?? 6;
    if (
      typeof digits !== "number" ||
      !Number.isInteger(digits) ||
      digits < 1 ||
      digits > MAX_BATES_DIGITS
    ) {
      throw new Error(
        `Bates digits must be a whole number between 1 and ${MAX_BATES_DIGITS}.`,
      );
    }
  }

  const { PDFDocument, StandardFonts, rgb, degrees } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (pdfDoc.isEncrypted) {
    throw new Error("The PDF is encrypted with a password. Please unlock or decrypt it in PDF Protect / Unlock before adding page numbers.");
  }
  const totalPages = pdfDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error("PDF document has 0 pages.");
  }

  const targetIndices = parseTargetPages(options.pageRange, totalPages);
  if (targetIndices.length === 0) {
    throw new Error("No valid pages matched the specified page range.");
  }

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

  for (let i = 0; i < targetIndices.length; i++) {
    const pageIndex = targetIndices[i];
    const page = pdfDoc.getPage(pageIndex);
    const box = page.getCropBox();
    const rotationAngle =
      typeof page.getRotation === "function" ? page.getRotation().angle : 0;

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

    const placement = calculateRotatedNumberPlacement(
      box,
      rotationAngle,
      textWidth,
      textHeight,
      position,
      marginX,
      marginY,
    );

    page.drawText(safeText, {
      x: placement.x,
      y: placement.y,
      size: fontSize,
      font: embeddedFont,
      color: rgb(color.r, color.g, color.b),
      opacity,
      ...(placement.textAngle !== 0 && typeof degrees === "function"
        ? { rotate: degrees(placement.textAngle) }
        : {}),
    });

    const pct = Math.round(15 + ((i + 1) / targetIndices.length) * 80);
    options.onProgress?.(pct);
  }

  options.onProgress?.(100);
  return await pdfDoc.save();
}
