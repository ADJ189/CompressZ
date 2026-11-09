/**
 * convertMedia.ts — video/audio *format* conversion for the Convert page.
 *
 * This is deliberately separate from compressVideo.ts / compressAudio.ts:
 * those optimise for smallest file size at acceptable quality, hardcode
 * MP4 as the only video output container, and expose a lot of size/bitrate
 * controls that don't make sense for a "just change the container/codec"
 * tool. convertVideo() here is container-aware (mp4/webm/mov/mkv/avi/gif)
 * and defaults to a near-lossless quality tier instead of an aggressive
 * compression tier. Audio conversion is already fully format-parameterised
 * in compressAudio.ts, so it's reused directly with a high-quality bitrate.
 */
import { getFFmpeg, ffFetch, ffJob, setProgressHandler } from "./ffmpeg";

export type VideoContainer = "mp4" | "webm" | "mov" | "mkv" | "avi" | "gif";

export interface ConvertVideoOptions {
  crf?: number; // 18 (visually lossless), 23 (balanced), 28 (small file)
  resolution?: "original" | "1080p" | "720p" | "480p";
  fps?: number; // 0 (original), 60, 30, 24
  muteAudio?: boolean;
  fastStart?: boolean;
  stripMetadata?: boolean;
  audioBitrate?: string; // "320k", "192k", "128k", "96k"
}

const VIDEO_MIME: Record<VideoContainer, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  gif: "image/gif",
};

export interface ConvertResult {
  blob: Blob;
  originalSize: number;
  convertedSize: number;
  format: string;
}

export function convertVideo(
  file: File,
  target: VideoContainer,
  options?: ConvertVideoOptions,
  onProgress?: (pct: number) => void,
): Promise<ConvertResult> {
  return ffJob(() => runConvertVideo(file, target, options, onProgress));
}

async function runConvertVideo(
  file: File,
  target: VideoContainer,
  options?: ConvertVideoOptions,
  onProgress?: (pct: number) => void,
): Promise<ConvertResult> {
  const ff = (await getFFmpeg()) as any;
  onProgress?.(4);
  setProgressHandler(ff, ({ progress }) =>
    onProgress?.(4 + Math.round(progress * 90)),
  );

  const ext = file.name.match(/\.[^.]+$/)?.[0] ?? ".mp4";
  const inN = `cvin${ext}`;
  await ff.writeFile(inN, await ffFetch(file));

  let outN: string;
  let fmtLabel: string;

  try {
    if (target === "gif") {
      outN = "cvout.gif";
      const fps = options?.fps && options.fps > 0 ? options.fps : 12;
      const scale = options?.resolution === "480p" ? 480 : 720;
      await ff.exec([
        "-i",
        inN,
        "-vf",
        `fps=${fps},scale=${scale}:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff`,
        "-y",
        "cvpalette.png",
      ]);
      await ff.exec([
        "-i",
        inN,
        "-i",
        "cvpalette.png",
        "-lavfi",
        `fps=${fps},scale=${scale}:-1:flags=lanczos,paletteuse=dither=bayer:bayer_scale=5`,
        "-y",
        outN,
      ]);
      await ff.deleteFile("cvpalette.png").catch(() => {});
      fmtLabel = `GIF · ${fps}fps/${scale}px`;
    } else {
      outN = `cvout.${target}`;
      const args: string[] = ["-i", inN];

      // Video filters: scaling and fps
      const vf: string[] = [];
      if (options?.resolution === "1080p") vf.push("scale=-2:'min(1080,ih)'");
      else if (options?.resolution === "720p") vf.push("scale=-2:'min(720,ih)'");
      else if (options?.resolution === "480p") vf.push("scale=-2:'min(480,ih)'");

      if (options?.fps && options.fps > 0) {
        args.push("-r", String(options.fps));
      }

      if (vf.length > 0) {
        args.push("-vf", vf.join(","));
      }

      if (options?.stripMetadata) {
        args.push("-map_metadata", "-1");
      }

      const crfVal = String(options?.crf ?? (target === "webm" ? 24 : 18));
      const aBitrate = options?.audioBitrate ?? "192k";

      if (target === "webm") {
        args.push(
          "-c:v",
          "libvpx-vp9",
          "-crf",
          crfVal,
          "-b:v",
          "0",
        );
        if (options?.muteAudio) {
          args.push("-an");
        } else {
          args.push("-c:a", "libopus", "-b:a", aBitrate === "320k" ? "192k" : aBitrate);
        }
      } else if (target === "avi") {
        args.push(
          "-c:v",
          "mpeg4",
          "-qscale:v",
          "3",
        );
        if (options?.muteAudio) {
          args.push("-an");
        } else {
          args.push("-c:a", "libmp3lame", "-b:a", aBitrate);
        }
      } else {
        // mp4 / mov / mkv
        args.push(
          "-c:v",
          "libx264",
          "-crf",
          crfVal,
          "-preset",
          "medium",
          "-pix_fmt",
          "yuv420p",
        );
        if (options?.muteAudio) {
          args.push("-an");
        } else {
          args.push("-c:a", "aac", "-b:a", aBitrate);
        }
        if (target === "mp4" && options?.fastStart !== false) {
          args.push("-movflags", "+faststart");
        }
      }
      args.push("-y", outN);
      await ff.exec(args);
      fmtLabel = `${target.toUpperCase()} · ${target === "webm" ? "VP9/Opus" : target === "avi" ? "MPEG-4/MP3" : "H.264/AAC"}`;
    }

    const data = await ff.readFile(outN);
    const blob = new Blob([data], { type: VIDEO_MIME[target] });
    onProgress?.(100);
    return {
      blob,
      originalSize: file.size,
      convertedSize: blob.size,
      format: `${fmtLabel} · FFmpeg.wasm`,
    };
  } finally {
    await ff.deleteFile(inN).catch(() => {});
    // outN may not exist if exec threw before writing it — deleteFile
    // failures are already swallowed above per-file, this just covers the
    // success path's output file too.
    for (const n of [
      "cvout.mp4",
      "cvout.webm",
      "cvout.mov",
      "cvout.mkv",
      "cvout.avi",
      "cvout.gif",
    ]) {
      await ff.deleteFile(n).catch(() => {});
    }
  }
}
