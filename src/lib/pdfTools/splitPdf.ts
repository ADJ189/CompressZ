/**
 * splitPdf.ts — Extract page ranges, chunk by N-pages, or burst PDF into ZIP.
 *
 * 100% client-side via pdf-lib. Clones raw page content streams and dictionaries
 * without rasterisation to preserve vector crispness and selectable text.
 */

import { getPdfLib } from "../pdfLibs";
import { zipToBlob, type ZipEntryIn } from "../zip";

export interface SplitOptions {
  mode: "ranges" | "chunk" | "burst";
  ranges?: string; // e.g. "1-3, 5, 8-10"
  chunkSize?: number; // e.g. 2 pages per file
  baseFilename?: string; // default "document"
}

export interface SplitOutputFile {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export interface SplitResult {
  files: SplitOutputFile[];
  zipBlob?: Blob;
  totalOriginalPages: number;
}

/**
 * Parse human page ranges into array of 0-based page index arrays.
 * Handles single pages ("5"), ranges ("1-3"), spaces, commas, semicolons.
 * Clamps indices into [0, totalPages - 1].
 */
export function parsePageRanges(
  rangeStr: string,
  totalPages: number,
): number[][] {
  if (!rangeStr || !rangeStr.trim()) {
    throw new Error("Page range expression cannot be empty.");
  }
  if (totalPages <= 0) {
    throw new Error("Document must have at least 1 page.");
  }

  const parts = rangeStr.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("No valid page numbers found in range expression.");
  }

  const groups: number[][] = [];

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (start <= 0 || end <= 0) {
        throw new Error(`Page numbers must be 1 or greater (got "${part}").`);
      }
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      const group: number[] = [];
      for (let p = min; p <= max; p++) {
        if (p <= totalPages) {
          group.push(p - 1);
        }
      }
      if (group.length > 0) {
        groups.push(group);
      }
    } else {
      const single = Number.parseInt(part, 10);
      if (Number.isNaN(single) || single <= 0) {
        throw new Error(`Invalid page number "${part}".`);
      }
      if (single <= totalPages) {
        groups.push([single - 1]);
      }
    }
  }

  if (groups.length === 0) {
    throw new Error(
      `All requested pages (${rangeStr}) are outside the document's ${totalPages}-page bounds.`,
    );
  }

  return groups;
}

/**
 * Plan page index groups for N-page chunks (e.g. 5 pages in chunks of 2 -> [[0,1], [2,3], [4]]).
 */
export function planChunks(
  totalPages: number,
  chunkSize: number,
): number[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const groups: number[][] = [];
  for (let i = 0; i < totalPages; i += size) {
    const group: number[] = [];
    for (let j = i; j < Math.min(i + size, totalPages); j++) {
      group.push(j);
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Plan burst mode: one page per file.
 */
export function planBurst(totalPages: number): number[][] {
  return planChunks(totalPages, 1);
}

/**
 * Execute PDF splitting based on planned options.
 */
export async function splitPdf(
  pdfBytes: Uint8Array,
  options: SplitOptions,
  onProgress?: (pct: number) => void,
): Promise<SplitResult> {
  onProgress?.(5);

  const { PDFDocument } = await getPdfLib();
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  if (totalPages === 0) {
    throw new Error("PDF document has 0 pages.");
  }

  let plannedGroups: number[][];
  if (options.mode === "ranges") {
    plannedGroups = parsePageRanges(options.ranges || "1", totalPages);
  } else if (options.mode === "chunk") {
    plannedGroups = planChunks(totalPages, options.chunkSize || 1);
  } else {
    // burst
    plannedGroups = planBurst(totalPages);
  }

  const baseName = (options.baseFilename || "document").replace(/\.pdf$/i, "");
  const outputFiles: SplitOutputFile[] = [];

  for (let i = 0; i < plannedGroups.length; i++) {
    const group = plannedGroups[i];
    const subDoc = await PDFDocument.create();
    const copiedPages = await subDoc.copyPages(srcDoc, group);
    for (const page of copiedPages) {
      subDoc.addPage(page);
    }

    const outBytes = await subDoc.save();
    let fileName: string;

    if (options.mode === "burst") {
      const pad = String(i + 1).padStart(Math.max(2, String(totalPages).length), "0");
      fileName = `${baseName}_page_${pad}.pdf`;
    } else if (options.mode === "chunk") {
      fileName = `${baseName}_part_${i + 1}.pdf`;
    } else {
      const pageDesc = group.length === 1 ? `p${group[0] + 1}` : `p${group[0] + 1}-${group[group.length - 1] + 1}`;
      fileName = `${baseName}_${pageDesc}.pdf`;
    }

    outputFiles.push({
      name: fileName,
      bytes: outBytes,
      pageCount: group.length,
    });

    const pct = Math.round(10 + ((i + 1) / plannedGroups.length) * 80);
    onProgress?.(pct);
  }

  let zipBlob: Blob | undefined;
  if (outputFiles.length > 1) {
    const zipEntries: ZipEntryIn[] = outputFiles.map((f) => ({
      name: f.name,
      data: f.bytes,
    }));
    zipBlob = await zipToBlob(zipEntries);
  }

  onProgress?.(100);

  return {
    files: outputFiles,
    zipBlob,
    totalOriginalPages: totalPages,
  };
}
