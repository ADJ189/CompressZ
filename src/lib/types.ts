// ── Types ─────────────────────────────────────────────────────

export type FileType =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "gif"
  | "svg"
  | "unknown";
export type ImageFormat =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/avif";
export type AudioFormat = "mp3" | "aac" | "ogg" | "opus" | "flac" | "wav";
export type VideoCodec = "h264" | "h265" | "vp9" | "vp8" | "av1";
export type PdfLevel = "low" | "recommended" | "extreme";

export interface CompressOptions {
  // Image
  quality?: number;
  targetSizeKB?: number;
  format?: ImageFormat;
  maxWidth?: number;
  maxHeight?: number;
  stripMetadata?: boolean;
  // Video
  videoBitrate?: number;
  videoCodec?: VideoCodec;
  videoPreset?: "ultrafast" | "fast" | "medium" | "slow";
  fps?: number;
  videoTenBit?: boolean; // 10-bit (yuv420p10le) — only meaningful for h265/av1
  videoProxy?: boolean; // edit proxy: all-intra (GOP=1), locked fps, small size
  videoTwoPass?: boolean; // 2-pass encode — only applies when a bitrate target is set (bitrate/targetSize mode)
  // Audio
  audioFormat?: AudioFormat;
  audioBitrate?: number;
  audioSampleRate?: number;
  audioPassthrough?: boolean; // remux only (-c:a copy) — preserves lossless/surround tracks untouched
  audioTrackMode?: "first" | "all"; // video only: keep just the default audio track, or every audio track present
  audioDownmixStereo?: boolean; // video only: force included (transcoded, not copied) tracks to stereo
  subtitleMode?: "none" | "all"; // video only: drop subtitles, or passthrough every subtitle track (no burn-in)
  // PDF
  pdfCompressionLevel?: PdfLevel;
  pdfRenderScale?: number;
  // GIF
  gifToVideo?: boolean;
}

export interface CompressResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  format: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface FileEntry {
  id: string;
  file: File;
  name: string;
  originalSize: number;
  type: FileType;
  status: "idle" | "compressing" | "done" | "error";
  progress?: number;
  result?: CompressResult;
  compressedBlob?: Blob;
  compressedSize?: number;
  thumbUrl?: string;
  error?: string;
  options?: CompressOptions;
  aiLabel?: string; // set by the local AI engine's "Smart Analyze" (see lib/aiEngine.ts) — undefined until run
}

// ── Helpers ───────────────────────────────────────────────────

/** Cryptographically strong random base-36 string of `len` characters. */
export function randomToken(len: number): string {
  let out = "";
  const buf = new Uint8Array(len * 2);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    // Reject bytes >= 252 (252 = 36 * 7) so every symbol is equally likely.
    for (const b of buf) {
      if (b < 252 && out.length < len) out += (b % 36).toString(36);
    }
  }
  return out;
}

export function uid(): string {
  return randomToken(8);
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(Math.max(0, decimals)))} ${sizes[i]}`;
}

export function detectFileType(file: File): FileType {
  const mime = file.type.toLowerCase();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (mime === "image/gif" || ext === "gif") return "gif";
  if (mime === "image/svg+xml" || ext === "svg") return "svg";
  if (
    mime.startsWith("image/") ||
    [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "avif",
      "bmp",
      "tiff",
      "tif",
      "heic",
      "heif",
      "ico",
    ].includes(ext)
  )
    return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mime.startsWith("video/") ||
    [
      "mp4",
      "webm",
      "mov",
      "avi",
      "mkv",
      "m4v",
      "flv",
      "wmv",
      "ogv",
      "3gp",
    ].includes(ext)
  )
    return "video";
  if (
    mime.startsWith("audio/") ||
    [
      "mp3",
      "aac",
      "ogg",
      "opus",
      "flac",
      "wav",
      "m4a",
      "wma",
      "aiff",
      "aif",
    ].includes(ext)
  )
    return "audio";
  return "unknown";
}

export function getOutputExtension(result: CompressResult): string {
  // Primary: derive from the actual blob MIME type — always authoritative.
  const detected = extensionForMime(result.blob.type);
  if (detected) return detected;

  // Fallback: parse the human-readable format string (lower-cased).
  const fmt = result.format.toLowerCase();
  if (fmt.includes("webp")) return "webp";
  if (fmt.includes("jpeg") || fmt.includes("jpg")) return "jpg";
  if (fmt.includes("png")) return "png";
  if (fmt.includes("avif")) return "avif";
  if (fmt.includes("pdf")) return "pdf";
  if (fmt.includes("webm")) return "webm";
  if (fmt.includes("mp4")) return "mp4";
  if (fmt.includes("mp3")) return "mp3";
  if (fmt.includes("aac")) return "m4a";
  if (fmt.includes("opus")) return "opus";
  if (fmt.includes("flac")) return "flac";
  if (fmt.includes("wav")) return "wav";
  if (fmt.includes("ogg")) return "ogg";
  if (fmt.includes("gif")) return "gif";
  if (fmt.includes("svg")) return "svg";
  return "bin";
}

/**
 * Map a MIME type to a safe file extension. Returns null when the type is
 * empty or unrecognised so callers can fall back to a requested format.
 * Parameter suffixes (`audio/ogg; codecs=opus`) are ignored.
 */
export function extensionForMime(type: string): string | null {
  const mime = type.toLowerCase().split(";")[0].trim();
  switch (mime) {
    case "image/webp": return "webp";
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/avif": return "avif";
    case "image/gif": return "gif";
    case "image/svg+xml": return "svg";
    case "image/bmp": return "bmp";
    case "application/pdf": return "pdf";
    case "application/zip":
    case "application/x-zip-compressed": return "zip";
    case "text/plain": return "txt";
    case "text/html": return "html";
    case "text/markdown": return "md";
    case "video/webm": return "webm";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/x-matroska": return "mkv";
    case "video/x-msvideo": return "avi";
    case "audio/mpeg": return "mp3";
    case "audio/mp4": return "m4a"; // AAC in an MP4 container
    case "audio/opus": return "opus";
    case "audio/flac": return "flac";
    case "audio/wav":
    case "audio/x-wav": return "wav";
    case "audio/ogg": return "ogg";
    case "audio/x-matroska": return "mka";
    default: return null;
  }
}

/**
 * Build a download filename from the *actual* output blob, not the format the
 * user asked for. Canvas encoders can fall back (AVIF → WebP), GIF conversion
 * writes WebM, and MP4 containers carry AAC — trusting the request would
 * mislabel the bytes. `fallbackExt` is used only when the blob type is opaque.
 */
export function outputFilename(
  originalName: string,
  blob: Blob,
  opts: { suffix?: string; fallbackExt?: string } = {},
): string {
  const base = originalName.replace(/\.[^/.]+$/, "") || "file";
  const ext =
    extensionForMime(blob.type) ??
    (opts.fallbackExt ? opts.fallbackExt.replace(/^\./, "") : "bin");
  return `${base}${opts.suffix ?? ""}.${ext}`;
}
