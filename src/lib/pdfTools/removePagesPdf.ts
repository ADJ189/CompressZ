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

  // Normalize whitespace around hyphens/dashes linearly (no regex backtracking)
  const rawParts = trimmed.split(/([-–—])/);
  let normalized = "";
  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (part === "-" || part === "–" || part === "—") {
      const prevTrimmed = normalized.trimEnd();
      const nextPart = rawParts[i + 1] ?? "";
      const nextTrimmed = nextPart.trimStart();
      if (
        prevTrimmed.length > 0 &&
        nextTrimmed.length > 0 &&
        /\d$/.test(prevTrimmed) &&
        /^\d/.test(nextTrimmed)
      ) {
        normalized = prevTrimmed + "-";
        rawParts[i + 1] = nextTrimmed;
        continue;
      }
    }
    normalized += part;
  }

  // Tokenize on commas, semicolons, newlines, and whitespace
  const tokens = normalized.split(/[,;\s\n]+/).map((s) => s.trim()).filter(Boolean);

  const indices = new Set<number>();

  for (const token of tokens) {
    // 1. Check for range pattern e.g. "2-5" or "5-2"
    const rangeMatch = token.match(/^(\d+)[-–—](\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
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
      const page = Number.parseInt(singleMatch[1], 10);
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

  // Set<number> collections represent internal 0-based page indices regardless of zeroBased
  const effectiveZeroBased = pagesToRemove instanceof Set ? true : zeroBased;

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
            if (effectiveZeroBased) {
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

interface PdfRefLike {
  objectNumber: number;
  generationNumber?: number;
}

interface PdfContextLike {
  trailerInfo?: {
    Root?: unknown;
    Info?: unknown;
    Encrypt?: unknown;
    ID?: unknown;
  };
  lookup?: (ref: PdfRefLike) => unknown;
  enumerateIndirectObjects?: () => Iterable<[PdfRefLike, unknown]>;
  delete?: (ref: PdfRefLike) => void;
}

interface PdfDocLike {
  context?: PdfContextLike;
}

function refKey(ref: PdfRefLike): string {
  return `${ref.objectNumber}:${ref.generationNumber ?? 0}`;
}

/**
 * Delete indirect PDF objects no longer reachable from trailer Root/Info so
 * removed page streams and private text do not remain in the saved PDF bytes.
 */
function pruneUnreachablePdfObjects(
  pdfDoc: PdfDocLike,
  removedRefs: Set<string>,
): void {
  const ctx = pdfDoc?.context;
  if (
    !ctx ||
    !ctx.trailerInfo ||
    typeof ctx.enumerateIndirectObjects !== "function" ||
    typeof ctx.lookup !== "function" ||
    typeof ctx.delete !== "function"
  ) {
    return;
  }

  const visited = new Set<string>();
  const stack: PdfRefLike[] = [];

  const enqueue = (val: unknown) => {
    if (!val || typeof val !== "object") return;
    const obj = val as Record<string, unknown>;
    if (typeof obj.objectNumber === "number" && typeof obj.generationNumber === "number") {
      const ref = obj as unknown as PdfRefLike;
      const k = refKey(ref);
      if (removedRefs.has(k) || visited.has(k)) return;
      visited.add(k);
      stack.push(ref);
      return;
    }
    if (typeof obj.entries === "function") {
      for (const [, entryVal] of (obj.entries as () => Iterable<[unknown, unknown]>)()) {
        enqueue(entryVal);
      }
      return;
    }
    if (typeof obj.asArray === "function") {
      for (const item of (obj.asArray as () => unknown[])()) {
        enqueue(item);
      }
      return;
    }
    if (obj.dict) {
      enqueue(obj.dict);
    }
  };

  enqueue(ctx.trailerInfo.Root);
  enqueue(ctx.trailerInfo.Info);
  if (ctx.trailerInfo.Encrypt) enqueue(ctx.trailerInfo.Encrypt);
  if (ctx.trailerInfo.ID) enqueue(ctx.trailerInfo.ID);

  while (stack.length > 0) {
    const ref = stack.pop()!;
    const resolved = ctx.lookup(ref);
    enqueue(resolved);
  }

  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!visited.has(refKey(ref))) {
      ctx.delete(ref);
    }
  }
}

interface PdfNameFactoryLike {
  of?: (name: string) => unknown;
}

interface PdfArrayLike {
  size?: () => number;
  get?: (index: number) => unknown;
  remove?: (index: number) => void;
  asArray?: () => unknown[];
}

interface PdfWidgetLike {
  ref?: PdfRefLike;
  P?: () => PdfRefLike | undefined;
}

interface PdfFieldLike {
  ref?: PdfRefLike;
  acroField?: {
    Kids?: () => PdfArrayLike | undefined;
    getWidgets?: () => PdfWidgetLike[];
    removeWidget?: (index: number) => void;
  };
}

interface PdfFormLike {
  getFields?: () => PdfFieldLike[];
  removeField?: (field: PdfFieldLike) => void;
  flatten?: () => void;
}

interface PdfPageWithAnnotsLike {
  ref?: PdfRefLike;
  node?: {
    Annots?: () => unknown;
    get?: (key: unknown) => unknown;
  };
}

interface PdfSourceDocLike extends PdfDocLike {
  getForm?: () => PdfFormLike;
}

function collectPageAnnotRefs(
  srcDoc: PdfSourceDocLike,
  page: PdfPageWithAnnotsLike | null | undefined,
  PDFName: PdfNameFactoryLike | undefined,
  targetSet: Set<string>,
): void {
  const node = page?.node;
  if (!node) return;
  let rawAnnots: unknown;
  if (typeof node.Annots === "function") {
    rawAnnots = node.Annots();
  } else if (typeof node.get === "function" && PDFName?.of) {
    rawAnnots = node.get(PDFName.of("Annots"));
  }
  if (!rawAnnots) return;
  const rawRef = rawAnnots as Partial<PdfRefLike>;
  const resolvedAnnots =
    typeof rawRef.objectNumber === "number" && typeof srcDoc?.context?.lookup === "function"
      ? srcDoc.context.lookup(rawRef as PdfRefLike)
      : rawAnnots;
  const annotsArray = resolvedAnnots as PdfArrayLike | unknown[];
  const items: unknown[] = Array.isArray(annotsArray)
    ? annotsArray
    : typeof annotsArray?.asArray === "function"
      ? annotsArray.asArray()
      : [];
  for (const item of items) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as PdfRefLike).objectNumber === "number"
    ) {
      targetSet.add(refKey(item as PdfRefLike));
    }
  }
}

