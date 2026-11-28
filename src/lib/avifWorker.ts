/**
 * avifWorker.ts — Same-origin ('self') module worker for single-threaded AVIF WASM encoding.
 *
 * Loading `@jsquash/avif/codec/enc/avif_enc.js` inside our own same-origin module
 * worker avoids cross-origin pthread worker instantiation (`avif_enc_mt.worker.js`
 * on esm.sh), which fails Same-Origin Policy and CSP `worker-src` under COOP/COEP.
 */

export const JSQUASH_AVIF_ST_URL =
  "https://esm.sh/@jsquash/avif@1.3.0/codec/enc/avif_enc.js";

export const AVIF_DEFAULT_OPTIONS = {
  cqLevel: 33,
  cqAlphaLevel: -1,
  denoiseLevel: 0,
  tileColsLog2: 0,
  tileRowsLog2: 0,
  speed: 6,
  subsample: 1,
  chromaDeltaQ: false,
  sharpness: 0,
  tune: 0,
  enableSharpYUV: false,
} as const;

interface AvifWasmModule {
  encode: (
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    options: Record<string, unknown>,
  ) => Uint8Array | ArrayBuffer | Promise<Uint8Array | ArrayBuffer>;
}

interface WorkerEncodeRequest {
  id: number;
  data: ArrayBuffer;
  width: number;
  height: number;
  cqLevel: number;
  speed: number;
}

let _modulePromise: Promise<AvifWasmModule> | null = null;

async function getAvifModule(): Promise<AvifWasmModule> {
  if (!_modulePromise) {
    _modulePromise = import(/* @vite-ignore */ JSQUASH_AVIF_ST_URL)
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
        _modulePromise = null;
        throw err;
      });
  }
  return _modulePromise;
}

if (
  typeof self !== "undefined" &&
  typeof (self as unknown as { document?: unknown }).document === "undefined"
) {
  self.onmessage = async (event: MessageEvent<WorkerEncodeRequest>) => {
    const { id, data, width, height, cqLevel, speed } = event.data;
    try {
      const mod = await getAvifModule();
      const pixels = new Uint8ClampedArray(data);
      const raw = await mod.encode(pixels, width, height, {
        ...AVIF_DEFAULT_OPTIONS,
        cqLevel,
        speed,
      });
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      // Copy out of the WASM heap before transferring the ArrayBuffer.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      self.postMessage(
        { id, ok: true, buffer: copy.buffer },
        { transfer: [copy.buffer] } as StructuredSerializeOptions,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ id, ok: false, error: message });
    }
  };
}
