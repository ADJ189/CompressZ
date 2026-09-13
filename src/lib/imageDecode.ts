/**
 * imageDecode.ts — Shared "turn a user File into an ImageBitmap" helper.
 *
 * Every image entry point (compressImage.ts, imagesToPdf.ts, aiEngine.ts,
 * thumb.ts) used to call `createImageBitmap(file)` directly and just throw
 * on failure. That's silently broken for HEIC/HEIF: only Safari/WebKit
 * (macOS + iOS, including Chrome/Firefox-on-iOS since Apple mandates WebKit
 * there) can decode HEIC through the canvas pipeline. Chrome, Firefox and
 * Edge on Android, Windows, Linux and ChromeOS all fail `createImageBitmap`
 * on a real iPhone-shot .heic — which is the single most common photo
 * format users drag in, so this was the top HEIC complaint.
 *
 * Fix: try the native path everywhere first (free, GPU-backed, works for
 * every non-HEIC format and for HEIC itself on WebKit). Only when that
 * fails AND the file looks like HEIC/HEIF do we lazy-load a WASM HEIC
 * decoder (heic2any, which wraps libheif) from CDN — same
 * load-on-first-use pattern as ffmpeg.ts/pdfLibs.ts, so the ~2-3MB WASM
 * payload never touches RAM/CPU/network for the vast majority of users
 * who never open a HEIC file.
 */

const HEIC_EXT_RE  = /\.(heic|heif)$/i;
const HEIC_MIME_RE = /^image\/hei[cf]/i;

export function isHeicFile(file: File): boolean {
  return HEIC_MIME_RE.test(file.type) || HEIC_EXT_RE.test(file.name);
}

const HEIC2ANY_CDN = 'https://esm.sh/heic2any@0.0.4';

// Per-File cache of the decoded-to-PNG blob. HEIC decoding via WASM is slow
// and memory-heavy (full-res decode + re-encode); without this, opening the
// same file for a thumbnail *and* then compressing it would pay that cost
// twice. WeakMap means the cache entry is freed automatically once the File
// itself is no longer referenced (e.g. removed from the queue).
const heicPngCache = new WeakMap<File, Promise<Blob>>();

async function heicToPngBlob(file: File): Promise<Blob> {
  let pending = heicPngCache.get(file);
  if (!pending) {
    pending = (async () => {
      const mod: any = await import(/* @vite-ignore */ HEIC2ANY_CDN);
      const heic2any = mod.default ?? mod;
      const out = await heic2any({ blob: file, toType: 'image/png', quality: 0.92 });
      return (Array.isArray(out) ? out[0] : out) as Blob;
    })();
    heicPngCache.set(file, pending);
  }
  return pending;
}

function loadViaImgTag(source: File | Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try { resolve(await createImageBitmap(img)); } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

/**
 * Decode any user-supplied image File into an ImageBitmap. Throws a
 * user-facing error (not a raw browser exception) when the file truly can't
 * be read, including a clear explanation for the HEIC-specific failure mode.
 */
export async function decodeImageBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    if (isHeicFile(file)) {
      try {
        const png = await heicToPngBlob(file);
        return await createImageBitmap(png);
      } catch (heicErr: any) {
        throw new Error(
          `"${file.name}" is a HEIC/HEIF photo this browser can't decode natively, and the ` +
          `built-in HEIC converter couldn't read it either${heicErr?.message ? ` (${heicErr.message})` : ''}. ` +
          `It may be a Live Photo or a corrupted export — try re-exporting it as JPEG from your Photos app.`,
          { cause: heicErr }
        );
      }
    }
    // Non-HEIC decode failure — last-resort <img> tag path. Handles some
    // edge cases createImageBitmap rejects outright but the browser can
    // still paint (a handful of malformed-but-renderable files).
    try {
      return await loadViaImgTag(file);
    } catch {
      throw new Error(`"${file.name}" isn't a readable image.`);
    }
  }
}

/**
 * Best-effort small preview of a HEIC file as a data/object URL, for use in
 * file-queue thumbnails (see thumb.ts). Returns null rather than throwing —
 * callers fall back to a generic icon.
 */
export async function heicPreviewBlob(file: File): Promise<Blob | null> {
  try { return await heicToPngBlob(file); } catch { return null; }
}
