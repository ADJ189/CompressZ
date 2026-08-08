/**
 * mergePdf.ts — Combine multiple PDFs into one, in the given order.
 *
 * Reuses the exact pdf-lib CDN loading pattern already used by
 * compressPdf.ts, convertPdf.ts, and convertOffice.ts (see lib/pdfLibs.ts).
 * Pages are copied via PDFDocument.copyPages(), which clones the page's
 * content stream and resources directly — no rasterisation, no rendering
 * pass, so text stays selectable and vectors stay sharp at any zoom, same
 * as the "structural" strategy in compressPdf.ts.
 */
import { PDFLIB_ESM } from './pdfLibs';

export interface MergeResult {
  blob: Blob;
  pageCount: number;
  totalInputSize: number;
}

export async function mergePdfs(
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<MergeResult> {
  if (files.length < 2) throw new Error('Add at least two PDFs to merge');
  onProgress?.(2);

  const { PDFDocument } = await import(/* @vite-ignore */ PDFLIB_ESM) as any;
  const merged = await PDFDocument.create();
  let pageCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      throw new Error(`Couldn't read "${file.name}" — the file may be corrupted.`);
    }

    let src: any;
    try {
      // ignoreEncryption lets us open PDFs with owner-password restrictions
      // (no user password) — the same permissive load used elsewhere in
      // the app for compression. A PDF that truly needs a password to open
      // still throws below and is reported by name.
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch {
      throw new Error(`"${file.name}" isn't a readable PDF (invalid, corrupted, or password-protected).`);
    }

    const indices = src.getPageIndices();
    if (indices.length === 0) {
      // Skip genuinely empty PDFs rather than failing the whole merge.
      onProgress?.(2 + Math.round(((i + 1) / files.length) * 96));
      continue;
    }

    const pages = await merged.copyPages(src, indices);
    pages.forEach((p: any) => merged.addPage(p));
    pageCount += pages.length;

    onProgress?.(2 + Math.round(((i + 1) / files.length) * 96));
  }

  if (pageCount === 0) throw new Error('None of the selected PDFs contained any pages.');

  const outBytes = await merged.save();
  onProgress?.(100);

  return {
    blob: new Blob([outBytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
    pageCount,
    totalInputSize: files.reduce((sum, f) => sum + f.size, 0),
  };
}
