/**
 * settings.ts — Global app settings: GPU-acceleration toggles and
 * per-engine defaults, persisted to localStorage. Every tool store in
 * store.ts seeds its initial values from here, and the Settings page
 * (pages/settings.ts) is the editor for all of it in one place.
 */
import type { ImageFormat, AudioFormat, VideoCodec, PdfLevel } from './types';
import { detectPlatform, recommend } from './platform';
import type { EngineRecommendation, PerformanceTier, PlatformInfo } from './platform';
import type { AiModelTier } from './aiEngine';

const KEY = 'cz-settings-v2';
const LEGACY_KEY = 'cz-settings-v1';

export interface GpuSettings {
  images: boolean;
  pdf:    boolean;
  ocr:    boolean;
  video:  boolean;
  gif:    boolean; // no-op today — see GPU_CAPABLE below
  audio:  boolean; // no-op today — see GPU_CAPABLE below
}

export interface EngineDefaults {
  images: { format: ImageFormat; quality: number; maxDim: number };
  pdf:    { level: PdfLevel; renderScale: number };
  video:  { codec: VideoCodec; preset: 'ultrafast' | 'fast' | 'medium' | 'slow'; crfQuality: number };
  audio:  { format: AudioFormat; bitrate: number };
  gif:    { quality: number };
  ocr:    { engine: 'paddle' | 'tesseract'; lang: string };
}

export interface AiSettings {
  enabled:         boolean;     // master switch for Smart Analyze/Sort features on the Images pages
  modelTier:       AiModelTier | 'auto'; // 'auto' follows the resolved resource profile
  /**
   * Preferred inference backend. 'auto' uses WebGPU only when the device
   * exposes it (the AI loader still performs a real adapter/device probe and
   * falls back to WASM). 'wasm' explicitly keeps inference on the CPU even on
   * a WebGPU-capable machine; 'webgpu' asks for the GPU first but still falls
   * back to WASM instead of making the feature unavailable.
   */
  backend:         'auto' | 'webgpu' | 'wasm';
  autoApplySuggestions: boolean; // let Smart Analyze also rewrite each file's format/quality, not just tag+sort
}

/**
 * Adaptive Resource Guard profile. This is the single user-facing resource
 * control; the older `performanceMode` tier values are migrated into it and
 * kept only for rollback safety.
 */
export type ResourceMode = 'auto' | 'memory-saver' | 'balanced' | 'maximum';

export interface RecommendationSettings {
  enabled: boolean; // contextual suggestions in tool workflows
  allowAi: boolean; // allow the optional local classifier to inform suggestions
}

/**
 * Manual overrides for how much CPU/RAM the app is allowed to use at once.
 * 'auto' (the default for both) means "trust the resolved Resource Guard
 * profile". Setting either to a fixed number opts out of that detection for
 * people who know their situation better than a heuristic can (a phone that's
 * about to throttle, a shared/low-power machine, a tab they want to keep
 * light while doing other work).
 */
export interface ResourceLimits {
  concurrency: number | 'auto'; // user ceiling for concurrent lightweight batch jobs
  maxImageDim: number | 'auto'; // hard cap, in px on the longer edge, applied before any per-tool resize setting
}

export interface AppSettings {
  gpu:     GpuSettings;
  engines: EngineDefaults;
  /**
   * @deprecated Legacy tier control (`efficient`/`balanced`/`powerful`).
   * Migrated into `resourceMode` on read; never rendered as a second control.
   */
  performanceMode: PerformanceTier | 'auto';
  resourceMode: ResourceMode;
  ai:      AiSettings;
  recommendations: RecommendationSettings;
  resourceLimits: ResourceLimits;
}

// Engines whose GPU toggle actually changes engine behaviour today (see
// gpu.ts for what "GPU acceleration" concretely means for each). Audio and
// GIF are pure FFmpeg.wasm pipelines with no canvas step in the browser —
// their toggle is still shown in Settings (for a consistent, honest
// per-engine layout) but rendered disabled with an explanatory note.
export const GPU_CAPABLE: (keyof GpuSettings)[] = ['images', 'pdf', 'ocr', 'video'];

