import { assert, assertEquals } from "./assert.ts";
import {
  BROWSER_PROFILES,
  BROWSER_PROFILE_IDS,
  type BrowserProfileId,
  clampCanvasDimensions,
  detectBrowserProfileId,
  resolveBrowserProfile,
} from "../src/lib/browserProfile.ts";
import { detectPlatform, type PlatformInfo } from "../src/lib/platform.ts";
import { defaultSettings, mergeSettings, resolveExecutionProfile } from "../src/lib/settings.ts";

function fakePlatform(
  engine: PlatformInfo["engine"],
  deviceClass: PlatformInfo["deviceClass"],
  os: PlatformInfo["os"],
  overrides: Partial<PlatformInfo> = {},
): PlatformInfo {
  return {
    ...detectPlatform(),
    deviceClass,
    os,
    engine,
    cores: 8,
    memoryGB: engine === "Blink" ? 8 : null,
    touch: deviceClass !== "desktop",
    webgl2: true,
    webgpu: true,
    offscreenCanvas: true,
    webCodecs: true,
    crossOriginIsolated: true,
    tier: deviceClass === "mobile" ? "balanced" : "powerful",
    ...overrides,
  };
}

const DETECTION_CASES: ReadonlyArray<
  [PlatformInfo["engine"], PlatformInfo["deviceClass"], PlatformInfo["os"], BrowserProfileId]
> = [
  ["Blink", "desktop", "Windows", "chromium-desktop"],
  ["Blink", "mobile", "Android", "chromium-mobile"],
  ["WebKit", "desktop", "macOS", "webkit-desktop"],
  ["WebKit", "mobile", "iOS", "webkit-mobile"],
  // All iOS browsers run on WebKit even if engine label varies
  ["Blink", "tablet", "iOS", "webkit-mobile"],
  ["Gecko", "desktop", "Linux", "gecko-desktop"],
  ["Gecko", "mobile", "Android", "gecko-mobile"],
];

Deno.test("browserProfile: detects all 6 engine/form-factor profiles accurately", () => {
  for (const [engine, deviceClass, os, expected] of DETECTION_CASES) {
    assertEquals(detectBrowserProfileId(fakePlatform(engine, deviceClass, os)), expected);
  }
});

Deno.test("browserProfile: clampCanvasDimensions enforces iOS WebKit 16 MP ceiling without upscaling", () => {
  const ios = BROWSER_PROFILES["webkit-mobile"];
  // 24 MP image (6000x4000) exceeds both 4096 edge and 16 MP area
  const clamped = clampCanvasDimensions(6000, 4000, ios);
  assert(clamped.clamped, "Expected 6000x4000 to be clamped on webkit-mobile");
  assert(clamped.width <= 4096 && clamped.height <= 4096, "Edge must stay <= 4096");
  assert(clamped.width * clamped.height <= ios.canvas.maxCanvasPixels, "Area must stay <= 16 MP");

  // 4096x4096 (16,777,216 px) still exceeds 16,000,000 px area cap and gets scaled cleanly
  const square4k = clampCanvasDimensions(4096, 4096, ios);
  assert(square4k.clamped, "Expected 4096x4096 to clamp to <= 16 MP area");
  assert(square4k.width * square4k.height <= ios.canvas.maxCanvasPixels);

  // Small image is never upscaled
  const small = clampCanvasDimensions(800, 600, ios);
  assertEquals(small, { width: 800, height: 600, clamped: false });
});

Deno.test("browserProfile: resolveExecutionProfile integrates browser limits and manual overrides", () => {
  const s = defaultSettings();
  const iosProfile = resolveExecutionProfile(
    s,
    fakePlatform("WebKit", "mobile", "iOS", { tier: "balanced" }),
  );
  assertEquals(
    {
      id: iosProfile.browserProfile.id,
      maxConcurrentImages: iosProfile.maxConcurrentImages,
      maxDecodedImageDimension: iosProfile.maxDecodedImageDimension,
      aiBackend: iosProfile.aiBackendPreference,
      releaseWebGL: iosProfile.browserProfile.canvas.releaseWebGLContextAfterResize,
      offscreen: iosProfile.browserProfile.canvas.useOffscreenCanvas,
    },
    {
      id: "webkit-mobile",
      maxConcurrentImages: 1,
      maxDecodedImageDimension: 4096,
      aiBackend: "wasm",
      releaseWebGL: true,
      offscreen: false,
    },
  );

  const geckoDesktop = resolveExecutionProfile(
    s,
    fakePlatform("Gecko", "desktop", "Windows", { tier: "powerful" }),
  );
  assertEquals(geckoDesktop.browserProfile.id, "gecko-desktop");
  assertEquals(geckoDesktop.browserProfile.media.preferredVideoCodec, "vp9");
  assertEquals(geckoDesktop.aiBackendPreference, "wasm");

  // Manual browserProfile override in settings is validated and honored
  const merged = mergeSettings(s, { browserProfile: "webkit-mobile" });
  assertEquals(merged.browserProfile, "webkit-mobile");
  const manualProfile = resolveExecutionProfile(
    merged,
    fakePlatform("Blink", "desktop", "Windows", { tier: "powerful" }),
  );
  assertEquals(manualProfile.browserProfileSource, "manual");
  assertEquals(manualProfile.browserProfile.id, "webkit-mobile");
  assertEquals(manualProfile.maxConcurrentImages, 1);
  assertEquals(manualProfile.maxDecodedImageDimension, 4096);

  // Invalid persisted browserProfile falls back safely to 'auto'
  const sanitized = mergeSettings(s, { browserProfile: "bogus-engine" });
  assertEquals(sanitized.browserProfile, "auto");
  assertEquals(resolveBrowserProfile("auto", null).id, "chromium-desktop");
  assertEquals(BROWSER_PROFILE_IDS.length, 6);

  // Balanced mode with browserProfile 'auto' still enforces the detected profile concurrency cap,
  // while preserving explicit concurrency overrides.
  const balancedIos = resolveExecutionProfile(
    mergeSettings(s, { resourceMode: "balanced", browserProfile: "auto" }),
    fakePlatform("WebKit", "mobile", "iOS", { tier: "balanced" }),
  );
  assertEquals(balancedIos.maxConcurrentImages, 1);

  const balancedExplicit = resolveExecutionProfile(
    mergeSettings(s, {
      resourceMode: "balanced",
      browserProfile: "auto",
      resourceLimits: { ...s.resourceLimits, concurrency: 3 },
    }),
    fakePlatform("WebKit", "mobile", "iOS", { tier: "balanced" }),
  );
  assertEquals(balancedExplicit.maxConcurrentImages, 3);
});
