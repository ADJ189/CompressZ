import { test, expect } from "@playwright/test";

/**
 * Opt-in, real-encode integration test for the WebCodecs/Mediabunny route.
 *
 * Normal `npm run test:e2e` never runs this file: it needs the Vite dev server
 * (to import the TypeScript engine module), network access to `esm.sh` for the
 * lazy Mediabunny import, and a browser with a working WebCodecs encoder. CI
 * stays deterministic; run `npm run test:webcodecs` locally or on a release
 * checklist machine instead.
 *
 * The test records a real VP8/Opus clip with MediaRecorder, runs the shipped
 * `videoViaWebCodecs()` against it, then re-opens the output with Mediabunny to
 * prove it is a readable container with decodable video *and* audio tracks.
 * Audio loss is a release blocker, so it is asserted explicitly.
 */

test.describe("WebCodecs + Mediabunny real encode", () => {
  test.skip(
    !process.env.WEBCODECS_E2E,
    "Opt-in integration test — run `npm run test:webcodecs`.",
  );

  test("transcodes a real clip to MP4/H.264 with audio intact", async ({
    page,
  }) => {
    test.setTimeout(3 * 60_000);

    await page.goto("/");

    const result = await page.evaluate(async () => {
      // Variable specifiers keep TypeScript from trying to resolve browser-only
      // URLs at build time (same pattern as e2e/bench.spec.ts).
      const modulePath = "/src/lib/webcodecsVideo.ts";
      const mediabunnyCdn = "https://esm.sh/mediabunny@1.62.1";

      const mod = (await import(/* @vite-ignore */ modulePath)) as {
        videoViaWebCodecs: (
          file: File,
          options: Record<string, unknown>,
          onProgress?: (pct: number) => void,
        ) => Promise<null | {
          blob: Blob;
          format: string;
          width?: number;
          height?: number;
          duration?: number;
        }>;
      };

      const mb = (await import(/* @vite-ignore */ mediabunnyCdn)) as {
        Input: new (o: { formats: unknown; source: unknown }) => {
          canRead(): Promise<boolean>;
          getAudioTracks(): Promise<{ canDecode(): Promise<boolean> }[]>;
          getPrimaryVideoTrack(): Promise<{ canDecode(): Promise<boolean> } | null>;
          dispose(): void;
        };
        BlobSource: new (b: Blob) => unknown;
        ALL_FORMATS: unknown;
      };

      // Probe the exact encoders the MP4/H.264 route needs *before* the
      // conversion. This keeps capability skips separate from real failures:
      // once both encoders are known to exist, a null result below is a
      // regression (dropped audio, undecodable track, broken mux), not a
      // reason to quietly skip.
      const encoderSupported =
        typeof VideoEncoder !== "undefined" &&
        typeof AudioEncoder !== "undefined" &&
        (
          await VideoEncoder.isConfigSupported({
            codec: "avc1.42001f",
            width: 320,
            height: 240,
            bitrate: 1_000_000,
            framerate: 30,
          })
        ).supported === true &&
        (
          await AudioEncoder.isConfigSupported({
            codec: "mp4a.40.2",
            sampleRate: 48_000,
            numberOfChannels: 1,
            bitrate: 96_000,
          })
        ).supported === true;

      // A real source clip: canvas video + oscillator audio.
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D unavailable");
      const stream = canvas.captureStream(30);

      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audio = new AudioCtor();
      const destination = audio.createMediaStreamDestination();
      const osc = audio.createOscillator();
      osc.frequency.value = 440;
      const gain = audio.createGain();
      gain.gain.value = 0.05;
      osc.connect(gain).connect(destination);
      osc.start();
      for (const track of destination.stream.getAudioTracks()) {
        stream.addTrack(track);
      }

      const mime = "video/webm;codecs=vp8,opus";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `hsl(${i * 8}, 70%, 45%)`;
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = "#fff";
        ctx.fillRect((i * 7) % 280, 100, 40, 40);
        await new Promise((resolve) => setTimeout(resolve, 33));
      }
      recorder.stop();
      await stopped;
      osc.stop();
      await audio.close();

      const source = new File(chunks, "source.webm", { type: "video/webm" });
      const progress: number[] = [];
      const converted = await mod.videoViaWebCodecs(
        source,
        { videoCodec: "h264", quality: 0.8 },
        (pct) => progress.push(pct),
      );
      if (!converted) return { encoderSupported, converted: false as const };

      const input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: new mb.BlobSource(converted.blob),
      });
      const readable = await input.canRead();
      const video = await input.getPrimaryVideoTrack();
      const audioTracks = await input.getAudioTracks();
      const inspection = {
        readable,
        video: !!video,
        videoDecodable: video ? await video.canDecode() : false,
        audioTracks: audioTracks.length,
        audioDecodable: audioTracks.length
          ? await audioTracks[0].canDecode()
          : false,
      };
      input.dispose();

      return {
        encoderSupported,
        converted: true as const,
        bytes: converted.blob.size,
        type: converted.blob.type,
        format: converted.format,
        width: converted.width,
        height: converted.height,
        duration: converted.duration,
        lastProgress: progress[progress.length - 1],
        inspection,
      };
    });

    test.skip(
      !result.encoderSupported,
      "This browser has no WebCodecs H.264/AAC encoder; the route correctly fell through to FFmpeg.",
    );
    // The encoders exist, so the shipped route must have produced a file.
    // Returning null here would mean a capability-gated abort (e.g. audio
    // dropped) and is treated as a failure, not a skip.
    expect(result.converted).toBe(true);
    if (!result.converted) return;

    expect(result.type).toBe("video/mp4");
    expect(result.format).toContain("video/mp4 · WebCodecs / Mediabunny");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.duration).toBeGreaterThan(1);
    expect(result.lastProgress).toBe(100);
    expect(result.inspection.readable).toBe(true);
    expect(result.inspection.video).toBe(true);
    expect(result.inspection.videoDecodable).toBe(true);
    expect(result.inspection.audioTracks).toBe(1);
    expect(result.inspection.audioDecodable).toBe(true);
  });
});