/**
 * Remove AcroForm widget annotations belonging to deleted pages before object pruning.
 * Fields retain editability if at least one widget lives on a retained page; fields
 * whose widgets all lived on deleted pages are removed from the AcroForm.
 */
function removeDeletedPageFormWidgets(
  srcDoc: PdfSourceDocLike,
  removedPageRefs: Set<string>,
  removedAnnotRefs: Set<string>,
  removedRefs: Set<string>,
): void {
  let form: PdfFormLike | null;
  try {
    form = typeof srcDoc.getForm === "function" ? srcDoc.getForm() : null;
  } catch {
    return;
  }
  if (!form || typeof form.getFields !== "function") return;

  const fields = [...(form.getFields() ?? [])];
  for (const field of fields) {
    const acroField = field?.acroField;
    if (!acroField || typeof acroField.getWidgets !== "function") continue;
    const widgets = acroField.getWidgets();
    if (!Array.isArray(widgets) || widgets.length === 0) continue;

    const kidsArr = typeof acroField.Kids === "function" ? acroField.Kids() : undefined;
    let retainedCount = 0;

    for (let wi = widgets.length - 1; wi >= 0; wi--) {
      const widget = widgets[wi];
      const kidsCount = typeof kidsArr?.size === "function" ? kidsArr.size() : 0;
      const kidRef =
        kidsArr && typeof kidsArr.get === "function" && wi < kidsCount
          ? (kidsArr.get(wi) as PdfRefLike | undefined)
          : undefined;
      const wRef = widget?.ref ?? kidRef;
      const pRef = typeof widget?.P === "function" ? widget.P() : undefined;

      const onDeletedPage =
        (pRef && typeof pRef.objectNumber === "number" && removedPageRefs.has(refKey(pRef))) ||
        (wRef && typeof wRef.objectNumber === "number" && removedAnnotRefs.has(refKey(wRef))) ||
        (!wRef && field?.ref && typeof field.ref.objectNumber === "number" && removedAnnotRefs.has(refKey(field.ref)));

      if (onDeletedPage) {
        if (typeof acroField.removeWidget === "function") {
          acroField.removeWidget(wi);
        } else if (kidsArr && typeof kidsArr.remove === "function") {
          kidsArr.remove(wi);
        }
        if (wRef && typeof wRef.objectNumber === "number") {
          removedRefs.add(refKey(wRef));
        }
      } else {
        retainedCount++;
      }
    }

    if (retainedCount === 0) {
      if (typeof form.removeField === "function") {
        form.removeField(field);
      }
      if (field?.ref && typeof field.ref.objectNumber === "number") {
        removedRefs.add(refKey(field.ref));
      }
    }
  }
}

/**
 * Execute page removal on a PDF document.
 * Removes pages in-place in descending index order so that page indices do not shift,
 * preserving document metadata, bookmarks, catalog properties, and form field interactiveness,
 * then removes deleted-page form widgets and prunes unreachable objects so deleted page
 * content is absent from output bytes.
 */
export async function removePagesFromPdf(
  pdfBytes: Uint8Array,
  options: RemovePagesOptions,
): Promise<RemovePagesResult> {
  options.onProgress?.(10);

  const { PDFDocument, PDFName } = await getPdfLib();

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
  // Record removed page and annotation refs first so deleted-page widgets and streams are purged cleanly.
  const descendingIndices = [...plan.toRemoveIndices].sort((a, b) => b - a);
  const removedPageRefs = new Set<string>();
  const removedAnnotRefs = new Set<string>();
  const removedRefs = new Set<string>();
  for (const idx of descendingIndices) {
    const page = typeof srcDoc.getPage === "function" ? srcDoc.getPage(idx) : null;
    if (page?.ref && typeof page.ref.objectNumber === "number") {
      const key = refKey(page.ref);
      removedPageRefs.add(key);
      removedRefs.add(key);
    }
    collectPageAnnotRefs(srcDoc, page, PDFName, removedAnnotRefs);
    srcDoc.removePage(idx);
  }

  if (!options.flattenForms) {
    removeDeletedPageFormWidgets(srcDoc, removedPageRefs, removedAnnotRefs, removedRefs);
  }

  pruneUnreachablePdfObjects(srcDoc, removedRefs);

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
