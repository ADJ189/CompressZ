/**
 * searchablePdf.ts — build a searchable (image + invisible text layer) PDF.
 *
 * The OCR engines return word boxes in **raster pixels** relative to the page
 * canvas (`OcrWordBox`), so this module does the two things that are easy to
 * get wrong:
 *
 *   1. Coordinate conversion — PDF's origin is bottom-left and its units are
 *      points (1/72in); OCR boxes are top-left in pixels.
 *   2. Font coverage — the embedded Noto Sans file covers Latin, Cyrillic,
 *      Greek and Vietnamese. A word containing a glyph the font does not have
 *      is skipped and counted, never drawn as tofu, so `Ctrl+F` can't match a
 *      garbled string.
 *
 * Memory: one page at a time. `addPage()` embeds the raster immediately, so the
 * caller is free to drop its canvas/blob before the next page — the builder
 * only ever holds the pdf-lib document.
 */
import type { OcrWordBox } from "./ocrEngines";
import { FONTKIT_ESM, NOTO_SANS_UNICODE_FONT, PDFLIB_ESM } from "./pdfLibs";

export interface OcrPdfPageInput {
  /** Page raster, encoded as JPEG or PNG. */
  imageBytes: Uint8Array;
  imageType: "image/jpeg" | "image/png";
  /** Raster dimensions in pixels — the space `words` coordinates live in. */
  widthPx: number;
  heightPx: number;
  /** DPI the raster was rendered at (drives px → pt conversion). */
  dpi: number;
  words: OcrWordBox[];
}

export interface OcrPdfPageStats {
  placedWords: number;
  skippedWords: number;
  /** Distinct unsupported code points, for an honest "text layer is partial" note. */
  unsupportedCodePoints: number[];
}

export interface SearchablePdfBuilder {
  addPage(input: OcrPdfPageInput): Promise<OcrPdfPageStats>;
  finish(): Promise<Uint8Array>;
}

export interface SearchablePdfOptions {
  title?: string;
  /** Words below this Tesseract confidence are not placed in the text layer. */
  minConfidence?: number;
}

/** Points per inch — PDF user space. */
export const PT_PER_INCH = 72;

/**
 * Raster pixel size → PDF page size in points. A 300 DPI A4 scan comes out as
 * 595×842 pt, i.e. A4, instead of a giant page measured in pixels.
 */
export function rasterPageSizePt(
  widthPx: number,
  heightPx: number,
  dpi: number,
): { widthPt: number; heightPt: number } {
  return {
    widthPt: (widthPx * PT_PER_INCH) / dpi,
    heightPt: (heightPx * PT_PER_INCH) / dpi,
  };
}

/**
 * Convert one OCR word box (top-left origin, raster pixels) to the arguments
 * pdf-lib needs (bottom-left origin, points). The baseline is approximated by
 * the bottom edge of the box, which is what keeps a selectable word aligned
 * with the pixels it describes.
 */
export function wordPlacementPt(
  word: Pick<OcrWordBox, "x" | "y" | "w" | "h">,
  pageHeightPx: number,
  dpi: number,
): { x: number; y: number; size: number; maxWidth: number } {
  const pxToPt = PT_PER_INCH / dpi;
  return {
    x: word.x * pxToPt,
    y: (pageHeightPx - (word.y + word.h)) * pxToPt,
    size: Math.max(1, word.h * pxToPt),
    maxWidth: Math.max(0.1, word.w * pxToPt),
  };
}

let fontBytesPromise: Promise<Uint8Array> | null = null;

