/**
 * resourceManager.ts — the single global Adaptive Resource Guard.
 *
 * Every heavyweight engine (image/PDF batches, OCR, local AI, FFmpeg-backed
 * video/audio/GIF/convert) acquires a slot here before it starts. There are
 * two bounded pools:
 *
 *   • a heavy pool (capacity 1 by default, 2 only on a powerful device in
 *     Maximum Performance) for whole-file transcoding, OCR and AI inference;
 *   • a light pool with weighted slots for independent, cheaper batch items.
 *
 * The browser cannot report exact free physical RAM, so this is a scheduling
 * and cleanup boundary — not a RAM meter. Signals are workload facts (bytes,
 * pixels, pages), device hints (cores, memory), and failures we actually
 * observed (allocation errors). Pressure lowers future concurrency with
 * hysteresis and recovers slowly after successful jobs.
 *
 * No network calls, no persistence of file data, no worker spawning.
 */
import {
  getSettings,
  resolveExecutionProfile,
  type ResourceMode,
} from './settings';
import { detectPlatform } from './platform';

export type WorkloadClass = 'light' | 'medium' | 'heavy';
export type JobKind =
  | 'image'
  | 'pdf'
  | 'ocr'
  | 'ai'
  | 'video'
  | 'audio'
  | 'gif'
  | 'convert'
  | 'document'
  | 'thumbnail';

export interface JobDescriptor {
  kind: JobKind;
  /** Short, non-sensitive label used by the queue/status UI. */
  label?: string;
  bytes?: number;
  pixels?: number;
  pages?: number;
  durationSec?: number;
  /** Explicit estimate for callers that already know the cost. */
  workload?: WorkloadClass;
}

export interface JobEstimate {
  workload: WorkloadClass;
  level: 'low' | 'moderate' | 'high';
  reason: string;
}

export interface ResourcePolicy {
  mode: ResourceMode;
  tier: 'efficient' | 'balanced' | 'powerful';
  heavyLimit: number;
  lightCapacity: number;
  userCeiling: number;
  label: string;
}

export interface ResourceJobSnapshot {
  id: string;
  kind: JobKind;
  label: string;
  workload: WorkloadClass;
  state: 'queued' | 'running';
}

export interface ResourceSnapshot {
  mode: ResourceMode;
  modeLabel: string;
  tier: ResourcePolicy['tier'];
  estimate: 'idle' | 'low' | 'moderate' | 'high';
  estimateLabel: string;
  concurrencyLabel: string;
  engineHint: string;
  reduced: boolean;
  pressureReason: string | null;
  activeHeavy: number;
  activeLight: number;
  queued: number;
  jobs: ResourceJobSnapshot[];
  /** Always true: browser hints are estimates, not a measured RAM meter. */
  estimateOnly: true;
}

const MODE_LABEL: Record<ResourceMode, string> = {
  'auto': 'Auto',
  'memory-saver': 'Memory Saver',
  'balanced': 'Balanced',
  'maximum': 'Maximum Performance',
};

let policyCache: { key: string; policy: ResourcePolicy } | null = null;

