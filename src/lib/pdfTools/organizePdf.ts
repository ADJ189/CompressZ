/**
 * organizePdf.ts — Reorder, rotate, duplicate, delete, and insert blank PDF pages.
 *
 * Direct structural page manipulation via pdf-lib without re-rasterisation.
 */

import { getPdfLib } from "../pdfLibs";

export interface PageSpec {
  id: string; // unique key for drag-and-drop UI tracking
  originalIndex: number; // 0-based index from source
  rotation: number; // additional rotation in degrees: 0, 90, 180, 270
  deleted?: boolean;
  duplicateCount?: number; // default 1
  isBlank?: boolean;
}

export interface PlannedPageAction {
  sourceIndex: number;
  rotation: number;
  isBlank: boolean;
}

/**
 * Pure calculation: compute ordered sequence of pages to construct.
 */
export function computeTargetSequence(specs: PageSpec[]): PlannedPageAction[] {
  const sequence: PlannedPageAction[] = [];

  for (const spec of specs) {
    if (spec.deleted) continue;

    const count = Math.max(1, spec.duplicateCount ?? 1);
    for (let c = 0; c < count; c++) {
      sequence.push({
        sourceIndex: spec.originalIndex,
        rotation: ((spec.rotation % 360) + 360) % 360,
        isBlank: !!spec.isBlank,
      });
    }
  }

  return sequence;
}

/**
 * Execute page reorganization and return modified PDF buffer.
 */
export async function reorganizePdf(
  pdfBytes: Uint8Array,
  specs: PageSpec[],
  onProgress?: (pct: number) => void,
): Promise<Uint8Array> {
  onProgress?.(10);

  const planned = computeTargetSequence(specs);
  if (planned.length === 0) {
    throw new Error("Cannot create a PDF with 0 pages (all pages were deleted).");
  }

  const { PDFDocument, degrees } = await getPdfLib();
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();

  // Distinct indices to copy from srcDoc
  const neededSourceIndices = Array.from(
    new Set(planned.filter((p) => !p.isBlank).map((p) => p.sourceIndex)),
  );

  const copiedPagesMap = new Map<number, any>();
  if (neededSourceIndices.length > 0) {
    const copiedPages = await newDoc.copyPages(srcDoc, neededSourceIndices);
    for (let i = 0; i < neededSourceIndices.length; i++) {
      copiedPagesMap.set(neededSourceIndices[i], copiedPages[i]);
    }
  }

  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    if (item.isBlank) {
      const blankPage = newDoc.addPage([595.28, 841.89]); // A4 standard
      if (item.rotation !== 0) {
        blankPage.setRotation(degrees(item.rotation));
      }
    } else {
      // If a page is used multiple times, copyPages again if needed or clone
      let pageToAdd = copiedPagesMap.get(item.sourceIndex);
      if (!pageToAdd || newDoc.getPages().includes(pageToAdd)) {
        const extraCopy = await newDoc.copyPages(srcDoc, [item.sourceIndex]);
        pageToAdd = extraCopy[0];
      }
      const existingRot = pageToAdd.getRotation().angle;
      const combinedRot = ((existingRot + item.rotation) % 360 + 360) % 360;
      pageToAdd.setRotation(degrees(combinedRot));
      newDoc.addPage(pageToAdd);
    }

    const pct = Math.round(15 + ((i + 1) / planned.length) * 75);
    onProgress?.(pct);
  }

  const result = await newDoc.save();
  onProgress?.(100);
  return result;
}
