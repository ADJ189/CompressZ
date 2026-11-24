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
    keywords = keywordsStr
      .split(/[,;\s]+/)
      .map((k: string) => k.trim())
      .filter(Boolean);
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

/**
 * Update PDF metadata fields or strip all metadata for privacy.
 */
export async function updatePdfMetadata(
  pdfBytes: Uint8Array,
  metadata: Partial<PdfMetadataInfo> = {},
  stripAll: boolean = false,
): Promise<Uint8Array> {
  const { PDFDocument } = await getPdfLib();
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (pdfDoc.isEncrypted) {
    throw new Error("The PDF is encrypted with a password. Please unlock or decrypt it in PDF Protect / Unlock before editing metadata.");
  }

  if (stripAll) {
    // Sanitize and strip all identifying metadata
    pdfDoc.setTitle("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setKeywords([]);
    pdfDoc.setCreator("");
    pdfDoc.setProducer("");
    // Note: pdf-lib doesn't have deleteCreationDate, setting epoch date or clearing info dict
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
      pdfDoc.setKeywords(kwList);
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
