/**
 * libreOfficeWasm.ts — Self-hosted LibreOffice WebAssembly interface.
 *
 * Implements self-hosted converter logic for complex Office documents.
 * In accordance with privacy and security requirements, arbitrary remote
 * executable JavaScript from third-party CDNs is prohibited from handling
 * private document bytes.
 *
 * All conversion logic runs strictly client-side.
 */

export interface LibreOfficeStatus {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  downloadProgress: number;
  stage: string;
}

let _libreOfficeInstance: any = null;
let _loadPromise: Promise<any> | null = null;
const _status: LibreOfficeStatus = {
  loaded: false,
  loading: false,
  error: null,
  downloadProgress: 0,
  stage: "Idle",
};

export function isLibreOfficeLoaded(): boolean {
  return _libreOfficeInstance !== null;
}

export function getLibreOfficeStatus(): LibreOfficeStatus {
  return { ..._status };
}

export function resetLibreOfficeForTesting(): void {
  _libreOfficeInstance = null;
  _loadPromise = null;
  _status.loaded = false;
  _status.loading = false;
  _status.error = null;
  _status.downloadProgress = 0;
  _status.stage = "Idle";
}

export function setLibreOfficeInstance(instance: any): void {
  _libreOfficeInstance = instance;
  _status.loaded = true;
  _status.loading = false;
  _status.stage = "Ready";
}

/**
 * Load self-hosted audited LibreOffice WASM container.
 */
export async function loadLibreOfficeWasm(
  onProgress?: (pct: number, stage: string) => void,
  customLoader?: () => Promise<any>,
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
  _status.stage = "Initializing self-hosted WASM container...";
  onProgress?.(5, _status.stage);

  _loadPromise = (async () => {
    try {
      if (customLoader) {
        _libreOfficeInstance = await customLoader();
        _status.loaded = true;
        _status.loading = false;
        _status.stage = "Ready";
        onProgress?.(100, "Ready");
        return _libreOfficeInstance;
      }

      // Check for self-hosted window or worker instance
      if (typeof window !== "undefined" && (window as any).libreOfficeWasm) {
        _libreOfficeInstance = (window as any).libreOfficeWasm;
        _status.loaded = true;
        _status.loading = false;
        _status.stage = "Ready";
        onProgress?.(100, "Ready");
        return _libreOfficeInstance;
      }

      // Prohibit unverified remote JS execution on private documents
      throw new Error(
        "Self-hosted LibreOffice WASM asset bundle not found in build. To maintain document privacy and eliminate remote code execution risks, use the built-in web-native engine.",
      );
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
 * Returns whether a self-hosted LibreOffice WASM environment is available in this runtime.
 */
export function isLibreOfficeAvailable(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).libreOfficeWasm);
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

  if (typeof instance.run === "function") {
    if (!instance.FS || typeof instance.FS.writeFile !== "function") {
      throw new Error("LibreOffice WASM instance does not expose an Emscripten FS interface.");
    }
    const cleanIn = inputExt.replace(/^\./, "");
    const cleanOut = targetExt.replace(/^\./, "");
    const inPath = `input.${cleanIn}`;
    const outPath = `input.${cleanOut}`;

    try {
      instance.FS.writeFile(inPath, fileBytes);
      await instance.run([
        "--headless",
        "--convert-to",
        cleanOut,
        inPath,
      ]);
      const outData = instance.FS.readFile(outPath);
      onProgress?.(100, "Done");
      return new Uint8Array(outData);
    } finally {
      try { instance.FS.unlink(inPath); } catch { /* ignore unlink error */ }
      try { instance.FS.unlink(outPath); } catch { /* ignore unlink error */ }
    }
  }

  throw new Error(
    "LibreOffice WASM instance did not expose a recognized conversion interface.",
  );
}
