/**
 * aiEngine.ts — Local, in-browser image understanding.
 *
 * Uses transformers.js (`@huggingface/transformers`) to run a real image-
 * classification model entirely on-device — no upload, no API call,
 * consistent with every other engine in this app. The package is
 * dynamically imported so it never touches the main bundle: it's only
 * fetched the first time someone actually uses a "Smart" feature, exactly
 * like FFmpeg.wasm/PaddleOCR already are.
 *
 * Backend selection is explicit, not assumed:
 *   - WebGPU is attempted only after `navigator.gpu.requestAdapter()` and a
 *     real `requestDevice()` succeed. Transformers.js defaults to WASM, so
 *     passing `device: "webgpu"` is required to actually use the GPU.
 *   - If WebGPU load fails for any reason (adapter, unsupported dtype,
 *     memory), the loader retries the same model on WASM with q8 weights.
 *     The backend that actually succeeded is reported by `getAiRuntimeInfo`.
 *
 * What it's used for (see pages/images.ts and pages/imagesToPdf.ts):
 *   - Auto-tag: label each image with what's actually in it.
 *   - Sort by predicted label: reorder a batch alphabetically by those
 *     labels. This is NOT embedding-based visual similarity grouping — a
 *     classifier label alone can't measure visual distance.
 *   - Smart Preset: a lightweight local heuristic (no model needed) reads
 *     each image's edge density / colour palette to guess "photo" vs.
 *     "graphic-or-document" and suggests the compression settings that
 *     tend to suit that content type — the model tells you *what* it is,
 *     this tells you *how busy* it looks, and together they drive the
 *     one-click "Apply suggestions" action.
 *
 * Model choice is intentionally two-tier (see Settings → AI Engine):
 *   'efficient' → a ~14MB MobileNet — fast, low memory, good enough for
 *                 sorting/tagging on modest phones.
 *   'powerful'  → a ~90MB ViT-Base — slower first load, meaningfully more
 *                 accurate labels, better suited to desktop-class devices.
 * Settings → Performance Mode picks the tier automatically per the
 * recommendation from lib/platform.ts, but can be overridden.
 */

import { decodeImageBitmap } from "./imageDecode";
import { getSettings } from "./settings";
// The exact onnxruntime-web version bundled with @huggingface/transformers —
// injected at build time (see vite.config.ts) by reading the installed
// package directly, since onnxruntime-web's package.json isn't exposed
// through its "exports" map and so can't be imported as a module here.
declare const __ORT_VERSION__: string;

export type AiModelTier = "efficient" | "powerful";
export type AiBackend = "webgpu" | "wasm";

const MODEL_IDS: Record<AiModelTier, string> = {
  efficient: "Xenova/mobilenet_v2_1.0_224",
  powerful: "Xenova/vit-base-patch16-224",
};

/** Model ID shown in diagnostics — keep this in sync with MODEL_IDS. */
export function aiModelId(tier: AiModelTier): string {
  return MODEL_IDS[tier];
}

export interface AiTag {
  label: string;
  score: number; // 0..1
}

export interface ContentGuess {
  contentType: "photo" | "graphic";
  suggestedFormat: "image/webp" | "image/png";
  suggestedQuality: number;
  reason: string;
}

export interface SmartAnalysis {
  file: File;
  tag: AiTag | null; // null if classification failed — the rest of the analysis still applies
  content: ContentGuess;
}

// ── Capability check ─────────────────────────────────────────

export function aiSupported(): boolean {
  return typeof WebAssembly !== "undefined";
}

/**
 * True when the WebGPU API exists. This is only a cheap gate — it does not
 * prove an adapter/device can actually be created. `canUseWebGpu()` does the
 * real feature test below.
 */
export function hasWebGpuApi(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).gpu;
}

let _webgpuProbe: Promise<boolean> | null = null;

async function canUseWebGpu(): Promise<boolean> {
  if (!hasWebGpuApi()) return false;
  if (!_webgpuProbe) {
    _webgpuProbe = (async () => {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) return false;
        // Adapter presence alone isn't enough: some browsers expose it but
        // fail to create a device (software blocklist, exhausted budget).
        const device = await adapter.requestDevice?.();
        device?.destroy?.();
        return true;
      } catch {
        return false;
      }
    })();
  }
  return _webgpuProbe;
}

// ── Model loading (lazy, cached per tier) ────────────────────

type Classifier = (
  input: any,
  opts?: any,
) => Promise<{ label: string; score: number }[]>;
const pipelines = new Map<AiModelTier, Promise<Classifier>>();
const loadedBackends = new Map<AiModelTier, AiBackend>();
let _lastLoaded: { tier: AiModelTier; backend: AiBackend } | null = null;

/**
 * What the last successful model load actually used. Null until a model has
 * loaded in this session; useful for Settings diagnostics and for not
 * claiming "WebGPU" when the WASM fallback ran.
 */
