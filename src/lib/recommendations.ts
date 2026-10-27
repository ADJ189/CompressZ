/**
 * recommendations.ts — deterministic, local Contextual Recommendations.
 *
 * The rules here are intentionally model-free: they read only metadata that a
 * page already has (filenames, byte sizes, MIME types, the current settings
 * choices) and never decode, upload or reorder anything on their own. A
 * caller must apply a returned action; nothing is mutated automatically.
 *
 * The layer is separate from the AI runtime on purpose, so suggestions still
 * work when Local AI is disabled, still downloading, or unsupported. AI-gated
 * suggestions (none ship yet) would additionally require
 * `settings.recommendations.allowAi`.
 *
 * Dismissals persist in localStorage under `cz-recommendations-v1` as a list
 * of `scope:rule:action` keys. Including the action in the key means a
 * dismissed suggestion stays dismissed for that exact choice, while a
 * materially different suggestion for the same rule can still appear.
 */
import { getSettings } from './settings';
import type { ImageFormat, PdfLevel } from './types';

export type RecommendationScope =
  | 'images'
  | 'images-to-pdf'
  | 'merge-pdf'
  | 'pdf'
  | 'ocr';

export type OcrScript = 'latin' | 'cjk' | 'rtl' | 'indic';

export type RecommendationAction =
  | { type: 'reorder'; order: number[] }
  | { type: 'image-format'; format: ImageFormat; quality: number }
  | { type: 'page-size'; pageSize: 'auto' | 'a4' | 'letter' }
  | { type: 'pdf-level'; level: PdfLevel }
  | { type: 'ocr-engine'; engine: 'tesseract' | 'paddle' };

export interface Recommendation {
  /** Stable rule id, e.g. `order/natural`. */
  id: string;
  scope: RecommendationScope;
  title: string;
  reason: string;
  actionLabel: string;
  /** Honest trade-off shown under the reason when applying is not free. */
  tradeoff?: string;
  confidence: 'certain' | 'likely';
  reversible: boolean;
  action: RecommendationAction;
}

export interface RecommendationFile {
  name: string;
  size?: number;
  type?: string;
}

export interface RecommendationInput {
  scope: RecommendationScope;
  /** Files in the order the user currently sees them. */
  files?: RecommendationFile[];
  /** Images workflow choices. */
  imageFormat?: ImageFormat;
  imageQuality?: number;
  /** Images → PDF workflow choices. */
  pageSize?: 'auto' | 'a4' | 'letter';
  /** PDF workflow choice. */
  pdfLevel?: PdfLevel;
  /** PDF total size in bytes, when known. */
  pdfBytes?: number;
  /** OCR workflow choices. */
  ocrEngine?: 'auto' | 'tesseract' | 'paddle';
  ocrScript?: OcrScript;
}

// ── Natural filename ordering ─────────────────────────────────

const DIGITS = /^\d+$/;
const TOKENS = /\d+|\D+/g;

function tokenize(value: string): string[] {
  // Compare case-insensitively and ignore the extension so `Page 10.png`
  // sorts after `Page 9.jpg` rather than after `Page 9.txt`.
  const stem = value.replace(/\.[^./\\]+$/, '');
  return stem.toLowerCase().match(TOKENS) ?? [];
}

/**
 * Locale-independent natural sort: digit runs compare numerically, everything
 * else compares as lower-cased text. Deterministic across browsers, which
 * `localeCompare({ numeric: true })` is not guaranteed to be.
 */
export function naturalCompare(a: string, b: string): number {
  const at = tokenize(a);
  const bt = tokenize(b);
  const shared = Math.min(at.length, bt.length);

  for (let i = 0; i < shared; i++) {
    const x = at[i];
    const y = bt[i];
    if (x === y) continue;

    const xNum = DIGITS.test(x);
    const yNum = DIGITS.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      // Same value but different zero padding (007 vs 7) — shorter first.
      return x.length - y.length;
    }
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }

  return at.length - bt.length;
}

/** Indices of `names` in natural order. */
export function naturalOrder(names: string[]): number[] {
  return names
    .map((name, index) => ({ name, index }))
    .sort((a, b) => naturalCompare(a.name, b.name) || a.index - b.index)
    .map((entry) => entry.index);
}

/** True when the current order already equals natural order. */
export function isNaturallySorted(names: string[]): boolean {
  const order = naturalOrder(names);
  return order.every((value, index) => value === index);
}

