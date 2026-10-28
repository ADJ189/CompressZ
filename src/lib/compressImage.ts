import type { CompressOptions, CompressResult, ImageFormat } from "./types";
import { makeCanvas, get2D, resizeViaWebGL } from "./gpu";
import { decodeImageBitmap } from "./imageDecode";
import { resolvedMaxImageDim } from "./settings";
import {
  computeSsim,
  decideQualityGuard,
  planOutputSize,
  sampleLuma,
} from "./qualityGuard";

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

  const origW = bitmap.width,
    origH = bitmap.height;
  // planOutputSize() never upscales: a max dimension is a ceiling, so a
  // 1200px source stays 1200px even when the cap is 4000px.
  const size = planOutputSize(origW, origH, maxW, maxH);
  const w = size.width,
    h = size.height;
  const needsResize = size.resized;

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
  const requestedQ = clamp(options.quality ?? defaultQ);

  let blob: Blob;
  if (options.targetSizeKB && options.targetSizeKB > 0) {
    blob = await binarySearch(
      canvas,
      format,
      options.targetSizeKB * 1024,
      onProgress,
    );
  } else {
    blob = await encode(canvas, format, requestedQ);
    onProgress?.(95);
  }

  // Post-encode quality guard. It measures a ≤96×96 luma sample, so a 6000px
  // photo costs a small fixed amount of work instead of a second full decode.
  // The guard never lowers the requested quality or resolution: at most it
  // retries once at a *higher* quality (when no byte target is active) and
  // otherwise reports a short note on the result.
  let guardNote = "";
  let measured: MeasuredImage | null = null;
  if (format !== "image/png") {
    measured = await measureEncoded(canvas, w, h, blob);
    if (measured) {
      const base = {
        format,
        requestedQuality: requestedQ,
        targetSizeKB: options.targetSizeKB,
        planned: { width: w, height: h },
      };
      const first = decideQualityGuard({
        ...base,
        ssim: measured.ssim,
        actual: measured,
      });
      if (first.action === "retry") {
        const retried = await encode(canvas, format, clamp(first.quality));
        const retriedMeasure = await measureEncoded(canvas, w, h, retried);
        if (retriedMeasure && retriedMeasure.ssim > measured.ssim) {
          const second = decideQualityGuard({
            ...base,
            ssim: retriedMeasure.ssim,
            actual: retriedMeasure,
            requestedQuality: first.quality,
            alreadyRetried: true,
          });
          blob = retried;
          measured = retriedMeasure;
          guardNote = second.action === "warn" ? guardLabel(second.code) : "";
        } else {
          const second = decideQualityGuard({
            ...base,
            ssim: measured.ssim,
            actual: measured,
            requestedQuality: first.quality,
            alreadyRetried: true,
          });
          guardNote = guardLabel(second.action === "warn" ? second.code : "low-ssim");
        }
      } else if (first.action === "warn") {
        guardNote = guardLabel(first.code);
      }
    }
  }

  // If PNG re-encoding didn't actually shrink the file, returning the
  // original is a reasonable choice — but the metadata describing the
  // returned blob has to describe the blob we're actually returning, not
  // the resized/re-encoded one we discarded. Otherwise the UI can show
  // "resized to WxH, PNG" while the downloaded bytes are the original file
  // at its original dimensions/format, and metadata-stripping guarantees
  // silently don't hold.
  let outFormat: ImageFormat = format;
  let outW = measured?.width || w,
    outH = measured?.height || h;
  if (
    format === "image/png" &&
    blob.size >= file.size &&
    (await isPngSource(file))
  ) {
    blob = file;
    outFormat = "image/png";
    outW = origW;
    outH = origH;
    guardNote = "";
  }
  onProgress?.(100);

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: file.size / blob.size,
    // `components.ts` shows everything after the "·" as the engine/note
    // badge, so the guard note rides along without changing the MIME type.
    format: guardNote ? `${outFormat} · ${guardNote}` : outFormat,
    width: outW,
    height: outH,
  };
}

interface MeasuredImage {
  ssim: number;
  width: number;
  height: number;
}

/**
 * Decode the encoded blob into a bounded sample instead of a full-resolution
 * bitmap, then sample source and output to a ≤96×96 luma grid and return
 * global SSIM plus the encoded image's real dimensions. Returns null when the
 * browser cannot decode its own output — the caller then treats the encode as
 * unmeasured rather than inventing a score.
 *
 * `createImageBitmap` can downscale while decoding, so a 6000px output never
 * has to materialise at full size just to be measured. Dimensions are read
 * from the encoded header (`encodedDimensions`) because a resized bitmap no
 * longer reports them.
 */
