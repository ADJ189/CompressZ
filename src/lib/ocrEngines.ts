/**
 * ocrEngines.ts — Unified OCR engine adapters and recognition contracts.
 *
 * Distinguishes:
 *   - Native PDF text extraction (always tried first for digital PDFs)
 *   - Printed-text OCR (Tesseract.js 5 LSTM default, optional experimental PaddleOCR PP-OCRv3)
 *   - Handwriting recognition (TrOCR candidate via ocrHandwriting.ts)
 *
 * Core principles:
 *   - Never invent confidence scores. Only include confidence when reported by the engine.
 *   - Disclose engine, version, and language capabilities honestly.
 *   - Single-page sequential processing to prevent browser tab crashes.
 *   - Clean release of workers, canvases, and buffers on cancellation/completion.
 */

import { EngineError, toErrorMessage } from "./engineError";
import { supportsWasmSimd } from "./browserProfile";
import type { EngineWarning } from "./types";

export type OcrProfile = "auto" | "printed" | "handwriting" | "mixed";
export type OcrEngineId = "auto" | "tesseract" | "paddle" | "trocr";
export type OcrEngine = OcrEngineId;

export type OcrLanguage =
  | "auto"
  | "eng"
  | "fra"
  | "deu"
  | "spa"
  | "ita"
  | "por"
  | "rus"
  | "nld"
  | "pol"
  | "swe"
  | "nor"
  | "dan"
  | "fin"
  | "tur"
  | "chi_sim"
  | "chi_tra"
  | "jpn"
  | "kor"
  | "ara"
  | "hin"
  | "ben";

export interface OcrWordBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export interface OcrLineResult {
  text: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  words: OcrWordBox[];
}

export interface OcrPageResult {
  text: string;
  confidence: number;
  lines: OcrLineResult[];
  engineId: OcrEngineId;
  language: OcrLanguage;
  profile: OcrProfile;
  warnings?: string[];
  engineWarnings?: EngineWarning[];
  executionTimeMs?: number;
}

// ── CDN URLs (lazy-loaded) ──────────────────────────────────
export const TESS_UMD =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
export const TESS_CORE =
  "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd-lstm.wasm.js";
export const TESS_CORE_NOSIMD =
  "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-lstm.wasm.js";
export const TESS_LANGS = "https://tessdata.projectnaptha.com/4.0.0";
export const TESS_WKR =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js";

export const PADDLE_CDN =
  "https://cdn.jsdelivr.net/npm/@paddle-js-models/ocr@0.0.11/dist/index.js";

// Validated languages per engine
export const TESSERACT_LANGUAGES: ReadonlySet<OcrLanguage> = new Set([
  "auto",
  "eng",
  "fra",
  "deu",
  "spa",
  "ita",
  "por",
  "rus",
  "nld",
  "pol",
  "swe",
  "nor",
  "dan",
  "fin",
  "tur",
  "chi_sim",
  "chi_tra",
  "jpn",
  "kor",
  "ara",
  "hin",
  "ben",
]);

export const PADDLE_LANGUAGES: ReadonlySet<OcrLanguage> = new Set([
  "auto",
  "eng",
  "chi_sim",
  "chi_tra",
  "jpn",
  "kor",
]);

/**
 * Checks whether an engine genuinely supports a given language code.
 */
export function isLanguageSupported(
  engine: OcrEngineId,
  lang: OcrLanguage,
): boolean {
  if (engine === "trocr") {
    // TrOCR small handwritten candidate is strictly validated for English
    return lang === "eng" || lang === "auto";
  }
  if (engine === "paddle") {
    return PADDLE_LANGUAGES.has(lang);
  }
  return TESSERACT_LANGUAGES.has(lang);
}

// Global cached Tesseract worker promise (singleton per active language)
let activeTessWorker: any = null;
let activeTessLang: string | null = null;
let activeTessPromise: Promise<unknown> | null = null;
let activeTessProgress: ((progress: number, status: string) => void) | undefined;
let activeTessUses = 0;
let tessJobChain: Promise<void> = Promise.resolve();

