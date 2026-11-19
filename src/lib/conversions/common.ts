/**
 * common.ts — Shared utilities for Office document conversions.
 *
 * Centralizes XML escaping and PDF reading-order extraction to eliminate
 * duplicate code across Word (.docx) and PowerPoint (.pptx) conversion pipelines.
 */

import { openPdfDocument } from "../pdfLibs";
import { reconstructReadingOrder, type ExtractedBlock } from "../pdfToMarkdown";

/**
 * Strips XML 1.0 disallowed control characters that cause Word, Excel, and PowerPoint
 * to prompt for repair on file open.
 * Allowed: \u0009 (tab), \u000A (LF), \u000D (CR).
 * Disallowed: \u0000-\u0008, \u000B, \u000C, \u000E-\u001F, \uFFFE, \uFFFF.
 */
export function stripInvalidXml(str: string | null | undefined): string {
  if (!str) return "";
  // eslint-disable-next-line no-control-regex -- explicitly stripping disallowed XML 1.0 control characters
  return String(str).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}

/**
 * Escape XML special characters for OpenXML (.docx, .pptx, .xlsx).
 * Strips invalid XML control characters and encodes XML entities.
 */
export function escapeXml(str: string | null | undefined): string {
  return stripInvalidXml(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escape HTML special characters to prevent XSS sinks.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Extract reading-order blocks for every page in a PDF document.
 */
export async function extractPdfPageBlocks(
  pdfInput: Uint8Array | File,
  onProgress?: (pct: number) => void,
): Promise<ExtractedBlock[][]> {
  const bytes =
    pdfInput instanceof File
      ? new Uint8Array(await pdfInput.arrayBuffer())
      : pdfInput;

  onProgress?.(10);
  const pdfDoc = await openPdfDocument(bytes);
  try {
    const numPages = pdfDoc.numPages;
    const allPageBlocks: ExtractedBlock[][] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      const rawItems = textContent.items.map((it: any) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        h: it.height,
        fontSize: Math.hypot(it.transform[0], it.transform[1]),
        fontName: it.fontName,
      }));

      const blocks = reconstructReadingOrder(
        rawItems,
        viewport.width,
        viewport.height,
      );
      allPageBlocks.push(blocks);

      const pct = Math.round(15 + (i / numPages) * 70);
      onProgress?.(pct);
    }

    return allPageBlocks;
  } finally {
    if (pdfDoc && typeof pdfDoc.destroy === "function") {
      await pdfDoc.destroy().catch(() => {});
    }
  }
}
