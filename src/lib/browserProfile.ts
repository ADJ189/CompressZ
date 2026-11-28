/**
 * browserProfile.ts — Browser-engine & form-factor optimization profiles.
 *
 * Maps each real browser runtime (Chromium/Blink, Safari/WebKit, Firefox/Gecko,
 * split across Desktop and Mobile) to concrete engine and UI tuning parameters:
 *   - Canvas dimension and pixel-area ceilings (e.g. iOS WebKit's 16.7 MP limit)
 *   - WebGL2 context lifecycle & Canvas2D `desynchronized` gating
 *   - WebP canvas encoding & WASM SIMD capability probes
 *   - WebCodecs strategy, preferred codecs, and MediaRecorder MIME order
 *   - ONNX/WASM thread limits and OCR/PDF render budgets
 *   - UI vibrancy blur intensity, hover mode, and thumbnail batch budgets
 *
 * Pure TypeScript, zero Svelte imports, safe in headless Node/Deno unit tests.
 */

import type { BrowserEngine, DeviceClass, PlatformInfo } from "./platform";
import type { ImageFormat, VideoCodec } from "./types";

export type BrowserProfileId =
  | "chromium-desktop"
  | "chromium-mobile"
  | "webkit-desktop"
  | "webkit-mobile"
  | "gecko-desktop"
  | "gecko-mobile";

export type BrowserProfileSetting = "auto" | BrowserProfileId;

export type WebCodecsStrategy = "prefer-native" | "conservative" | "ffmpeg-first";

export interface BrowserProfile {
  id: BrowserProfileId;
  label: string;
  shortLabel: string;
  engine: BrowserEngine;
  formFactor: "desktop" | "mobile";
  summary: string;
  canvas: {
    maxCanvasDim: number;
    maxCanvasPixels: number;
    useOffscreenCanvas: boolean;
    prefer2DDesynchronized: boolean;
    releaseWebGLContextAfterResize: boolean;
    preferredImageFormat: ImageFormat;
    preferredImageQuality: number;
  };
  media: {
    webCodecsStrategy: WebCodecsStrategy;
    preferredVideoCodec: VideoCodec;
    defaultVideoPreset: "ultrafast" | "fast" | "medium";
    mediaRecorderMimeOrder: readonly string[];
  };
  wasm: {
    maxBatchConcurrency: number;
    maxHeavyJobs: number;
    onnxMaxThreads: number;
    preferWebGpu: boolean;
    ocrRecommendedEngine: "tesseract" | "paddle";
    ocrMaxRenderDpi: number;
    pdfMaxRenderScale: number;
  };
  ui: {
    chromeStyle: "crisp-layered" | "vibrancy-glass" | "gecko-vibrant";
    backdropBlurPx: number;
    hoverMode: "fine-pointer" | "touch-first";
    eagerThumbnailCount: number;
    thumbnailScale: number;
  };
}

export const BROWSER_PROFILE_IDS: readonly BrowserProfileId[] = [
  "chromium-desktop",
  "chromium-mobile",
  "webkit-desktop",
  "webkit-mobile",
  "gecko-desktop",
  "gecko-mobile",
];

