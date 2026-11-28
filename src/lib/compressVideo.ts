import {
  randomToken,
  type CompressOptions,
  type CompressResult,
} from "./types";
import {
  getFFmpeg,
  ffExec,
  ffFetch,
  ffHasMT,
  ffJob,
  setProgressHandler,
} from "./ffmpeg";
import { get2D } from "./gpu";
import { resolveExecutionProfile } from "./settings";
import { buildFfmpegScaleFilter, getVideoMeta, planVideoSize } from "./videoMeta";
import { videoViaWebCodecs } from "./webcodecsVideo";

export async function compressVideo(
  file: File,
  options: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  // Fast path: browser-native WebCodecs encode/decode muxed by Mediabunny.
  // It only runs for simple, verified codec configurations; every other
  // request — and every failed probe — falls through to FFmpeg.wasm below.
  try {
    const native = await videoViaWebCodecs(file, options, onProgress);
    if (native) return native;
  } catch (e) {
    console.warn(
      "[video] WebCodecs/Mediabunny route failed, falling back to FFmpeg:",
      e,
    );
  }

  // Compatibility path: FFmpeg.wasm — filters, 10-bit, multi-track audio,
  // subtitle passthrough, two-pass and every codec the browser can't encode.
  try {
    return await ffJob(() => videoViaFFmpeg(file, options, onProgress));
  } catch (e) {
    console.warn("[video] FFmpeg failed, falling back to MediaRecorder:", e);
  }

  // Last resort: MediaRecorder — browser-native recording of a canvas + the
  // source video's audio track. Produces a valid container on every browser
  // that still supports MediaRecorder, but cannot honour codec/container
  // choices beyond what the recorder supports.
  return videoViaMediaRecorder(file, options, onProgress);
}

// Counts audio streams in a file already written into ffmpeg's virtual FS,
// by running `-i <file>` with no output. ffmpeg has nothing to encode in
// that case, so it prints the input's stream list to its log and exits
// with a non-zero status — we only want the log lines, so the rejection
// from `exec` is expected and swallowed. Uses the same single-listener
// swap pattern as setProgressHandler so a probe never leaks a stale 'log'
// listener onto the shared ffmpeg singleton.
async function probeAudioTrackCount(ff: any, inN: string): Promise<number> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    lines.push(message);
  };
  ff.on("log", onLog);
  try {
    await ff.exec(["-i", inN]).catch(() => {});
  } finally {
    ff.off("log", onLog);
  }
  return lines.filter((l) => /Stream #\d+:\d+[^:]*:\s*Audio:/.test(l)).length;
}

