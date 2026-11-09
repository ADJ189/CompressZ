import { assert, assertEquals } from "./assert.ts";
import { planVideoSize } from "../src/lib/videoMeta.ts";

Deno.test("videoMeta: planVideoSize rounds odd dimensions down without upscaling", () => {
  const result = planVideoSize(641, 481);
  assertEquals(result.width, 640);
  assertEquals(result.height, 480);
  assertEquals(result.resized, true);
  assert(result.scale < 1);
});

Deno.test("videoMeta: planVideoSize keeps even dimensions untouched when no cap", () => {
  const result = planVideoSize(1920, 1080);
  assertEquals(result.width, 1920);
  assertEquals(result.height, 1080);
  assertEquals(result.resized, false);
  assertEquals(result.scale, 1);
});

Deno.test("videoMeta: planVideoSize never exceeds odd maxWidth cap", () => {
  const result = planVideoSize(1920, 1080, 1001);
  assert(result.width <= 1001);
  assertEquals(result.width % 2, 0);
  assertEquals(result.height % 2, 0);
  assertEquals(result.width, 1000);
});