export const BROWSER_PROFILES: Record<BrowserProfileId, BrowserProfile> = {
  "chromium-desktop": {
    id: "chromium-desktop",
    label: "Chromium (Blink · Desktop)",
    shortLabel: "Blink Desktop",
    engine: "Blink",
    formFactor: "desktop",
    summary:
      "Full WebCodecs + WebGPU acceleration, OffscreenCanvas 2D desynchronized compositing, and up to 4 ONNX WASM threads.",
    canvas: {
      maxCanvasDim: 16384,
      maxCanvasPixels: 268_435_456,
      useOffscreenCanvas: true,
      prefer2DDesynchronized: true,
      releaseWebGLContextAfterResize: false,
      preferredImageFormat: "image/webp",
      preferredImageQuality: 82,
    },
    media: {
      webCodecsStrategy: "prefer-native",
      preferredVideoCodec: "h264",
      defaultVideoPreset: "fast",
      mediaRecorderMimeOrder: [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
      ],
    },
    wasm: {
      maxBatchConcurrency: 3,
      maxHeavyJobs: 2,
      onnxMaxThreads: 4,
      preferWebGpu: true,
      ocrRecommendedEngine: "tesseract",
      ocrMaxRenderDpi: 200,
      pdfMaxRenderScale: 3.0,
    },
    ui: {
      chromeStyle: "crisp-layered",
      backdropBlurPx: 20,
      hoverMode: "fine-pointer",
      eagerThumbnailCount: 24,
      thumbnailScale: 0.25,
    },
  },
  "chromium-mobile": {
    id: "chromium-mobile",
    label: "Chromium (Blink · Mobile)",
    shortLabel: "Blink Mobile",
    engine: "Blink",
    formFactor: "mobile",
    summary:
      "Bounded 6K canvas cap, eager WebGL2 context release, conservative WASM thread pool, and reduced backdrop blur for mobile GPUs.",
    canvas: {
      maxCanvasDim: 6000,
      maxCanvasPixels: 36_000_000,
      useOffscreenCanvas: true,
      prefer2DDesynchronized: true,
      releaseWebGLContextAfterResize: true,
      preferredImageFormat: "image/webp",
      preferredImageQuality: 80,
    },
    media: {
      webCodecsStrategy: "conservative",
      preferredVideoCodec: "h264",
      defaultVideoPreset: "ultrafast",
      mediaRecorderMimeOrder: [
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
      ],
    },
    wasm: {
      maxBatchConcurrency: 2,
      maxHeavyJobs: 1,
      onnxMaxThreads: 2,
      preferWebGpu: false,
      ocrRecommendedEngine: "tesseract",
      ocrMaxRenderDpi: 150,
      pdfMaxRenderScale: 2.0,
    },
    ui: {
      chromeStyle: "crisp-layered",
      backdropBlurPx: 12,
      hoverMode: "touch-first",
      eagerThumbnailCount: 10,
      thumbnailScale: 0.2,
    },
  },
  "webkit-desktop": {
    id: "webkit-desktop",
    label: "Safari (WebKit · Desktop)",
    shortLabel: "WebKit Desktop",
    engine: "WebKit",
    formFactor: "desktop",
    summary:
      "macOS vibrancy chrome, immediate WebGL2 context release to stay within Safari's context cap, and VideoToolbox-friendly H.264/MP4 routing.",
    canvas: {
      maxCanvasDim: 8192,
      maxCanvasPixels: 67_108_864,
      useOffscreenCanvas: true,
      prefer2DDesynchronized: false,
      releaseWebGLContextAfterResize: true,
      preferredImageFormat: "image/webp",
      preferredImageQuality: 82,
    },
    media: {
      webCodecsStrategy: "prefer-native",
      preferredVideoCodec: "h264",
      defaultVideoPreset: "fast",
      mediaRecorderMimeOrder: [
        "video/mp4",
        "video/webm;codecs=vp9",
        "video/webm",
      ],
    },
    wasm: {
      maxBatchConcurrency: 2,
      maxHeavyJobs: 1,
      onnxMaxThreads: 2,
      preferWebGpu: true,
      ocrRecommendedEngine: "tesseract",
      ocrMaxRenderDpi: 200,
      pdfMaxRenderScale: 2.5,
    },
    ui: {
      chromeStyle: "vibrancy-glass",
      backdropBlurPx: 20,
      hoverMode: "fine-pointer",
      eagerThumbnailCount: 24,
      thumbnailScale: 0.25,
    },
  },
  "webkit-mobile": {
    id: "webkit-mobile",
    label: "Safari (WebKit · Mobile)",
    shortLabel: "WebKit Mobile",
    engine: "WebKit",
    formFactor: "mobile",
    summary:
      "Enforces iOS 16 MP canvas ceiling, DOM canvas stability, single-thread WASM memory guard, and touch-optimized vibrancy.",
    canvas: {
      maxCanvasDim: 4096,
      maxCanvasPixels: 16_000_000,
      useOffscreenCanvas: false,
      prefer2DDesynchronized: false,
      releaseWebGLContextAfterResize: true,
      preferredImageFormat: "image/webp",
      preferredImageQuality: 80,
    },
    media: {
      webCodecsStrategy: "conservative",
      preferredVideoCodec: "h264",
      defaultVideoPreset: "ultrafast",
      mediaRecorderMimeOrder: ["video/mp4", "video/webm"],
    },
    wasm: {
      maxBatchConcurrency: 1,
      maxHeavyJobs: 1,
      onnxMaxThreads: 1,
      preferWebGpu: false,
      ocrRecommendedEngine: "tesseract",
      ocrMaxRenderDpi: 150,
      pdfMaxRenderScale: 1.5,
    },
    ui: {
      chromeStyle: "vibrancy-glass",
      backdropBlurPx: 12,
      hoverMode: "touch-first",
      eagerThumbnailCount: 8,
      thumbnailScale: 0.18,
    },
  },
  "gecko-desktop": {
    id: "gecko-desktop",
    label: "Firefox (Gecko · Desktop)",
    shortLabel: "Gecko Desktop",
    engine: "Gecko",
    formFactor: "desktop",
    summary:
      "Zen/Firefox vibrant chrome, VP9/WebM WebCodecs & MediaRecorder audio-capture support, and multi-thread WASM fallback.",
    canvas: {
      maxCanvasDim: 16384,
      maxCanvasPixels: 120_000_000,
      useOffscreenCanvas: true,
      prefer2DDesynchronized: false,
      releaseWebGLContextAfterResize: false,
      preferredImageFormat: "image/webp",
      preferredImageQuality: 82,
    },
    media: {
      webCodecsStrategy: "conservative",
      preferredVideoCodec: "vp9",
      defaultVideoPreset: "fast",
      mediaRecorderMimeOrder: [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ],
    },
    wasm: {
      maxBatchConcurrency: 2,
      maxHeavyJobs: 1,
      onnxMaxThreads: 4,
      preferWebGpu: false,
      ocrRecommendedEngine: "tesseract",
      ocrMaxRenderDpi: 200,
      pdfMaxRenderScale: 2.5,
    },
    ui: {
      chromeStyle: "gecko-vibrant",
      backdropBlurPx: 18,
      hoverMode: "fine-pointer",
      eagerThumbnailCount: 24,
      thumbnailScale: 0.25,
    },
  },
  "gecko-mobile": {
    id: "gecko-mobile",
    label: "Firefox (Gecko · Mobile)",
    shortLabel: "Gecko Mobile",
    engine: "Gecko",
    formFactor: "mobile",
    summary:
      "Bounded 4K canvas memory guard, ultrafast media fallback, VP9/WebM support, and lightweight mobile blur.",
    canvas: {
      maxCanvasDim: 4096,
      maxCanvasPixels: 16_777_216,
      useOffscreenCanvas: true,
      prefer2DDesynchronized: false,
      releaseWebGLContextAfterResize: true,
      preferredImageFormat: "image/webp",
      preferredImageQuality: 80,
    },
    media: {
      webCodecsStrategy: "conservative",
      preferredVideoCodec: "vp9",
      defaultVideoPreset: "ultrafast",
      mediaRecorderMimeOrder: [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ],
    },
    wasm: {
      maxBatchConcurrency: 1,
      maxHeavyJobs: 1,
      onnxMaxThreads: 2,
      preferWebGpu: false,
      ocrRecommendedEngine: "tesseract",
      ocrMaxRenderDpi: 150,
      pdfMaxRenderScale: 1.5,
    },
    ui: {
      chromeStyle: "gecko-vibrant",
      backdropBlurPx: 12,
      hoverMode: "touch-first",
      eagerThumbnailCount: 8,
      thumbnailScale: 0.18,
    },
  },
};

