/**
 * settings.ts — Global app settings: GPU-acceleration toggles and
 * per-engine defaults, persisted to localStorage. Every tool store in
 * store.ts seeds its initial values from here, and the Settings page
 * (pages/settings.ts) is the editor for all of it in one place.
 */
import type { ImageFormat, AudioFormat, VideoCodec, PdfLevel } from './types';
import { detectPlatform, recommend } from './platform';
import type { PerformanceTier } from './platform';
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
  modelTier:       AiModelTier | 'auto'; // 'auto' follows Performance Mode's recommendation
  autoApplySuggestions: boolean; // let Smart Analyze also rewrite each file's format/quality, not just tag+sort
}

/**
 * Manual overrides for how much CPU/RAM the app is allowed to use at once.
 * 'auto' (the default for both) means "trust lib/platform.ts's device
 * detection" — the same hardware-aware behaviour the app already had.
 * Setting either to a fixed number opts out of that detection for people
 * who know their situation better than a heuristic can (a phone that's
 * about to throttle, a shared/low-power machine, a tab they want to keep
 * light while doing other work) — see the explanatory copy in the
 * Settings page for the concrete trade-offs of each direction.
 */
export interface ResourceLimits {
  concurrency: number | 'auto'; // how many files runBatch() processes at once (Images/PDF batches)
  maxImageDim: number | 'auto'; // hard cap, in px on the longer edge, applied before any per-tool resize setting
}

export interface AppSettings {
  gpu:     GpuSettings;
  engines: EngineDefaults;
  performanceMode: PerformanceTier | 'auto'; // 'auto' = follow lib/platform.ts's device-based recommendation
  ai:      AiSettings;
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
      ocr:    { engine: 'paddle', lang: 'eng' },
    },
    performanceMode: 'auto',
    ai: { enabled: true, modelTier: 'auto', autoApplySuggestions: false },
    resourceLimits: { concurrency: 'auto', maxImageDim: 'auto' },
  };
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

export function resolvedPerformanceTier(s: AppSettings = getSettings()): PerformanceTier {
  if (s.performanceMode !== 'auto') return s.performanceMode;
  try { return detectPlatform().tier; } catch { return 'balanced'; }
}

export function resolvedAiModelTier(s: AppSettings = getSettings()): AiModelTier {
  if (s.ai.modelTier !== 'auto') return s.ai.modelTier;
  try { return recommend(detectPlatform()).aiModelTier; } catch { return 'efficient'; }
}

/** How many files a batch should process at once — the manual override
 * when set, otherwise the device-recommended value (same default as
 * before this setting existed). */
export function resolvedConcurrency(s: AppSettings = getSettings()): number {
  if (s.resourceLimits.concurrency !== 'auto') return s.resourceLimits.concurrency;
  try { return recommend(detectPlatform()).batchConcurrency; } catch { return 1; }
}

/** Longer-edge pixel cap applied before any per-tool resize setting —
 * 0 means "no extra cap" (still subject to each tool's own maxWidth/
 * maxHeight, just not this additional guardrail). 'auto' scales the cap
 * to the detected performance tier, same spirit as every other 'auto'
 * value in this file: efficient devices get a firmer ceiling so a single
 * huge photo can't blow past what the device can comfortably hold in
 * memory, powerful devices go uncapped. */
export function resolvedMaxImageDim(s: AppSettings = getSettings()): number {
  if (s.resourceLimits.maxImageDim !== 'auto') return s.resourceLimits.maxImageDim;
  try {
    const tier = resolvedPerformanceTier(s);
    return tier === 'efficient' ? 6000 : tier === 'balanced' ? 10000 : 0;
  } catch { return 0; }
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
function merge(base: AppSettings, saved: any): AppSettings {
  if (!saved || typeof saved !== 'object') return base;
  return {
    gpu: { ...base.gpu, ...(saved.gpu ?? {}) },
    engines: {
      images: { ...base.engines.images, ...(saved.engines?.images ?? {}) },
      pdf:    { ...base.engines.pdf,    ...(saved.engines?.pdf    ?? {}) },
      video:  { ...base.engines.video,  ...(saved.engines?.video  ?? {}) },
      audio:  { ...base.engines.audio,  ...(saved.engines?.audio  ?? {}) },
      gif:    { ...base.engines.gif,    ...(saved.engines?.gif    ?? {}) },
      ocr:    { ...base.engines.ocr,    ...(saved.engines?.ocr    ?? {}) },
    },
    performanceMode: saved.performanceMode ?? base.performanceMode,
    ai: { ...base.ai, ...(saved.ai ?? {}) },
    resourceLimits: { ...base.resourceLimits, ...(saved.resourceLimits ?? {}) },
  };
}

let _settings: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (_settings) return _settings;

  const savedV2 = readRaw();
  if (savedV2) {
    _settings = merge(defaults(), savedV2);
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
  _settings = applyAutoDefaults(merge(defaults(), legacy), isFirstRun);
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

// Lightweight pub/sub, same render()-on-change pattern every page already
// uses — lets the Settings page (or anything else) react to a change made
// elsewhere without polling.
const listeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { listeners.forEach(fn => fn()); }