async function measureEncoded(
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  blob: Blob,
): Promise<MeasuredImage | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const { width: sw, height: sh } = sampleSize(width, height);
    let decoded: ImageBitmap;
    try {
      decoded = await createImageBitmap(blob, {
        resizeWidth: sw,
        resizeHeight: sh,
        resizeQuality: "high",
      });
    } catch {
      // Some engines reject the resize options themselves. Fall back to a
      // plain decode rather than losing the measurement entirely.
      decoded = await createImageBitmap(blob);
    }
    const a = await sampleCanvasLuma(source, width, height);
    const b = await sampleCanvasLuma(decoded, sw, sh);
    decoded.close();
    // The planned dimensions are the encoder's own input, so they are the
    // correct fallback when the header can't be parsed (unknown container).
    const actual = (await encodedDimensions(blob)) ?? { width, height };
    return { ssim: computeSsim(a, b), width: actual.width, height: actual.height };
  } catch {
    return null;
  }
}

/** The ≤96px sampling grid used for both source and output. */
function sampleSize(width: number, height: number): { width: number; height: number } {
  const MAX_SIDE = 96;
  const scale = Math.min(1, MAX_SIDE / Math.max(1, width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Read image dimensions from the encoded header without decoding pixels.
 * Covers the formats this app encodes (JPEG, WebP, AVIF); unknown input
 * returns null. Only the first 64 KiB are read.
 */
async function encodedDimensions(
  blob: Blob,
): Promise<{ width: number; height: number } | null> {
  try {
    const head = new Uint8Array(
      await blob.slice(0, 64 * 1024).arrayBuffer(),
    );
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

    // JPEG: walk the marker chain until a Start Of Frame segment.
    if (head[0] === 0xff && head[1] === 0xd8) {
      let off = 2;
      while (off + 9 <= head.length) {
        if (head[off] !== 0xff) {
          off++;
          continue;
        }
        const marker = head[off + 1];
        if (marker === 0xd8 || marker === 0xd9) {
          off += 2;
          continue;
        }
        const len = view.getUint16(off + 2);
        if (len < 2) return null;
        const isSof =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 && // DHT
          marker !== 0xc8 && // JPG extension
          marker !== 0xcc; // DAC
        if (isSof) {
          return {
            height: view.getUint16(off + 5),
            width: view.getUint16(off + 7),
          };
        }
        off += 2 + len;
      }
      return null;
    }

    // WebP: RIFF container, VP8 (lossy), VP8L (lossless) or VP8X (extended).
    const riff = String.fromCharCode(...head.subarray(0, 4));
    const webp = String.fromCharCode(...head.subarray(8, 12));
    if (riff === "RIFF" && webp === "WEBP" && head.length >= 30) {
      const chunk = String.fromCharCode(...head.subarray(12, 16));
      if (chunk === "VP8 ") {
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
        };
      }
      if (chunk === "VP8L") {
        return {
          width: 1 + (((head[22] & 0x3f) << 8) | head[21]),
          height:
            1 +
            (((head[24] & 0x0f) << 10) |
              (head[23] << 2) |
              ((head[22] & 0xc0) >> 6)),
        };
      }
      if (chunk === "VP8X") {
        return {
          width: 1 + (head[24] | (head[25] << 8) | (head[26] << 16)),
          height: 1 + (head[27] | (head[28] << 8) | (head[29] << 16)),
        };
      }
      return null;
    }

    // AVIF: ISOBMFF — the `ispe` box carries width/height as 32-bit values
    // after its 4-byte version/flags field.
    const text = new TextDecoder("latin1").decode(head);
    const idx = text.indexOf("ispe");
    if (idx >= 0 && idx + 16 <= head.length) {
      return {
        width: view.getUint32(idx + 8),
        height: view.getUint32(idx + 12),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function sampleCanvasLuma(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Float32Array> {
  const MAX_SIDE = 96;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));
  const small = makeCanvas(sw, sh);
  const ctx = get2D(small, "images");
  ctx.drawImage(source, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  return sampleLuma(data, sw, sh, MAX_SIDE);
}

function guardLabel(code: string): string {
  switch (code) {
    case "resolution-lost":
      return "⚠ output smaller than planned";
    case "target-size-quality":
      return "⚠ target size limits quality";
    default:
      return "⚠ low SSIM at requested quality";
  }
}

// Browsers often leave File.type empty (e.g. some drag-and-drop sources, or
// unusual OS MIME mappings) even though the Images page accepts the file by
// extension — so don't trust `type` alone. Content wins over names: once the
// bytes have been read, the PNG magic number is authoritative (a mislabelled
// "photo.png" that is really a JPEG/WebP must NOT count as a PNG, or the
// no-upsize fallback would hand back non-PNG bytes under a .png name). The
// declared type / filename are only a last resort when the bytes can't be read.
async function isPngSource(file: File): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (head.length === 8) {
      const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return sig.every((b, i) => head[i] === b);
    }
  } catch {
    /* unreadable: fall back to the declared type / extension below */
  }
  return file.type === "image/png" || (!file.type && /\.png$/i.test(file.name));
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