function normalizeFormFactor(deviceClass: DeviceClass): "desktop" | "mobile" {
  return deviceClass === "desktop" ? "desktop" : "mobile";
}

/**
 * Resolve the canonical BrowserProfileId from a PlatformInfo snapshot.
 * On iOS/iPadOS all browsers run on WebKit regardless of brand token, so
 * OS === "iOS" maps cleanly to `webkit-mobile`.
 */
export function detectBrowserProfileId(
  info?: Pick<PlatformInfo, "engine" | "deviceClass" | "os"> | null,
): BrowserProfileId {
  if (!info) return "chromium-desktop";
  const form = normalizeFormFactor(info.deviceClass);
  if (info.os === "iOS") return "webkit-mobile";
  if (info.engine === "WebKit") {
    return form === "mobile" ? "webkit-mobile" : "webkit-desktop";
  }
  if (info.engine === "Gecko") {
    return form === "mobile" ? "gecko-mobile" : "gecko-desktop";
  }
  return form === "mobile" ? "chromium-mobile" : "chromium-desktop";
}

export function getBrowserProfile(id: BrowserProfileId): BrowserProfile {
  return BROWSER_PROFILES[id];
}

export function resolveBrowserProfile(
  setting: BrowserProfileSetting,
  info?: Pick<PlatformInfo, "engine" | "deviceClass" | "os"> | null,
): BrowserProfile {
  if (setting !== "auto" && Object.hasOwn(BROWSER_PROFILES, setting)) {
    return BROWSER_PROFILES[setting];
  }
  return BROWSER_PROFILES[detectBrowserProfileId(info)];
}

