import { assert, assertEquals } from "./assert.ts";
import {
  defaultSettings,
  resolveExecutionProfile,
} from "../src/lib/settings.ts";

Deno.test("settings: defaultSettings contains valid engine defaults", () => {
  const s = defaultSettings();
  assertEquals(s.resourceMode, "auto");
  assertEquals(s.engines.images.quality, 82);
  assertEquals(s.engines.images.format, "image/webp");
  assertEquals(s.engines.pdf.level, "recommended");
  assertEquals(s.engines.video.preset, "fast");
  assertEquals(s.engines.ocr.engine, "tesseract");
});

Deno.test("settings: resolveExecutionProfile honors resourceMode overrides", () => {
  const s = defaultSettings();
  s.resourceMode = "memory-saver";
  const profile = resolveExecutionProfile(s);
  assertEquals(profile.maxConcurrentImages, 1);
  assertEquals(profile.maxDecodedImageDimension, 6000);

  s.resourceMode = "maximum";
  const maxProfile = resolveExecutionProfile(s);
  assertEquals(maxProfile.maxConcurrentImages, 3);
  assertEquals(maxProfile.maxDecodedImageDimension, 0);
});
