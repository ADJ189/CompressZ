/**
 * avifEncode.ts — Lazy-loaded WebAssembly AVIF encoder fallback.
 *
 * Chromium (Chrome, Edge, Brave) and Safari can decode AVIF images, but their
 * Canvas 2D `toBlob` / `toDataURL` implementations do not support encoding
 * `image/avif`. When native Canvas AVIF encoding is unavailable, we run
 * `@jsquash/avif`'s single-threaded WASM encoder inside a same-origin `'self'`
 * module worker (`avifWorker.ts`), with main-thread fallback if Workers are
 * unavailable.
 */

import { AVIF_DEFAULT_OPTIONS, JSQUASH_AVIF_ST_URL } from "./avifWorker";

export { AVIF_DEFAULT_OPTIONS, JSQUASH_AVIF_ST_URL };

type AvifEncodeFn = (
  data: ImageData,
  options?: { cqLevel?: number; speed?: number },
) => Promise<ArrayBuffer>;

interface AvifWasmModule {
  encode: (
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    options: Record<string, unknown>,
  ) => Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;
}

let _mainModulePromise: Promise<AvifWasmModule> | null = null;
let _encoderOverrideForTesting: AvifEncodeFn | null = null;

interface PendingWorkerJob {
  resolve: (buffer: ArrayBuffer) => void;
  reject: (err: Error) => void;
}

let _worker: Worker | null = null;
let _nextJobId = 1;
const _pendingJobs = new Map<number, PendingWorkerJob>();
let _workerQueue: Promise<void> = Promise.resolve();

/** Test-only injection hook for offline encodeAvifWasm unit tests. */
export function setAvifEncoderForTesting(fn: AvifEncodeFn | null): void {
  _encoderOverrideForTesting = fn;
}

/** Map unit quality (0.01–0.99) to @jsquash/avif's 1–100 integer scale. */
export function avifQualityFromUnit(q: number): number {
  const clamped = Number.isFinite(q) ? Math.max(0.01, Math.min(0.99, q)) : 0.7;
  return Math.max(1, Math.min(100, Math.round(clamped * 100)));
}

/**
 * Map unit quality (0.01–0.99) to libavif's cqLevel quantizer (0–63 range).
 * Lower cqLevel means higher visual quality: 0.99 → 1, 0.70 → 19, 0.01 → 62.
 */
export function avifCqLevelFromUnit(q: number): number {
  const clamped = Number.isFinite(q) ? Math.max(0.01, Math.min(0.99, q)) : 0.7;
  return Math.max(0, Math.min(63, Math.round((1 - clamped) * 63)));
}

function resetWorker(err: Error): void {
  if (_worker) {
    try {
      _worker.terminate();
    } catch {
      /* ignore termination errors */
    }
    _worker = null;
  }
  for (const job of _pendingJobs.values()) {
    job.reject(err);
  }
  _pendingJobs.clear();
}

function getOrCreateWorker(): Worker {
  if (_worker) return _worker;
  const worker = new Worker(new URL("./avifWorker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (
    event: MessageEvent<{
      id: number;
      ok: boolean;
      buffer?: ArrayBuffer;
      error?: string;
    }>,
  ) => {
    const msg = event.data;
    const job = _pendingJobs.get(msg.id);
    if (!job) return;
    _pendingJobs.delete(msg.id);
    if (msg.ok && msg.buffer) {
      job.resolve(msg.buffer);
    } else {
      job.reject(new Error(msg.error || "AVIF worker encoding failed"));
    }
  };
  worker.onerror = (event: ErrorEvent) => {
    const err = new Error(event?.message || "AVIF worker crashed");
    resetWorker(err);
  };
  _worker = worker;
  return worker;
}

function encodeInWorker(
  imageData: ImageData,
  cqLevel: number,
  speed: number,
): Promise<ArrayBuffer> {
  const run = async (): Promise<ArrayBuffer> => {
    const worker = getOrCreateWorker();
    const id = _nextJobId++;
    const pixels = new Uint8ClampedArray(imageData.data.byteLength);
    pixels.set(imageData.data);
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      _pendingJobs.set(id, { resolve, reject });
      try {
        worker.postMessage(
          {
            id,
            data: pixels.buffer,
            width: imageData.width,
            height: imageData.height,
            cqLevel,
            speed,
          },
          [pixels.buffer],
        );
      } catch (err) {
        _pendingJobs.delete(id);
        const error = err instanceof Error ? err : new Error(String(err));
        resetWorker(error);
        reject(error);
      }
    });
  };

  // Serialize jobs through a single lazy worker so memory stays bounded.
  const next = _workerQueue.then(run, run);
  _workerQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function loadAvifEncoder(): Promise<AvifEncodeFn> {
  if (!_mainModulePromise) {
    _mainModulePromise = import(/* @vite-ignore */ JSQUASH_AVIF_ST_URL)
      .then(async (imported: Record<string, unknown>) => {
        const factory = imported?.default ?? imported;
        if (typeof factory === "function") {
          const mod = await (factory as (opts: { noInitialRun: boolean }) => Promise<AvifWasmModule>)({
            noInitialRun: true,
          });
          if (mod && typeof mod.encode === "function") {
            return mod;
          }
        }
        if (imported && typeof (imported as unknown as AvifWasmModule).encode === "function") {
          return imported as unknown as AvifWasmModule;
        }
        throw new Error("Single-threaded AVIF WASM module did not export encode()");
      })
      .catch((err) => {
        _mainModulePromise = null;
        throw err;
      });
  }
  const mod = await _mainModulePromise;
  return async (data: ImageData, options = {}) => {
    const raw = await mod.encode(data.data, data.width, data.height, {
      ...AVIF_DEFAULT_OPTIONS,
      cqLevel: options.cqLevel ?? AVIF_DEFAULT_OPTIONS.cqLevel,
      speed: options.speed ?? AVIF_DEFAULT_OPTIONS.speed,
    });
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  };
}

/** Encode raw RGBA ImageData into an `image/avif` Blob via WebAssembly. */
export async function encodeAvifWasm(
  imageData: ImageData,
  qualityUnit: number,
): Promise<Blob> {
  const cqLevel = avifCqLevelFromUnit(qualityUnit);
  const speed = 6;

  if (_encoderOverrideForTesting) {
    const buffer = await _encoderOverrideForTesting(imageData, { cqLevel, speed });
    return new Blob([buffer], { type: "image/avif" });
  }

  if (typeof Worker !== "undefined") {
    try {
      const buffer = await encodeInWorker(imageData, cqLevel, speed);
      return new Blob([buffer], { type: "image/avif" });
    } catch {
      // Fall through to main-thread fallback when module workers are unsupported
      // or restricted in the current runtime.
    }
  }

  const encodeFn = await loadAvifEncoder();
  const buffer = await encodeFn(imageData, { cqLevel, speed });
  return new Blob([buffer], { type: "image/avif" });
}