function defaults(): AppSettings {
  return {
    gpu: { images: true, pdf: true, ocr: true, video: true, gif: false, audio: false },
    engines: {
      images: { format: 'image/webp', quality: 82, maxDim: 0 },
      pdf:    { level: 'recommended', renderScale: 2 },
      video:  { codec: 'h264', preset: 'fast', crfQuality: 75 },
      audio:  { format: 'mp3', bitrate: 192 },
      gif:    { quality: 82 },
      // Tesseract is the stable default. PaddleOCR PP-OCRv3 remains
      // selectable, but its integration is experimental and the PP-OCRv3
      // recognizer is not a layout/handwriting model.
      ocr:    { engine: 'tesseract', lang: 'eng' },
    },
    performanceMode: 'auto',
    resourceMode: 'auto',
    ai: { enabled: true, modelTier: 'auto', backend: 'auto', autoApplySuggestions: false },
    recommendations: { enabled: true, allowAi: true },
    resourceLimits: { concurrency: 'auto', maxImageDim: 'auto' },
  };
}

/** Map the legacy tier control onto the Resource Guard profile exactly once. */
export function migrateLegacyResourceMode(
  legacy: PerformanceTier | 'auto' | undefined,
): ResourceMode {
  if (legacy === 'efficient') return 'memory-saver';
  if (legacy === 'powerful') return 'maximum';
  if (legacy === 'balanced') return 'balanced';
  return 'auto';
}

/** The performance tier a resource profile resolves to on this device. */
export function resourceModeTier(
  mode: ResourceMode,
  detectedTier: PerformanceTier,
): PerformanceTier {
  switch (mode) {
    case 'memory-saver': return 'efficient';
    case 'balanced':    return 'balanced';
    case 'maximum':     return 'powerful';
    default:            return detectedTier;
  }
}

/**
 * Resolve 'auto' choices (performanceMode, ai.modelTier) against the
 * detected device, and — only on a device's very first visit, before any
 * saved settings exist — seed the GPU toggles from the recommendation too.
 * Once a person has touched a toggle themselves, their choice persists as
 * normal; this never overwrites an existing saved value.
 */
function applyAutoDefaults(s: AppSettings, isFirstRun: boolean): AppSettings {
  if (typeof window === 'undefined') return s; // SSR/test guard — no window, nothing to detect
  try {
    const info = detectPlatform();
    const rec = recommend(info);
    if (isFirstRun) {
      s.gpu.images = rec.gpu.images;
      s.gpu.pdf    = rec.gpu.pdf;
      s.gpu.ocr    = rec.gpu.ocr;
      s.gpu.video  = rec.gpu.video;
      s.engines.video.preset = rec.videoPreset;
    }
  } catch {
    // detection failed (non-browser test env, locked-down sandbox) — keep hand-picked defaults
  }
  return s;
}

/**
 * The single resolved "how should this session run" profile.
 *
 * Before this existed, each resolver independently called
 * `recommend(detectPlatform())`, so a manual Performance Mode choice changed
 * the tier label but *not* the AI model, concurrency or FFmpeg threading.
 * Now every engine-facing resolver below reads this one object. Explicit
 * per-engine overrides (AI model tier, batch concurrency, image dimension
 * cap, video preset) still win — Performance Mode only supplies the values
 * for choices left on 'auto'.
 *
 * This is a resource profile, not a quality goal: it never changes the
 * requested image/video/audio quality or silently lowers output resolution.
 */
export interface ExecutionProfile {
  /** Resolved performance tier (derived from resourceMode + device). */
  mode: PerformanceTier;
  /** User-facing Resource Guard profile. */
  resourceMode: ResourceMode;
  modeSource: 'auto' | 'manual';
  aiModelTier: AiModelTier;
  /** Preferred inference backend. aiEngine still feature-tests it and falls back to WASM at load time. */
  aiBackendPreference: 'webgpu' | 'wasm';
  maxConcurrentImages: number;
  /** PDF page rendering shares the same canvas batch pool as images today. */
  maxConcurrentPdfs: number;
  maxDecodedImageDimension: number; // 0 = no extra cap
  ffmpegThreaded: boolean;
  videoPreset: 'ultrafast' | 'fast' | 'medium' | 'slow';
  gpu: EngineRecommendation['gpu'];
  reason: string;
}

