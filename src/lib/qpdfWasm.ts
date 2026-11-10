/**
 * qpdfWasm.ts — Singleton loader for QPDF WebAssembly.
 *
 * Provides cryptographic PDF encryption (AES-256/128), decryption,
 * xref reconstruction, linearization, and corruption repair.
 * Lazy loaded on demand.
 */

let _qpdfModule: any = null;
let _loadPromise: Promise<any> | null = null;

export interface QpdfStatus {
  loaded: boolean;
  loading: boolean;
}

export function isQpdfLoaded(): boolean {
  return _qpdfModule !== null;
}

/**
 * Lazy load QPDF WebAssembly module from CDN.
 */
export async function getQpdf(): Promise<any> {
  if (_qpdfModule) return _qpdfModule;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      const QPDF_URL = "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js";
      if (typeof window !== "undefined") {
        if (!(window as any).createQPDF) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = QPDF_URL;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load QPDF WASM library"));
            document.head.appendChild(script);
          });
        }
        const createQPDF = (window as any).createQPDF;
        if (typeof createQPDF === "function") {
          _qpdfModule = await createQPDF();
          return _qpdfModule;
        }
      }
      throw new Error("createQPDF is not available in current environment");
    } catch (err) {
      _loadPromise = null;
      throw err;
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
): Promise<{ outputFiles: { name: string; data: Uint8Array }[]; stdout: string; exitCode: number }> {
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
