import { assert, assertEquals } from "./assert.ts";
import { detectPlatform, recommend, type PlatformInfo } from "../src/lib/platform.ts";

Deno.test("platform: detects platform snapshot safely", () => {
  const p = detectPlatform();
  assert(p.tier === "efficient" || p.tier === "balanced" || p.tier === "powerful");
  assert(typeof p.cores === "number");
  assert(typeof p.webgl2 === "boolean");
});

Deno.test("platform: recommend maps performance tiers accurately", () => {
  const mockEfficient: PlatformInfo = {
    deviceClass: "mobile",
    os: "Android",
    engine: "Blink",
    cores: 2,
    memoryGB: 2,
    touch: true,
    gpuRenderer: null,
    webgl2: false,
    webgpu: false,
    offscreenCanvas: false,
    webCodecs: false,
    crossOriginIsolated: false,
    connection: "3g",
    saveData: false,
    reducedMotion: false,
    tier: "efficient",
  };

  const recEff = recommend(mockEfficient);
  assertEquals(recEff.aiModelTier, "efficient");
  assertEquals(recEff.batchConcurrency, 1);
  assertEquals(recEff.videoPreset, "ultrafast");

  const mockPowerful: PlatformInfo = {
    ...mockEfficient,
    deviceClass: "desktop",
    os: "Windows",
    cores: 16,
    memoryGB: 32,
    webgl2: true,
    tier: "powerful",
  };

  const recPow = recommend(mockPowerful);
  assertEquals(recPow.aiModelTier, "powerful");
  assertEquals(recPow.batchConcurrency, 3);
  assertEquals(recPow.videoPreset, "medium");
});
