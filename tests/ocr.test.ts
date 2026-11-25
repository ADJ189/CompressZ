import { assert, assertEquals } from "./assert.ts";
import {
  isLanguageSupported,
  runPrintedOcr,
  terminateOcrWorkers,
  TESSERACT_LANGUAGES,
  PADDLE_LANGUAGES,
} from "../src/lib/ocrEngines.ts";
import {
  TROCR_MODEL_ID,
  TROCR_ESTIMATED_DOWNLOAD_MB,
} from "../src/lib/ocrHandwriting.ts";

Deno.test("ocrEngines: validates language support correctly per engine", () => {
  assert(TESSERACT_LANGUAGES.size > 20);
  assert(PADDLE_LANGUAGES.size > 0);

  // Tesseract supports broad range
  assertEquals(isLanguageSupported("tesseract", "eng"), true);
  assertEquals(isLanguageSupported("tesseract", "hin"), true);
  assertEquals(isLanguageSupported("tesseract", "ben"), true);
  assertEquals(isLanguageSupported("tesseract", "chi_sim"), true);

  // Paddle supports CJK + Latin
  assertEquals(isLanguageSupported("paddle", "chi_sim"), true);
  assertEquals(isLanguageSupported("paddle", "eng"), true);
  assertEquals(isLanguageSupported("paddle", "hin"), false);

  // TrOCR is English-only candidate
  assertEquals(isLanguageSupported("trocr", "eng"), true);
  assertEquals(isLanguageSupported("trocr", "auto"), true);
  assertEquals(isLanguageSupported("trocr", "hin"), false);
  assertEquals(isLanguageSupported("trocr", "chi_sim"), false);
});

Deno.test("ocrHandwriting: pinned candidate model and size disclosure", () => {
  assertEquals(TROCR_MODEL_ID, "Xenova/trocr-small-handwritten");
  assert(TROCR_ESTIMATED_DOWNLOAD_MB >= 100);
});

Deno.test("ocrEngines: symbolMode preserves selected language with +equ and defaults to eng+equ", async () => {
  const createdLangs: string[] = [];
  const globalObj = globalThis as unknown as { window?: unknown };
  const origWindow = globalObj.window;
  globalObj.window = {
    Tesseract: {
      createWorker: async (lang: string) => {
        createdLangs.push(lang);
        return {
          recognize: async () => ({ data: { text: "ok", confidence: 95, lines: [] } }),
          terminate: async () => {},
        };
      },
    },
  };

  try {
    await runPrintedOcr({} as HTMLCanvasElement, { symbolMode: true });
    await runPrintedOcr({} as HTMLCanvasElement, { language: "fra", symbolMode: true });
    assertEquals(createdLangs, ["eng+equ", "fra+equ"]);
  } finally {
    await terminateOcrWorkers();
    globalObj.window = origWindow;
  }
});

Deno.test("ocrEngines: overlapping runPrintedOcr jobs serialize worker switching and isolate progress", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let terminatedWhileInFlight = false;
  const createdLangs: string[] = [];
  const logA: number[] = [];
  const logB: number[] = [];

  const globalObj = globalThis as unknown as { window?: unknown };
  const origWindow = globalObj.window;
  globalObj.window = {
    Tesseract: {
      createWorker: async (
        lang: string,
        _oem: number,
        opts: { logger?: (m: { status: string; progress?: number }) => void },
      ) => {
        createdLangs.push(lang);
        let terminated = false;
        return {
          recognize: async () => {
            if (terminated) throw new Error("Worker used after termination");
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            opts.logger?.({ status: "recognizing text", progress: 0.5 });
            await new Promise((r) => setTimeout(r, 25));
            opts.logger?.({ status: "recognizing text", progress: 1.0 });
            inFlight--;
            return { data: { text: lang, confidence: 90, lines: [] } };
          },
          terminate: async () => {
            if (inFlight > 0) terminatedWhileInFlight = true;
            terminated = true;
          },
        };
      },
    },
  };

  try {
    const [resA, resB] = await Promise.all([
      runPrintedOcr({} as HTMLCanvasElement, {
        language: "eng",
        onProgress: (p) => logA.push(p),
      }),
      runPrintedOcr({} as HTMLCanvasElement, {
        language: "deu",
        onProgress: (p) => logB.push(p),
      }),
    ]);

    assertEquals(resA.text, "eng");
    assertEquals(resB.text, "deu");
    assertEquals(maxInFlight, 1);
    assertEquals(terminatedWhileInFlight, false);
    assertEquals(createdLangs, ["eng", "deu"]);
    assertEquals(logA, [0.5, 1.0]);
    assertEquals(logB, [0.5, 1.0]);
  } finally {
    await terminateOcrWorkers();
    globalObj.window = origWindow;
  }
});

Deno.test("Ocr.svelte: language select includes every supported Tesseract language and ignores resource-tier DPI overrides", async () => {
  const ocrSvelte = await Deno.readTextFile(
    new URL("../src/routes/Ocr.svelte", import.meta.url),
  );
  for (const lang of TESSERACT_LANGUAGES) {
    assert(
      ocrSvelte.includes(`code: "${lang}"`),
      `Ocr.svelte language selector missing supported language "${lang}"`,
    );
  }
  assert(
    !ocrSvelte.includes("dpiForTier") && !ocrSvelte.includes("profile.mode"),
    "Ocr.svelte must keep default renderDpi independent of resource profile.mode",
  );
});