/** Resolve the current profile. Cheap; cached until the settings shape changes. */
export function getResourcePolicy(): ResourcePolicy {
  const s = getSettings();
  const key = [
    s.resourceMode,
    s.resourceLimits.concurrency,
    s.resourceLimits.maxImageDim,
  ].join('|');
  if (policyCache?.key === key) return policyCache.policy;

  const profile = resolveExecutionProfile(s);
  let cores = 4;
  try {
    cores = detectPlatform().cores || 4;
  } catch {
    /* non-browser/test environment — keep the conservative default */
  }

  const userCeiling =
    s.resourceLimits.concurrency === 'auto'
      ? Number.POSITIVE_INFINITY
      : s.resourceLimits.concurrency;

  let lightBase: number;
  switch (s.resourceMode) {
    case 'memory-saver':
      lightBase = 1;
      break;
    case 'maximum':
      lightBase = Math.max(2, Math.min(4, Math.floor(cores / 2)));
      break;
    case 'balanced':
      lightBase = 2;
      break;
    default:
      lightBase =
        profile.mode === 'efficient' ? 1 : profile.mode === 'powerful' ? 3 : 2;
  }

  const lightCapacity = Math.max(1, Math.min(lightBase, userCeiling));
  const heavyLimit =
    s.resourceMode === 'maximum' && profile.mode === 'powerful' && cores >= 8
      ? 2
      : 1;

  const policy: ResourcePolicy = {
    mode: s.resourceMode,
    tier: profile.mode,
    heavyLimit,
    lightCapacity,
    userCeiling,
    label: MODE_LABEL[s.resourceMode],
  };
  policyCache = { key, policy };
  return policy;
}

/** Test/debug helper — never needed in normal app flow. */
export function invalidateResourcePolicy(): void {
  policyCache = null;
}

// ── Job estimation ────────────────────────────────────────────

function estimate(
  workload: WorkloadClass,
  reason: string,
): JobEstimate {
  return {
    workload,
    level:
      workload === 'heavy'
        ? 'high'
        : workload === 'medium'
          ? 'moderate'
          : 'low',
    reason,
  };
}

/**
 * Conservative cost estimate from metadata already available to the caller.
 * Never decodes a file just to measure it.
 */
export function estimateJob(job: JobDescriptor): JobEstimate {
  if (job.workload) return estimate(job.workload, 'Caller declared workload class.');

  const bytes = job.bytes ?? 0;
  const pixels = job.pixels ?? 0;
  const pages = job.pages ?? 0;
  const duration = job.durationSec ?? 0;

  switch (job.kind) {
    case 'ai':
    case 'video':
    case 'gif':
      return estimate('heavy', `${job.kind} engine runs as one heavy job.`);
    case 'ocr':
      if (pages >= 25 || bytes >= 15 * 1024 * 1024) {
        return estimate('heavy', 'Large document — page-by-page OCR.');
      }
      return estimate('medium', 'OCR job; one page is processed at a time.');
    case 'image':
      if (pixels >= 24_000_000 || bytes >= 25 * 1024 * 1024) {
        return estimate('heavy', 'Very large image or pixel count.');
      }
      if (pixels >= 8_000_000 || bytes >= 6 * 1024 * 1024) {
        return estimate('medium', 'Moderate image size.');
      }
      return estimate('light', 'Small image.');
    case 'pdf':
      if (pages >= 40 || bytes >= 20 * 1024 * 1024) {
        return estimate('heavy', 'Long or large PDF.');
      }
      if (pages >= 8 || bytes >= 3 * 1024 * 1024) {
        return estimate('medium', 'Multi-page PDF.');
      }
      return estimate('light', 'Small PDF.');
    case 'audio':
      if (bytes >= 40 * 1024 * 1024 || duration >= 600) {
        return estimate('heavy', 'Long audio track.');
      }
      return estimate('medium', 'Audio conversion shares the FFmpeg engine.');
    case 'convert':
      if (bytes >= 20 * 1024 * 1024) {
        return estimate('heavy', 'Large conversion input.');
      }
      return estimate('medium', 'Conversion job.');
    case 'document':
      return estimate('medium', 'Document conversion.');
    case 'thumbnail':
      return estimate('light', 'Preview thumbnail.');
    default:
      return estimate('medium', 'Unclassified job — scheduled conservatively.');
  }
}

/** Allocation-style failures are the only ones that trigger a pressure drop. */
export function isAllocationFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err instanceof RangeError) return true;
  return /allocation failed|out of memory|invalid array length|cannot enlarge memory|not enough memory/i.test(
    err.message,
  );
}

// ── Weighted semaphore ────────────────────────────────────────

