/**
 * aiEngine.ts — Local, in-browser image understanding.
 *
 * Uses transformers.js (`@huggingface/transformers`) to run a real image-
 * classification model entirely on-device (WASM, or WebGPU when the
 * browser supports it) — no upload, no API call, consistent with every
 * other engine in this app. The package is dynamically imported so it
 * never touches the main bundle: it's only fetched the first time someone
 * actually uses a "Smart" feature, exactly like FFmpeg.wasm/PaddleOCR
 * already are.
 *
 * What it's used for (see pages/images.ts and pages/imagesToPdf.ts):
 *   - Auto-tag: label each image with what's actually in it.
 *   - Smart Sort: group/reorder a batch by visual similarity of those
 *     labels instead of upload order.
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

export type AiModelTier = 'efficient' | 'powerful';

const MODEL_IDS: Record<AiModelTier, string> = {
  efficient: 'Xenova/mobilenet_v2_1.0_224',
  powerful:  'Xenova/vit-base-patch16-224',
};

export interface AiTag {
  label: string;
  score: number; // 0..1
}

export interface ContentGuess {
  contentType: 'photo' | 'graphic';
  suggestedFormat: 'image/webp' | 'image/png';
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
  return typeof WebAssembly !== 'undefined';
}

// ── Model loading (lazy, cached per tier) ────────────────────

type Classifier = (input: any, opts?: any) => Promise<{ label: string; score: number }[]>;
const pipelines = new Map<AiModelTier, Promise<Classifier>>();

async function getClassifier(tier: AiModelTier, onProgress?: (pct: number, note: string) => void): Promise<Classifier> {
  let p = pipelines.get(tier);
  if (p) return p;

  p = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    // Keep everything local: don't let transformers.js probe for a local
    // model server, and cache fetched model weights in the browser (IndexedDB)
    // so it's only downloaded once, same trade-off as PaddleOCR/Tesseract.
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    onProgress?.(0, 'Downloading model…');
    const clf = await pipeline('image-classification', MODEL_IDS[tier], {
      progress_callback: (e: any) => {
        if (e?.status === 'progress' && typeof e.progress === 'number') {
          onProgress?.(Math.round(e.progress), `Downloading ${e.file ?? 'model'}…`);
        }
      },
    });
    onProgress?.(100, 'Ready');
    return ((input: any, opts?: any) => clf(input, opts)) as Classifier;
  })();

  pipelines.set(tier, p);
  return p;
}

/** Drop cached pipelines (e.g. if the user switches AI Engine tier mid-session and wants to free memory). Cached model *weights* stay in the browser cache — only the in-memory session is released. */
export function unloadModels() {
  pipelines.clear();
}

// ── Classification ────────────────────────────────────────────

export async function classifyImage(file: File, tier: AiModelTier, onProgress?: (pct: number, note: string) => void): Promise<AiTag | null> {
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
  const first = raw.split(',')[0].trim();
  return first.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Content-type heuristic (no model — pure canvas analysis) ──

export async function guessContentType(file: File): Promise<ContentGuess> {
  try {
    const bmp = await createImageBitmap(file);
    const size = 64; // downsample hard — this only needs a rough texture signal, not detail
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, size, size);
    bmp.close?.();
    const { data } = ctx.getImageData(0, 0, size, size);

    // Edge density: average gradient magnitude between horizontally adjacent
    // pixels. Flat illustrations/screenshots/documents have large uniform
    // regions (low average gradient); photos have continuous tonal variation
    // (higher average gradient). Also count distinct quantized colours —
    // graphics/screenshots tend to use far fewer than photos.
    let gradSum = 0, gradCount = 0;
    const colors = new Set<number>();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        colors.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)); // 4-bit-per-channel bucket
        if (x < size - 1) {
          const j = i + 4;
          gradSum += Math.abs(r - data[j]) + Math.abs(g - data[j + 1]) + Math.abs(b - data[j + 2]);
          gradCount++;
        }
      }
    }
    const avgGrad = gradSum / Math.max(1, gradCount);
    const uniqueColors = colors.size;

    const isGraphic = avgGrad < 10 || uniqueColors < 40;
    return isGraphic
      ? { contentType: 'graphic', suggestedFormat: 'image/png', suggestedQuality: 95,
          reason: 'Flat colour regions and a small palette — looks like a screenshot, illustration, or document, so lossless-leaning PNG tends to hold up better than a lossy re-encode.' }
      : { contentType: 'photo', suggestedFormat: 'image/webp', suggestedQuality: 80,
          reason: 'Continuous tonal variation typical of a photo — WebP at moderate quality usually gives the best size-for-quality trade-off.' };
  } catch {
    return { contentType: 'photo', suggestedFormat: 'image/webp', suggestedQuality: 82, reason: 'Could not analyse the image — using the general-purpose default.' };
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
      classifyImage(file, tier, (pct, note) => onProgress?.(i, files.length, pct < 100 ? note : `Analysing ${file.name}…`)),
      guessContentType(file),
    ]);
    out.push({ file, tag, content });
  }
  onProgress?.(files.length, files.length, 'Done');
  return out;
}

/** Stable sort of a file list by AI label (falls back to filename for files whose label lookup failed), grouping visually/semantically similar images together instead of leaving them in drop order. */
export function sortBySmartAnalysis(files: File[], analysis: SmartAnalysis[]): File[] {
  const byFile = new Map(analysis.map(a => [a.file, a.tag?.label ?? '~' + a.file.name]));
  return files.slice().sort((a, b) => (byFile.get(a) ?? a.name).localeCompare(byFile.get(b) ?? b.name));
}
