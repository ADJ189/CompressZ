/**
 * metadataPdf.ts — Inspect, edit, and sanitize/strip PDF document metadata.
 *
 * Provides client-side reading and editing of standard PDF metadata dictionary fields
 * (Title, Author, Subject, Keywords, Creator, Producer) and a 1-click privacy sanitizer
 * to strip personal and system identifiers before public distribution.
 */

import { getPdfLib } from "../pdfLibs";

export interface PdfMetadataInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  pageCount?: number;
}

/**
 * Sanitize metadata strings to remove dangerous or unprintable control characters.
 */
export function sanitizeMetadataString(str?: string): string {
  if (!str) return "";
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Exclude null bytes, unprintable control codes (except tab 9, newline 10, carriage return 13), and DEL 127
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      continue;
    }
    out += str[i];
  }
  return out.trim();
}

/**
 * Parse date from PDF metadata object into an ISO string or undefined.
 */
export function formatPdfDate(date?: Date): string | undefined {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

/**
 * Parse comma/semicolon-separated metadata keyword input while preserving
 * internal whitespace inside multi-word phrases (e.g. "annual report, Q4").
 */
export function parseMetadataKeywords(input?: string): string[] {
  if (!input) return [];
  return input
    .split(/[,;]+/)
    .map((k) => sanitizeMetadataString(k))
    .filter(Boolean);
}

/**
 * Read all metadata from a PDF document.
 */
export async function readPdfMetadata(pdfBytes: Uint8Array): Promise<PdfMetadataInfo> {
  const { PDFDocument } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (pdfDoc.isEncrypted) {
    throw new Error("The PDF is encrypted with a password. Please unlock or decrypt it in PDF Protect / Unlock before reading metadata.");
  }

  const title = pdfDoc.getTitle() || undefined;
  const author = pdfDoc.getAuthor() || undefined;
  const subject = pdfDoc.getSubject() || undefined;
  const keywordsStr = pdfDoc.getKeywords() || undefined;
  const creator = pdfDoc.getCreator() || undefined;
  const producer = pdfDoc.getProducer() || undefined;
  const creationDate = formatPdfDate(pdfDoc.getCreationDate());
  const modificationDate = formatPdfDate(pdfDoc.getModificationDate());
  const pageCount = pdfDoc.getPageCount();

  let keywords: string[] | undefined = undefined;
  if (keywordsStr) {
    const parsed = parseMetadataKeywords(keywordsStr);
    if (parsed.length > 0) {
      keywords = parsed;
    }
  }

  return {
    title,
    author,
    subject,
    keywords,
    creator,
    producer,
    creationDate,
    modificationDate,
    pageCount,
  };
}

const PRIVATE_PDF_DICT_KEYS = ["Metadata", "PieceInfo", "LastModified", "SpiderInfo"] as const;

interface PdfRefLike {
  objectNumber: number;
  generationNumber?: number;
}

function pdfRefKey(ref: PdfRefLike): string {
  return `${ref.objectNumber}:${typeof ref.generationNumber === "number" ? ref.generationNumber : 0}`;
}

function walkReachableRefs(
  context: any,
  seeds: unknown[],
  skipParentKey: boolean,
): Map<string, PdfRefLike> {
  const visited = new Map<string, PdfRefLike>();
  const stack: unknown[] = [...seeds];

  while (stack.length > 0) {
    const val = stack.pop();
    if (!val || typeof val !== "object") continue;

    const maybeRef = val as { objectNumber?: unknown; generationNumber?: unknown };
    if (typeof maybeRef.objectNumber === "number") {
      const ref = val as PdfRefLike;
      const key = pdfRefKey(ref);
      if (visited.has(key)) continue;
      visited.set(key, ref);
      const resolved = typeof context?.lookup === "function" ? context.lookup(ref) : undefined;
      if (resolved && resolved !== val) {
        stack.push(resolved);
      }
      continue;
    }

    const dictLike = val as { entries?: () => Iterable<[unknown, unknown]> };
    if (typeof dictLike.entries === "function") {
      for (const [k, v] of dictLike.entries()) {
        if (skipParentKey) {
          const keyText = String(k ?? "");
          if (keyText === "/Parent" || keyText === "Parent") continue;
        }
        stack.push(v);
      }
      continue;
    }

    const arrayLike = val as { asArray?: () => unknown[] };
    if (typeof arrayLike.asArray === "function") {
      for (const item of arrayLike.asArray()) {
        stack.push(item);
      }
      continue;
    }

    const streamLike = val as { dict?: unknown };
    if (streamLike.dict) {
      stack.push(streamLike.dict);
    }
  }

  return visited;
}

/**
 * Update PDF metadata fields or strip all metadata for privacy.
 */
export async function updatePdfMetadata(
  pdfBytes: Uint8Array,
  metadata: Partial<PdfMetadataInfo> = {},
  stripAll: boolean = false,
): Promise<Uint8Array> {
  const { PDFDocument, PDFName } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (pdfDoc.isEncrypted) {
    throw new Error("The PDF is encrypted with a password. Please unlock or decrypt it in PDF Protect / Unlock before editing metadata.");
  }

  if (stripAll) {
    // 1. Remove Info entries, timestamps, XMP Metadata streams, and private app data (PieceInfo, LastModified, SpiderInfo)
    const candidateSeeds: unknown[] = [];

    if (PDFName) {
      const stripPrivateDictKeys = (dict: any) => {
        if (!dict || typeof dict.get !== "function" || typeof dict.delete !== "function") return;
        for (const keyName of PRIVATE_PDF_DICT_KEYS) {
          const key = PDFName.of(keyName);
          const entry = dict.get(key);
          dict.delete(key);
          if (entry) {
            candidateSeeds.push(entry);
          }
        }
      };

      stripPrivateDictKeys(pdfDoc.catalog);
      if (typeof pdfDoc.getPages === "function") {
        for (const page of pdfDoc.getPages()) {
          stripPrivateDictKeys(page?.node);
        }
      }
    }

    const trailerInfo = pdfDoc.context?.trailerInfo;
    if (trailerInfo) {
      const infoRef = trailerInfo.Info;
      if (infoRef) {
        const infoDict = typeof pdfDoc.context.lookup === "function"
          ? pdfDoc.context.lookup(infoRef)
          : infoRef;
        if (infoDict && typeof infoDict.keys === "function" && typeof infoDict.delete === "function") {
          for (const key of Array.from(infoDict.keys())) {
            infoDict.delete(key);
          }
        }
        candidateSeeds.push(infoRef);
        delete trailerInfo.Info;
      }
    } else {
      pdfDoc.setTitle("");
      pdfDoc.setAuthor("");
      pdfDoc.setSubject("");
      pdfDoc.setKeywords([]);
      pdfDoc.setCreator("");
      pdfDoc.setProducer("");
    }

    // 2. After unlinking private entries, delete only objects no longer reachable from the retained document
    if (candidateSeeds.length > 0 && typeof pdfDoc.context?.delete === "function") {
      const candidateRefs = walkReachableRefs(pdfDoc.context, candidateSeeds, true);
      if (candidateRefs.size > 0) {
        const retainedSeeds: unknown[] = [];
        if (trailerInfo?.Root) retainedSeeds.push(trailerInfo.Root);
        if (trailerInfo?.Info) retainedSeeds.push(trailerInfo.Info);
        if (trailerInfo?.Encrypt) retainedSeeds.push(trailerInfo.Encrypt);
        if (trailerInfo?.ID) retainedSeeds.push(trailerInfo.ID);
        if (pdfDoc.catalog) retainedSeeds.push(pdfDoc.catalog);
        if (typeof pdfDoc.getPages === "function") {
          for (const page of pdfDoc.getPages()) {
            if (page?.ref) retainedSeeds.push(page.ref);
            if (page?.node) retainedSeeds.push(page.node);
          }
        }

        const retainedRefs = walkReachableRefs(pdfDoc.context, retainedSeeds, false);
        for (const [key, ref] of candidateRefs) {
          if (!retainedRefs.has(key)) {
            pdfDoc.context.delete(ref);
          }
        }
      }
    }
  } else {
    if (metadata.title !== undefined) {
      pdfDoc.setTitle(sanitizeMetadataString(metadata.title));
    }
    if (metadata.author !== undefined) {
      pdfDoc.setAuthor(sanitizeMetadataString(metadata.author));
    }
    if (metadata.subject !== undefined) {
      pdfDoc.setSubject(sanitizeMetadataString(metadata.subject));
    }
    if (metadata.keywords !== undefined) {
      const kwList = Array.isArray(metadata.keywords)
        ? metadata.keywords.map(sanitizeMetadataString).filter(Boolean)
        : [];
      // Preserve comma separation so pdf-lib's internal space join keeps multi-word phrases distinct
      pdfDoc.setKeywords(kwList.length > 0 ? [kwList.join(", ")] : []);
    }
    if (metadata.creator !== undefined) {
      pdfDoc.setCreator(sanitizeMetadataString(metadata.creator));
    }
    if (metadata.producer !== undefined) {
      pdfDoc.setProducer(sanitizeMetadataString(metadata.producer));
    }
    // Update modification date to current time
    pdfDoc.setModificationDate(new Date());
  }

  return await pdfDoc.save();
}