/**
 * Clamp target dimensions so they never exceed either the profile's single-edge
 * ceiling (`maxCanvasDim`) or its total pixel area ceiling (`maxCanvasPixels`),
 * and never upscale past (width, height).
 */
export function clampCanvasDimensions(
  width: number,
  height: number,
  profile: Pick<BrowserProfile, "canvas">,
): { width: number; height: number; clamped: boolean } {
  const w0 = Math.max(1, Math.round(width));
  const h0 = Math.max(1, Math.round(height));
  let scale = 1;

  const { maxCanvasDim, maxCanvasPixels } = profile.canvas;
  if (maxCanvasDim > 0 && (w0 > maxCanvasDim || h0 > maxCanvasDim)) {
    scale = Math.min(scale, maxCanvasDim / w0, maxCanvasDim / h0);
  }
  const scaledPixels = w0 * scale * (h0 * scale);
  if (maxCanvasPixels > 0 && scaledPixels > maxCanvasPixels) {
    scale *= Math.sqrt(maxCanvasPixels / scaledPixels);
  }

  if (scale >= 1) {
    return { width: w0, height: h0, clamped: false };
  }
  return {
    width: Math.max(1, Math.floor(w0 * scale)),
    height: Math.max(1, Math.floor(h0 * scale)),
    clamped: true,
  };
}

let _webpEncodeSupport: boolean | null = null;

/**
 * Feature-test whether this browser's Canvas 2D actually encodes `image/webp`.
 * Older Safari/WebKit versions silently fall back to `image/png` when asked
 * for `image/webp`; callers should check this before trusting a WebP output.
 */
export function supportsWebpCanvasEncode(): boolean {
  if (_webpEncodeSupport !== null) return _webpEncodeSupport;
  if (typeof document === "undefined") return true;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    _webpEncodeSupport = c
      .toDataURL("image/webp")
      .startsWith("data:image/webp");
  } catch {
    _webpEncodeSupport = false;
  }
  return _webpEncodeSupport;
}

let _wasmSimdSupport: boolean | null = null;

/**
 * Probe WebAssembly SIMD (v128) support using the minimal valid 16-byte SIMD
 * module. Returns false in restricted environments (e.g. iOS Lockdown Mode)
 * so Tesseract can choose its non-SIMD core instead of failing at init.
 */
export function supportsWasmSimd(): boolean {
  if (_wasmSimdSupport !== null) return _wasmSimdSupport;
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") {
    _wasmSimdSupport = false;
    return false;
  }
  try {
    // Minimal valid WASM module containing a v128.const opcode (0xfd 0x0c)
    const simdModule = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00,
      0x0a, 0x16, 0x01, 0x14, 0x00,
      0xfd, 0x0c,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x0b,
    ]);
    _wasmSimdSupport = WebAssembly.validate(simdModule);
  } catch {
    _wasmSimdSupport = false;
  }
  return _wasmSimdSupport;
}

/**
 * Apply the resolved browser profile attributes and CSS custom properties to
 * `document.documentElement` so layout, blur, and interaction CSS can adapt
 * cleanly per browser engine and form factor.
 */
export function applyBrowserProfileDom(profile: BrowserProfile): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.browserProfile = profile.id;
  root.dataset.browserEngine = profile.engine.toLowerCase();
  root.dataset.deviceForm = profile.formFactor;
  root.style.setProperty("--chrome-blur", `${profile.ui.backdropBlurPx}px`);
}
