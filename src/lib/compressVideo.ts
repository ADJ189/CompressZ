import type { CompressOptions, CompressResult } from './types';
import { getFFmpeg, ffFetch, ffHasMT, setProgressHandler } from './ffmpeg';
import { get2D } from './gpu';

export async function compressVideo(
  file: File,
  options: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  // Primary: FFmpeg.wasm — best quality, all codecs, proper MP4 container.
  try { return await videoViaFFmpeg(file, options, onProgress); }
  catch (e) { console.warn('[video] FFmpeg failed, falling back to MediaRecorder:', e); }

  // Fallback: MediaRecorder — browser-native, always produces a valid container.
  // The WebCodecs path has been removed: it encoded raw H.264 NAL units with no
  // container muxer, producing blobs that no player can open. Re-enable it only
  // after integrating mp4box.js or webm-muxer for proper muxing.
  return videoViaMediaRecorder(file, options, onProgress);
}

// ── FFmpeg.wasm ───────────────────────────────────────────────
async function videoViaFFmpeg(
  file: File,
  opts: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  // FIX 1: get actual duration BEFORE bitrate calc so we never divide by 60
  const meta = await getVideoMeta(file);
  onProgress?.(2);

  const ff = await getFFmpeg() as any;
  onProgress?.(4);
  setProgressHandler(ff, ({ progress }) =>
    onProgress?.(4 + Math.round(progress * 88)));

  const ext  = file.name.match(/\.[^.]+$/)?.[0] ?? '.mp4';
  const inN  = `vin${ext}`;

  await ff.writeFile(inN, await ffFetch(file));

  const codec  = opts.videoCodec ?? 'h264';
  const audioTrackMode = opts.audioTrackMode ?? 'first';
  const subtitleMode   = opts.subtitleMode ?? 'none';
  // BUG FIX: this used to hardcode `vout.mp4` for every codec. VP8 isn't a
  // legal codec inside the MP4/ISO-BMFF muxer at all (ffmpeg rejects it,
  // which is why VP8 selection silently fell through to the MediaRecorder
  // fallback), and VP9 + Opus in MP4 plays inconsistently outside Chrome.
  // WebM is the container these codecs were actually designed for.
  // Multi-track audio and subtitle passthrough can carry codecs (DTS,
  // TrueHD, PGS, ASS...) that neither MP4 nor WebM can hold — Matroska
  // accepts virtually anything ffmpeg can mux, so we force it whenever
  // either feature is in use, regardless of source codec.
  const container = (subtitleMode === 'all' || audioTrackMode === 'all')
    ? 'mkv'
    : (codec === 'vp8' || codec === 'vp9') ? 'webm' : 'mp4';
  const outN = `vout.${container}`;
  // 10-bit is only offered for h265/av1 in the UI — libx264 in the default
  // ffmpeg.wasm core is an 8-bit-only build, so a 10-bit request there would
  // silently no-op or fail depending on the core. Guard it here too in case
  // callers construct options outside the UI.
  const tenBit = !!opts.videoTenBit && (codec === 'h265' || codec === 'av1');

  // ── Video-encode args — shared between the 2-pass probe run and the
  // real output, so both passes see identical encode settings. ──────
  const vArgs: string[] = [];

  if      (codec === 'h265') vArgs.push('-c:v', 'libx265');
  else if (codec === 'vp9')  vArgs.push('-c:v', 'libvpx-vp9');
  else if (codec === 'vp8')  vArgs.push('-c:v', 'libvpx');
  else if (codec === 'av1')  vArgs.push('-c:v', 'libaom-av1');
  else                       vArgs.push('-c:v', 'libx264');

  // A bitrate target (explicit bitrate mode, or a computed target-size
  // bitrate) is what makes 2-pass meaningful; CRF mode has no first-pass
  // stats to gather, so 2-pass is simply ignored there.
  const usesBitrate = !!(opts.targetSizeKB && opts.targetSizeKB > 0) || !!opts.videoBitrate;
  let targetBitrateK = 0;

  if (opts.targetSizeKB && opts.targetSizeKB > 0) {
    // FIX 1: use actual duration instead of hardcoded 60
    const dur = Math.max(1, meta.duration);
    targetBitrateK = Math.round((opts.targetSizeKB * 8) / dur);
  } else if (opts.videoBitrate) {
    targetBitrateK = Math.round(opts.videoBitrate / 1000);
  }

  if (usesBitrate) {
    vArgs.push('-b:v', `${targetBitrateK}k`, '-bufsize', `${targetBitrateK * 2}k`, '-maxrate', `${targetBitrateK * 1.5}k`);
  } else {
    const q   = opts.quality ?? 0.75;
    const crf = Math.round(18 + (1 - q) * 17);
    if (codec === 'vp9' || codec === 'av1') vArgs.push('-crf', String(crf), '-b:v', '0');
    else                                    vArgs.push('-crf', String(crf));
  }

  const preset = opts.videoPreset ?? 'fast';
  if      (codec === 'h264' || codec === 'h265') vArgs.push('-preset', preset);
  else if (codec === 'vp9')                      vArgs.push('-speed', preset === 'slow' ? '1' : preset === 'fast' ? '3' : '2');

  if (opts.maxWidth) vArgs.push('-vf', `scale='min(${opts.maxWidth},iw)':-2:flags=lanczos`);
  if (opts.fps && opts.fps > 0) vArgs.push('-r', String(opts.fps));

  if      (codec === 'h265' && tenBit) vArgs.push('-pix_fmt', 'yuv420p10le', '-profile:v', 'main10');
  else if (codec === 'av1'  && tenBit) vArgs.push('-pix_fmt', 'yuv420p10le');
  else if (codec === 'h264' || codec === 'h265') vArgs.push('-pix_fmt', 'yuv420p');

  // Edit proxy: all-intra (every frame a keyframe) so NLEs can seek/scrub
  // without decoding a GOP, plus no B-frames for the same reason. Trades
  // file size for editing responsiveness — not meant as a delivery format.
  if (opts.videoProxy) vArgs.push('-g', '1', '-bf', '0');

  const twoPass = !!opts.videoTwoPass && usesBitrate &&
    (codec === 'h264' || codec === 'h265' || codec === 'vp9' || codec === 'vp8' || codec === 'av1');
  const passPrefix = `pass_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (twoPass) {
    const pass1 = [
      '-i', inN, '-map', '0:v:0', ...vArgs,
      '-pass', '1', '-passlogfile', passPrefix,
      '-an', '-f', 'null', '-y', 'null_out',
    ];
    await ff.exec(pass1);
  }

  // ── Stream mapping: video always, audio per audioTrackMode, subtitles
  // per subtitleMode. `?` suffixes make a map optional so ffmpeg doesn't
  // error on a file that simply has no subtitle/second audio track. ──
  const mapArgs = ['-map', '0:v:0'];
  mapArgs.push('-map', audioTrackMode === 'all' ? '0:a?' : '0:a:0?');
  if (subtitleMode === 'all') mapArgs.push('-map', '0:s?');

  const audioArgs: string[] = [];
  if (opts.audioPassthrough) {
    // Copy the audio stream(s) untouched — keeps lossless/surround tracks
    // (TrueHD, DTS, DTS-HD, etc.) intact while the video re-encodes.
    audioArgs.push('-c:a', 'copy');
  } else {
    if (codec === 'vp9') audioArgs.push('-c:a', 'libopus', '-b:a', '96k');
    else                 audioArgs.push('-c:a', 'aac', '-b:a', '128k');
    if (opts.audioDownmixStereo) audioArgs.push('-ac', '2');
  }

  const subArgs: string[] = subtitleMode === 'all' ? ['-c:s', 'copy'] : [];

  const finalArgs = [
    '-i', inN, ...mapArgs, ...vArgs,
    ...(twoPass ? ['-pass', '2', '-passlogfile', passPrefix] : []),
    ...audioArgs, ...subArgs,
  ];
  if (container === 'mp4') finalArgs.push('-movflags', '+faststart');
  finalArgs.push('-y', outN);

  await ff.exec(finalArgs);

  const data = await ff.readFile(outN);
  await ff.deleteFile(inN).catch(() => {});
  await ff.deleteFile(outN).catch(() => {});
  if (twoPass) {
    await ff.deleteFile(`${passPrefix}-0.log`).catch(() => {});
    await ff.deleteFile(`${passPrefix}-0.log.mbtree`).catch(() => {});
    await ff.deleteFile('null_out').catch(() => {});
  }

  const mime = container === 'webm' ? 'video/webm' : container === 'mkv' ? 'video/x-matroska' : 'video/mp4';
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
  onProgress?.(100);

  return {
    blob,
    originalSize:     file.size,
    compressedSize:   blob.size,
    compressionRatio: file.size / blob.size,
    format:           `${mime} · FFmpeg.wasm${ffHasMT() ? ' MT' : ''}${tenBit ? ' · 10-bit' : ''}${opts.videoProxy ? ' · Proxy' : ''}${twoPass ? ' · 2-pass' : ''}${audioTrackMode === 'all' ? ' · multi-audio' : ''}${subtitleMode === 'all' ? ' · subs' : ''}`,
    width:    meta.width,
    height:   meta.height,
    duration: meta.duration,
  };
}

// ── MediaRecorder ─────────────────────────────────────────────
// NOTE: A WebCodecs path was removed because it concatenated raw H.264 NAL
// units without a container muxer, producing blobs no player can open.
// Re-introduce it only after adding mp4box.js or webm-muxer for proper
// muxing. The FFmpeg + MediaRecorder chain below is reliable on all browsers.
async function videoViaMediaRecorder(
  file: File,
  opts: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  const meta = await getVideoMeta(file);
  const { width: ow, height: oh, duration } = meta;
  const bitrate = opts.targetSizeKB
    ? Math.round((opts.targetSizeKB * 1024 * 8) / Math.max(duration, 1))
    : (opts.videoBitrate ?? 1_500_000);

  const ua       = navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isFirefox = ua.includes('Firefox/');
  const types    = isSafari
    ? ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    : isFirefox
    ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mimeType = types.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

  const url = URL.createObjectURL(file);
  // FIX 2: don't mute the video — we need its audio stream
  const vid = Object.assign(document.createElement('video'),
    { src: url, muted: false, playsInline: true, volume: 0 });
  await new Promise<void>(r => { vid.onloadedmetadata = () => r(); });

  const w      = opts.maxWidth ? Math.min(ow, opts.maxWidth) : ow;
  const h      = opts.maxWidth ? Math.round(oh * (w / ow))   : oh;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  // This fallback path draws one frame to canvas per `ontimeupdate` tick —
  // a real per-frame hot loop, unlike the single-shot canvases elsewhere —
  // so the GPU compositing hint (Settings → GPU Acceleration → Video)
  // matters here specifically. Primary encoding stays on FFmpeg.wasm above;
  // this MediaRecorder path only runs if that fails, and FFmpeg itself has
  // no browser-exposed GPU encode path — see gpu.ts's file header.
  const ctx    = get2D(canvas, 'video');

  // FIX 2: merge canvas video stream with audio track from the video element
  const videoStream = canvas.captureStream(opts.fps ?? 30);

  // Try to get audio tracks from the hidden video element
  let combinedStream = videoStream;
  try {
    const vidStream   = (vid as any).captureStream?.() ?? null;
    const audioTracks = vidStream?.getAudioTracks() ?? [];
    if (audioTracks.length > 0) {
      combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioTracks,
      ]);
    }
  } catch { /**/ }

  const rec    = new MediaRecorder(combinedStream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  rec.start(250);
  vid.play();

  await new Promise<void>(resolve => {
    vid.ontimeupdate = () => {
      ctx.drawImage(vid, 0, 0, w, h);
      onProgress?.(5 + Math.round((vid.currentTime / Math.max(duration, 1)) * 90));
    };
    vid.onended = () => resolve();
    setTimeout(() => resolve(), (duration + 5) * 1000);
  });

  rec.stop();
  vid.pause();
  URL.revokeObjectURL(url);
  await new Promise<void>(r => { rec.onstop = () => r(); });

  const blob = new Blob(chunks, { type: mimeType });
  onProgress?.(100);
  return {
    blob,
    originalSize:     file.size,
    compressedSize:   blob.size,
    compressionRatio: file.size / blob.size,
    format:           `${mimeType} · MediaRecorder`,
    width: w, height: h, duration,
  };
}

// ── Utility ───────────────────────────────────────────────────
function getVideoMeta(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v   = document.createElement('video');
    v.src     = url;
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: v.videoWidth || 1280, height: v.videoHeight || 720, duration: v.duration || 30 });
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot read video metadata')); };
  });
}
