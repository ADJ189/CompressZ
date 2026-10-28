/**
 * webcodecsVideo.ts — capability-gated WebCodecs video route.
 *
 * WebCodecs encodes/decodes chunks but does not mux a container. This module
 * deliberately does not concatenate NAL units (the earlier prototype did, and
 * produced files no player could open). It uses Mediabunny as the demuxer /
 * muxer / conversion pipeline, and only takes the route when the exact output
 * codec configuration is reported as encodable by this browser.
 *
 * Routing rules (also covered by pure tests in e2e/engines.spec.ts):
 *   • MP4/AVC, HEVC, AV1; WebM/VP8, VP9; AAC for MP4; Opus for WebM.
 *   • No 10-bit, edit-proxy, two-pass, audio passthrough, multi-audio or
 *     subtitle passthrough requests — those keep the FFmpeg.wasm semantics.
 *   • Any unreadable/undecodable track, discarded audio track or unsupported
 *     encoder returns null so compressVideo.ts falls back automatically.
 *
 * Mediabunny is a lazy CDN import (the same pattern as FFmpeg.wasm, PDF.js and
 * the OCR engines), so it adds nothing to the initial bundle and is never
 * fetched on browsers without WebCodecs. No file bytes are sent to the CDN.
 */

import type { CompressOptions, CompressResult, VideoCodec } from "./types";
import { getVideoMeta, planVideoSize, type VideoMeta } from "./videoMeta";

const MEDIABUNNY_CDN = "https://esm.sh/mediabunny@1.62.1";

const AAC_BPS = 128_000;
const OPUS_BPS = 96_000;

export type WebCodecsContainer = "mp4" | "webm";
export type WebCodecsVideoCodec = "avc" | "hevc" | "vp8" | "vp9" | "av1";
export type WebCodecsAudioCodec = "aac" | "opus";

export interface WebCodecsRoute {
  container: WebCodecsContainer;
  mime: "video/mp4" | "video/webm";
  videoCodec: WebCodecsVideoCodec;
  audioCodec: WebCodecsAudioCodec;
}

const ROUTES: Record<VideoCodec, WebCodecsRoute> = {
  h264: {
    container: "mp4",
    mime: "video/mp4",
    videoCodec: "avc",
    audioCodec: "aac",
  },
  h265: {
    container: "mp4",
    mime: "video/mp4",
    videoCodec: "hevc",
    audioCodec: "aac",
  },
  av1: {
    container: "mp4",
    mime: "video/mp4",
    videoCodec: "av1",
    audioCodec: "aac",
  },
  vp9: {
    container: "webm",
    mime: "video/webm",
    videoCodec: "vp9",
    audioCodec: "opus",
  },
  vp8: {
    container: "webm",
    mime: "video/webm",
    videoCodec: "vp8",
    audioCodec: "opus",
  },
};

/**
 * Decide whether a request is simple enough for the browser-native route.
 * Pure and browser-free so it runs in Node tests.
 */
export function webCodecsRouteFor(
  options: CompressOptions,
): WebCodecsRoute | null {
  if (options.videoTenBit) return null;
  if (options.videoProxy) return null;
  if (options.videoTwoPass) return null;
  if (options.audioPassthrough) return null;
  if (options.audioTrackMode === "all") return null;
  if (options.subtitleMode === "all") return null;
  // Mediabunny/WebCodecs exposes no encoder-speed preset. `"fast"` is the
  // app default, so treating it as "no preference" is honest; an explicit
  // ultrafast/medium/slow choice must reach FFmpeg, which actually applies it.
  if (options.videoPreset && options.videoPreset !== "fast") return null;
  return ROUTES[options.videoCodec ?? "h264"] ?? null;
}

/** Audio bitrate reserved out of a target-size budget for this container. */
export function audioBitrateFor(route: WebCodecsRoute): number {
  return route.audioCodec === "opus" ? OPUS_BPS : AAC_BPS;
}

/**
 * Explicit video bitrate for bitrate/target-size modes, or null for quality
 * (CRF-like) mode. Target-size math mirrors the FFmpeg path: subtract the
 * encoded audio track and ~2% container overhead before budgeting video.
 */
