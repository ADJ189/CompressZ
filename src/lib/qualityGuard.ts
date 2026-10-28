/**
 * qualityGuard.ts — pure scale + SSIM guard for image compression.
 *
 * Two rules matter here:
 *   1. Never upscale. A requested max dimension is a ceiling, not a target.
 *   2. Never silently lower the user's requested quality or resolution to hit
 *      a size target. If the encoded result measures poorly, the guard either
 *      asks for one higher-quality retry (when no size target is active) or
 *      reports a warning that the caller surfaces in the result metadata.
 *
 * SSIM is measured on a small (≤96×96) luma sample, not the full image, so it
 * is cheap enough to run per file. The sampling grid is identical for source
 * and output, which keeps the comparison meaningful without retaining another
 * full-resolution bitmap.
 *
 * This module is intentionally dependency-free and DOM-free so it runs in
 * Node tests under Playwright.
 */

export interface Size {
  width: number;
  height: number;
}

export interface PlannedSize extends Size {
  /** True only when the source was downscaled. */
  resized: boolean;
  /** Applied scale in (0, 1]. 1 means the source size was kept. */
  scale: number;
}

/**
 * Plan output dimensions, clamped independently by width and height.
 * Returns the source size unchanged rather than upscaling when either limit
 * is larger than the source.
 */
export function planOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth?: number,
  maxHeight?: number,
): PlannedSize {
  const w = Math.max(1, Math.round(sourceWidth));
  const h = Math.max(1, Math.round(sourceHeight));
  const mw = maxWidth && maxWidth > 0 ? maxWidth : Infinity;
  const mh = maxHeight && maxHeight > 0 ? maxHeight : Infinity;
  const scale = Math.min(1, mw / w, mh / h);
  if (scale >= 1) return { width: w, height: h, resized: false, scale: 1 };
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    resized: true,
    scale,
  };
}

/**
 * Sample RGBA pixels to a small luma grid. Uses nearest-neighbour sampling at
 * a fixed relative grid, so the source and the decoded output produce arrays
 * of the same length. Never allocates a second full-resolution buffer.
 */
export function sampleLuma(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  maxSide = 96,
): Float32Array {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / sh));
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / sw));
      const i = (sy * w + sx) * 4;
      out[y * sw + x] =
        0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    }
  }
  return out;
}

const SSIM_C1 = (0.01 * 255) ** 2;
const SSIM_C2 = (0.03 * 255) ** 2;

/**
 * Global SSIM over two equal-length luma arrays. Returns 1 for identical
 * arrays (including flat black/white images) and a value near 0 for unrelated
 * images. Invalid/empty input returns 0 rather than pretending to be perfect.
 */
export function computeSsim(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const n = a.length;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= n;
  varB /= n;
  cov /= n;

  const numerator = (2 * meanA * meanB + SSIM_C1) * (2 * cov + SSIM_C2);
  const denominator =
    (meanA * meanA + meanB * meanB + SSIM_C1) * (varA + varB + SSIM_C2);
  if (denominator === 0) return 1;
  const value = numerator / denominator;
  return Math.max(-1, Math.min(1, value));
}

export const SSIM_FLOOR = 0.9;

export type QualityGuardCode =
  | "resolution-lost"
  | "target-size-quality"
  | "low-ssim";

export type QualityGuardDecision =
  | { action: "ok"; reason?: undefined }
  | { action: "retry"; quality: number; reason: string }
  | { action: "warn"; code: QualityGuardCode; reason: string };

export interface QualityGuardInput {
  /** MIME type of the encoded image. PNG is lossless and skipped. */
  format: string;
  ssim: number;
  requestedQuality?: number;
  targetSizeKB?: number;
  /** Dimensions requested after the max-width/height clamp. */
  planned: Size;
  /** Dimensions actually decoded from the encoded blob. */
  actual: Size;
  /** True after the one allowed higher-quality retry. */
  alreadyRetried?: boolean;
}

/**
 * Decide what to do after measuring an encoded image.
 *
 * - Resolution loss is always a warning; this function never returns a
 *   "downscale to fix it" action.
 * - Target-size mode cannot raise quality without missing the user's byte
 *   target, so low SSIM is reported instead of silently rewritten.
 * - Aggressive quality requests (<0.70) are allowed to look soft; the guard
 *   does not second-guess an explicit choice.
 * - Otherwise, one retry at a higher quality (never lower than requested) is
 *   requested. The caller measures again and turns a still-low result into a
 *   warning.
 */
export function decideQualityGuard(
  input: QualityGuardInput,
): QualityGuardDecision {
  if (
    input.actual.width < input.planned.width ||
    input.actual.height < input.planned.height
  ) {
    return {
      action: "warn",
      code: "resolution-lost",
      reason: `Encoded size ${input.actual.width}×${input.actual.height} is smaller than the planned ${input.planned.width}×${input.planned.height}; resolution was not silently changed.`,
    };
  }

  if (input.format === "image/png") return { action: "ok" };

  if (input.ssim >= SSIM_FLOOR) return { action: "ok" };

  if (input.targetSizeKB && input.targetSizeKB > 0) {
    return {
      action: "warn",
      code: "target-size-quality",
      reason: `SSIM ${input.ssim.toFixed(2)} is low because the file is being held to a target size; quality was not silently changed.`,
    };
  }

  const requested = input.requestedQuality ?? 0.82;
  if (requested < 0.7) return { action: "ok" };

  if (input.alreadyRetried) {
    return {
      action: "warn",
      code: "low-ssim",
      reason: `SSIM ${input.ssim.toFixed(2)} is still below ${SSIM_FLOOR} after a higher-quality retry.`,
    };
  }

  const next = Math.min(0.98, Math.max(0.9, requested + 0.08));
  if (next <= requested + 0.001) {
    return {
      action: "warn",
      code: "low-ssim",
      reason: `SSIM ${input.ssim.toFixed(2)} is below ${SSIM_FLOOR} at the maximum requested quality.`,
    };
  }

  return {
    action: "retry",
    quality: next,
    reason: `SSIM ${input.ssim.toFixed(2)} is below ${SSIM_FLOOR}; retrying once at quality ${next.toFixed(2)}.`,
  };
}