function fallbackRecommendation(tier: PerformanceTier): EngineRecommendation {
  return {
    gpu: { images: false, pdf: false, ocr: false, video: false },
    videoPreset: tier === 'efficient' ? 'ultrafast' : tier === 'powerful' ? 'medium' : 'fast',
    ffmpegThreaded: false,
    batchConcurrency: tier === 'efficient' ? 1 : tier === 'powerful' ? 3 : 2,
    aiModelTier: tier === 'powerful' ? 'powerful' : 'efficient',
    reason: 'Device detection unavailable — using conservative defaults.',
  };
}

function tierImageCap(tier: PerformanceTier): number {
  return tier === 'efficient' ? 6000 : tier === 'balanced' ? 10000 : 0;
}

export function resolveExecutionProfile(
  s: AppSettings = getSettings(),
  /**
   * Test/injection hook: pass `null` to skip device detection entirely, or a
   * concrete `PlatformInfo` to resolve against a fixed device. Normal callers
   * omit it and get the cached `detectPlatform()` snapshot.
   */
  infoOverride?: PlatformInfo | null,
): ExecutionProfile {
  let info: PlatformInfo | null;
  if (infoOverride !== undefined) {
    info = infoOverride;
  } else {
    info = null;
    try { info = detectPlatform(); } catch { /* non-browser/test env */ }
  }

  const tier: PerformanceTier = resourceModeTier(
    s.resourceMode,
    info?.tier ?? 'balanced',
  );
  const rec = info ? recommend(info, tier) : fallbackRecommendation(tier);

  const maxConcurrentImages =
    s.resourceLimits.concurrency !== 'auto'
      ? s.resourceLimits.concurrency
      : rec.batchConcurrency;
  const maxDecodedImageDimension =
    s.resourceLimits.maxImageDim !== 'auto'
      ? s.resourceLimits.maxImageDim
      : tierImageCap(tier);

  const aiBackendPreference: 'webgpu' | 'wasm' =
    s.ai.backend === 'webgpu'
      ? 'webgpu'
      : s.ai.backend === 'wasm'
        ? 'wasm'
        : info?.webgpu
          ? 'webgpu'
          : 'wasm';

  return {
    mode: tier,
    resourceMode: s.resourceMode,
    modeSource: s.resourceMode === 'auto' ? 'auto' : 'manual',
    aiModelTier: s.ai.modelTier !== 'auto' ? s.ai.modelTier : rec.aiModelTier,
    aiBackendPreference,
    maxConcurrentImages,
    maxConcurrentPdfs: maxConcurrentImages,
    maxDecodedImageDimension,
    ffmpegThreaded: rec.ffmpegThreaded,
    videoPreset: s.engines.video.preset,
    gpu: rec.gpu,
    reason: rec.reason,
  };
}

export function resolvedPerformanceTier(s: AppSettings = getSettings()): PerformanceTier {
  return resolveExecutionProfile(s).mode;
}

export function resolvedAiModelTier(s: AppSettings = getSettings()): AiModelTier {
  return resolveExecutionProfile(s).aiModelTier;
}

/** How many files a batch should process at once — the manual override
 * when set, otherwise the value from the same resolved profile the rest of
 * the app uses. */
export function resolvedConcurrency(s: AppSettings = getSettings()): number {
  return resolveExecutionProfile(s).maxConcurrentImages;
}

/** Longer-edge pixel cap applied before any per-tool resize setting —
 * 0 means "no extra cap" (still subject to each tool's own maxWidth/
 * maxHeight, just not this additional guardrail). 'auto' scales the cap to
 * the *resolved* performance mode, so a manual Eco choice actually applies
 * the firmer ceiling even on powerful hardware. */
export function resolvedMaxImageDim(s: AppSettings = getSettings()): number {
  return resolveExecutionProfile(s).maxDecodedImageDimension;
}

// Safari private mode (and storage-disabled browsers generally) throw on
// localStorage access rather than just failing quietly — wrap both sides
// so a settings read/write never takes the app down with it.
function readRaw(): unknown {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function writeRaw(v: AppSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); }
  catch { /* storage unavailable — settings simply won't persist this session */ }
}