interface Waiter {
  weight: number;
  grant: () => void;
  fail: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class WeightedSemaphore {
  private used = 0;
  private queue: Waiter[] = [];

  constructor(private capacity: number) {}

  setCapacity(n: number): void {
    this.capacity = Math.max(1, n);
    this.drain();
  }

  get load(): number {
    return this.used;
  }

  acquire(weight: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    const w = Math.min(Math.max(1, weight), this.capacity);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        weight: w,
        grant: () => resolve(() => this.release(w)),
        fail: reject,
        signal,
      };
      if (signal) {
        waiter.onAbort = () => {
          const i = this.queue.indexOf(waiter);
          if (i >= 0) this.queue.splice(i, 1);
          reject(abortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      this.drain();
    });
  }

  private release(weight: number): void {
    this.used = Math.max(0, this.used - weight);
    this.drain();
  }

  private drain(): void {
    while (this.queue.length) {
      const next = this.queue[0];
      if (this.used + next.weight > this.capacity) break;
      this.queue.shift();
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      this.used += next.weight;
      next.grant();
    }
  }
}

function abortError(): Error {
  const err = new Error('Job cancelled');
  err.name = 'AbortError';
  return err;
}

// ── Adaptive state ────────────────────────────────────────────

let heavyPool: WeightedSemaphore | null = null;
let lightPool: WeightedSemaphore | null = null;
let poolsKey = '';
let pressure = 0;
let pressureReason: string | null = null;
let successStreak = 0;
let seq = 0;
const active = new Map<string, ResourceJobSnapshot>();
const listeners = new Set<() => void>();

function pools() {
  const p = getResourcePolicy();
  const key = `${p.heavyLimit}|${p.lightCapacity}`;
  if (key !== poolsKey || !heavyPool || !lightPool) {
    poolsKey = key;
    heavyPool = new WeightedSemaphore(p.heavyLimit);
    lightPool = new WeightedSemaphore(p.lightCapacity);
    // A pressure event must survive a profile/pool rebuild.
    if (pressure > 0) lightPool.setCapacity(1);
  }
  return { heavy: heavyPool, light: lightPool, policy: p };
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a subscriber must not break the scheduler */
    }
  });
}

