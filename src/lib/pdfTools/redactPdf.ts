/**
 * redactPdf.ts — True, irreversible redaction for sensitive PDF documents.
 *
 * Compliance with Invariant #7: Never merely place a visual overlay over text
 * streams (which leaves sensitive strings extractable via pdftotext or clipboard).
 * Redacted pages are sanitized by purging underlying text streams and burning in
 * opaque solid blocks onto a 300-DPI archival raster layer. Untouched pages retain
 * their original crisp vector streams.
 */

import { getPdfLib, openPdfDocument } from "../pdfLibs";

export interface RedactionRegion {
  pageIndex: number; // 0-based
  x: number; // PDF points from bottom-left
  y: number;
  width: number;
  height: number;
  reason?: string; // Optional label e.g. "REDACTED", "PII"
}

export interface RedactionOptions {
  regions: RedactionRegion[];
  onProgress?: (pct: number) => void;
  renderDpi?: number; // default 300 DPI for high print fidelity
}

/**
 * Filter and group redaction regions by 0-based page index.
 */
export function groupRedactionsByPage(
  regions: RedactionRegion[],
  totalPages: number,
): Map<number, RedactionRegion[]> {
  const map = new Map<number, RedactionRegion[]>();

  for (const r of regions) {
    if (r.pageIndex >= 0 && r.pageIndex < totalPages && r.width > 0 && r.height > 0) {
      const list = map.get(r.pageIndex) || [];
      list.push(r);
      map.set(r.pageIndex, list);
    }
  }

  return map;
}

/**
 * Render a single PDF page to a sanitized raster canvas with permanent redaction burn-in.
 */
export async function renderSanitizedRasterPage(
  pdfJsDoc: any,
  pageIndex: number,
  redactions: RedactionRegion[],
  dpi: number = 300,
): Promise<{ pngBytes: Uint8Array; widthPt: number; heightPt: number }> {
  const page = await pdfJsDoc.getPage(pageIndex + 1);
  const scale = dpi / 72; // 72 pt = 1 inch
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;

  // Render base PDF page
  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  // Burn in permanent opaque redaction blocks
  ctx.save();
  for (const r of redactions) {
    // Convert PDF bottom-left coordinates to Canvas top-left coordinates
    const canvasX = r.x * scale;
    const canvasY = (page.view[3] - r.y - r.height) * scale;
    const canvasW = r.width * scale;
    const canvasH = r.height * scale;

    ctx.fillStyle = "#000000";
    ctx.fillRect(canvasX, canvasY, canvasW, canvasH);

    if (r.reason) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.max(12, Math.round(10 * scale))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `[${r.reason.toUpperCase()}]`,
        canvasX + canvasW / 2,
        canvasY + canvasH / 2,
        canvasW - 4,
      );
    }
  }
  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });

  const pngBytes = new Uint8Array(await blob.arrayBuffer());
  canvas.width = 0;
  canvas.height = 0;

  return {
    pngBytes,
    widthPt: page.view[2] - page.view[0],
    heightPt: page.view[3] - page.view[1],
  };
}

/**
 * Execute true redaction on PDF document.
 */
export async function applyTrueRedaction(
  pdfBytes: Uint8Array,
  options: RedactionOptions,
): Promise<Uint8Array> {
  options.onProgress?.(5);

  const { PDFDocument } = await getPdfLib();
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  const redactionsMap = groupRedactionsByPage(options.regions, totalPages);
  if (redactionsMap.size === 0) {
    options.onProgress?.(100);
    return pdfBytes;
  }

  const pdfJsDoc = await openPdfDocument(pdfBytes);
  const outDoc = await PDFDocument.create();

  for (let i = 0; i < totalPages; i++) {
    const pageRedactions = redactionsMap.get(i);

    if (pageRedactions && pageRedactions.length > 0) {
      // Redacted page: burn in permanently into sanitized raster layer
      const { pngBytes, widthPt, heightPt } = await renderSanitizedRasterPage(
        pdfJsDoc,
        i,
        pageRedactions,
        options.renderDpi || 300,
      );
      const embeddedPng = await outDoc.embedPng(pngBytes);
      const newPage = outDoc.addPage([widthPt, heightPt]);
      newPage.drawImage(embeddedPng, {
        x: 0,
        y: 0,
        width: widthPt,
        height: heightPt,
      });
    } else {
      // Untouched page: copy structural vectors and text verbatim
      const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
      outDoc.addPage(copiedPage);
    }

    const pct = Math.round(10 + ((i + 1) / totalPages) * 80);
    options.onProgress?.(pct);
  }

  const resultBytes = await outDoc.save();
  options.onProgress?.(100);
  return resultBytes;
}
