/**
 * libreOfficeWasm.ts — Desktop-grade LibreOffice WebAssembly lazy loader.
 *
 * Provides full-fidelity conversions for complex Office files (DOCX, PPTX, XLSX)
 * with complete font rendering, shape layouts, and complex equations.
 *
 * IMPORTANT LAZY-LOADING INVARIANTS:
 * 1. This engine weighs ~85–110 MB (WASM + VFS assets) and consumes up to 2 GB of RAM.
 * 2. It is NEVER downloaded or initialized on page load.
 * 3. It only loads when explicitly requested by the user via the Apple Inset Inspector
 *    engine toggle or in Settings.
 */

export interface LibreOfficeStatus {
  loaded: boolean;
  loading: boolean;
  downloadProgress: number; // 0..100
  stage: string;
  error: string | null;
}

let _libreOfficeInstance: any = null;
let _loadPromise: Promise<any> | null = null;

let _status: LibreOfficeStatus = {
  loaded: false,
  loading: false,
  downloadProgress: 0,
  stage: "idle",
  error: null,
};

export function getLibreOfficeStatus(): LibreOfficeStatus {
  return { ..._status };
}

export function isLibreOfficeLoaded(): boolean {
  return _status.loaded && _libreOfficeInstance !== null;
}

/**
 * Lazy load LibreOffice WASM runtime on demand.
 */
export async function loadLibreOfficeWasm(
  onProgress?: (pct: number, stage: string) => void,
): Promise<any> {
  if (_libreOfficeInstance) {
    onProgress?.(100, "Ready");
    return _libreOfficeInstance;
  }

  if (_loadPromise) {
    return _loadPromise;
  }

  _status.loading = true;
  _status.error = null;
  _status.downloadProgress = 0;
  _status.stage = "Initializing WASM container...";
  onProgress?.(5, _status.stage);

  _loadPromise = (async () => {
    try {
      // In browser environments with WebAssembly and SharedArrayBuffer:
      if (typeof window === "undefined" || typeof WebAssembly === "undefined") {
        throw new Error("LibreOffice WASM requires a browser environment supporting WebAssembly.");
      }

      _status.stage = "Fetching LibreOffice WASM package (~85 MB)...";
      onProgress?.(25, _status.stage);

      // Dynamic import from CDN only when invoked
      const LIBREOFFICE_CDN_URL = "https://cdn.jsdelivr.net/npm/@bentopdf/libreoffice-wasm@0.1.3/+esm";
      const module = await import(/* @vite-ignore */ LIBREOFFICE_CDN_URL);

      _status.stage = "Compiling WASM bytecode & mounting virtual filesystem...";
      onProgress?.(70, _status.stage);

      const initFn = module.default || module.init || module.loadLibreOffice;
      if (typeof initFn === "function") {
        _libreOfficeInstance = await initFn();
      } else {
        _libreOfficeInstance = module;
      }

      _status.loaded = true;
      _status.loading = false;
      _status.downloadProgress = 100;
      _status.stage = "Ready";
      onProgress?.(100, "Ready");

      return _libreOfficeInstance;
    } catch (err: any) {
      _status.loading = false;
      _status.loaded = false;
      _status.error = err?.message || "Failed to load LibreOffice WASM";
      _loadPromise = null;
      throw new Error(`[LibreOffice WASM] ${_status.error}`, { cause: err });
    }
  })();

  return _loadPromise;
}

/**
 * Convert an office document using Desktop-Grade LibreOffice WASM.
 */
export async function convertWithLibreOfficeWasm(
  fileBytes: Uint8Array,
  inputExt: string,
  targetExt: string,
  onProgress?: (pct: number, stage: string) => void,
): Promise<Uint8Array> {
  const instance = await loadLibreOfficeWasm(onProgress);

  onProgress?.(80, "Executing LibreOffice headless conversion...");

  if (typeof instance.convert === "function") {
    const result = await instance.convert({
      data: fileBytes,
      from: inputExt.replace(/^\./, ""),
      to: targetExt.replace(/^\./, ""),
    });
    onProgress?.(100, "Done");
    return result instanceof Uint8Array ? result : new Uint8Array(result);
  }

  // Fallback for custom wasm export structures
  if (typeof instance.run === "function") {
    const result = await instance.run([
      "--headless",
      "--convert-to",
      targetExt.replace(/^\./, ""),
      "input." + inputExt.replace(/^\./, ""),
    ]);
    onProgress?.(100, "Done");
    return result;
  }

  throw new Error("LibreOffice WASM instance did not expose a recognized conversion interface.");
}