export function videoBitrateFor(
  options: CompressOptions,
  durationSec: number,
  route: WebCodecsRoute,
  hasAudio = true,
): number | null {
  if (options.videoBitrate && options.videoBitrate > 0) {
    return Math.round(options.videoBitrate);
  }
  if (options.targetSizeKB && options.targetSizeKB > 0) {
    const duration = Math.max(1, durationSec || 1);
    const total = (options.targetSizeKB * 1024 * 8) / duration;
    const audio = hasAudio ? audioBitrateFor(route) : 0;
    const overhead = total * 0.02;
    return Math.max(32_000, Math.round(total - audio - overhead));
  }
  return null;
}

/** Clamp the UI's 0–100 quality to Mediabunny's 0–1 Quality scale. */
export function webCodecsQuality(options: CompressOptions): number {
  return Math.min(0.99, Math.max(0.01, options.quality ?? 0.75));
}

export function webCodecsRouteLabel(route: WebCodecsRoute): string {
  return `${route.mime} · WebCodecs / Mediabunny`;
}

// ── Minimal structural types for the lazily imported Mediabunny API ──────
// We intentionally do not add Mediabunny to package.json: the project loads
// heavy engines from CDNs at first use. These interfaces describe only the
// small surface this module touches, so TypeScript stays useful without
// pulling the whole library's declarations into the build.
interface MbInput {
  canRead(): Promise<boolean>;
  getPrimaryVideoTrack(): Promise<MbVideoTrack | null>;
  getAudioTracks(): Promise<MbAudioTrack[]>;
  dispose(): void;
}

interface MbTrack {
  readonly type: "video" | "audio" | "subtitle";
  canDecode(): Promise<boolean>;
}

interface MbVideoTrack extends MbTrack {
  readonly type: "video";
}

interface MbAudioTrack extends MbTrack {
  readonly type: "audio";
}

interface MbOutput {
  target: { buffer: ArrayBuffer | null };
  cancel(): Promise<void>;
}

interface MbConversion {
  readonly isValid: boolean;
  readonly discardedTracks: {
    track: MbTrack;
    reason: string;
  }[];
  readonly utilizedTracks: { type: string }[];
  onProgress: ((progress: number) => void) | null;
  execute(): Promise<void>;
  cancel(): Promise<void>;
}

interface MbConversionInit {
  input: MbInput;
  output: MbOutput;
  video?: Record<string, unknown>;
  audio?: Record<string, unknown>;
  tracks?: "primary" | "all";
  copy?: boolean;
}

interface MediabunnyModule {
  Input: new (options: { formats: unknown; source: unknown }) => MbInput;
  BlobSource: new (blob: Blob) => unknown;
  ALL_FORMATS: unknown;
  Output: new (options: { format: unknown; target: unknown }) => MbOutput;
  Mp4OutputFormat: new (options?: {
    fastStart?: false | "in-memory" | "reserve" | "fragmented";
  }) => unknown;
  WebMOutputFormat: new (options?: Record<string, unknown>) => unknown;
  BufferTarget: new () => unknown;
  Conversion: { init(options: MbConversionInit): Promise<MbConversion> };
  Quality: new (
    value: number | string | { bitrate?: number; quantizer?: number },
  ) => unknown;
  canEncodeVideo(codec: string, config?: Record<string, unknown>): Promise<boolean>;
  canEncodeAudio(codec: string, config?: Record<string, unknown>): Promise<boolean>;
}

let _module: Promise<MediabunnyModule> | null = null;

function loadMediabunny(): Promise<MediabunnyModule> {
  if (!_module) {
    const pending = import(/* @vite-ignore */ MEDIABUNNY_CDN).then(
      (mod) => mod as MediabunnyModule,
    );
    _module = pending;
    // A transient CDN/network failure must not poison the rest of the session.
    pending.catch(() => {
      if (_module === pending) _module = null;
    });
  }
  return _module;
}

/**
 * Try the WebCodecs/Mediabunny route. Returns null when the request or the
 * browser is not eligible (caller falls through to FFmpeg), and throws only
 * when an eligible conversion was attempted and failed (caller still falls
 * through, but logs the error).
 */
