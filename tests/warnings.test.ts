import { assert, assertEquals } from "./assert.ts";
import { deduplicateWarnings, mergeWarnings } from "../src/lib/warnings.ts";
import { runPrintedOcr, terminateOcrWorkers } from "../src/lib/ocrEngines.ts";
import type { EngineWarning } from "../src/lib/types.ts";

Deno.test("warnings: deduplicateWarnings aggregates identical warnings with counts and upgrades severity", () => {
  const input: EngineWarning[] = [
    {
      code: "avif-wasm-fallback",
      engine: "image",
      severity: "info",
      message: "AVIF WASM encoding failed; saved as WebP instead.",
      detail: "network error",
    },
    {
      code: "avif-wasm-fallback",
      engine: "image",
      severity: "warn",
      message: "AVIF WASM encoding failed; saved as WebP instead.",
      detail: "network error",
    },
    {
      code: "low-ssim",
      engine: "image",
      severity: "warn",
      message: "Visual similarity (SSIM) fell below 0.90 at the requested quality.",
    },
  ];

  const deduped = deduplicateWarnings(input);
  assertEquals(deduped.length, 2);
  assertEquals(deduped[0].code, "avif-wasm-fallback");
  assertEquals(deduped[0].count, 2);
  assertEquals(deduped[0].severity, "warn");
  assertEquals(deduped[1].code, "low-ssim");
  assertEquals(deduped[1].count, 1);
});

Deno.test("warnings: mergeWarnings returns undefined when all groups are empty", () => {
  assertEquals(mergeWarnings(undefined, []), undefined);
  const merged = mergeWarnings(undefined, [
    { code: "a", engine: "video", message: "one" },
  ]);
  assertEquals(merged?.length, 1);
  assertEquals(merged?.[0].code, "a");
});

Deno.test("warnings: runPrintedOcr emits paddle-fallback-tesseract and ocr-low-confidence EngineWarnings", async () => {
  const globalObj = globalThis as unknown as { window?: unknown };
  const origWindow = globalObj.window;
  globalObj.window = {
    Tesseract: {
      createWorker: async () => ({
        recognize: async () => ({
          data: {
            text: "blurry scan",
            confidence: 42,
            lines: [
              {
                text: "blurry scan",
                confidence: 42,
                bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
                words: [],
              },
            ],
          },
        }),
        terminate: async () => {},
      }),
    },
  };

  try {
    const res = await runPrintedOcr({} as HTMLCanvasElement, {
      language: "eng",
      preferredEngine: "paddle",
    });

    assertEquals(res.engineId, "tesseract");
    const codes = (res.engineWarnings ?? []).map((w) => w.code);
    assert(codes.includes("paddle-fallback-tesseract"), "Expected paddle fallback warning");
    assert(codes.includes("ocr-low-confidence"), "Expected low confidence warning");
  } finally {
    await terminateOcrWorkers();
    globalObj.window = origWindow;
  }
});
