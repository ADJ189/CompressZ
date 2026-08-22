/**
 * imagesToPdf.ts — Combine one or more images into a single PDF, one image
 * per page, in the given order. Shared by the dedicated "Images → PDF"
 * tool (pages/imagesToPdf.ts) and the Convert page's img2pdf flow, so
 * there's a single implementation instead of two copies to keep in sync.
 *
 * Each image is drawn to canvas — GPU-composited via gpu.ts's get2D when
 * the Images GPU-acceleration setting is on, with a WebGL2-accelerated
 * resize pass when a max dimension is set and the source exceeds it —
 * then embedded as a JPEG page sized to the image's own pixel dimensions
 * via pdf-lib. Reuses the exact pdf-lib CDN loading pattern already used
 * by mergePdf.ts, compressPdf.ts, and convertPdf.ts (see lib/pdfLibs.ts).
 */
import { PDFLIB_ESM } from './pdfLibs';
import { makeCanvas, get2D, resizeViaWebGL } from './gpu';

export interface ImagesToPdfOptions {
  quality?:  number;                     // JPEG quality, 0.01-0.99 — default 0.92
  maxDim?:   number;                     // cap the longer edge before embedding — 0/undefined = no cap
  pageSize?: { w: number; h: number };   // fixed page size in PDF points — image is scaled to fit and centered; undefined = page matches each image's own size ("Auto")
}

export async function imagesToPdf(
  files: File[],
  options: ImagesToPdfOptions = {},
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (!files.length) throw new Error('Add at least one image');
  const quality = Math.max(0.01, Math.min(0.99, options.quality ?? 0.92));
  const maxDim  = options.maxDim ?? 0;

  const { PDFDocument } = await import(/* @vite-ignore */ PDFLIB_ESM) as any;
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error(`"${file.name}" isn't a readable image.`); }

    let w = bitmap.width, h = bitmap.height;
    if (maxDim > 0 && (w > maxDim || h > maxDim)) {
      const r = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const needsResize = w !== bitmap.width || h !== bitmap.height;

    // GPU path first (WebGL2 texture draw — only worth it when we're
    // actually scaling), Canvas2D fallback always available underneath.
    let canvas = needsResize ? resizeViaWebGL(bitmap, w, h, 'images', '#ffffff') : null;
    if (!canvas) {
      canvas = makeCanvas(w, h);
      const ctx = get2D(canvas, 'images');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // JPEG has no alpha — flatten onto white
      ctx.drawImage(bitmap, 0, 0, w, h);
    }
    bitmap.close();

    const jpegBytes = await encodeJpeg(canvas, quality);
    canvas.width = 0; canvas.height = 0;

    const img = await pdfDoc.embedJpg(new Uint8Array(jpegBytes));

    if (options.pageSize) {
      const { w: pw, h: ph } = options.pageSize;
      const page  = pdfDoc.addPage([pw, ph]);
      const scale = Math.min(pw / img.width, ph / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
    } else {
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }

    onProgress?.(Math.round(((i + 1) / files.length) * 95));
  }

  const bytes = await pdfDoc.save();
  onProgress?.(100);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

function encodeJpeg(c: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<ArrayBuffer> {
  if (c instanceof OffscreenCanvas) {
    return c.convertToBlob({ type: 'image/jpeg', quality }).then(b => b.arrayBuffer());
  }
  return new Promise((res, rej) =>
    (c as HTMLCanvasElement).toBlob(
      b => b ? b.arrayBuffer().then(res) : rej(new Error('toBlob returned null')),
      'image/jpeg', quality,
    ));
}
