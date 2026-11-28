import { assert, assertEquals } from "./assert.ts";
import {
  AVIF_DEFAULT_OPTIONS,
  JSQUASH_AVIF_ST_URL,
  avifCqLevelFromUnit,
  avifQualityFromUnit,
  encodeAvifWasm,
  setAvifEncoderForTesting,
} from "../src/lib/avifEncode.ts";
import { deduplicateBatchNames } from "../src/lib/batchDownload.ts";

Deno.test("avifEncode: targets single-threaded codec/enc/avif_enc.js (never avif_enc_mt)", async () => {
  assertEquals(
    JSQUASH_AVIF_ST_URL,
    "https://esm.sh/@jsquash/avif@1.3.0/codec/enc/avif_enc.js",
  );
  assert(!JSQUASH_AVIF_ST_URL.includes("avif_enc_mt"));
  assertEquals(AVIF_DEFAULT_OPTIONS.speed, 6);

  const workerSrc = await Deno.readTextFile(
    new URL("../src/lib/avifWorker.ts", import.meta.url),
  );
  const codeOnly = workerSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(codeOnly.includes("avif_enc.js"));
  assert(!codeOnly.includes("avif_enc_mt"));
});

Deno.test("avifEncode: falls back cleanly when global Worker is undefined", async () => {
  const globalObj = globalThis as unknown as { Worker?: unknown };
  const origWorker = globalObj.Worker;
  globalObj.Worker = undefined;
  const fakeImage = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4) } as ImageData;

  setAvifEncoderForTesting(async (_data, options = {}) => {
    assertEquals(options.speed, 6);
    assertEquals(options.cqLevel, 19);
    return new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70]).buffer;
  });

  try {
    const blob = await encodeAvifWasm(fakeImage, 0.7);
    assertEquals(blob.type, "image/avif");
    assertEquals(blob.size, 8);
  } finally {
    setAvifEncoderForTesting(null);
    globalObj.Worker = origWorker;
  }
});

Deno.test("avifEncode: avifQualityFromUnit maps 0.01..0.99 to 1..100", () => {
  assertEquals(avifQualityFromUnit(0.01), 1);
  assertEquals(avifQualityFromUnit(0.7), 70);
  assertEquals(avifQualityFromUnit(0.82), 82);
  assertEquals(avifQualityFromUnit(0.99), 99);
  assertEquals(avifQualityFromUnit(2), 99);
  assertEquals(avifQualityFromUnit(-1), 1);
  assertEquals(avifQualityFromUnit(Number.NaN), 70);
});

Deno.test("avifEncode: encodeAvifWasm maps quality to inverted cqLevel with speed 6 and produces distinct outputs", async () => {
  assertEquals(avifCqLevelFromUnit(0.99), 1);
  assertEquals(avifCqLevelFromUnit(0.7), 19);
  assertEquals(avifCqLevelFromUnit(0.01), 62);
  assertEquals(avifCqLevelFromUnit(Number.NaN), 19);

  const seenOptions: Array<{ cqLevel?: number; speed?: number }> = [];
  const fakeImage = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) } as ImageData;

  setAvifEncoderForTesting(async (_data, options = {}) => {
    seenOptions.push(options);
    // Simulate higher cqLevel (lower visual quality) producing a smaller byte payload
    const byteCount = Math.max(8, 96 - (options.cqLevel ?? 33));
    const bytes = new Uint8Array(byteCount).fill(options.cqLevel ?? 33);
    return bytes.buffer;
  });

  try {
    const lowBlob = await encodeAvifWasm(fakeImage, 0.2);
    const highBlob = await encodeAvifWasm(fakeImage, 0.9);

    assertEquals(seenOptions.length, 2);
    assertEquals(seenOptions[0].speed, 6);
    assertEquals(seenOptions[1].speed, 6);
    assert(
      (seenOptions[0].cqLevel ?? 0) > (seenOptions[1].cqLevel ?? 0),
      "Higher quality must produce a lower cqLevel",
    );
    assertEquals(lowBlob.type, "image/avif");
    assertEquals(highBlob.type, "image/avif");

    const lowBytes = new Uint8Array(await lowBlob.arrayBuffer());
    const highBytes = new Uint8Array(await highBlob.arrayBuffer());
    assert(lowBytes.length !== highBytes.length || lowBytes[0] !== highBytes[0], "Low and high quality outputs must differ");
  } finally {
    setAvifEncoderForTesting(null);
  }
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
