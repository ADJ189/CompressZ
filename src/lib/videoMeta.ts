/**
 * videoMeta.ts — shared video metadata + output-size planning.
 *
 * Kept separate from compressVideo.ts so the pure size planner can be tested
 * in Node (Playwright's pure specs import engine modules directly) without
 * pulling in the FFmpeg/Mediabunny engine code. The DOM probe is only called
 * from browser code.
 */

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

export interface PlannedVideoSize {
  width: number;
  height: number;
  /** True only when the source was downscaled. Never true for an upscale. */
  resized: boolean;
  /** Applied scale in (0, 1]. 1 means the source size was kept. */
  scale: number;
}

/** Round down to an even dimension; most 4:2:0 video encoders require it and we must never enlarge or exceed caps. */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/**
 * Plan a video output size from an optional maximum width.
 *
 * Ensures dimensions are even numbers without upscaling or exceeding maxWidth caps.
 * An unscaled source with odd dimensions is safely rounded down with resized=true.
 */
export function planVideoSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth?: number,
): PlannedVideoSize {
  const w = Math.max(1, Math.round(sourceWidth));
  const h = Math.max(1, Math.round(sourceHeight));

  const cap = maxWidth && maxWidth > 0 ? even(maxWidth) : undefined;

  if (!cap || cap >= w) {
    const targetW = even(w);
    const targetH = even(h);
    const resized = targetW !== w || targetH !== h;
    const scale = resized ? targetW / w : 1;
    return { width: targetW, height: targetH, resized, scale };
  }

  const scale = cap / w;
  const targetW = cap;
  const targetH = even(h * scale);
  return {
    width: targetW,
    height: targetH,
    resized: true,
    scale,
  };
}

/** Resolve display dimensions + duration from a video element. */
export function getVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const duration = Number.isFinite(v.duration) ? v.duration : 30;
      resolve({
        width: v.videoWidth || 1280,
        height: v.videoHeight || 720,
        duration: duration > 0 ? duration : 30,
      });
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Cannot read video metadata"));
    };
  });
}
