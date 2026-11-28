/**
 * avifEncode.ts — Lazy-loaded WebAssembly AVIF encoder fallback.
 *
 * Chromium (Chrome, Edge, Brave) and Safari can decode AVIF images, but their
 * Canvas 2D `toBlob` / `toDataURL` implementations do not support encoding
 * `image/avif`. When native Canvas AVIF encoding is unavailable, we lazily load
 * `@jsquash/avif` from esm.sh on first use so AVIF requests still produce real
 * `.avif` files.
 */

const JSQUASH_AVIF_URL = "https://esm.sh/@jsquash/avif@1.3.0";

type AvifEncodeFn = (
  data: ImageData,
  options?: { cqLevel?: number; speed?: number },
) => Promise<ArrayBuffer>;

let _encodePromise: Promise<AvifEncodeFn> | null = null;
let _encoderOverrideForTesting: AvifEncodeFn | null = null;

/** Test-only injection hook for offline encodeAvifWasm unit tests. */
export function setAvifEncoderForTesting(fn: AvifEncodeFn | null): void {
  _encoderOverrideForTesting = fn;
}

/** Map unit quality (0.01–0.99) to @jsquash/avif's 1–100 integer scale. */
export function avifQualityFromUnit(q: number): number {
  const clamped = Number.isFinite(q) ? Math.max(0.01, Math.min(0.99, q)) : 0.7;
  return Math.max(1, Math.min(100, Math.round(clamped * 100)));
}

/**
 * Map unit quality (0.01–0.99) to libavif's cqLevel quantizer (0–63 range).
 * Lower cqLevel means higher visual quality: 0.99 → 1, 0.70 → 19, 0.01 → 62.
 */
export function avifCqLevelFromUnit(q: number): number {
  const clamped = Number.isFinite(q) ? Math.max(0.01, Math.min(0.99, q)) : 0.7;
  return Math.max(0, Math.min(63, Math.round((1 - clamped) * 63)));
}

async function loadAvifEncoder(): Promise<AvifEncodeFn> {
  if (!_encodePromise) {
    _encodePromise = import(/* @vite-ignore */ JSQUASH_AVIF_URL)
      .then((mod) => {
        const fn = (mod?.encode ?? mod?.default?.encode) as AvifEncodeFn | undefined;
        if (typeof fn !== "function") {
          throw new Error("AVIF WASM module did not export encode()");
        }
        return fn;
      })
      .catch((err) => {
        _encodePromise = null;
        throw err;
      });
  }
  return _encodePromise;
}

/** Encode raw RGBA ImageData into an `image/avif` Blob via WebAssembly. */
export async function encodeAvifWasm(
  imageData: ImageData,
  qualityUnit: number,
): Promise<Blob> {
  const encodeFn = _encoderOverrideForTesting ?? (await loadAvifEncoder());
  const cqLevel = avifCqLevelFromUnit(qualityUnit);
  // speed: 6 balances encoding throughput and compression efficiency for batches.
  const buffer = await encodeFn(imageData, { cqLevel, speed: 6 });
  return new Blob([buffer], { type: "image/avif" });
}