// Merge saved settings over defaults key-by-key (not a blind spread) so a
// settings shape added in a later app version — a new engine, a new GPU
// key — isn't lost or left undefined when merging an older saved blob.
/** Shape of a persisted blob. Everything is optional because it comes from
 *  an older (or hand-edited) install and must be merged defensively. */
type SavedSettings = {
  gpu?: Partial<AppSettings['gpu']>;
  engines?: Partial<EngineDefaults>;
  performanceMode?: PerformanceTier | 'auto';
  resourceMode?: string;
  ai?: Partial<AiSettings>;
  recommendations?: Partial<RecommendationSettings>;
  resourceLimits?: Partial<ResourceLimits>;
};

const IMAGE_FORMATS: readonly ImageFormat[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];
const PDF_LEVELS: readonly PdfLevel[] = ['low', 'recommended', 'extreme'];
const VIDEO_CODECS: readonly VideoCodec[] = ['h264', 'h265', 'vp9', 'vp8', 'av1'];
const VIDEO_PRESETS: readonly EngineDefaults['video']['preset'][] = [
  'ultrafast',
  'fast',
  'medium',
  'slow',
];
const AUDIO_FORMATS: readonly AudioFormat[] = [
  'mp3',
  'aac',
  'ogg',
  'opus',
  'flac',
  'wav',
];
const OCR_ENGINES: readonly EngineDefaults['ocr']['engine'][] = ['paddle', 'tesseract'];
const PERFORMANCE_MODES: readonly (PerformanceTier | 'auto')[] = [
  'auto',
  'efficient',
  'balanced',
  'powerful',
];
const AI_MODEL_TIERS: readonly (AiModelTier | 'auto')[] = [
  'auto',
  'efficient',
  'powerful',
];
const AI_BACKENDS: readonly AiSettings['backend'][] = ['auto', 'webgpu', 'wasm'];

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Clamp a persisted number into a sane range; reject NaN/Infinity/strings. */
function asInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function asAutoInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number | 'auto',
): number | 'auto' {
  if (value === 'auto') return 'auto';
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function asLanguage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^[a-z0-9_+.-]{1,32}$/i.test(trimmed) ? trimmed : fallback;
}

/**
 * Merge a persisted (and therefore untrusted) blob over the defaults.
 *
 * localStorage is writable by hand, by older app versions and by other code on
 * the same origin. A blind spread used to let a corrupted `quality`, `bitrate`
 * or `concurrency` reach an engine (or a semaphore capacity) unchanged. Every
 * field is now type-checked and range-clamped, with unknown keys dropped.
 */
