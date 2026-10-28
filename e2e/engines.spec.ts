import { test, expect } from "@playwright/test";
import {
  audioBitrateFor,
  videoBitrateFor,
  webCodecsQuality,
  webCodecsRouteFor,
  webCodecsRouteLabel,
  type WebCodecsRoute,
} from "../src/lib/webcodecsVideo";
import { planVideoSize } from "../src/lib/videoMeta";
import {
  SSIM_FLOOR,
  computeSsim,
  decideQualityGuard,
  planOutputSize,
  sampleLuma,
} from "../src/lib/qualityGuard";

/**
 * Pure Node tests for the WebCodecs/Mediabunny routing rules, video size and
 * bitrate planning, and the image SSIM/scale guard. None of these modules
 * touch the DOM at import time, so the same assertions run under every
 * Playwright project without a page (or a browser).
 */

const MP4_AVC: WebCodecsRoute = {
  container: "mp4",
  mime: "video/mp4",
  videoCodec: "avc",
  audioCodec: "aac",
};

test.describe("WebCodecs routing", () => {
  test("routes each supported codec to a real container + audio codec", () => {
    expect(webCodecsRouteFor({ videoCodec: "h264" })).toEqual({
      container: "mp4",
      mime: "video/mp4",
      videoCodec: "avc",
      audioCodec: "aac",
    });
    expect(webCodecsRouteFor({ videoCodec: "h265" })).toEqual({
      container: "mp4",
      mime: "video/mp4",
      videoCodec: "hevc",
      audioCodec: "aac",
    });
    expect(webCodecsRouteFor({ videoCodec: "av1" })).toEqual({
      container: "mp4",
      mime: "video/mp4",
      videoCodec: "av1",
      audioCodec: "aac",
    });
    expect(webCodecsRouteFor({ videoCodec: "vp9" })).toEqual({
      container: "webm",
      mime: "video/webm",
      videoCodec: "vp9",
      audioCodec: "opus",
    });
    expect(webCodecsRouteFor({ videoCodec: "vp8" })).toEqual({
      container: "webm",
      mime: "video/webm",
      videoCodec: "vp8",
      audioCodec: "opus",
    });
  });

  test("defaults an unspecified codec to MP4/AVC", () => {
    expect(webCodecsRouteFor({})).toEqual(MP4_AVC);
  });

  test("declines every request that needs FFmpeg semantics", () => {
    expect(webCodecsRouteFor({ videoTenBit: true })).toBeNull();
    expect(webCodecsRouteFor({ videoProxy: true })).toBeNull();
    expect(webCodecsRouteFor({ videoTwoPass: true })).toBeNull();
    expect(webCodecsRouteFor({ audioPassthrough: true })).toBeNull();
    expect(webCodecsRouteFor({ audioTrackMode: "all" })).toBeNull();
    expect(webCodecsRouteFor({ subtitleMode: "all" })).toBeNull();
  });

  test("labels the route with its real MIME type", () => {
    expect(webCodecsRouteLabel(MP4_AVC)).toContain("video/mp4");
    expect(
      webCodecsRouteLabel({ ...MP4_AVC, container: "webm", mime: "video/webm" }),
    ).toContain("video/webm");
  });

  test("clamps quality into Mediabunny's 0–1 range", () => {
    expect(webCodecsQuality({ quality: 0.82 })).toBe(0.82);
    expect(webCodecsQuality({ quality: 0 })).toBe(0.01);
    expect(webCodecsQuality({ quality: 5 })).toBe(0.99);
    expect(webCodecsQuality({})).toBe(0.75);
  });

  test("reserves the container's audio bitrate in target-size math", () => {
    expect(audioBitrateFor(MP4_AVC)).toBe(128_000);
    expect(audioBitrateFor({ ...MP4_AVC, audioCodec: "opus" })).toBe(96_000);
  });

  test("passes an explicit video bitrate through unchanged", () => {
    expect(videoBitrateFor({ videoBitrate: 2_500_000 }, 30, MP4_AVC)).toBe(
      2_500_000,
    );
  });

  test("budgets video from target size minus audio and overhead", () => {
    // 30s target of 9 MB ≈ 2.4 Mbps total; subtract 128k audio + 2% overhead.
    const bps = videoBitrateFor({ targetSizeKB: 9 * 1024 }, 30, MP4_AVC);
    const total = (9 * 1024 * 1024 * 8) / 30;
    expect(bps).not.toBeNull();
    expect(bps!).toBeLessThan(total);
    expect(bps!).toBeGreaterThan(total - 128_000 - total * 0.02 - 2);
    expect(videoBitrateFor({ targetSizeKB: 9 * 1024 }, 30, MP4_AVC, false)).toBe(
      Math.round(total - total * 0.02),
    );
  });

  test("never budgets below a usable floor", () => {
    expect(videoBitrateFor({ targetSizeKB: 1 }, 3600, MP4_AVC)).toBe(32_000);
  });

  test("returns null when the user chose quality mode", () => {
    expect(videoBitrateFor({ quality: 0.8 }, 30, MP4_AVC)).toBeNull();
  });
});