function hasSequenceNumber(names: string[]): boolean {
  return names.some((name) => /\d/.test(name));
}

// ── Dismissal persistence ─────────────────────────────────────

const DISMISS_KEY = 'cz-recommendations-v1';

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(keys.slice(-200)));
  } catch {
    /* storage disabled — dismissal is session-only */
  }
}

function actionSignature(action: RecommendationAction): string {
  switch (action.type) {
    case 'reorder':
      return 'reorder';
    case 'image-format':
      return `format:${action.format}:${action.quality}`;
    case 'page-size':
      return `page:${action.pageSize}`;
    case 'pdf-level':
      return `level:${action.level}`;
    case 'ocr-engine':
      return `engine:${action.engine}`;
  }
}

export function recommendationKey(rec: Recommendation): string {
  return `${rec.scope}:${rec.id}:${actionSignature(rec.action)}`;
}

export function isRecommendationDismissed(rec: Recommendation): boolean {
  return readDismissed().includes(recommendationKey(rec));
}

export function dismissRecommendation(rec: Recommendation): void {
  const key = recommendationKey(rec);
  const keys = readDismissed();
  if (!keys.includes(key)) writeDismissed([...keys, key]);
}

export function clearDismissedRecommendations(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

export function dismissedRecommendationCount(): number {
  return readDismissed().length;
}

// ── Rules ─────────────────────────────────────────────────────

const PHOTO_INPUT = /\.(jpe?g|heic|heif|avif|tiff?|bmp)$/i;

function extensionOf(name: string): string {
  const match = /(\.[^./\\]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function formatLabel(format: ImageFormat): string {
  switch (format) {
    case 'image/jpeg':
      return 'JPEG';
    case 'image/png':
      return 'PNG';
    case 'image/webp':
      return 'WebP';
    case 'image/avif':
      return 'AVIF';
  }
}

function orderRule(
  scope: RecommendationScope,
  files: RecommendationFile[],
): Recommendation | null {
  if (files.length < 3) return null;
  const names = files.map((f) => f.name);
  if (!hasSequenceNumber(names)) return null;
  if (isNaturallySorted(names)) return null;

  const order = naturalOrder(names);
  return {
    id: 'order/natural',
    scope,
    title: 'Sort by filename',
    reason:
      'These files look numbered, but the current order does not follow the numbers — natural sort puts page 2 before page 10.',
    actionLabel: 'Sort naturally',
    confidence: 'certain',
    reversible: true,
    action: { type: 'reorder', order },
  };
}

function imageFormatRule(input: RecommendationInput): Recommendation | null {
  const files = input.files ?? [];
  if (!files.length || !input.imageFormat) return null;

  const extensions = files.map((f) => extensionOf(f.name));
  const allPhotos =
    extensions.every((ext) => PHOTO_INPUT.test(ext)) && extensions.length > 0;

  if (input.imageFormat === 'image/png' && allPhotos) {
    return {
      id: 'images/photo-to-png',
      scope: input.scope,
      title: 'Use WebP instead of PNG',
      reason:
        'Every file here is a camera-style format, so PNG output stays lossless and much larger for the same look. WebP keeps transparency support and a similar appearance at a smaller size.',
      actionLabel: 'Switch to WebP',
      tradeoff: 'WebP is supported by every current browser but not by some older desktop apps.',
      confidence: 'likely',
      reversible: true,
      action: {
        type: 'image-format',
        format: 'image/webp',
        quality: Math.min(input.imageQuality ?? 82, 90),
      },
    };
  }

  if (
    input.imageFormat !== 'image/png' &&
    (input.imageQuality ?? 0) >= 96
  ) {
    return {
      id: 'images/quality-high',
      scope: input.scope,
      title: 'Try quality 82',
      reason: `Quality ${input.imageQuality} is above the point where most photos look different on screen, and it usually costs a lot of file size.`,
      actionLabel: `Use 82`,
      tradeoff: 'Fine detail in large prints may soften slightly.',
      confidence: 'likely',
      reversible: true,
      action: {
        type: 'image-format',
        format: input.imageFormat,
        quality: 82,
      },
    };
  }

  return null;
}

function imagesToPdfRules(input: RecommendationInput): Recommendation[] {
  const out: Recommendation[] = [];
  const order = orderRule('images-to-pdf', input.files ?? []);
  if (order) out.push(order);

  if (input.pageSize && input.pageSize !== 'auto') {
    out.push({
      id: 'images-to-pdf/page-size',
      scope: 'images-to-pdf',
      title: 'Use Auto page size',
      reason:
        'Auto sizes every page to its own image, so nothing is letterboxed or cropped. A fixed size is only better when the pages must print at a known dimension.',
      actionLabel: 'Use Auto',
      confidence: 'likely',
      reversible: true,
      action: { type: 'page-size', pageSize: 'auto' },
    });
  }

  return out;
}

function pdfRules(input: RecommendationInput): Recommendation[] {
  if (!input.pdfLevel) return [];

  if (input.pdfLevel === 'extreme') {
    return [
      {
        id: 'pdf/rasterised',
        scope: 'pdf',
        title: 'Prefer Recommended over Extreme',
        reason:
          'Extreme renders each page as an image, so text stops being selectable or searchable and the file can even get bigger. Recommended re-encodes embedded images and leaves text and vectors intact.',
        actionLabel: 'Switch to Recommended',
        tradeoff: 'Extreme still wins when a page is a single flat scan with no text.',
        confidence: 'likely',
        reversible: true,
        action: { type: 'pdf-level', level: 'recommended' },
      },
    ];
  }

  if (input.pdfLevel === 'low' && (input.pdfBytes ?? 0) >= 8 * 1024 * 1024) {
    return [
      {
        id: 'pdf/low-large-file',
        scope: 'pdf',
        title: 'Try the Recommended preset',
        reason:
          'Low keeps more embedded-image detail. On a file this size, Recommended usually saves noticeably more without a visible difference on screen.',
        actionLabel: 'Switch to Recommended',
        tradeoff: 'Images inside the PDF are re-encoded at a lower quality.',
        confidence: 'likely',
        reversible: true,
        action: { type: 'pdf-level', level: 'recommended' },
      },
    ];
  }

  return [];
}

function ocrRules(input: RecommendationInput): Recommendation[] {
  const script = input.ocrScript;
  if (!script) return [];
  const engine = input.ocrEngine ?? 'auto';

  if (script === 'cjk' && engine !== 'paddle') {
    return [
      {
        id: 'ocr/cjk-engine',
        scope: 'ocr',
        title: 'Try PaddleOCR for this script',
        reason:
          'PaddleOCR ships dedicated Chinese/Japanese/Korean recognition models; Tesseract\u2019s Latin model often mis-reads CJK glyphs.',
        actionLabel: 'Use PaddleOCR',
        tradeoff:
          'PaddleOCR PP-OCRv3 is experimental and downloads ~25 MB of weights on first use.',
        confidence: 'likely',
        reversible: true,
        action: { type: 'ocr-engine', engine: 'paddle' },
      },
    ];
  }

  if (engine === 'paddle' && (script === 'latin' || script === 'rtl' || script === 'indic')) {
    return [
      {
        id: 'ocr/latin-engine',
        scope: 'ocr',
        title: 'Tesseract.js is the safer default here',
        reason:
          'For this script Tesseract.js is the stable path and does not need extra CJK weights downloaded before the first page.',
        actionLabel: 'Use Tesseract.js',
        confidence: 'likely',
        reversible: true,
        action: { type: 'ocr-engine', engine: 'tesseract' },
      },
    ];
  }

  return [];
}

/**
 * All applicable, non-dismissed recommendations for one workflow, most
 * important first. Returns an empty array when suggestions are disabled or
 * nothing useful can be said — never a generic filler suggestion.
 */
export function recommendFor(
  input: RecommendationInput,
  settings = getSettings(),
): Recommendation[] {
  if (!settings.recommendations.enabled) return [];

  let out: Recommendation[] = [];
  switch (input.scope) {
    case 'images':
    case 'merge-pdf': {
      const order = orderRule(input.scope, input.files ?? []);
      if (order) out.push(order);
      if (input.scope === 'images') {
        const format = imageFormatRule(input);
        if (format) out.push(format);
      }
      break;
    }
    case 'images-to-pdf':
      out = imagesToPdfRules(input);
      break;
    case 'pdf':
      out = pdfRules(input);
      break;
    case 'ocr':
      out = ocrRules(input);
      break;
  }

  return out.filter((rec) => !isRecommendationDismissed(rec));
}

export { formatLabel as imageFormatLabel };
