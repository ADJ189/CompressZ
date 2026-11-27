import { assertEquals } from "./assert.ts";
import { avifQualityFromUnit } from "../src/lib/avifEncode.ts";
import { deduplicateBatchNames } from "../src/lib/batchDownload.ts";

Deno.test("avifEncode: avifQualityFromUnit maps 0.01..0.99 to 1..100", () => {
  assertEquals(avifQualityFromUnit(0.01), 1);
  assertEquals(avifQualityFromUnit(0.7), 70);
  assertEquals(avifQualityFromUnit(0.82), 82);
  assertEquals(avifQualityFromUnit(0.99), 99);
  assertEquals(avifQualityFromUnit(2), 99);
  assertEquals(avifQualityFromUnit(-1), 1);
  assertEquals(avifQualityFromUnit(Number.NaN), 70);
});

Deno.test("batchDownload: deduplicateBatchNames renames colliding output filenames", () => {
  const b1 = new Blob(["a"]);
  const b2 = new Blob(["b"]);
  const b3 = new Blob(["c"]);
  const b4 = new Blob(["d"]);

  const out = deduplicateBatchNames([
    { name: "photo.avif", blob: b1 },
    { name: "Photo.avif", blob: b2 },
    { name: "photo.avif", blob: b3 },
    { name: "other.avif", blob: b4 },
  ]);

  assertEquals(
    out.map((i) => i.name),
    ["photo.avif", "Photo (2).avif", "photo (3).avif", "other.avif"],
  );
});
