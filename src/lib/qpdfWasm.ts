/**
 * qpdfWasm.ts — Singleton loader for QPDF WebAssembly.
 *
 * Provides cryptographic PDF encryption (AES-256/128), decryption,
 * xref reconstruction, linearization, and corruption repair.
 * Lazy loaded on demand using version-locked audited ESM and WASM assets.
 */

let _qpdfModule: any = null;
let _loadPromise: Promise<any> | null = null;

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
              if (res.ok) cache.put(QPDF_WASM_URL, res);
            }).catch(() => {});
          }
        } catch {
          // Ignore cache storage errors
        }
      }

      const mod = await import(/* @vite-ignore */ QPDF_ESM_URL);
      const initQpdf = mod.default || mod;
      if (typeof initQpdf === "function") {
        _qpdfModule = await initQpdf({
          locateFile: () => QPDF_WASM_URL,
          noInitialRun: true,
        });
        return _qpdfModule;
      }
      throw new Error("QPDF module does not export an initializer function");
    } catch (err: any) {
      _loadPromise = null;
      throw new Error(
        `[qpdfWasm] Failed to load QPDF module: ${err?.message || err}`,
        { cause: err },
      );
    }
  })();

  return _loadPromise;
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
  const qpdf = await getQpdf();

  // Write input files to WASM memory virtual FS
  for (const f of inputFiles) {
    qpdf.FS.writeFile(f.name, f.data);
  }

  let stdout = "";
  let stderr = "";
  const originalOut = qpdf.print;
  const originalErr = qpdf.printErr;

  qpdf.print = (text: string) => {
    stdout += text + "\n";
  };
  qpdf.printErr = (text: string) => {
    stderr += text + "\n";
  };

  let exitCode: number;
  try {
    exitCode = qpdf.callMain(args);
  } catch (err: any) {
    exitCode = err?.status ?? 1;
  } finally {
    qpdf.print = originalOut;
    qpdf.printErr = originalErr;
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
}