function enqueueTessJob<T>(fn: () => Promise<T>): Promise<T> {
  const next = tessJobChain.then(fn, fn);
  tessJobChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function getTesseractWorkerInternal(
  lang: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<any> {
  activeTessProgress = onProgress;
  const Tesseract = await loadTesseract();
  const targetLang = lang === "auto" ? "eng" : lang;

  if (activeTessWorker && activeTessLang === targetLang) {
    return activeTessWorker;
  }

  if (activeTessPromise && activeTessLang === targetLang) {
    return activeTessPromise;
  }

  const prevPromise = activeTessPromise;
  const initPromise = (async () => {
    if (prevPromise) {
      await prevPromise.catch(() => {});
    }

    if (activeTessWorker && activeTessLang === targetLang) {
      return activeTessWorker;
    }

    if (activeTessWorker) {
      try {
        await activeTessWorker.terminate();
      } catch {
        // Ignored
      }
      activeTessWorker = null;
      activeTessLang = null;
    }

    activeTessLang = targetLang;
    const worker = await Tesseract.createWorker(targetLang, 1, {
      workerPath: TESS_WKR,
      corePath: supportsWasmSimd() ? TESS_CORE : TESS_CORE_NOSIMD,
      langPath: TESS_LANGS,
      logger: (m: any) => {
        if (m.status === "recognizing text" && typeof m.progress === "number") {
          activeTessProgress?.(m.progress, "Recognising printed text...");
        } else if (typeof m.status === "string") {
          activeTessProgress?.(0, m.status);
        }
      },
    });

    activeTessWorker = worker;
    return worker;
  })();

  activeTessPromise = initPromise;
  try {
    return await initPromise;
  } catch (err) {
    if (activeTessPromise === initPromise) {
      activeTessLang = null;
    }
    throw err;
  } finally {
    if (activeTessPromise === initPromise) {
      activeTessPromise = null;
    }
  }
}

export async function getTesseractWorker(
  lang: string,
  onProgress?: (progress: number, status: string) => void,
): Promise<any> {
  return enqueueTessJob(() => getTesseractWorkerInternal(lang, onProgress));
}

/** Release active Tesseract worker and memory once any in-flight recognition finishes. */
export async function terminateOcrWorkers(): Promise<void> {
  return enqueueTessJob(async () => {
    if (activeTessPromise) {
      await activeTessPromise.catch(() => {});
    }
    if (activeTessWorker && activeTessUses === 0) {
      try {
        await activeTessWorker.terminate();
      } catch {
        // Ignored
      }
      activeTessWorker = null;
      activeTessLang = null;
    }
  });
}

let tessLoadPromise: Promise<any> | null = null;
export function loadTesseract(): Promise<any> {
  if (typeof (window as any).Tesseract !== "undefined") {
    return Promise.resolve((window as any).Tesseract);
  }
  if (tessLoadPromise) return tessLoadPromise;

  tessLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TESS_UMD;
    const timer = setTimeout(() => {
      tessLoadPromise = null;
      s.remove();
      reject(new EngineError("Timed out loading Tesseract.js runtime from CDN", "tesseract"));
    }, 30_000);
    s.onload = () => {
      clearTimeout(timer);
      const lib = (window as any).Tesseract;
      if (!lib) {
        tessLoadPromise = null;
        reject(new EngineError("Tesseract.js global unavailable after script load", "tesseract"));
        return;
      }
      resolve(lib);
    };
    s.onerror = () => {
      clearTimeout(timer);
      tessLoadPromise = null;
      reject(new EngineError("Failed to load Tesseract.js runtime from CDN", "tesseract"));
    };
    document.head.appendChild(s);
  });
  return tessLoadPromise;
}

/**
 * Run printed text OCR on an image canvas or Blob using Tesseract.
 */
export async function runPrintedOcr(
  imageSource: HTMLCanvasElement | Blob | ImageData,
  options: {
    language?: OcrLanguage;
    symbolMode?: boolean;
    preferredEngine?: OcrEngineId;
    onProgress?: (progress: number, status: string) => void;
  } = {},
): Promise<OcrPageResult> {
  const startTime = performance.now();
  const baseLang =
    !options.language || options.language === "auto"
      ? "eng"
      : options.language;
  const lang = options.symbolMode ? `${baseLang}+equ` : (options.language ?? "eng");

  const result = await enqueueTessJob(async () => {
    activeTessUses++;
    try {
      const worker = await getTesseractWorkerInternal(lang, options.onProgress);
      activeTessProgress = options.onProgress;
      return await worker.recognize(imageSource);
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError(
        `Tesseract failed to recognise text: ${toErrorMessage(err, "engine error")}`,
        "tesseract",
      );
    } finally {
      activeTessUses = Math.max(0, activeTessUses - 1);
      if (activeTessProgress === options.onProgress) {
        activeTessProgress = undefined;
      }
    }
  });

  const lines: OcrLineResult[] = [];
  const warnings: string[] = [];
  const engineWarnings: EngineWarning[] = [];

  if (options.preferredEngine === "paddle") {
    const msg = "PaddleOCR is not enabled in this build; ran Tesseract OCR instead.";
    warnings.push(msg);
    engineWarnings.push({
      code: "paddle-fallback-tesseract",
      engine: "ocr",
      severity: "warn",
      message: msg,
    });
  }

  const rawLines = result.data?.lines ?? [];
  for (const l of rawLines) {
    const words: OcrWordBox[] = (l.words ?? []).map((w: any) => ({
      text: w.text?.trim() ?? "",
      x: w.bbox?.x0 ?? 0,
      y: w.bbox?.y0 ?? 0,
      w: (w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0),
      h: (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0),
      confidence: Math.round(w.confidence ?? 0),
    }));

    lines.push({
      text: l.text?.trim() ?? "",
      confidence: Math.round(l.confidence ?? 0),
      bbox: {
        x: l.bbox?.x0 ?? 0,
        y: l.bbox?.y0 ?? 0,
        w: (l.bbox?.x1 ?? 0) - (l.bbox?.x0 ?? 0),
        h: (l.bbox?.y1 ?? 0) - (l.bbox?.y0 ?? 0),
      },
      words,
    });
  }

  const overallConfidence = Math.round(result.data?.confidence ?? 0);
  if (overallConfidence < 60 && lines.length > 0) {
    const msg = "Low OCR confidence detected; review page preview for fidelity.";
    warnings.push(msg);
    engineWarnings.push({
      code: "ocr-low-confidence",
      engine: "ocr",
      severity: "warn",
      message: msg,
      detail: `Page confidence: ${overallConfidence}%`,
    });
  }

  return {
    text: result.data?.text?.trim() ?? "",
    confidence: overallConfidence,
    lines,
    engineId: "tesseract",
    language: (options.language ?? "eng"),
    profile: "printed",
    warnings: warnings.length > 0 ? warnings : undefined,
    ...(engineWarnings.length > 0 ? { engineWarnings } : {}),
    executionTimeMs: Math.round(performance.now() - startTime),
  };
}