export function subscribeResource(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notePressure(reason: string): void {
  pressure = Math.min(2, pressure + 1);
  pressureReason = reason;
  successStreak = 0;
  const { light } = pools();
  light.setCapacity(1);
  notify();
}

function noteSuccess(): void {
  if (pressure === 0) return;
  successStreak++;
  // Hysteresis: recover only after several clean jobs, one pressure step at a
  // time, so a single slow job cannot make concurrency oscillate.
  if (successStreak >= 5) {
    pressure = Math.max(0, pressure - 1);
    successStreak = 0;
    const p = getResourcePolicy();
    pools().light.setCapacity(
      pressure === 0 ? p.lightCapacity : Math.max(1, Math.min(2, p.lightCapacity)),
    );
    if (pressure === 0) pressureReason = null;
    notify();
  }
}

/** Test hook: clear adaptive pressure between deterministic scenarios. */
export function resetAdaptiveState(): void {
  pressure = 0;
  pressureReason = null;
  successStreak = 0;
  active.clear();
  heavyPool = null;
  lightPool = null;
  poolsKey = '';
  policyCache = null;
  notify();
}

export interface RunOptions {
  signal?: AbortSignal;
}

async function waitUntilVisible(signal?: AbortSignal): Promise<void> {
  if (typeof document === 'undefined' || !document.hidden) return;
  await new Promise<void>((resolve, reject) => {
    const onVisibility = () => {
      if (document.hidden) return;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      signal?.removeEventListener('abort', onAbort);
    };
    document.addEventListener('visibilitychange', onVisibility);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `task` inside the global guard. The returned promise settles exactly
 * when the task settles, and the slot is always released in `finally`.
 */
export async function runScheduled<T>(
  job: JobDescriptor,
  task: (signal?: AbortSignal) => Promise<T>,
  opts: RunOptions = {},
): Promise<T> {
  const estimate = estimateJob(job);
  const id = `${job.kind}-${++seq}`;
  const entry: ResourceJobSnapshot = {
    id,
    kind: job.kind,
    label: job.label ?? job.kind,
    workload: estimate.workload,
    state: 'queued',
  };
  active.set(id, entry);
  notify();

  const useHeavy = estimate.workload === 'heavy';
  const weight = estimate.workload === 'medium' ? 2 : 1;
  let release: () => void = () => {};

  try {
    if (opts.signal?.aborted) throw abortError();
    if (estimate.workload !== 'light') await waitUntilVisible(opts.signal);

    const current = pools();
    if (useHeavy) {
      release = await current.heavy.acquire(1, opts.signal);
    } else {
      release = await current.light.acquire(weight, opts.signal);
    }

    entry.state = 'running';
    notify();
    const result = await task(opts.signal);
    noteSuccess();
    return result;
  } catch (err) {
    if (isAllocationFailure(err)) {
      notePressure('A job ran out of memory — reduced parallel work to keep this tab responsive.');
    }
    throw err;
  } finally {
    release();
    active.delete(id);
    notify();
  }
}

// ── Status snapshot ───────────────────────────────────────────

const ENGINE_HINT: Partial<Record<JobKind, string>> = {
  image: 'Canvas/OffscreenCanvas',
  pdf: 'PDF.js + pdf-lib',
  ocr: 'Tesseract.js / PaddleOCR',
  ai: 'Transformers.js (local)',
  video: 'WebCodecs / Mediabunny → FFmpeg.wasm',
  audio: 'FFmpeg.wasm',
  gif: 'FFmpeg.wasm',
  convert: 'FFmpeg.wasm / document engines',
  document: 'Document engine',
  thumbnail: 'Canvas thumbnail',
};

export function getResourceSnapshot(): ResourceSnapshot {
  const p = getResourcePolicy();
  const jobs = Array.from(active.values());
  const running = jobs.filter((j) => j.state === 'running');
  const heavy = running.filter((j) => j.workload === 'heavy');
  const light = running.filter((j) => j.workload !== 'heavy');
  const peak = jobs.reduce<'idle' | 'low' | 'moderate' | 'high'>(
    (acc, j) =>
      j.workload === 'heavy'
        ? 'high'
        : j.workload === 'medium'
          ? acc === 'high'
            ? 'high'
            : 'moderate'
          : acc === 'idle'
            ? 'low'
            : acc,
    'idle',
  );
  const engineKind = heavy[0]?.kind ?? running[0]?.kind ?? light[0]?.kind;
  return {
    mode: p.mode,
    modeLabel: p.label,
    tier: p.tier,
    estimate: peak,
    estimateLabel:
      peak === 'idle'
        ? 'Idle'
        : peak === 'high'
          ? 'High'
          : peak === 'moderate'
            ? 'Moderate'
            : 'Low',
    concurrencyLabel:
      `${p.heavyLimit} heavy job${p.heavyLimit === 1 ? '' : 's'}` +
      ` + ${p.lightCapacity} lightweight task${p.lightCapacity === 1 ? '' : 's'}`,
    engineHint: engineKind ? (ENGINE_HINT[engineKind] ?? 'CompressZ engine') : 'Idle',
    reduced: pressure > 0,
    pressureReason,
    activeHeavy: heavy.length,
    activeLight: light.length,
    queued: jobs.filter((j) => j.state === 'queued').length,
    jobs,
    estimateOnly: true,
  };
}

/** One-line status for Settings / the home queue panel. */
export function resourceStatusLine(): string {
  const s = getResourceSnapshot();
  return `Resource mode: ${s.modeLabel} · Workload estimate: ${s.estimateLabel} · Concurrency: ${s.concurrencyLabel}`;
}
