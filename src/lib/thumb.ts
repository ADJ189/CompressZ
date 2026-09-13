/**
 * thumb.ts — Small, cached preview thumbnails for file-queue cards.
 *
 * Used anywhere a queued file is shown before processing — most usefully
 * in the two reorderable queues (Images → PDF, Merge PDF) where seeing the
 * actual content matters for deciding page order, but also in the regular
 * compress queues so a "viewable" file (image or PDF) doesn't just show a
 * generic emoji.
 *
 * Kept deliberately cheap for RAM/CPU:
 *   - Thumbnails are tiny (≤96px) and JPEG-encoded, not full-res decodes
 *     kept around — the source ImageBitmap/canvas is discarded immediately
 *     after the small thumbnail is drawn.
 *   - Per-File caching (WeakMap) means re-rendering a card (progress
 *     ticks, reorders) never regenerates the thumbnail.
 *   - Generation is queued through a small concurrency limiter so dropping
 *     50 files at once doesn't fire 50 simultaneous decodes/PDF opens.
 *   - Only images and PDFs get real thumbnails. Video/audio/GIF keep their
 *     icon — a representative video frame would mean spinning up a hidden
 *     <video> element and a decode per file, which is exactly the kind of
 *     background CPU/RAM cost this app is trying to avoid by default.
 */
import { decodeImageBitmap, isHeicFile } from './imageDecode';
import { openPdfDocument } from './pdfLibs';

const THUMB_PX = 96;
const cache = new WeakMap<File, Promise<string | null>>();

function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || isHeicFile(f) ||
    /\.(jpg|jpeg|png|webp|avif|bmp|tiff?|gif)$/i.test(f.name);
}
function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

// ── Concurrency limiter ─────────────────────────────────────────
// Thumbnail work competes with actual compression for CPU, so cap it low.
const MAX_CONCURRENT = 2;
let active = 0;
const queue: (() => void)[] = [];
function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      job().then(resolve, reject).finally(() => {
        active--;
        const next = queue.shift();
        if (next) next();
      });
    };
    if (active < MAX_CONCURRENT) run(); else queue.push(run);
  });
}

function canvasToJpegUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise(resolve => {
    canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.6);
  });
}

async function renderImageThumb(file: File): Promise<string | null> {
  try {
    const bitmap = await decodeImageBitmap(file);
    const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return await canvasToJpegUrl(canvas);
  } catch {
    return null; // falls back to the icon — thumbnails are best-effort
  }
}

async function renderPdfThumb(file: File): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc  = await openPdfDocument(bytes);
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = THUMB_PX / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    await doc.destroy?.();
    return await canvasToJpegUrl(canvas);
  } catch {
    return null;
  }
}

/** Get (or start generating) a small preview URL for a queued file.
 * Returns null immediately for types with no cheap preview (caller keeps
 * showing its emoji icon) — never throws. */
export function getFileThumbnail(file: File): Promise<string | null> {
  let p = cache.get(file);
  if (!p) {
    if (isImageFile(file)) p = schedule(() => renderImageThumb(file));
    else if (isPdfFile(file)) p = schedule(() => renderPdfThumb(file));
    else p = Promise.resolve(null);
    cache.set(file, p);
  }
  return p;
}

/** Free a queued file's cached thumbnail (revokes its object URL and drops
 * the cache entry) — call this when a file is removed from a queue so
 * removed/re-added files don't accumulate blob URLs for the rest of the
 * session. Safe to call on a file with no thumbnail yet (no-op). */
export function revokeFileThumbnail(file: File) {
  const p = cache.get(file);
  if (!p) return;
  cache.delete(file);
  p.then(url => { if (url) URL.revokeObjectURL(url); }).catch(() => {});
}

/** Mount a thumbnail into a `.fc-ico`-style container: shows the fallback
 * emoji immediately, then swaps in the real preview image once ready (a
 * no-op if the container has since been removed from the DOM, e.g. the
 * file was removed or the list re-rendered before generation finished). */
export function mountThumbnail(container: HTMLElement, file: File, fallbackEmoji: string) {
  container.textContent = fallbackEmoji;
  if (!isImageFile(file) && !isPdfFile(file)) return; // no cheap preview available — keep the icon
  getFileThumbnail(file).then(url => {
    if (!url || !container.isConnected) return;
    container.innerHTML = '';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.className = 'fc-thumb-img';
    container.appendChild(img);
  });
}

