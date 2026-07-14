import type { CompressOptions, CompressResult, ImageFormat } from './types';

// AVIF *encoding* support varies a lot more than decoding support (notably
// Safari can display AVIF but can't encode it via canvas, and older Firefox
// versions can't either). Feature-detect once via toDataURL instead of
// sniffing the user agent string, which is fragile and easy to get wrong
// across Chromium forks, WebKit variants, and future browser releases.
let _avifEncodeSupport: boolean | null = null;
function supportsAvifEncode(): boolean {
  if (_avifEncodeSupport !== null) return _avifEncodeSupport;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    _avifEncodeSupport = c.toDataURL('image/avif').startsWith('data:image/avif');
  } catch {
    _avifEncodeSupport = false;
  }
  return _avifEncodeSupport;
}

export function getBestFormat(requested: ImageFormat): ImageFormat {
  if (typeof document === 'undefined') return requested;
  if (requested === 'image/avif' && !supportsAvifEncode()) return 'image/webp';
  return requested;
}

export async function compressImage(
  file: File,
  options: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  onProgress?.(5);
  const format = getBestFormat((options.format ?? 'image/webp') as ImageFormat);
  const maxW   = options.maxWidth  ?? 16384;
  const maxH   = options.maxHeight ?? 16384;

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { bitmap = await loadViaImg(file); }
  onProgress?.(18);

  let { width: w, height: h } = bitmap;
  if (w > maxW || h > maxH) {
    const r = Math.min(maxW / w, maxH / h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }

  const canvas = makeCanvas(w, h);
  const ctx    = getCtx(canvas);
  if (format === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  onProgress?.(32);

  const defaultQ = format === 'image/avif' ? 0.70 : format === 'image/jpeg' ? 0.85 : 0.82;
  const clamp    = (q: number) => format === 'image/png' ? 1 : Math.max(0.01, Math.min(0.99, q));

  let blob: Blob;
  if (options.targetSizeKB && options.targetSizeKB > 0) {
    blob = await binarySearch(canvas, format, options.targetSizeKB * 1024, onProgress);
  } else {
    blob = await encode(canvas, format, clamp(options.quality ?? defaultQ));
    onProgress?.(95);
  }

  // If PNG got larger, return original
  if (format === 'image/png' && blob.size >= file.size) blob = file;
  onProgress?.(100);

  return {
    blob,
    originalSize:     file.size,
    compressedSize:   blob.size,
    compressionRatio: file.size / blob.size,
    format,
    width: w,
    height: h,
  };
}

async function binarySearch(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: ImageFormat,
  targetBytes: number,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (format === 'image/png') { onProgress?.(90); return encode(canvas, format, 1); }
  let lo = 0.01, hi = 0.99, best: Blob | null = null;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const b   = await encode(canvas, format, mid);
    onProgress?.(32 + Math.round((i / 14) * 60));
    if (b.size <= targetBytes) { best = b; lo = mid; } else hi = mid;
    if (hi - lo < 0.004) break;
  }
  return best ?? await encode(canvas, format, lo);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function getCtx(c: HTMLCanvasElement | OffscreenCanvas) {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return ctx;
}

function encode(c: HTMLCanvasElement | OffscreenCanvas, fmt: string, q: number): Promise<Blob> {
  if (c instanceof OffscreenCanvas) return c.convertToBlob({ type: fmt, quality: q });
  return new Promise((res, rej) =>
    (c as HTMLCanvasElement).toBlob(b => b ? res(b) : rej(new Error('toBlob null')), fmt, q),
  );
}

function loadViaImg(file: File): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try { resolve(await createImageBitmap(img)); } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}
