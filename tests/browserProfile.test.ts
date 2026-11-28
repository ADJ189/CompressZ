import { assert, assertEquals } from "./assert.ts";
import {
  BROWSER_PROFILES,
  BROWSER_PROFILE_IDS,
  clampCanvasDimensions,
  detectBrowserProfileId,
  resolveBrowserProfile,
} from "../src/lib/browserProfile.ts";
import { defaultSettings, mergeSettings, resolveExecutionProfile } from "../src/lib/settings.ts";
import type { PlatformInfo } from "../src/lib/platform.ts";

function fakePlatform(
  engine: PlatformInfo["engine"],
  deviceClass: PlatformInfo["deviceClass"],
  os: PlatformInfo["os"],
  overrides: Partial<PlatformInfo> = {},
): PlatformInfo {
  return {
    deviceClass,
    os,
    engine,
    cores: 8,
    memoryGB: engine === "Blink" ? 8 : null,
    touch: deviceClass !== "desktop",
    gpuRenderer: null,
    webgl2: true,
    webgpu: true,
    offscreenCanvas: true,
    webCodecs: true,
    crossOriginIsolated: true,
    connection: null,
    saveData: false,
    reducedMotion: false,
    tier: deviceClass === "mobile" ? "balanced" : "powerful",
    ...overrides,
  };
}

Deno.test("browserProfile: detects all 6 engine/form-factor profiles accurately", () => {
  assertEquals(
    detectBrowserProfileId(fakePlatform("Blink", "desktop", "Windows")),
    "chromium-desktop",
  );
  assertEquals(
    detectBrowserProfileId(fakePlatform("Blink", "mobile", "Android")),
    "chromium-mobile",
  );
  assertEquals(
    detectBrowserProfileId(fakePlatform("WebKit", "desktop", "macOS")),
    "webkit-desktop",
  );
  assertEquals(
    detectBrowserProfileId(fakePlatform("WebKit", "mobile", "iOS")),
    "webkit-mobile",
  );
  // All iOS browsers run on WebKit even if engine label varies
  assertEquals(
    detectBrowserProfileId(fakePlatform("Blink", "tablet", "iOS")),
    "webkit-mobile",
  );
  assertEquals(
    detectBrowserProfileId(fakePlatform("Gecko", "desktop", "Linux")),
    "gecko-desktop",
  );
  assertEquals(
    detectBrowserProfileId(fakePlatform("Gecko", "mobile", "Android")),
    "gecko-mobile",
  );
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
  assertEquals(iosProfile.browserProfile.id, "webkit-mobile");
  assertEquals(iosProfile.maxConcurrentImages, 1);
  assertEquals(iosProfile.maxDecodedImageDimension, 4096);
  assertEquals(iosProfile.aiBackendPreference, "wasm");
  assertEquals(iosProfile.browserProfile.canvas.releaseWebGLContextAfterResize, true);
  assertEquals(iosProfile.browserProfile.canvas.useOffscreenCanvas, false);

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
});
