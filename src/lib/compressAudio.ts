import type { CompressOptions, CompressResult, AudioFormat } from './types';
import { getFFmpeg, ffFetch, setProgressHandler } from './ffmpeg';

const DEFAULT_BITRATE: Record<AudioFormat, number> = {
  mp3: 192, aac: 160, ogg: 128, opus: 96, flac: 0, wav: 0,
};

const MIME_TYPE: Record<AudioFormat, string> = {
  mp3:  'audio/mpeg',
  aac:  'audio/mp4',
  ogg:  'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  flac: 'audio/flac',
  wav:  'audio/wav',
};

export async function compressAudio(
  file: File,
  options: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  onProgress?.(2);
  const ff = await getFFmpeg() as any;
  onProgress?.(6);

  setProgressHandler(ff, ({ progress }) =>
    onProgress?.(6 + Math.round(progress * 88)));

  // Passthrough: remux only, no re-encode. This is the only way to carry a
  // lossless/surround track (TrueHD, DTS, DTS-HD, PCM multichannel, etc.)
  // through untouched — any of the formats below would force a transcode
  // and either fail on unsupported codecs or throw away channels/precision
  // ffmpeg.wasm's decoders can't losslessly round-trip anyway.
  if (options.audioPassthrough) {
    return passthroughAudio(file, ff, options.stripMetadata, onProgress);
  }

  const fmt  = (options.audioFormat ?? 'mp3') as AudioFormat;
  const br   = options.audioBitrate ?? DEFAULT_BITRATE[fmt];
  const ext  = file.name.match(/\.[^.]+$/)?.[0] ?? '.audio';
  const outN = `output.${fmt === 'aac' ? 'm4a' : fmt}`;

  await ff.writeFile(`input${ext}`, await ffFetch(file));

  const args: string[] = ['-i', `input${ext}`];

  switch (fmt) {
    case 'mp3':  args.push('-c:a', 'libmp3lame', '-b:a', `${br}k`); break;
    case 'aac':  args.push('-c:a', 'aac', '-b:a', `${br}k`, '-movflags', '+faststart'); break;
    case 'ogg':  args.push('-c:a', 'libvorbis', '-b:a', `${br}k`); break;
    case 'opus': args.push('-c:a', 'libopus', '-b:a', `${br}k`, '-vbr', 'on', '-compression_level', '10'); break;
    case 'flac': args.push('-c:a', 'flac', '-compression_level', '8'); break;
    case 'wav':  args.push('-c:a', 'pcm_s16le'); break;
  }

  if (options.audioSampleRate) args.push('-ar', String(options.audioSampleRate));
  if (options.stripMetadata)   args.push('-map_metadata', '-1');
  args.push('-vn', '-y', outN);

  await ff.exec(args);

  const data = await ff.readFile(outN);
  await ff.deleteFile(`input${ext}`).catch(() => {});
  await ff.deleteFile(outN).catch(() => {});

  const blob = new Blob([data.buffer as ArrayBuffer], { type: MIME_TYPE[fmt] });
  onProgress?.(100);

  return {
    blob,
    originalSize:     file.size,
    compressedSize:   blob.size,
    compressionRatio: file.size / blob.size,
    format:           `${fmt.toUpperCase()} · FFmpeg.wasm`,
  };
}

// ── Passthrough (stream copy, no re-encode) ─────────────────────
async function passthroughAudio(
  file: File,
  ff: any,
  stripMetadata: boolean | undefined,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  const ext  = file.name.match(/\.[^.]+$/)?.[0] ?? '.audio';
  // Keep the source container — the codec is untouched, so re-wrapping into
  // an unrelated container (e.g. forcing TrueHD into an .mp3 shell) would
  // just produce a file nothing can open. MKV is the one container that
  // accepts virtually any audio codec, so fall back to it for extensions
  // that can't hold the source codec (still lets video containers through
  // for the "extract audio from a video file" use case).
  const containerSafe = /\.(mkv|mka|m4a|mp4|mov|wav|flac|ogg|opus)$/i.test(ext);
  const outExt = containerSafe ? ext : '.mka';
  const outN   = `output${outExt}`;

  await ff.writeFile(`input${ext}`, await ffFetch(file));

  const args: string[] = ['-i', `input${ext}`, '-map', '0:a', '-c:a', 'copy'];
  if (stripMetadata) args.push('-map_metadata', '-1');
  args.push('-vn', '-y', outN);

  await ff.exec(args);

  const data = await ff.readFile(outN);
  await ff.deleteFile(`input${ext}`).catch(() => {});
  await ff.deleteFile(outN).catch(() => {});

  const blob = new Blob([data.buffer as ArrayBuffer], { type: 'audio/x-matroska' });
  onProgress?.(100);

  return {
    blob,
    originalSize:     file.size,
    compressedSize:   blob.size,
    compressionRatio: file.size / blob.size,
    format:           `Passthrough (${ext.slice(1).toUpperCase()} · stream copy, no re-encode)`,
  };
}
