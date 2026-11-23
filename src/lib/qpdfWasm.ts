/**
 * qpdfWasm.ts — Singleton loader for QPDF WebAssembly.
 *
 * Provides cryptographic PDF encryption (AES-256/128), decryption,
 * xref reconstruction, linearization, and corruption repair.
 * Lazy loaded on demand using version-locked audited ESM and WASM assets.
 */

import { EngineError } from "./engineError";

let _qpdfModule: any = null;
let _loadPromise: Promise<any> | null = null;

/**
 * Emscripten binds `print` / `printErr` when the module is created, so the
 * callbacks must exist up front and delegate through this mutable sink.
 * Reassigning `qpdf.print` after init never reaches the already-bound callers.
 */
const sink = {
  out: (_text: string) => {},
  err: (_text: string) => {},
};

export const QPDF_ESM_URL =
  "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/+esm";
export const QPDF_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm";

export interface QpdfStatus {
  loaded: boolean;
  loading: boolean;
}

export function isQpdfLoaded(): boolean {
  return _qpdfModule !== null;
}

export function resetQpdfForTesting(): void {
  _qpdfModule = null;
  _loadPromise = null;
}

export function setQpdfInstance(instance: any): void {
  _qpdfModule = instance;
}

/**
 * Lazy load QPDF WebAssembly module with version-locked audited assets.
 */
export async function getQpdf(customLoader?: () => Promise<any>): Promise<any> {
  if (_qpdfModule) return _qpdfModule;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      if (customLoader) {
        _qpdfModule = await customLoader();
        return _qpdfModule;
      }

      // Check if pre-configured on window
      if (typeof window !== "undefined" && (window as any).qpdfModule) {
        _qpdfModule = (window as any).qpdfModule;
        return _qpdfModule;
      }

      // Load version-locked ESM module with Cache API persistence
      if (typeof caches !== "undefined") {
        try {
          const cache = await caches.open("compressz-engines-v1");
          const cachedWasm = await cache.match(QPDF_WASM_URL);
          if (!cachedWasm) {
            fetch(QPDF_WASM_URL).then((res) => {
              if (res.ok) void cache.put(QPDF_WASM_URL, res);
            }).catch(() => {});
          }
        } catch {
          // Ignore cache storage errors
        }
      }

      const mod = await import(/* @vite-ignore */ QPDF_ESM_URL);
      const initQpdf = mod.default || mod;
      if (typeof initQpdf === "function") {
        // This build captures `console.log.bind(console)` /
        // `console.error.bind(console)` when the factory runs, and never reads
        // the `print`/`printErr` options. Bridge console across init so the
        // bound references point at our sink for the rest of the session.
        // eslint-disable-next-line no-console -- deliberate: capture qpdf's bound stdout sink
        const originalConsoleLog = console.log;
        const originalConsoleError = console.error;
        // eslint-disable-next-line no-console -- deliberate: capture qpdf's bound stdout sink
        console.log = (...data: unknown[]) => sink.out(data.map(String).join(" "));
        console.error = (...data: unknown[]) => sink.err(data.map(String).join(" "));
        try {
          _qpdfModule = await initQpdf({
            locateFile: () => QPDF_WASM_URL,
            noInitialRun: true,
            print: (text: string) => sink.out(text),
            printErr: (text: string) => sink.err(text),
          });
        } finally {
          // eslint-disable-next-line no-console -- deliberate: restore the app's console
          console.log = originalConsoleLog;
          console.error = originalConsoleError;
        }
        return _qpdfModule;
      }
      throw new Error("QPDF module does not export an initializer function");
    } catch (err: any) {
      _loadPromise = null;
      throw new EngineError(
        `Failed to load QPDF module: ${err?.message || err}`,
        "qpdf",
      );
    }
  })();

  return _loadPromise;
}

let _qpdfQueue: Promise<unknown> = Promise.resolve();

/**
 * Serialized job queue for QPDF executions. Guarantees that concurrent
 * operations (repair, password protect, extract) never collide in the shared
 * WASM virtual filesystem or mutate global stdout sinks simultaneously.
 */
export function qpdfJob<T>(job: () => Promise<T>): Promise<T> {
  const run = _qpdfQueue.then(job);
  _qpdfQueue = run.catch(() => {});
  return run;
}

/**
 * Run QPDF command inside WASM virtual filesystem.
 */
export async function runQpdfCommand(
  args: string[],
  inputFiles: { name: string; data: Uint8Array }[],
): Promise<{
  outputFiles: { name: string; data: Uint8Array }[];
  stdout: string;
  exitCode: number;
}> {
  return qpdfJob(async () => {
    const qpdf = await getQpdf();

    // Write input files to WASM memory virtual FS
    for (const f of inputFiles) {
      qpdf.FS.writeFile(f.name, f.data);
    }

    let stdout = "";
    let stderr = "";
    sink.out = (text: string) => {
      stdout += text + "\n";
    };
    sink.err = (text: string) => {
      stderr += text + "\n";
    };

    // Modules created by getQpdf() are already bound to `sink`. Modules injected
    // via setQpdfInstance()/window never saw our init options, so patch the
    // instance properties too for the duration of this call.
    const previousOut = qpdf.print;
    const previousErr = qpdf.printErr;
    if (typeof previousOut === "function") qpdf.print = (text: string) => sink.out(text);
    if (typeof previousErr === "function") qpdf.printErr = (text: string) => sink.err(text);

    let exitCode: number;
    const originalConsoleError = console.error;
    // eslint-disable-next-line no-console -- deliberate: capture qpdf's stdout during callMain
    const originalConsoleLog = console.log;
    try {
      // qpdf-wasm 0.3.0 snapshots Emscripten's print/printErr before the init
      // options are read, so its diagnostics go straight to console.*. The call
      // is synchronous, so capturing here is race-free — and without it the
      // reason a repair failed is lost to a stray console entry.
      console.error = (...data: unknown[]) => {
        stderr += data.map((d) => String(d)).join(" ") + "\n";
      };
      // eslint-disable-next-line no-console -- deliberate: capture qpdf's stdout during callMain
      console.log = (...data: unknown[]) => {
        stdout += data.map((d) => String(d)).join(" ") + "\n";
      };
      exitCode = qpdf.callMain(args);
    } catch (err: any) {
      exitCode = err?.status ?? 1;
    } finally {
      console.error = originalConsoleError;
      // eslint-disable-next-line no-console -- deliberate: restore the app's console
      console.log = originalConsoleLog;
      sink.out = () => {};
      sink.err = () => {};
      if (typeof previousOut === "function") qpdf.print = previousOut;
      if (typeof previousErr === "function") qpdf.printErr = previousErr;
    }

    // Read output files
    const outputFiles: { name: string; data: Uint8Array }[] = [];
    const outTarget = args[args.length - 1];

    try {
      if (qpdf.FS.analyzePath(outTarget).exists) {
        const data = qpdf.FS.readFile(outTarget);
        outputFiles.push({ name: outTarget, data });
      }
    } catch {
      // Target might not have been written if error occurred
    }

    // Cleanup virtual files
    for (const f of inputFiles) {
      try {
        qpdf.FS.unlink(f.name);
      } catch {
        // Ignore cleanup error
      }
    }
    try {
      qpdf.FS.unlink(outTarget);
    } catch {
      // Ignore cleanup error
    }

    return {
      outputFiles,
      stdout: stdout + stderr,
      exitCode,
    };
  });
}
