import type { CompressOptions, CompressResult, ImageFormat } from "./types";
import { makeCanvas, get2D, resizeViaWebGL } from "./gpu";
import { decodeImageBitmap } from "./imageDecode";
import { resolvedMaxImageDim } from "./settings";

// AVIF *encoding* support varies a lot more than decoding support (notably
// Safari can display AVIF but can't encode it via canvas, and older Firefox
// versions can't either). Feature-detect once via toDataURL instead of
// sniffing the user agent string, which is fragile and easy to get wrong
// across Chromium forks, WebKit variants, and future browser releases.
let _avifEncodeSupport: boolean | null = null;
function supportsAvifEncode(): boolean {
  if (_avifEncodeSupport !== null) return _avifEncodeSupport;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _avifEncodeSupport = c
      .toDataURL("image/avif")
      .startsWith("data:image/avif");
  } catch {
    _avifEncodeSupport = false;
  }
  return _avifEncodeSupport;
}

export function getBestFormat(requested: ImageFormat): ImageFormat {
  if (typeof document === "undefined") return requested;
  if (requested === "image/avif" && !supportsAvifEncode()) return "image/webp";
  return requested;
}

export async function compressImage(
  file: File,
  options: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  onProgress?.(5);
  const format = getBestFormat((options.format ?? "image/webp") as ImageFormat);
  // The per-tool maxWidth/maxHeight (from the Images page's own settings)
  // is clamped further by the global Settings → Performance → "Max image
  // dimension" resource limit, if the person has set one — this is the one
  // guardrail that applies no matter what a specific tool's own settings
  // say, so a manual RAM cap actually holds even if someone left an
  // individual tool set to "no limit".
  const resourceCap = resolvedMaxImageDim();
  const maxW = Math.min(options.maxWidth ?? 16384, resourceCap || 16384);
  const maxH = Math.min(options.maxHeight ?? 16384, resourceCap || 16384);

  const bitmap = await decodeImageBitmap(file);
  onProgress?.(18);

  let { width: w, height: h } = bitmap;
  const origW = w,
    origH = h;
  const needsResize = w > maxW || h > maxH;
  if (needsResize) {
    const r = Math.min(maxW / w, maxH / h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }

  // GPU path: when we're actually downscaling, run the resize as a WebGL2
  // texture draw (hardware bilinear filtering) instead of Canvas2D's
  // CPU-bound drawImage() scaler. Falls back to plain Canvas2D — silently,
  // same visual result — when WebGL2 is unavailable, the Images GPU
  // toggle is off in Settings, or the GPU draw throws for any reason.
  let canvas = needsResize
    ? resizeViaWebGL(
        bitmap,
        w,
        h,
        "images",
        format === "image/jpeg" ? "#ffffff" : undefined,
      )
    : null;
  if (!canvas) {
    canvas = makeCanvas(w, h);
    const ctx = get2D(canvas, "images");
    if (format === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
  }
  bitmap.close();
  onProgress?.(32);

  const defaultQ =
    format === "image/avif" ? 0.7 : format === "image/jpeg" ? 0.85 : 0.82;
  const clamp = (q: number) =>
    format === "image/png" ? 1 : Math.max(0.01, Math.min(0.99, q));

  let blob: Blob;
  if (options.targetSizeKB && options.targetSizeKB > 0) {
    blob = await binarySearch(
      canvas,
      format,
      options.targetSizeKB * 1024,
      onProgress,
    );
  } else {
    blob = await encode(canvas, format, clamp(options.quality ?? defaultQ));
    onProgress?.(95);
  }

  // If PNG re-encoding didn't actually shrink the file, returning the
  // original is a reasonable choice — but the metadata describing the
  // returned blob has to describe the blob we're actually returning, not
  // the resized/re-encoded one we discarded. Otherwise the UI can show
  // "resized to WxH, PNG" while the downloaded bytes are the original file
  // at its original dimensions/format, and metadata-stripping guarantees
  // silently don't hold.
  let outFormat: ImageFormat = format;
  let outW = w,
    outH = h;
  if (
    format === "image/png" &&
    blob.size >= file.size &&
    (await isPngSource(file))
  ) {
    blob = file;
    outFormat = "image/png";
    outW = origW;
    outH = origH;
  }
  onProgress?.(100);

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: file.size / blob.size,
    format: outFormat,
    width: outW,
    height: outH,
  };
}

// Browsers often leave File.type empty (e.g. some drag-and-drop sources, or
// unusual OS MIME mappings) even though the Images page accepts the file by
// extension — so don't trust `type` alone. Check the MIME type, then the PNG
// magic bytes, then the extension as a last resort.
async function isPngSource(file: File): Promise<boolean> {
  if (file.type === "image/png") return true;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (head.length === 8 && sig.every((b, i) => head[i] === b)) return true;
  } catch {
    /* fall through to the extension check */
  }
  return !file.type && /\.png$/i.test(file.name);
}

async function binarySearch(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: ImageFormat,
  targetBytes: number,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (format === "image/png") {
    onProgress?.(90);
    return encode(canvas, format, 1);
  }
  let lo = 0.01,
    hi = 0.99,
    best: Blob | null = null;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const b = await encode(canvas, format, mid);
    onProgress?.(32 + Math.round((i / 14) * 60));
    if (b.size <= targetBytes) {
      best = b;
      lo = mid;
    } else hi = mid;
    if (hi - lo < 0.004) break;
  }
  return best ?? (await encode(canvas, format, lo));
}

function encode(
  c: HTMLCanvasElement | OffscreenCanvas,
  fmt: string,
  q: number,
): Promise<Blob> {
  if (c instanceof OffscreenCanvas)
    return c.convertToBlob({ type: fmt, quality: q });
  return new Promise((res, rej) =>
    (c as HTMLCanvasElement).toBlob(
      (b) => (b ? res(b) : rej(new Error("toBlob null"))),
      fmt,
      q,
    ),
  );
}
