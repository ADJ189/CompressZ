/**
 * options.ts — UI state → engine option mapping.
 *
 * Every routed view (Images, PDF, Video, Audio, GIF, Images → PDF, Convert)
 * stores human-facing values (quality as a 0–100 percentage, a page-size id,
 * bitrate in kbps) while the engines in `src/lib/` consume a different
 * vocabulary (`quality` 0–1, `maxWidth`/`maxHeight`, `{ w, h }` page points,
 * `audioFormat`, …). Those mappings used to be copied into each route by
 * hand — and silently drifted, which is how Images → PDF ended up passing
 * `pageSize: "auto"` into a function that expected `{ w, h }`.
 *
 * These builders are the single source of truth for that translation. They
 * are pure, dependency-free TypeScript so the Deno unit suite can assert the
 * contract without a DOM or a browser.
 */
import type {
  AudioFormat,
  CompressOptions,
  ImageFormat,
  PdfLevel,
  VideoCodec,
} from "./types";
import type { ImagesToPdfOptions } from "./imagesToPdf";

export type PageSizeId = "auto" | "a4" | "letter";

export interface PdfPageSize {
  w: number;
  h: number;
}

/** ISO A4 / US Letter in PDF points (1/72 inch). */
export const PDF_PAGE_SIZES: Record<Exclude<PageSizeId, "auto">, PdfPageSize> = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
};

/** Resolve the UI's page-size id to PDF points; `auto` means "match image". */
export function pdfPageSize(id: PageSizeId): PdfPageSize | undefined {
  return id === "auto" ? undefined : PDF_PAGE_SIZES[id];
}

/** Convert a 0–100 UI percentage to the engines' clamped 0.01–0.99 range. */
export function qualityToUnit(percentage: number, fallback = 0.82): number {
  const n = Number.isFinite(percentage) ? percentage / 100 : fallback;
  return Math.max(0.01, Math.min(0.99, n));
}

// ── Images ────────────────────────────────────────────────────

export interface ImageOptionState {
  quality: number;
  format: ImageFormat;
  maxDim?: number;
  mode?: "quality" | "targetSize";
  targetSizeKB?: number;
}

export function imageOptions(state: ImageOptionState): CompressOptions {
  const options: CompressOptions = {
    format: state.format,
    quality: qualityToUnit(state.quality),
  };
  const cap = state.maxDim && state.maxDim > 0 ? Math.round(state.maxDim) : 0;
  if (cap > 0) {
    options.maxWidth = cap;
    options.maxHeight = cap;
  }
  if (
    state.mode === "targetSize" &&
    state.targetSizeKB &&
    state.targetSizeKB > 0
  ) {
    options.targetSizeKB = Math.round(state.targetSizeKB);
    delete options.quality;
  }
  return options;
}

// ── Audio ─────────────────────────────────────────────────────

export interface AudioOptionState {
  fmt: AudioFormat;
  bitrate?: number;
  sampleRate?: number;
  stripMeta?: boolean;
  passthrough?: boolean;
}

export function audioOptions(state: AudioOptionState): CompressOptions {
  const options: CompressOptions = { audioFormat: state.fmt };
  if (state.bitrate && state.bitrate > 0) {
    options.audioBitrate = Math.round(state.bitrate);
  }
  if (state.sampleRate && state.sampleRate > 0) {
    options.audioSampleRate = Math.round(state.sampleRate);
  }
  if (state.stripMeta) options.stripMetadata = true;
  if (state.passthrough) options.audioPassthrough = true;
  return options;
}

// ── Video ─────────────────────────────────────────────────────

export interface VideoOptionState {
  mode: "crf" | "bitrate" | "targetSize";
  crfQuality: number;
  bitrate: number;
  targetSizeMB: number;
  codec: VideoCodec;
  preset: "ultrafast" | "fast" | "medium" | "slow";
  maxWidth?: number;
  fps?: number;
  tenBit?: boolean;
  proxy?: boolean;
  audioPassthrough?: boolean;
  twoPass?: boolean;
  audioTrackMode?: "first" | "all";
  audioDownmix?: boolean;
  subtitleMode?: "none" | "all";
}

export function videoOptions(state: VideoOptionState): CompressOptions {
  const options: CompressOptions = {
    videoCodec: state.codec,
    videoPreset: state.preset,
  };

  if (state.mode === "crf") {
    options.quality = qualityToUnit(state.crfQuality, 0.75);
  } else if (state.mode === "bitrate" && state.bitrate > 0) {
    options.videoBitrate = Math.round(state.bitrate * 1000);
  } else if (state.mode === "targetSize" && state.targetSizeMB > 0) {
    options.targetSizeKB = Math.round(state.targetSizeMB * 1024);
  }

  if (state.maxWidth && state.maxWidth > 0) {
    options.maxWidth = Math.round(state.maxWidth);
  }
  if (state.fps && state.fps > 0) options.fps = Math.round(state.fps);

  const tenBitCapable = state.codec === "h265" || state.codec === "av1";
  if (state.tenBit && tenBitCapable) options.videoTenBit = true;
  if (state.proxy) options.videoProxy = true;
  if (state.mode !== "crf" && state.twoPass) options.videoTwoPass = true;
  if (state.audioPassthrough) options.audioPassthrough = true;
  if (state.audioTrackMode === "all") options.audioTrackMode = "all";
  if (state.audioDownmix && !state.audioPassthrough) {
    options.audioDownmixStereo = true;
  }
  if (state.subtitleMode === "all") options.subtitleMode = "all";

  return options;
}

// ── PDF ───────────────────────────────────────────────────────

export interface PdfOptionState {
  level: PdfLevel;
  stripMeta?: "auto" | "on" | "off";
  targetSizeKB?: number;
}

export function pdfOptions(state: PdfOptionState): CompressOptions {
  const options: CompressOptions = { pdfCompressionLevel: state.level };
  if (state.targetSizeKB && state.targetSizeKB > 0) {
    options.targetSizeKB = Math.round(state.targetSizeKB);
  }
  if (state.stripMeta === "on") options.stripMetadata = true;
  else if (state.stripMeta === "off") options.stripMetadata = false;
  // "auto" leaves stripMetadata undefined so the preset default applies.
  return options;
}

// ── GIF ───────────────────────────────────────────────────────

export interface GifOptionState {
  quality: number;
  gifToVideo?: boolean;
  maxWidth?: number;
  fps?: number;
}

export function gifOptions(state: GifOptionState): CompressOptions {
  const options: CompressOptions = {
    quality: qualityToUnit(state.quality),
    gifToVideo: Boolean(state.gifToVideo),
  };
  if (state.maxWidth && state.maxWidth > 0) {
    options.maxWidth = Math.round(state.maxWidth);
  }
  if (state.fps && state.fps > 0) options.fps = Math.round(state.fps);
  return options;
}

// ── Images → PDF ──────────────────────────────────────────────

export interface ImagesToPdfOptionState {
  pageSize: PageSizeId;
  quality: number;
  maxDim?: number;
}

export function imagesToPdfOptions(
  state: ImagesToPdfOptionState,
): ImagesToPdfOptions {
  const options: ImagesToPdfOptions = {
    quality: qualityToUnit(state.quality),
  };
  const page = pdfPageSize(state.pageSize);
  if (page) options.pageSize = page;
  if (state.maxDim && state.maxDim > 0) {
    options.maxDim = Math.round(state.maxDim);
  }
  return options;
}