/** Fetch the Unicode font once per page session; retry on failure. */
function loadFontBytes(): Promise<Uint8Array> {
  if (fontBytesPromise) return fontBytesPromise;
  fontBytesPromise = (async () => {
    const res = await fetch(NOTO_SANS_UNICODE_FONT, { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(
        `Could not download the OCR text-layer font (HTTP ${res.status}).`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  })().catch((err) => {
    fontBytesPromise = null;
    throw err;
  });
  return fontBytesPromise;
}

function codePointsOf(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) out.push(ch.codePointAt(0) ?? 0);
  return out;
}

export async function createSearchablePdfBuilder(
  options: SearchablePdfOptions = {},
): Promise<SearchablePdfBuilder> {
  const { title, minConfidence = 30 } = options;

  const { PDFDocument } = (await import(/* @vite-ignore */ PDFLIB_ESM)) as any;
  const fontkitMod = (await import(/* @vite-ignore */ FONTKIT_ESM)) as any;
  const fontkit = fontkitMod.default ?? fontkitMod;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  if (title) doc.setTitle(title);
  doc.setProducer("CompressZ");
  doc.setCreator("CompressZ — on-device OCR");

  const fontBytes = await loadFontBytes();
  const embeddedFont = await doc.embedFont(fontBytes, { subset: true });
  // fontkit gives an exact coverage answer; pdf-lib silently emits .notdef for
  // missing glyphs, which would put tofu in the text layer.
  const coverageFont = fontkit.create(fontBytes);
  const coverage = new Map<number, boolean>();

  function hasGlyph(codePoint: number): boolean {
    const cached = coverage.get(codePoint);
    if (cached !== undefined) return cached;
    let ok: boolean;
    try {
      ok = coverageFont.hasGlyphForCodePoint(codePoint) === true;
    } catch {
      ok = false;
    }
    coverage.set(codePoint, ok);
    return ok;
  }

  let finished = false;

  return {
    async addPage(input: OcrPdfPageInput): Promise<OcrPdfPageStats> {
      if (finished) throw new Error("This PDF builder has already been finished");
      const { imageBytes, imageType, widthPx, heightPx, dpi, words } = input;
      if (!(widthPx > 0 && heightPx > 0 && dpi > 0)) {
        throw new Error("Invalid page raster dimensions for the text layer");
      }

      const image =
        imageType === "image/png"
          ? await doc.embedPng(imageBytes)
          : await doc.embedJpg(imageBytes);

      const { widthPt, heightPt } = rasterPageSizePt(widthPx, heightPx, dpi);
      const page = doc.addPage([widthPt, heightPt]);
      page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });

      let placedWords = 0;
      const unsupported = new Set<number>();

      for (const word of words) {
        const text = word.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        if (word.confidence < minConfidence) continue;
        if (!(word.w > 0 && word.h > 0)) continue;

        const codePoints = codePointsOf(text);
        if (codePoints.some((cp) => !hasGlyph(cp))) {
          for (const cp of codePoints) if (!hasGlyph(cp)) unsupported.add(cp);
          continue;
        }

        const placement = wordPlacementPt(word, heightPx, dpi);
        try {
          page.drawText(text, {
            ...placement,
            font: embeddedFont,
            // Invisible but still selectable/searchable — pdf-lib's supported way
            // to paint a text layer over a scanned page.
            opacity: 0,
          });
          placedWords++;
        } catch {
          // A single malformed box must not lose the whole page.
        }
      }

      return {
        placedWords,
        skippedWords: words.length - placedWords,
        unsupportedCodePoints: [...unsupported].sort((a, b) => a - b),
      };
    },

    async finish(): Promise<Uint8Array> {
      if (finished) throw new Error("This PDF builder has already been finished");
      finished = true;
      const bytes = await doc.save({ useObjectStreams: true });
      return new Uint8Array(bytes);
    },
  };
}

/**
 * Human-readable note for the UI when some words could not be placed.
 * Returns `null` when nothing was skipped.
 */
export function describeTextLayerGap(
  unsupportedCodePoints: number[],
): string | null {
  if (unsupportedCodePoints.length === 0) return null;
  const sample = unsupportedCodePoints
    .slice(0, 6)
    .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`)
    .join(", ");
  return `Text layer skipped ${unsupportedCodePoints.length} unsupported character${
    unsupportedCodePoints.length === 1 ? "" : "s"
  } (${sample}). Those pages keep the page image; selection is unavailable for that script.`;
}
