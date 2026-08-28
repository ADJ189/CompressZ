/**
 * platform.ts — Device & platform detection engine.
 *
 * Reads whatever the browser honestly exposes (feature-detection first,
 * UA text only as a last-resort label) and turns it into:
 *   1. A human-readable PlatformInfo snapshot, shown on the Settings page.
 *   2. A PerformanceTier ('efficient' | 'balanced' | 'powerful') derived
 *      from CPU core count, device memory, and GPU capability.
 *   3. Concrete engine recommendations (GPU toggles, video preset/codec,
 *      AI model tier, batch concurrency) that Settings → "Auto" mode and
 *      the AI engine both read from, so every engine actually adapts to
 *      the device instead of using one fixed default for everyone.
 *
 * Everything here is synchronous, local, and re-computed once per session
 * (cached in module scope) — no network calls, nothing sent anywhere.
 */

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type OSFamily = 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux' | 'ChromeOS' | 'Unknown';
export type BrowserEngine = 'Blink' | 'WebKit' | 'Gecko' | 'Unknown';
export type PerformanceTier = 'efficient' | 'balanced' | 'powerful';

export interface PlatformInfo {
  deviceClass:      DeviceClass;
  os:               OSFamily;
  engine:           BrowserEngine;
  cores:            number;        // navigator.hardwareConcurrency, 0 if unavailable
  memoryGB:         number | null; // navigator.deviceMemory (Chromium-only), null elsewhere
  touch:            boolean;
  gpuRenderer:      string | null; // WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL, if permitted
  webgl2:           boolean;
  webgpu:           boolean;
  crossOriginIsolated: boolean;    // gates SharedArrayBuffer → multi-threaded ffmpeg.wasm/OCR
  connection:       string | null; // effectiveType: '4g' | '3g' | ... (Chromium-only)
  saveData:         boolean;
  reducedMotion:    boolean;
  tier:             PerformanceTier;
}

export interface EngineRecommendation {
  gpu: { images: boolean; pdf: boolean; ocr: boolean; video: boolean };
  videoPreset: 'ultrafast' | 'fast' | 'medium' | 'slow';
  ffmpegThreaded: boolean;   // whether it's safe/worthwhile to request the multi-threaded ffmpeg core
  batchConcurrency: number;  // how many files this device should reasonably chew through in parallel
  aiModelTier: 'efficient' | 'powerful';
  reason: string;            // one-line human explanation shown in Settings
}

let _cached: PlatformInfo | null = null;

function detectOS(ua: string, platform: string): OSFamily {
  if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Win/.test(platform) || /Windows/.test(ua)) return 'Windows';
  if (/Mac/.test(platform) || /Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(platform) || /Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function detectEngine(ua: string): BrowserEngine {
  if (/Edg\/|Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'Blink';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Gecko';
  if (/Safari\/|AppleWebKit\//.test(ua)) return 'WebKit';
  return 'Unknown';
}

function detectDeviceClass(os: OSFamily, ua: string): DeviceClass {
  const isTablet = /iPad/.test(ua) || (os === 'Android' && !/Mobile/.test(ua));
  if (isTablet) return 'tablet';
  const isMobile = os === 'iOS' || (os === 'Android' && /Mobile/.test(ua));
  if (isMobile) return 'mobile';
  return 'desktop';
}

function detectGpuRenderer(): { renderer: string | null; webgl2: boolean } {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') as WebGL2RenderingContext | null);
    if (!gl) return { renderer: null, webgl2: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
    return { renderer, webgl2: true };
  } catch {
    return { renderer: null, webgl2: false };
  }
}

function computeTier(p: Omit<PlatformInfo, 'tier'>): PerformanceTier {
  // Score out of ~6; thresholds chosen so a typical mid-range phone lands
  // 'balanced' and a low-core/low-memory device or explicit Save-Data
  // request lands 'efficient' rather than being over-trusted.
  let score = 0;
  if (p.cores >= 8) score += 2; else if (p.cores >= 4) score += 1;
  if (p.memoryGB === null) score += 1; // unknown (often desktop Safari/Firefox) — don't penalise
  else if (p.memoryGB >= 8) score += 2; else if (p.memoryGB >= 4) score += 1;
  if (p.webgl2) score += 1;
  if (p.webgpu) score += 1;
  if (p.deviceClass === 'mobile') score -= 1;
  if (p.saveData) score -= 2;
  if (p.connection && /^(slow-2g|2g|3g)$/.test(p.connection)) score -= 1;

  if (score <= 1) return 'efficient';
  if (score <= 4) return 'balanced';
  return 'powerful';
}

export function detectPlatform(): PlatformInfo {
  if (_cached) return _cached;

  const ua = navigator.userAgent || '';
  const platform = (navigator as any).platform || '';
  const os = detectOS(ua, platform);
  const engine = detectEngine(ua);
  const deviceClass = detectDeviceClass(os, ua);
  const { renderer, webgl2 } = detectGpuRenderer();
  const conn = (navigator as any).connection;

  const base = {
    deviceClass,
    os,
    engine,
    cores: navigator.hardwareConcurrency || 0,
    memoryGB: (navigator as any).deviceMemory ?? null,
    touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
    gpuRenderer: renderer,
    webgl2,
    webgpu: 'gpu' in navigator,
    crossOriginIsolated: !!(window as any).crossOriginIsolated,
    connection: conn?.effectiveType ?? null,
    saveData: !!conn?.saveData,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  };

  _cached = { ...base, tier: computeTier(base) };
  return _cached;
}

/** Concrete per-engine recommendations for the detected device. Pure function of the tier + a few raw signals, so it's easy to reason about and to show a "why" string in Settings. */
export function recommend(info: PlatformInfo = detectPlatform()): EngineRecommendation {
  const gpuOn = info.webgl2; // GPU toggles are only meaningful if a canvas GPU path exists at all
  switch (info.tier) {
    case 'efficient':
      return {
        gpu: { images: gpuOn, pdf: false, ocr: false, video: false },
        videoPreset: 'ultrafast',
        ffmpegThreaded: info.crossOriginIsolated && info.cores >= 4,
        batchConcurrency: 1,
        aiModelTier: 'efficient',
        reason: `${info.cores || 'Unknown'} CPU core(s)${info.memoryGB ? `, ~${info.memoryGB}GB RAM` : ''} — favouring low memory pressure and fast turnaround over max quality.`,
      };
    case 'powerful':
      return {
        gpu: { images: gpuOn, pdf: gpuOn, ocr: gpuOn, video: gpuOn },
        videoPreset: 'medium',
        ffmpegThreaded: info.crossOriginIsolated,
        batchConcurrency: 3,
        aiModelTier: 'powerful',
        reason: `${info.cores} CPU cores${info.memoryGB ? `, ~${info.memoryGB}GB RAM` : ''}${info.webgpu ? ', WebGPU available' : ''} — this device can comfortably run the heavier engines.`,
      };
    default:
      return {
        gpu: { images: gpuOn, pdf: gpuOn, ocr: false, video: gpuOn },
        videoPreset: 'fast',
        ffmpegThreaded: info.crossOriginIsolated && info.cores >= 4,
        batchConcurrency: 2,
        aiModelTier: 'efficient',
        reason: `${info.cores || 'Unknown'} CPU core(s)${info.memoryGB ? `, ~${info.memoryGB}GB RAM` : ''} — a balanced middle ground.`,
      };
  }
}

export function tierLabel(t: PerformanceTier): string {
  return t === 'efficient' ? 'Efficient' : t === 'powerful' ? 'Powerful' : 'Balanced';
}