test.describe("video size planning", () => {
  test("keeps the source size when no width cap is set", () => {
    expect(planVideoSize(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
      resized: false,
      scale: 1,
    });
  });

  test("never upscales a source smaller than the cap", () => {
    expect(planVideoSize(640, 360, 1920)).toEqual({
      width: 640,
      height: 360,
      resized: false,
      scale: 1,
    });
  });

  test("downscales proportionally and keeps even dimensions", () => {
    expect(planVideoSize(1920, 1080, 1280)).toEqual({
      width: 1280,
      height: 720,
      resized: true,
      scale: 1280 / 1920,
    });
    const odd = planVideoSize(1919, 1079, 1000);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    expect(odd.width).toBe(1000);
  });
});

test.describe("image output-size planning", () => {
  test("does not upscale when either cap exceeds the source", () => {
    expect(planOutputSize(800, 600, 4000, 4000)).toEqual({
      width: 800,
      height: 600,
      resized: false,
      scale: 1,
    });
    expect(planOutputSize(800, 600, 0, 0)).toEqual({
      width: 800,
      height: 600,
      resized: false,
      scale: 1,
    });
  });

  test("clamps by width and height independently", () => {
    const byWidth = planOutputSize(4000, 3000, 2000, 4000);
    expect(byWidth).toEqual({
      width: 2000,
      height: 1500,
      resized: true,
      scale: 0.5,
    });
    const byHeight = planOutputSize(4000, 3000, 4000, 1200);
    expect(byHeight).toEqual({
      width: 1600,
      height: 1200,
      resized: true,
      scale: 0.4,
    });
    // The tighter of the two limits wins.
    expect(planOutputSize(4000, 3000, 2000, 1200).width).toBe(1600);
  });

  test("keeps at least a 1px dimension", () => {
    expect(planOutputSize(4000, 1, 10, 10).height).toBe(1);
  });
});

test.describe("SSIM measurement", () => {
  function solid(
    width: number,
    height: number,
    value: number,
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = value;
      rgba[i + 1] = value;
      rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
    return rgba;
  }

  test("samples large images to a small luma grid", () => {
    const luma = sampleLuma(solid(1920, 1080, 128), 1920, 1080);
    expect(luma.length).toBe(96 * 54);
    expect(luma.every((v) => Math.abs(v - 128) < 0.01)).toBe(true);
  });

  test("returns 1 for identical images, including flat ones", () => {
    const a = sampleLuma(solid(200, 100, 90), 200, 100);
    expect(computeSsim(a, a)).toBe(1);
    expect(computeSsim(a, sampleLuma(solid(200, 100, 90), 200, 100))).toBe(1);
  });

  test("scores unrelated images low and rejects mismatched lengths", () => {
    const black = sampleLuma(solid(96, 96, 0), 96, 96);
    const white = sampleLuma(solid(96, 96, 255), 96, 96);
    expect(computeSsim(black, white)).toBeLessThan(0.1);
    expect(computeSsim(black, white.slice(0, 10))).toBe(0);
    expect(computeSsim(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});

test.describe("quality-guard decisions", () => {
  const planned = { width: 1600, height: 1200 };

  test("accepts PNG output without an SSIM pass", () => {
    expect(
      decideQualityGuard({
        format: "image/png",
        ssim: 0.2,
        planned,
        actual: planned,
      }),
    ).toEqual({ action: "ok" });
  });

  test("accepts a lossy encode above the SSIM floor", () => {
    expect(
      decideQualityGuard({
        format: "image/webp",
        ssim: SSIM_FLOOR + 0.01,
        planned,
        actual: planned,
      }),
    ).toEqual({ action: "ok" });
  });

  test("warns — never rescales — when the output is smaller than planned", () => {
    const decision = decideQualityGuard({
      format: "image/webp",
      ssim: 1,
      planned,
      actual: { width: 800, height: 600 },
    });
    expect(decision.action).toBe("warn");
    if (decision.action === "warn") expect(decision.code).toBe("resolution-lost");
  });

  test("warns in target-size mode instead of silently raising quality", () => {
    const decision = decideQualityGuard({
      format: "image/jpeg",
      ssim: 0.6,
      targetSizeKB: 200,
      planned,
      actual: planned,
    });
    expect(decision.action).toBe("warn");
    if (decision.action === "warn") {
      expect(decision.code).toBe("target-size-quality");
    }
  });

  test("does not second-guess an explicit aggressive quality", () => {
    expect(
      decideQualityGuard({
        format: "image/webp",
        ssim: 0.55,
        requestedQuality: 0.5,
        planned,
        actual: planned,
      }),
    ).toEqual({ action: "ok" });
  });

  test("retries once at a higher quality, never lower", () => {
    const decision = decideQualityGuard({
      format: "image/webp",
      ssim: 0.7,
      requestedQuality: 0.82,
      planned,
      actual: planned,
    });
    expect(decision.action).toBe("retry");
    if (decision.action === "retry") {
      expect(decision.quality).toBeGreaterThan(0.82);
      expect(decision.quality).toBeLessThanOrEqual(0.98);
    }
  });

  test("reports a warning after the retry still measures low", () => {
    const decision = decideQualityGuard({
      format: "image/webp",
      ssim: 0.7,
      requestedQuality: 0.9,
      alreadyRetried: true,
      planned,
      actual: planned,
    });
    expect(decision.action).toBe("warn");
    if (decision.action === "warn") expect(decision.code).toBe("low-ssim");
  });

  test("warns instead of retrying at or above the quality ceiling", () => {
    const decision = decideQualityGuard({
      format: "image/webp",
      ssim: 0.7,
      requestedQuality: 0.98,
      planned,
      actual: planned,
    });
    expect(decision.action).toBe("warn");
  });
});