export async function videoViaWebCodecs(
  file: File,
  options: CompressOptions,
  onProgress?: (pct: number) => void,
  precomputedMeta?: VideoMeta,
): Promise<CompressResult | null> {
  const route = webCodecsRouteFor(options);
  if (!route) return null;
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoDecoder === "undefined"
  ) {
    return null;
  }

  const meta = precomputedMeta ?? (await getVideoMeta(file));
  const size = planVideoSize(meta.width, meta.height, options.maxWidth);

  onProgress?.(3);
  const mb = await loadMediabunny();

  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: new mb.BlobSource(file),
  });

  let output: MbOutput | null = null;
  let conversion: MbConversion | null = null;
  let completed = false;

  try {
    if (!(await input.canRead())) return null;

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack || !(await videoTrack.canDecode())) return null;

    const audioTracks = await input.getAudioTracks();
    const hasAudio = audioTracks.length > 0;
    if (hasAudio && !(await audioTracks[0].canDecode())) return null;

    // The input's track list — not an assumption — decides whether the
    // target-size budget has to reserve room for an audio stream.
    const bitrate = videoBitrateFor(options, meta.duration, route, hasAudio);
    // Mediabunny's encoder options take a `Quality` instance, not a raw number
    // or a bare `{ bitrate }` object. A number is quality mode (0–1); an object
    // is explicit bitrate mode.
    const qualityValue =
      bitrate === null ? webCodecsQuality(options) : { bitrate };
    const quality = new mb.Quality(qualityValue);

    // Probe the exact output configuration before allocating the output.
    // These are the same settings Conversion will use below.
    const videoProbe: Record<string, unknown> = {
      width: size.width,
      height: size.height,
      quality,
    };
    if (options.fps && options.fps > 0) videoProbe.frameRate = options.fps;
    if (!(await mb.canEncodeVideo(route.videoCodec, videoProbe))) return null;

    const audioQuality = new mb.Quality({ bitrate: audioBitrateFor(route) });
    if (
      hasAudio &&
      !(await mb.canEncodeAudio(route.audioCodec, {
        quality: audioQuality,
        ...(options.audioDownmixStereo ? { numberOfChannels: 2 } : {}),
      }))
    ) {
      return null;
    }

    const format =
      route.container === "webm"
        ? new mb.WebMOutputFormat()
        : new mb.Mp4OutputFormat({ fastStart: "in-memory" });
    output = new mb.Output({
      format,
      target: new mb.BufferTarget(),
    });

    const videoOptions: Record<string, unknown> = {
      codec: route.videoCodec,
      quality,
      hardwareAcceleration: "no-preference",
    };
    if (size.resized) videoOptions.width = size.width;
    if (options.fps && options.fps > 0) videoOptions.frameRate = options.fps;

    const audioOptions: Record<string, unknown> = hasAudio
      ? {
          codec: route.audioCodec,
          quality: audioQuality,
          ...(options.audioDownmixStereo ? { numberOfChannels: 2 } : {}),
        }
      : { discard: true };

    conversion = await mb.Conversion.init({
      input,
      output,
      video: videoOptions,
      audio: audioOptions,
      tracks: "primary",
      // Always transcode: quality/bitrate is a user request, not a remux.
      copy: false,
    });

    if (!conversion.isValid) return null;

    const used = new Set(conversion.utilizedTracks.map((track) => track.type));
    if (!used.has("video")) return null;
    if (hasAudio && !used.has("audio")) return null;
    // Never silently drop the audio track because the chosen audio codec was
    // unavailable — fall back to FFmpeg, which can encode it.
    if (
      conversion.discardedTracks.some(
        (entry) =>
          entry.track.type === "video" ||
          (hasAudio && entry.track.type === "audio"),
      )
    ) {
      return null;
    }

    conversion.onProgress = (progress) => {
      onProgress?.(3 + Math.round(progress * 92));
    };
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("Mediabunny produced an empty video file");
    }

    const blob = new Blob([buffer], { type: route.mime });
    onProgress?.(100);
    completed = true;
    return {
      blob,
      originalSize: file.size,
      compressedSize: blob.size,
      compressionRatio: file.size / blob.size,
      format: webCodecsRouteLabel(route),
      width: size.width,
      height: size.height,
      duration: meta.duration,
    };
  } finally {
    if (!completed) {
      try {
        await conversion?.cancel();
      } catch {
        /* already finalized or never started */
      }
      try {
        await output?.cancel();
      } catch {
        /* already finalized or never started */
      }
    }
    try {
      input.dispose();
    } catch {
      /* disposal is best-effort */
    }
  }
}