// ── FFmpeg.wasm ───────────────────────────────────────────────
async function videoViaFFmpeg(
  file: File,
  opts: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  // FIX 1: get actual duration BEFORE bitrate calc so we never divide by 60
  const meta = await getVideoMeta(file);
  const planned = planVideoSize(meta.width, meta.height, opts.maxWidth);
  onProgress?.(2);

  const ff = (await getFFmpeg()) as any;
  onProgress?.(4);
  setProgressHandler(ff, ({ progress }) =>
    onProgress?.(4 + Math.round(progress * 88)),
  );

  const ext = file.name.match(/\.[^.]+$/)?.[0] ?? ".mp4";
  const inN = `vin${ext}`;

  await ff.writeFile(inN, await ffFetch(file));

  const codec = opts.videoCodec ?? "h264";
  const audioTrackMode = opts.audioTrackMode ?? "first";
  const subtitleMode = opts.subtitleMode ?? "none";
  // BUG FIX: this used to hardcode `vout.mp4` for every codec. VP8 isn't a
  // legal codec inside the MP4/ISO-BMFF muxer at all (ffmpeg rejects it,
  // which is why VP8 selection silently fell through to the MediaRecorder
  // fallback), and VP9 + Opus in MP4 plays inconsistently outside Chrome.
  // WebM is the container these codecs were actually designed for.
  // Multi-track audio and subtitle passthrough can carry codecs (DTS,
  // TrueHD, PGS, ASS...) that neither MP4 nor WebM can hold — Matroska
  // accepts virtually anything ffmpeg can mux, so we force it whenever
  // either feature is in use, regardless of source codec.
  const container =
    subtitleMode === "all" || audioTrackMode === "all"
      ? "mkv"
      : codec === "vp8" || codec === "vp9"
        ? "webm"
        : "mp4";
  const outN = `vout.${container}`;
  // 10-bit is only offered for h265/av1 in the UI — libx264 in the default
  // ffmpeg.wasm core is an 8-bit-only build, so a 10-bit request there would
  // silently no-op or fail depending on the core. Guard it here too in case
  // callers construct options outside the UI.
  const tenBit = !!opts.videoTenBit && (codec === "h265" || codec === "av1");

  // ── Video-encode args — shared between the 2-pass probe run and the
  // real output, so both passes see identical encode settings. ──────
  const vArgs: string[] = [];

  if (codec === "h265") vArgs.push("-c:v", "libx265");
  else if (codec === "vp9") vArgs.push("-c:v", "libvpx-vp9");
  else if (codec === "vp8") vArgs.push("-c:v", "libvpx");
  else if (codec === "av1") vArgs.push("-c:v", "libaom-av1");
  else vArgs.push("-c:v", "libx264");

  // A bitrate target (explicit bitrate mode, or a computed target-size
  // bitrate) is what makes 2-pass meaningful; CRF mode has no first-pass
  // stats to gather, so 2-pass is simply ignored there.
  const usesBitrate =
    !!(opts.targetSizeKB && opts.targetSizeKB > 0) || !!opts.videoBitrate;
  let targetBitrateK = 0;

  if (opts.targetSizeKB && opts.targetSizeKB > 0) {
    // FIX 1: use actual duration instead of hardcoded 60
    const dur = Math.max(1, meta.duration);
    const totalBitrateK = Math.round((opts.targetSizeKB * 8) / dur);
    // The total target-size bitrate has to be shared between video and
    // audio — audio is muxed in on top of -b:v, so budgeting the *entire*
    // total for video alone reliably overshoots the requested file size.
    // Reserve the encoded audio's bitrate (and a small container-overhead
    // margin) out of the total before deriving the video bitrate. When the
    // audio is a passthrough copy we can't know its bitrate up front, so we
    // just apply the overhead margin and leave the size target best-effort.
    // A silent source reserves nothing — there's no audio to mux in, so
    // budgeting for it would just under-use the video bitrate for no
    // reason. In "Keep all tracks" mode, -b:a applies per encoded stream,
    // so the *same* per-track rate is muxed in once for every track —
    // reserve for all of them, not just one. Only probe the source when we
    // actually need the count (passthrough doesn't need it either, since
    // its reservation is always 0).
    const perTrackAudioK = codec === "vp8" || codec === "vp9" ? 96 : 128;
    const audioTrackCount = opts.audioPassthrough
      ? 0
      : await probeAudioTrackCount(ff, inN);
    const audioBitrateK =
      opts.audioPassthrough || audioTrackCount === 0
        ? 0
        : perTrackAudioK * (audioTrackMode === "all" ? audioTrackCount : 1);
    const overheadK = Math.round(totalBitrateK * 0.02); // ~2% container/muxing overhead
    targetBitrateK = Math.max(32, totalBitrateK - audioBitrateK - overheadK);
  } else if (opts.videoBitrate) {
    targetBitrateK = Math.round(opts.videoBitrate / 1000);
  }

  if (usesBitrate) {
    vArgs.push(
      "-b:v",
      `${targetBitrateK}k`,
      "-bufsize",
      `${targetBitrateK * 2}k`,
      "-maxrate",
      `${targetBitrateK * 1.5}k`,
    );
  } else {
    const q = opts.quality ?? 0.75;
    const crf = Math.round(18 + (1 - q) * 17);
    if (codec === "vp9" || codec === "av1")
      vArgs.push("-crf", String(crf), "-b:v", "0");
    else vArgs.push("-crf", String(crf));
  }

  const preset = opts.videoPreset ?? "fast";
  if (codec === "h264" || codec === "h265") vArgs.push("-preset", preset);
  else if (codec === "vp9")
    vArgs.push(
      "-speed",
      preset === "slow" ? "1" : preset === "fast" ? "3" : preset === "ultrafast" ? "4" : "2",
    );

  const scaleFilter = buildFfmpegScaleFilter(planned);
  if (scaleFilter) vArgs.push("-vf", scaleFilter);
  if (opts.fps && opts.fps > 0) vArgs.push("-r", String(opts.fps));

  if (codec === "h265" && tenBit)
    vArgs.push("-pix_fmt", "yuv420p10le", "-profile:v", "main10");
  else if (codec === "av1" && tenBit) vArgs.push("-pix_fmt", "yuv420p10le");
  else if (codec === "h264" || codec === "h265")
    vArgs.push("-pix_fmt", "yuv420p");

  // Edit proxy: all-intra (every frame a keyframe) so NLEs can seek/scrub
  // without decoding a GOP, plus no B-frames for the same reason. Trades
  // file size for editing responsiveness — not meant as a delivery format.
  if (opts.videoProxy) vArgs.push("-g", "1", "-bf", "0");

  const twoPass =
    !!opts.videoTwoPass &&
    usesBitrate &&
    (codec === "h264" ||
      codec === "h265" ||
      codec === "vp9" ||
      codec === "vp8" ||
      codec === "av1");
  const passPrefix = `pass_${Date.now()}_${randomToken(5)}`;

  if (twoPass) {
    const pass1 = [
      "-i",
      inN,
      "-map",
      "0:v:0",
      ...vArgs,
      "-pass",
      "1",
      "-passlogfile",
      passPrefix,
      "-an",
      "-f",
      "null",
      "-y",
      "null_out",
    ];
    await ffExec(ff, pass1, "run the first video encoding pass");
  }

  // ── Stream mapping: video always, audio per audioTrackMode, subtitles
  // per subtitleMode. `?` suffixes make a map optional so ffmpeg doesn't
  // error on a file that simply has no subtitle/second audio track. ──
  const mapArgs = ["-map", "0:v:0"];
  mapArgs.push("-map", audioTrackMode === "all" ? "0:a?" : "0:a:0?");
  if (subtitleMode === "all") mapArgs.push("-map", "0:s?");

  const audioArgs: string[] = [];
  if (opts.audioPassthrough) {
    // Copy the audio stream(s) untouched — keeps lossless/surround tracks
    // (TrueHD, DTS, DTS-HD, etc.) intact while the video re-encodes.
    audioArgs.push("-c:a", "copy");
  } else {
    // WebM (vp8/vp9) can only legally carry Opus/Vorbis audio — AAC in a
    // WebM container is invalid and can fail muxing or produce an
    // unplayable file. Only mp4/mkv containers get AAC.
    if (codec === "vp8" || codec === "vp9")
      audioArgs.push("-c:a", "libopus", "-b:a", "96k");
    else audioArgs.push("-c:a", "aac", "-b:a", "128k");
    if (opts.audioDownmixStereo) audioArgs.push("-ac", "2");
  }

  const subArgs: string[] = subtitleMode === "all" ? ["-c:s", "copy"] : [];

  const finalArgs = [
    "-i",
    inN,
    ...mapArgs,
    ...vArgs,
    ...(twoPass ? ["-pass", "2", "-passlogfile", passPrefix] : []),
    ...audioArgs,
    ...subArgs,
  ];
  if (container === "mp4") finalArgs.push("-movflags", "+faststart");
  finalArgs.push("-y", outN);

  await ffExec(ff, finalArgs, "compress the video");

  const data = await ff.readFile(outN);
  await ff.deleteFile(inN).catch(() => {});
  await ff.deleteFile(outN).catch(() => {});
  if (twoPass) {
    await ff.deleteFile(`${passPrefix}-0.log`).catch(() => {});
    await ff.deleteFile(`${passPrefix}-0.log.mbtree`).catch(() => {});
    await ff.deleteFile("null_out").catch(() => {});
  }

  const mime =
    container === "webm"
      ? "video/webm"
      : container === "mkv"
        ? "video/x-matroska"
        : "video/mp4";
  const blob = new Blob([data], { type: mime });
  onProgress?.(100);

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: file.size / blob.size,
    format: `${mime} · FFmpeg.wasm${ffHasMT() ? " MT" : ""}${tenBit ? " · 10-bit" : ""}${opts.videoProxy ? " · Proxy" : ""}${twoPass ? " · 2-pass" : ""}${audioTrackMode === "all" ? " · multi-audio" : ""}${subtitleMode === "all" ? " · subs" : ""}`,
    width: planned.width,
    height: planned.height,
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
  metadataTimeoutMs: number = 8000,
): Promise<CompressResult> {
  const meta = await getVideoMeta(file);
  const { width: ow, height: oh, duration } = meta;
  // Reserve a typical audio track bitrate (~128kbps, MediaRecorder's usual
  // Opus default) out of the size target before budgeting video, since the
  // audio track is recorded independently on top of videoBitsPerSecond.
  const DEFAULT_AUDIO_BPS = 128_000;
  const bitrate = opts.targetSizeKB
    ? Math.max(
        32_000,
        Math.round((opts.targetSizeKB * 1024 * 8) / Math.max(duration, 1)) -
          DEFAULT_AUDIO_BPS,
      )
    : (opts.videoBitrate ?? 1_500_000);

  const size = planVideoSize(ow, oh, opts.maxWidth);
  const w = size.width;
  const h = size.height;

  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not supported in this browser");
  }
  const profile = resolveExecutionProfile().browserProfile;
  const mimeType =
    profile.media.mediaRecorderMimeOrder.find((t) =>
      MediaRecorder.isTypeSupported(t),
    ) ?? "video/webm";

  const url = URL.createObjectURL(file);
  let urlRevoked = false;
  const revokeUrl = () => {
    if (!urlRevoked) {
      urlRevoked = true;
      URL.revokeObjectURL(url);
    }
  };

  // `muted` only silences local audio output — it does NOT affect the
  // track(s) returned by captureStream(), so we can keep the element muted
  // (required by autoplay policy in most browsers) while still capturing
  // its audio below.
  const vid = Object.assign(document.createElement("video"), {
    src: url,
    muted: true,
    playsInline: true,
  });
  await new Promise<void>((r, rej) => {
    const timer = setTimeout(() => {
      vid.onloadedmetadata = null;
      vid.onerror = null;
      revokeUrl();
      rej(new Error("Timeout loading video metadata in MediaRecorder fallback"));
    }, metadataTimeoutMs);
    vid.onloadedmetadata = () => {
      clearTimeout(timer);
      r();
    };
    vid.onerror = () => {
      clearTimeout(timer);
      revokeUrl();
      rej(new Error("Failed to load video in MediaRecorder fallback"));
    };
  });

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  // This fallback path draws one frame to canvas per `ontimeupdate` tick —
  // a real per-frame hot loop, unlike the single-shot canvases elsewhere —
  // so the GPU compositing hint (Settings → GPU Acceleration → Video)
  // matters here specifically. Primary encoding stays on FFmpeg.wasm above;
  // this MediaRecorder path only runs if that fails, and FFmpeg itself has
  // no browser-exposed GPU encode path — see gpu.ts's file header.
  const ctx = get2D(canvas, "video");

  // FIX 2: merge canvas video stream with audio track from the video element
  let videoStream: MediaStream | null = null;
  let combinedStream: MediaStream | null = null;
  let rec: MediaRecorder | null = null;
  let playbackTimer: any = null;
  const clearPlaybackTimer = () => {
    if (playbackTimer !== null) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }
  };
  const chunks: Blob[] = [];

  try {
    videoStream = canvas.captureStream(opts.fps ?? 30);

    // Try to get audio tracks from the hidden video element (including Firefox mozCaptureStream)
    combinedStream = videoStream;
    try {
      const streamable = vid as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const vidStream =
        streamable.captureStream?.() ??
        streamable.mozCaptureStream?.() ??
        null;
      const audioTracks = vidStream?.getAudioTracks() ?? [];
      if (audioTracks.length > 0) {
        combinedStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioTracks,
        ]);
      }
    } catch {
      /**/
    }

    let recorderError: Error | null = null;
    rec = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: bitrate,
    });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onerror = (e: any) => {
      recorderError =
        e?.error instanceof Error
          ? e.error
          : new Error(`MediaRecorder error: ${e?.error?.message ?? e?.message ?? "recording failed"}`);
    };
    rec.start(250);

    let mediaEnded = false;
    let onPlaybackEnd: (() => void) | null = null;
    vid.onended = () => {
      mediaEnded = true;
      onPlaybackEnd?.();
    };

    try {
      await vid.play();
    } catch (err) {
      throw new Error(
        `MediaRecorder fallback could not start playback (autoplay blocked?): ${err}`,
        { cause: err },
      );
    }

    // `timeupdate` fires on a coarse, non-frame-aligned schedule (browsers
    // throttle it to a few times per second), which produces duplicated /
    // dropped frames and stutter when used to drive per-frame canvas capture.
    // requestVideoFrameCallback fires once per actually-decoded frame and
    // hands back the frame's presentation time, so drawing there is frame-
    // accurate. Fall back to requestAnimationFrame on browsers without it.
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = () => {
        clearPlaybackTimer();
        if (!done) {
          done = true;
          if (recorderError) {
            reject(recorderError);
          } else if (rec?.state === "inactive") {
            reject(
              new Error("MediaRecorder stopped unexpectedly before video playback completed"),
            );
          } else {
            resolve();
          }
        }
      };

      const checkRecorder = () => {
        if (recorderError) {
          clearPlaybackTimer();
          done = true;
          reject(recorderError);
          return false;
        }
        if (rec?.state === "inactive") {
          clearPlaybackTimer();
          done = true;
          reject(
            new Error("MediaRecorder stopped unexpectedly before video playback completed"),
          );
          return false;
        }
        return true;
      };

      const drawAndReport = (currentTime: number) => {
        if (!checkRecorder()) return;
        ctx.drawImage(vid, 0, 0, w, h);
        onProgress?.(5 + Math.round((currentTime / Math.max(duration, 1)) * 90));
      };

      const rvfc = (vid as any).requestVideoFrameCallback?.bind(vid);
      if (rvfc) {
        const onFrame = (_now: number, metadata: { mediaTime: number }) => {
          if (done) return;
          drawAndReport(metadata.mediaTime);
          if (!done) rvfc(onFrame);
        };
        rvfc(onFrame);
      } else {
        const raf =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (cb: () => void) => setTimeout(cb, 16);
        const onFrame = () => {
          if (done) return;
          drawAndReport(vid.currentTime);
          if (!done) raf(onFrame);
        };
        raf(onFrame);
      }

      onPlaybackEnd = finish;
      if (mediaEnded) {
        finish();
      } else {
        playbackTimer = setTimeout(finish, (duration + 5) * 1000);
      }
    });

    if (recorderError) {
      throw recorderError;
    }
    if (rec.state === "inactive") {
      throw new Error("MediaRecorder stopped unexpectedly before video playback completed");
    }

    rec.stop();
    await new Promise<void>((resolve, reject) => {
      if (!rec) return resolve();
      rec.onstop = () => {
        if (recorderError) reject(recorderError);
        else resolve();
      };
      rec.onerror = (e: any) => {
        reject(
          e?.error instanceof Error
            ? e.error
            : new Error(`MediaRecorder error: ${e?.error?.message ?? e?.message ?? "recording failed"}`),
        );
      };
    });
  } finally {
    clearPlaybackTimer();
    try {
      if (rec && rec.state !== "inactive") {
        rec.stop();
      }
    } catch {
      /**/
    }
    try {
      vid.pause();
    } catch {
      /**/
    }
    try {
      combinedStream?.getTracks()?.forEach((track) => track.stop());
      videoStream?.getTracks()?.forEach((track) => track.stop());
    } catch {
      /**/
    }
    revokeUrl();
  }

  if (chunks.length === 0) {
    throw new Error("MediaRecorder produced no video data");
  }

  const blob = new Blob(chunks, { type: mimeType });
  onProgress?.(100);
  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: file.size / blob.size,
    format: `${mimeType} · MediaRecorder`,
    width: w,
    height: h,
    duration,
  };
}

export { videoViaMediaRecorder };


