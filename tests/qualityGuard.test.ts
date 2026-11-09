import { assert, assertEquals } from "./assert.ts";
import { planOutputSize } from "../src/lib/qualityGuard.ts";

Deno.test("qualityGuard: planOutputSize downscales maintaining aspect ratio", () => {
  const result = planOutputSize(4000, 2000, 2000);
  assertEquals(result.width, 2000);
  assertEquals(result.height, 1000);
  assert(result.scale < 1);
});

Deno.test("qualityGuard: planOutputSize never upscales smaller images", () => {
  const result = planOutputSize(800, 600, 1920);
  assertEquals(result.width, 800);
  assertEquals(result.height, 600);
  assertEquals(result.scale, 1);
});

Deno.test("qualityGuard: planOutputSize uncapped when maxDim is 0", () => {
  const result = planOutputSize(5000, 3000, 0);
  assertEquals(result.width, 5000);
  assertEquals(result.height, 3000);
  assertEquals(result.scale, 1);
});
