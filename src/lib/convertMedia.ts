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
import { getFFmpeg, ffFetch, setProgressHandler } from './ffmpeg';

export type VideoContainer = 'mp4' | 'webm' | 'mov' | 'mkv' | 'avi' | 'gif';

const VIDEO_MIME: Record<VideoContainer, string> = {
  mp4:  'video/mp4',
  webm: 'video/webm',
  mov:  'video/quicktime',
  mkv:  'video/x-matroska',
  avi:  'video/x-msvideo',
  gif:  'image/gif',
};

export interface ConvertResult {
  blob: Blob;
  originalSize: number;
  convertedSize: number;
  format: string;
}

export async function convertVideo(
  file: File,
  target: VideoContainer,
  onProgress?: (pct: number) => void,
): Promise<ConvertResult> {
  const ff = await getFFmpeg() as any;
  onProgress?.(4);
  setProgressHandler(ff, ({ progress }) => onProgress?.(4 + Math.round(progress * 90)));

  const ext  = file.name.match(/\.[^.]+$/)?.[0] ?? '.mp4';
  const inN  = `cvin${ext}`;
  await ff.writeFile(inN, await ffFetch(file));

  let outN: string;
  let fmtLabel: string;

  try {
    if (target === 'gif') {
      // Two-pass palettegen + paletteuse, same "gold standard" approach used
      // for GIF compression elsewhere in the app. Capped to a sane width/fps
      // by default since arbitrary-resolution video → GIF produces enormous
      // files — GIF has no real compression for video-like content.
      outN = 'cvout.gif';
      await ff.exec([
        '-i', inN,
        '-vf', 'fps=12,scale=720:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff',
        '-y', 'cvpalette.png',
      ]);
      await ff.exec([
        '-i', inN, '-i', 'cvpalette.png',
        '-lavfi', 'fps=12,scale=720:-1:flags=lanczos,paletteuse=dither=bayer:bayer_scale=5',
        '-y', outN,
      ]);
      await ff.deleteFile('cvpalette.png').catch(() => {});
      fmtLabel = 'GIF · 12fps/720px (capped for file size)';
    } else {
      outN = `cvout.${target}`;
      const args: string[] = ['-i', inN];

      if (target === 'webm') {
        args.push('-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-c:a', 'libopus', '-b:a', '160k');
      } else if (target === 'avi') {
        // AVI is old-container-compatibility territory — mpeg4/mp3 plays
        // everywhere that still opens .avi files at all.
        args.push('-c:v', 'mpeg4', '-qscale:v', '3', '-c:a', 'libmp3lame', '-b:a', '192k');
      } else {
        // mp4 / mov / mkv all happily carry H.264 + AAC.
        args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
                   '-c:a', 'aac', '-b:a', '192k');
        if (target === 'mp4') args.push('-movflags', '+faststart');
      }
      args.push('-y', outN);
      await ff.exec(args);
      fmtLabel = `${target.toUpperCase()} · ${target === 'webm' ? 'VP9/Opus' : target === 'avi' ? 'MPEG-4/MP3' : 'H.264/AAC'}`;
    }

    const data = await ff.readFile(outN);
    const blob = new Blob([data.buffer as ArrayBuffer], { type: VIDEO_MIME[target] });
    onProgress?.(100);
    return { blob, originalSize: file.size, convertedSize: blob.size, format: `${fmtLabel} · FFmpeg.wasm` };
  } finally {
    await ff.deleteFile(inN).catch(() => {});
    // outN may not exist if exec threw before writing it — deleteFile
    // failures are already swallowed above per-file, this just covers the
    // success path's output file too.
    for (const n of ['cvout.mp4','cvout.webm','cvout.mov','cvout.mkv','cvout.avi','cvout.gif']) {
      await ff.deleteFile(n).catch(() => {});
    }
  }
}
