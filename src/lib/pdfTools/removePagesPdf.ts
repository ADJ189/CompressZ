/**
 * removePagesPdf.ts — Delete specific pages or ranges from PDF documents.
 *
 * Direct structural page manipulation via in-place page removal (pdfDoc.removePage).
 * Operates in descending index order so that page indices do not shift, preserving
 * document-level metadata (title, author, subject, etc.), document catalog dictionaries,
 * outlines/bookmarks, vector crispness, fonts, and hyperlinks.
 *
 * Interactive form fields on retained pages remain fully editable by default; form
 * flattening is opt-in via options.flattenForms.
 */

import { getPdfLib } from "../pdfLibs";
import { EngineError, toErrorMessage } from "../engineError";

export interface RemovePagesOptions {
  /**
   * Set of 0-based page indices, array of 1-based page numbers or 0-based indices,
   * or a comma-separated/space-separated range string (e.g. "1, 3-5, 8" or "1 3-5").
   */
  pagesToRemove: string | number[] | Set<number>;
  /** Optional 0-based flag if pagesToRemove array uses 0-based indices (defaults to false for string/numbers) */
  zeroBased?: boolean;
  /**
   * Optional flag to flatten interactive form fields into static vectors.
   * Defaults to false: form fields on retained pages remain interactive and editable.
   */
  flattenForms?: boolean;
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
 * Parse a human-facing page specification (e.g. "1, 3-5, 8" or "1 3-5") into a sorted,
 * deduplicated array of 0-based page indices within [0, totalPages - 1].
 *
 * Handles mixed whitespace, commas, semicolons, and newlines. Rejects unrecognized tokens
 * visibly with a descriptive error instead of silently dropping parts of the user's selection.
 */
export function parseRemovalRange(input: string, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Normalize whitespace around hyphens/dashes: "3 - 5" or "3 – 5" -> "3-5"
  const normalized = trimmed.replace(/(\d+)\s*[-–—]\s*(\d+)/g, "$1-$2");

  // Tokenize on commas, semicolons, newlines, and whitespace
  const tokens = normalized.split(/[,;\s\n]+/).map((s) => s.trim()).filter(Boolean);

  const indices = new Set<number>();

  for (const token of tokens) {
    // 1. Check for range pattern e.g. "2-5" or "5-2"
    const rangeMatch = token.match(/^(\d+)[-–—](\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start <= 0 || end <= 0) {
        throw new Error(`Page numbers must be 1 or greater (got "${token}").`);
      }
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      if (low <= totalPages) {
        const clampedHigh = Math.min(totalPages, high);
        for (let p = low; p <= clampedHigh; p++) {
          indices.add(p - 1);
        }
      }
      continue;
    }

    // 2. Check for single page number e.g. "3"
    const singleMatch = token.match(/^(\d+)$/);
    if (singleMatch) {
      const page = parseInt(singleMatch[1], 10);
      if (page <= 0) {
        throw new Error(`Page numbers must be 1 or greater (got "${token}").`);
      }
      if (page <= totalPages) {
        indices.add(page - 1);
      }
      continue;
    }

    // 3. Unrecognized token: reject visibly instead of silently applying partial selection
    throw new Error(
      `Unrecognized page token: "${token}". Expected a page number or range (e.g. "3" or "3-5").`,
    );
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

  const toRemoveIndices: number[] =
    typeof pagesToRemove === "string"
      ? parseRemovalRange(pagesToRemove, totalPages)
      : (pagesToRemove instanceof Set
          ? Array.from(pagesToRemove)
          : Array.isArray(pagesToRemove)
            ? pagesToRemove
            : []
        )
          .map((idx) => {
            if (typeof idx !== "number" || !Number.isFinite(idx)) return -1;
            if (zeroBased) {
              return idx >= 0 && idx < totalPages ? Math.floor(idx) : -1;
            }
            // 1-based indexing: page 1 is index 0. Values < 1 are invalid in a 1-based scheme.
            return idx >= 1 && idx <= totalPages ? Math.floor(idx) - 1 : -1;
          })
          .filter((idx) => idx >= 0);

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
 * Removes pages in-place in descending index order so that page indices do not shift,
 * preserving document metadata, bookmarks, catalog properties, and form field interactiveness.
 */
export async function removePagesFromPdf(
  pdfBytes: Uint8Array,
  options: RemovePagesOptions,
): Promise<RemovePagesResult> {
  options.onProgress?.(10);

  const { PDFDocument } = await getPdfLib();

  let srcDoc: any;
  try {
    srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (err: any) {
    throw new EngineError(
      `Failed to load PDF: ${toErrorMessage(err, "corrupt or invalid format")}`,
      "pdflib",
    );
  }

  // Reject encrypted documents with a clear, user-facing error
  if (srcDoc.isEncrypted) {
    throw new EngineError(
      "The PDF is encrypted with a password. Please unlock or decrypt the document before removing pages.",
      "pdflib",
    );
  }

  const totalPages = srcDoc.getPageCount();
  const plan = planPageRemoval(totalPages, options.pagesToRemove, options.zeroBased);

  options.onProgress?.(30);

  // If explicit form flattening is opted into, flatten the interactive fields
  if (options.flattenForms) {
    try {
      const form = srcDoc.getForm();
      if (form && typeof form.flatten === "function") {
        form.flatten();
      }
    } catch {
      // Proceed if form flattening fails or document has no form
    }
  }

  options.onProgress?.(50);

  // In-place removal: delete pages in descending index order so subsequent target indices remain valid.
  // This preserves document outlines (bookmarks), metadata (title/author), and interactive form fields.
  const descendingIndices = [...plan.toRemoveIndices].sort((a, b) => b - a);
  for (const idx of descendingIndices) {
    srcDoc.removePage(idx);
  }

  options.onProgress?.(80);

  const outBytes = await srcDoc.save();

  options.onProgress?.(100);

  return {
    bytes: outBytes,
    removedCount: plan.toRemoveIndices.length,
    remainingCount: plan.remainingIndices.length,
    removedPages: plan.toRemoveIndices.map((i) => i + 1),
    remainingPages: plan.remainingIndices.map((i) => i + 1),
  };
}