export function getAiRuntimeInfo(): {
  tier: AiModelTier;
  model: string;
  backend: AiBackend;
} | null {
  if (!_lastLoaded) return null;
  return {
    tier: _lastLoaded.tier,
    model: MODEL_IDS[_lastLoaded.tier],
    backend: _lastLoaded.backend,
  };
}

interface LoadAttempt {
  backend: AiBackend;
  dtype?: "q8" | "fp16" | "fp32";
}

async function configureTransformersEnv(): Promise<any> {
  const { pipeline, env } = await import("@huggingface/transformers");
  // Keep everything local: don't let transformers.js probe for a local
  // model server, and cache fetched model weights in the browser (IndexedDB)
  // so it's only downloaded once, same trade-off as PaddleOCR/Tesseract.
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  // onnxruntime-web's WASM binaries (the actual inference runtime, not the
  // model weights) are ~15-30MB each. The threaded+SIMD+asyncify build in
  // particular is a *build-time* asset Vite bundles locally by default
  // (via a `new URL(...)` reference inside onnxruntime-web's loader) —
  // and at ~26MB it exceeds Cloudflare Pages' 25MiB per-file limit,
  // failing deployment outright. Pointing wasmPaths at the exact
  // published onnxruntime-web version on a CDN makes the runtime fetch
  // these binaries remotely instead, so the (still Vite-bundled, but now
  // unused) local copy can be stripped from the build output — see
  // scripts/strip-oversized-assets.mjs, run as part of `npm run build`.
  if (env.backends.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${__ORT_VERSION__}/dist/`;
  }
  return pipeline;
}

async function loadClassifier(
  tier: AiModelTier,
  attempts: LoadAttempt[],
  onProgress?: (pct: number, note: string) => void,
): Promise<Classifier> {
  const pipeline = await configureTransformersEnv();
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      onProgress?.(
        0,
        attempt.backend === "webgpu"
          ? "Loading model on WebGPU…"
          : "Loading model on WASM…",
      );
      const clf = await pipeline("image-classification", MODEL_IDS[tier], {
        ...(attempt.backend === "webgpu"
          ? { device: "webgpu" }
          : { device: "wasm" }),
        ...(attempt.dtype ? { dtype: attempt.dtype } : {}),
        progress_callback: (e: any) => {
          if (e?.status === "progress" && typeof e.progress === "number") {
            onProgress?.(
              Math.round(e.progress),
              `Downloading ${e.file ?? "model"}…`,
            );
          }
        },
      });
      loadedBackends.set(tier, attempt.backend);
      _lastLoaded = { tier, backend: attempt.backend };
      onProgress?.(100, "Ready");
      return ((input: any, opts?: any) => clf(input, opts)) as Classifier;
    } catch (err) {
      lastError = err;
      console.warn(
        `[ai] ${tier} model failed on ${attempt.backend}${attempt.dtype ? ` (${attempt.dtype})` : ""}, trying next backend:`,
        err,
      );
    }
  }
  throw lastError ?? new Error("No usable AI backend");
}

async function getClassifier(
  tier: AiModelTier,
  onProgress?: (pct: number, note: string) => void,
): Promise<Classifier> {
  let p = pipelines.get(tier);
  if (p) return p;

  p = (async () => {
    // Settings → AI Engine → Inference backend. 'wasm' is an explicit
    // opt-out: never probe or attempt WebGPU in that case. 'auto' and
    // 'webgpu' both feature-test the adapter, and every path still falls
    // back to WASM rather than making Smart features unavailable.
    let preference: "auto" | "webgpu" | "wasm" = "auto";
    try {
      preference = getSettings().ai.backend ?? "auto";
    } catch {
      /* settings unavailable (test/SSR) — use the auto path */
    }
    const preferWebGpu =
      preference !== "wasm" && (await canUseWebGpu());
    // Dtype matters per backend: q8 is the small, tested WASM export; WebGPU
    // tries fp16 first (smaller/faster on supported GPUs) then fp32 for
    // exports that don't publish an fp16 variant. WASM is always the final
    // fallback, so a WebGPU failure never makes Smart features unavailable.
    const attempts: LoadAttempt[] = preferWebGpu
      ? [
          { backend: "webgpu", dtype: "fp16" },
          { backend: "webgpu", dtype: "fp32" },
          { backend: "wasm", dtype: "q8" },
          { backend: "wasm" },
        ]
      : [
          { backend: "wasm", dtype: "q8" },
          { backend: "wasm" },
        ];
    return loadClassifier(tier, attempts, onProgress);
  })();

  // Don't cache a failed load — otherwise one offline/transient failure
  // makes every later "Smart" action fail until the page is reloaded.
  p.catch(() => {
    if (pipelines.get(tier) === p) pipelines.delete(tier);
    loadedBackends.delete(tier);
    if (_lastLoaded?.tier === tier) _lastLoaded = null;
  });
  pipelines.set(tier, p);
  return p;
}

/** Drop cached pipelines (e.g. if the user switches AI Engine tier mid-session and wants to free memory). Cached model *weights* stay in the browser cache — only the in-memory session is released. */
export function unloadModels() {
  pipelines.clear();
  loadedBackends.clear();
  _lastLoaded = null;
}

// ── Classification ────────────────────────────────────────────

export async function classifyImage(
  file: File,
  tier: AiModelTier,
  onProgress?: (pct: number, note: string) => void,
): Promise<AiTag | null> {
  try {
    const clf = await getClassifier(tier, onProgress);
    const url = URL.createObjectURL(file);
    try {
      const out = await clf(url, { topk: 1 });
      if (!out?.length) return null;
      return { label: cleanLabel(out[0].label), score: out[0].score };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null; // model failed to load (offline, unsupported browser, etc.) — caller degrades gracefully
  }
}

function cleanLabel(raw: string): string {
  // ImageNet-style labels are often comma-separated synonyms ("tabby cat, tabby") — keep the first, title-case it.
  const first = raw.split(",")[0].trim();
  return first.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Content-type heuristic (no model — pure canvas analysis) ──

export async function guessContentType(file: File): Promise<ContentGuess> {
  try {
    const bmp = await decodeImageBitmap(file);
    const size = 64; // downsample hard — this only needs a rough texture signal, not detail
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, size, size);
    bmp.close?.();
    const { data } = ctx.getImageData(0, 0, size, size);

    // Edge density: average gradient magnitude between horizontally adjacent
    // pixels. Flat illustrations/screenshots/documents have large uniform
    // regions (low average gradient); photos have continuous tonal variation
    // (higher average gradient). Also count distinct quantized colours —
    // graphics/screenshots tend to use far fewer than photos.
    let gradSum = 0,
      gradCount = 0;
    const colors = new Set<number>();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)); // 4-bit-per-channel bucket
        if (x < size - 1) {
          const j = i + 4;
          gradSum +=
            Math.abs(r - data[j]) +
            Math.abs(g - data[j + 1]) +
            Math.abs(b - data[j + 2]);
          gradCount++;
        }
      }
    }
    const avgGrad = gradSum / Math.max(1, gradCount);
    const uniqueColors = colors.size;

    const isGraphic = avgGrad < 10 || uniqueColors < 40;
    return isGraphic
      ? {
          contentType: "graphic",
          suggestedFormat: "image/png",
          suggestedQuality: 95,
          reason:
            "Flat colour regions and a small palette — looks like a screenshot, illustration, or document, so lossless-leaning PNG tends to hold up better than a lossy re-encode.",
        }
      : {
          contentType: "photo",
          suggestedFormat: "image/webp",
          suggestedQuality: 80,
          reason:
            "Continuous tonal variation typical of a photo — WebP at moderate quality usually gives the best size-for-quality trade-off.",
        };
  } catch {
    return {
      contentType: "photo",
      suggestedFormat: "image/webp",
      suggestedQuality: 82,
      reason:
        "Could not analyse the image — using the general-purpose default.",
    };
  }
}

// ── Batch orchestration ────────────────────────────────────────

export async function smartAnalyze(
  files: File[],
  tier: AiModelTier,
  onProgress?: (done: number, total: number, note: string) => void,
): Promise<SmartAnalysis[]> {
  const out: SmartAnalysis[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, `Analysing ${file.name}…`);
    const [tag, content] = await Promise.all([
      classifyImage(file, tier, (pct, note) =>
        onProgress?.(
          i,
          files.length,
          pct < 100 ? note : `Analysing ${file.name}…`,
        ),
      ),
      guessContentType(file),
    ]);
    out.push({ file, tag, content });
  }
  onProgress?.(files.length, files.length, "Done");
  return out;
}

/**
 * Stable sort of a file list by predicted AI label (falls back to filename
 * for files whose label lookup failed). This groups images with the same
 * predicted class next to each other; it is not embedding-based visual
 * similarity. The name says exactly what it does so the UI can too.
 */
export function sortByPredictedLabel(
  files: File[],
  analysis: SmartAnalysis[],
): File[] {
  const labelOf = new Map(
    analysis.map((a) => [a.file, a.tag?.label ?? null]),
  );
  return files
    .slice()
    .sort((a, b) => {
      const la = labelOf.get(a) ?? null;
      const lb = labelOf.get(b) ?? null;
      // Files whose classification failed sort after every labelled file,
      // ordered by filename among themselves. A "~" prefix used to be used
      // here, but localeCompare treats punctuation as near-zero weight, so
      // unlabelled files could sort first instead of last.
      if (la === null && lb !== null) return 1;
      if (la !== null && lb === null) return -1;
      return (la ?? a.name).localeCompare(lb ?? b.name);
    });
}