export function mergeSettings(base: AppSettings, raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return base;
  const saved = raw as SavedSettings;
  const gpu = saved.gpu ?? {};
  const images = saved.engines?.images ?? base.engines.images;
  const pdf = saved.engines?.pdf ?? base.engines.pdf;
  const video = saved.engines?.video ?? base.engines.video;
  const audio = saved.engines?.audio ?? base.engines.audio;
  const gif = saved.engines?.gif ?? base.engines.gif;
  const ocr = saved.engines?.ocr ?? base.engines.ocr;
  const ai = saved.ai ?? {};
  const recommendations = saved.recommendations ?? {};
  const limits = saved.resourceLimits ?? {};

  const resourceMode: ResourceMode =
    saved.resourceMode === 'auto' ||
    saved.resourceMode === 'memory-saver' ||
    saved.resourceMode === 'balanced' ||
    saved.resourceMode === 'maximum'
      ? saved.resourceMode
      : saved.performanceMode !== undefined
        ? migrateLegacyResourceMode(saved.performanceMode)
        : base.resourceMode;

  return {
    gpu: {
      images: asBoolean(gpu.images, base.gpu.images),
      pdf: asBoolean(gpu.pdf, base.gpu.pdf),
      ocr: asBoolean(gpu.ocr, base.gpu.ocr),
      video: asBoolean(gpu.video, base.gpu.video),
      gif: asBoolean(gpu.gif, base.gpu.gif),
      audio: asBoolean(gpu.audio, base.gpu.audio),
    },
    engines: {
      images: {
        format: asEnum(images.format, IMAGE_FORMATS, base.engines.images.format),
        quality: asInt(images.quality, 0, 100, base.engines.images.quality),
        maxDim: asInt(images.maxDim, 0, 100_000, base.engines.images.maxDim),
      },
      pdf: {
        level: asEnum(pdf.level, PDF_LEVELS, base.engines.pdf.level),
        renderScale: asInt(pdf.renderScale, 1, 4, base.engines.pdf.renderScale),
      },
      video: {
        codec: asEnum(video.codec, VIDEO_CODECS, base.engines.video.codec),
        preset: asEnum(video.preset, VIDEO_PRESETS, base.engines.video.preset),
        crfQuality: asInt(video.crfQuality, 0, 100, base.engines.video.crfQuality),
      },
      audio: {
        format: asEnum(audio.format, AUDIO_FORMATS, base.engines.audio.format),
        bitrate: asInt(audio.bitrate, 8, 512, base.engines.audio.bitrate),
      },
      gif: {
        quality: asInt(gif.quality, 0, 100, base.engines.gif.quality),
      },
      ocr: {
        engine: asEnum(ocr.engine, OCR_ENGINES, base.engines.ocr.engine),
        lang: asLanguage(ocr.lang, base.engines.ocr.lang),
      },
    },
    performanceMode: asEnum(
      saved.performanceMode,
      PERFORMANCE_MODES,
      base.performanceMode,
    ),
    resourceMode,
    ai: {
      enabled: asBoolean(ai.enabled, base.ai.enabled),
      modelTier: asEnum(ai.modelTier, AI_MODEL_TIERS, base.ai.modelTier),
      backend: asEnum(ai.backend, AI_BACKENDS, base.ai.backend),
      autoApplySuggestions: asBoolean(
        ai.autoApplySuggestions,
        base.ai.autoApplySuggestions,
      ),
    },
    recommendations: {
      enabled: asBoolean(recommendations.enabled, base.recommendations.enabled),
      allowAi: asBoolean(recommendations.allowAi, base.recommendations.allowAi),
    },
    resourceLimits: {
      concurrency: asAutoInt(
        limits.concurrency,
        1,
        16,
        base.resourceLimits.concurrency,
      ),
      maxImageDim: asAutoInt(
        limits.maxImageDim,
        0,
        100_000,
        base.resourceLimits.maxImageDim,
      ),
    },
  };
}

let _settings: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (_settings) return _settings;

  const savedV2 = readRaw();
  if (savedV2) {
    _settings = mergeSettings(defaults(), savedV2);
    // Persist the merged shape so one-time migrations (legacy performanceMode
    // → resourceMode, newly added fields) survive a later reload.
    writeRaw(_settings);
    return _settings;
  }

  // No v2 blob yet: carry over a v1 install's GPU/engine choices (still the
  // same shape) instead of silently resetting a returning user, then seed
  // the new v2-only fields (performanceMode, ai) from device detection.
  let legacy: unknown = null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    legacy = raw ? JSON.parse(raw) : null;
  } catch { /* ignore */ }

  const isFirstRun = !legacy;
  _settings = applyAutoDefaults(mergeSettings(defaults(), legacy), isFirstRun);
  writeRaw(_settings);
  return _settings;
}

/** Mutate settings in place via `patch`, then persist and notify listeners. */
export function updateSettings(patch: (s: AppSettings) => void) {
  const s = getSettings();
  patch(s);
  writeRaw(s);
  notify();
}

export function resetSettings() {
  _settings = applyAutoDefaults(defaults(), true);
  writeRaw(_settings);
  notify();
}

/** Fresh copy of the built-in defaults — used by Settings' per-section reset. */
export function defaultSettings(): AppSettings {
  return JSON.parse(JSON.stringify(defaults())) as AppSettings;
}

/** Device-recommended defaults — applies hardware capabilities and performance tier recommendations. */
export function deviceDefaultSettings(): AppSettings {
  return applyAutoDefaults(defaults(), true);
}

// Lightweight pub/sub, same render()-on-change pattern every page already
// uses — lets the Settings page (or anything else) react to a change made
// elsewhere without polling.
const listeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { listeners.forEach(fn => fn()); }
