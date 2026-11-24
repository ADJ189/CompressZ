/**
 * removePagesPdf.ts — Delete specific pages or ranges from PDF documents.
 *
 * Direct structural page manipulation via pdf-lib without re-rasterisation.
 * Preserves vector graphics, fonts, form appearance, and hyperlinks.
 */

import { getPdfLib } from "../pdfLibs";

export interface RemovePagesOptions {
  /**
   * Set of 0-based page indices, array of 1-based page numbers or 0-based indices,
   * or a comma-separated range string (e.g. "1, 3-5, 8").
   */
  pagesToRemove: string | number[] | Set<number>;
  /** Optional 0-based flag if pagesToRemove array uses 0-based indices (defaults to false for string/numbers) */
  zeroBased?: boolean;
  onProgress?: (pct: number) => void;
}

export interface RemovePagesResult {
  bytes: Uint8Array;
  removedCount: number;
  remainingCount: number;
  removedPages: number[]; // 1-based page numbers
  remainingPages: number[]; // 1-based page numbers
}

/**
 * Parse a human-facing page specification (e.g. "1, 3-5, 8") into a sorted,
 * deduplicated array of 0-based page indices within [0, totalPages - 1].
 */
export function parseRemovalRange(input: string, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  const trimmed = input.trim();
  if (!trimmed) return [];

  const indices = new Set<number>();
  // Split on comma, semicolon, or newline first so tokens with spaces around dashes (e.g. "2 - 4") stay together
  const parts = trimmed.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    // Check for range pattern e.g. "2-5" or "2 - 5" or "2–5"
    const rangeMatch = part.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const low = Math.max(1, Math.min(start, end));
        const high = Math.min(totalPages, Math.max(start, end));
        for (let p = low; p <= high; p++) {
          indices.add(p - 1);
        }
      }
      continue;
    }

    // Also support space-separated single numbers within a part (e.g. "1 3 5")
    const subTokens = part.split(/\s+/).filter(Boolean);
    for (const sub of subTokens) {
      const singleMatch = sub.match(/^(\d+)$/);
      if (singleMatch) {
        const page = parseInt(singleMatch[1], 10);
        if (page >= 1 && page <= totalPages) {
          indices.add(page - 1);
        }
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Convert a sorted array of 0-based indices into a human-readable range string (e.g. "1-3, 5, 8").
 */
export function formatRemovalRange(indices0Based: number[]): string {
  if (!indices0Based || indices0Based.length === 0) return "";
  const sorted = Array.from(new Set(indices0Based)).sort((a, b) => a - b);
  const ranges: string[] = [];

  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
      start = cur;
      prev = cur;
    }
  }

  ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
  return ranges.join(", ");
}

/**
 * Helper to compute 0-based indices for all even pages (Page 2, 4, 6... -> index 1, 3, 5...).
 */
export function getEvenPageIndices(totalPages: number): number[] {
  const result: number[] = [];
  for (let p = 2; p <= totalPages; p += 2) {
    result.push(p - 1);
  }
  return result;
}

/**
 * Helper to compute 0-based indices for all odd pages (Page 1, 3, 5... -> index 0, 2, 4...).
 */
export function getOddPageIndices(totalPages: number): number[] {
  const result: number[] = [];
  for (let p = 1; p <= totalPages; p += 2) {
    result.push(p - 1);
  }
  return result;
}

/**
 * Plan page removal by validating constraints and calculating remaining page indices.
 * Pure function: runs synchronously without loading external engines.
 */
export function planPageRemoval(
  totalPages: number,
  pagesToRemove: string | number[] | Set<number>,
  zeroBased = false,
): { toRemoveIndices: number[]; remainingIndices: number[] } {
  if (totalPages <= 0) {
    throw new Error("Document must have at least 1 page.");
  }

  let toRemoveIndices: number[] = [];
  if (typeof pagesToRemove === "string") {
    toRemoveIndices = parseRemovalRange(pagesToRemove, totalPages);
  } else if (pagesToRemove instanceof Set) {
    toRemoveIndices = Array.from(pagesToRemove)
      .map((idx) => (zeroBased ? idx : idx >= 1 ? idx - 1 : idx))
      .filter((idx) => idx >= 0 && idx < totalPages);
  } else if (Array.isArray(pagesToRemove)) {
    toRemoveIndices = pagesToRemove
      .map((idx) => (zeroBased ? idx : idx >= 1 ? idx - 1 : idx))
      .filter((idx) => idx >= 0 && idx < totalPages);
  }

  const toRemoveSet = new Set(toRemoveIndices);

  if (toRemoveSet.size === 0) {
    throw new Error("No valid pages were selected for removal.");
  }

  if (toRemoveSet.size >= totalPages) {
    throw new Error(
      `Cannot remove all ${totalPages} pages from the PDF. At least 1 page must remain.`,
    );
  }

  const remainingIndices: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    if (!toRemoveSet.has(i)) {
      remainingIndices.push(i);
    }
  }

  return {
    toRemoveIndices: Array.from(toRemoveSet).sort((a, b) => a - b),
    remainingIndices,
  };
}

/**
 * Execute page removal on a PDF document.
 */
export async function removePagesFromPdf(
  pdfBytes: Uint8Array,
  options: RemovePagesOptions,
): Promise<RemovePagesResult> {
  options.onProgress?.(10);

  const { PDFDocument } = await getPdfLib();
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const plan = planPageRemoval(totalPages, options.pagesToRemove, options.zeroBased);

  options.onProgress?.(30);

  // Flatten interactive form fields if present to permanently preserve vector appearances
  try {
    const form = srcDoc.getForm();
    if (form && form.getFields().length > 0) {
      form.flatten();
    }
  } catch {
    // If PDF has no AcroForm or flattening fails, proceed
  }

  options.onProgress?.(50);

  const newDoc = await PDFDocument.create();
  const copiedPages = await newDoc.copyPages(srcDoc, plan.remainingIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }

  options.onProgress?.(80);

  const outBytes = await newDoc.save();

  options.onProgress?.(100);

  return {
    bytes: outBytes,
    removedCount: plan.toRemoveIndices.length,
    remainingCount: plan.remainingIndices.length,
    removedPages: plan.toRemoveIndices.map((i) => i + 1),
    remainingPages: plan.remainingIndices.map((i) => i + 1),
  };
}
