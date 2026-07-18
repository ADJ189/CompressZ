/**
 * convertPdf.ts — PDF → Images and Images → PDF, for the Convert page.
 * Reuses the exact pdfjs-dist / pdf-lib CDN loading pattern already used
 * in compressPdf.ts and pages/ocr.ts, so there's nothing new to audit.
 */
import { zipToBlob, zipSupported } from './zip';

const PDFJS_VERSION = '4.4.168';
const PDFJS_BASE     = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
const PDFLIB_ESM      = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

export interface PdfToImagesResult {
  blob: Blob;          // single image, or a .zip if multiple pages
  isZip: boolean;
  pageCount: number;
}

export async function pdfToImages(
  file: File,
  format: 'png' | 'jpeg',
  dpi: number,
  onProgress?: (pct: number) => void,
): Promise<PdfToImagesResult> {
  const lib = await import(/* @vite-ignore */ `${PDFJS_BASE}/build/pdf.mjs`) as any;
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/build/pdf.worker.mjs`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({
    data: bytes.slice(0),
    cMapUrl: `${PDFJS_BASE}/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    useSystemFonts: true, useWorkerFetch: false, isEvalSupported: false,
  }).promise;

  const scale = dpi / 72;
  const total = doc.numPages;
  const pages: { name: string; data: Uint8Array }[] = [];
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const base = file.name.replace(/\.pdf$/i, '');

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const vp   = page.getViewport({ scale });
    const w = Math.floor(vp.width), h = Math.floor(vp.height);

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { alpha: format === 'png' })!;
    if (format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;

    const blob = await new Promise<Blob>((res, rej) =>
      c.toBlob(b => b ? res(b) : rej(new Error('toBlob returned null')), mime, format === 'jpeg' ? 0.92 : undefined));
    pages.push({ name: `${base}_page${String(i).padStart(2, '0')}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) });

    c.width = 0; c.height = 0;
    page.cleanup();
    onProgress?.(Math.round((i / total) * 95));
  }
  await doc.destroy();
  onProgress?.(100);

  if (pages.length === 1) {
    return { blob: new Blob([pages[0].data.buffer as ArrayBuffer], { type: mime }), isZip: false, pageCount: 1 };
  }
  if (!zipSupported()) {
    throw new Error('Multi-page PDF → image needs one file per page, which requires ZIP support (CompressionStream) — please use a current version of Chrome, Firefox, Safari, or Edge.');
  }
  return { blob: await zipToBlob(pages), isZip: true, pageCount: pages.length };
}

export async function imagesToPdf(
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const { PDFDocument } = await import(/* @vite-ignore */ PDFLIB_ESM) as any;
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const bitmap = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bitmap.width; c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const jpegBytes = await new Promise<ArrayBuffer>((res, rej) =>
      c.toBlob(b => b ? b.arrayBuffer().then(res) : rej(new Error('toBlob returned null')), 'image/jpeg', 0.92));
    c.width = 0; c.height = 0;

    const img  = await pdfDoc.embedJpg(new Uint8Array(jpegBytes));
    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    onProgress?.(Math.round(((i + 1) / files.length) * 95));
  }

  const bytes = await pdfDoc.save();
  onProgress?.(100);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}
