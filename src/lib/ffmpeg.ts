// FFmpeg.wasm singleton — loaded once per session, reused for all compressions.
// Uses multithreaded core when SharedArrayBuffer is available (requires COOP/COEP headers).

const FFMPEG_PKG = "https://esm.sh/@ffmpeg/ffmpeg@0.12.10";
const FFMPEG_UTIL = "https://esm.sh/@ffmpeg/util@0.12.2";
// The single-threaded core is self-contained and loads reliably via blob URLs.
// Multi-threaded core-mt requires self-hosted worker files due to browser
// cross-origin blob import restrictions, so CORE_ST is used for the web build.
const CORE_ST = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";

// `@ffmpeg/ffmpeg` spawns its own module Worker from
// `new URL("./worker.js", import.meta.url)`. Inside the esm.sh bundle that
// resolves to `https://esm.sh/@ffmpeg/ffmpeg@0.12.10/es2022/worker.js`, a URL
// that (a) 404s and (b) is cross-origin, and browsers refuse to construct a
// Worker from another origin. `classWorkerURL` overrides that URL, but the
// worker is not self-contained: it imports `./const.js` and `./errors.js`
// relatively. Some browsers (notably WebKit) refuse to load cross-origin
// module specifiers inside a blob: Worker. Concurrently fetch the worker and
// its dependencies, inline them into a single self-contained script with no
// external imports, and hand the loader a same-origin blob URL.
const FFMPEG_CLASS_ESM =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";

async function classWorkerURL(): Promise<string> {
  const [workerRes, constRes, errorsRes] = await Promise.all([
    fetch(`${FFMPEG_CLASS_ESM}/worker.js`),
    fetch(`${FFMPEG_CLASS_ESM}/const.js`),
    fetch(`${FFMPEG_CLASS_ESM}/errors.js`),
  ]);
  if (!workerRes.ok || !constRes.ok || !errorsRes.ok) {
    throw new Error(
      `Could not download the FFmpeg worker runtime (HTTP ${workerRes.status})`,
    );
  }

  let source = await workerRes.text();
  const constCode = await constRes.text();
  const errorsCode = await errorsRes.text();

  source = source
    .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*const\.js['"];?/, "")
    .replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*errors\.js['"];?/, "");

  const inlinedConst = constCode.replace(/export\s+/g, "");
  const inlinedErrors = errorsCode.replace(/export\s+/g, "");
  const inlinedWorker = `${inlinedConst}\n${inlinedErrors}\n${source}`;

  return URL.createObjectURL(
    new Blob([inlinedWorker], { type: "text/javascript" }),
  );
}

let _instance: unknown = null;
let _loading: Promise<unknown> | null = null;

export async function getFFmpeg(): Promise<unknown> {
  if (_instance) return _instance;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import(/* @vite-ignore */ FFMPEG_PKG),
        import(/* @vite-ignore */ FFMPEG_UTIL),
      ]);

      const ff = new FFmpeg();
      const workerBlob = await classWorkerURL();

      try {
        const [coreURL, wasmURL] = await Promise.all([
          toBlobURL(`${CORE_ST}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${CORE_ST}/ffmpeg-core.wasm`, "application/wasm"),
        ]);

        await ff.load({
          classWorkerURL: workerBlob,
          coreURL,
          wasmURL,
        });
      } finally {
        // The Worker has already been constructed and its module graph
        // resolved by the time load() settles, so the blob URL is no longer
        // needed.
      const coreURLs: string[] = [];
      try {
        // Wait for both creations to settle so a late success is also cleaned up.
        const urls = await Promise.allSettled([
          toBlobURL(`${CORE_ST}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${CORE_ST}/ffmpeg-core.wasm`, "application/wasm"),
        ]);
        for (const result of urls) {
          if (result.status === "fulfilled") coreURLs.push(result.value);
        }
        for (const result of urls) {
          if (result.status === "rejected") throw result.reason;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            ff.load({ classWorkerURL: workerBlob, coreURL: coreURLs[0], wasmURL: coreURLs[1] }),
            new Promise<never>((_, reject) => {
              // Allow slower devices time to compile the WASM core. Worker
              // startup errors can leave the wrapper's load promise pending.
              timer = setTimeout(() => reject(new Error("FFmpeg initialization timed out")), 120_000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        ff.terminate();
        throw error;
      } finally {
        for (const url of coreURLs) URL.revokeObjectURL(url);
        URL.revokeObjectURL(workerBlob);
      }

      _instance = ff;
      return ff;
    } finally {
      // Always release the lock — on success this is a no-op (guarded by
      // _instance above), but on failure it lets the *next* call retry
      // instead of permanently replaying a cached rejected promise.
      _loading = null;
    }
  })();

  return _loading;
}

// ── Serialised jobs + guaranteed temp-file cleanup ──────────────
// Every FFmpeg-backed tool writes fixed names ("input.gif", "vin.mp4", ...)
// into the one shared in-memory filesystem. The page-level "Compress all"
// loops are sequential, but a per-card Compress button (or Compress-all
// while a card job is running) could still start two jobs at once — they'd
// overwrite each other's files and progress handler. Also, any exception
// mid-job skipped the deleteFile() calls at the end of each function, so the
// input (potentially hundreds of MB) stayed in wasm memory until reload.
// ffJob() queues jobs one at a time and, in `finally`, removes whatever files
// the job left behind in the FS root.
let _jobQueue: Promise<unknown> = Promise.resolve();

export function ffJob<T>(job: () => Promise<T>): Promise<T> {
  const run = _jobQueue.then(async () => {
    const ff = (await getFFmpeg()) as any;
    const listFiles = async (): Promise<string[]> => {
      try {
        const nodes: { name: string; isDir: boolean }[] = await ff.listDir("/");
        return nodes.filter((n) => !n.isDir).map((n) => n.name);
      } catch {
        return [];
      }
    };
    const before = new Set(await listFiles());
    try {
      return await job();
    } finally {
      for (const name of await listFiles()) {
        if (!before.has(name)) await ff.deleteFile(name).catch(() => {});
      }
    }
  });
  _jobQueue = run.catch(() => {});
  return run;
}

export async function ffFetch(file: File | Blob | string): Promise<Uint8Array> {
  if (typeof Blob !== "undefined" && file instanceof Blob) {
    return new Uint8Array(await file.arrayBuffer());
  }
  const { fetchFile } = await import(/* @vite-ignore */ FFMPEG_UTIL);
  return fetchFile(file);
}

export function ffHasMT(): boolean {
  return false;
}

// ── Progress handler management ────────────────────────────────
// The FFmpeg instance is a session-wide singleton reused across every
// compress call. Each call used to attach a fresh 'progress' listener via
// ff.on(...) without ever removing the previous one, so listeners piled up
// over a session — later files' progress events fired the callbacks of
// every prior (already-finished) file too, and the handler count grew
// without bound. setProgressHandler swaps out the single active listener.
let _lastProgressHandler: ((e: { progress: number }) => void) | null = null;

export function setProgressHandler(
  ff: any,
  handler: (e: { progress: number }) => void,
) {
  if (_lastProgressHandler) ff.off("progress", _lastProgressHandler);
  _lastProgressHandler = handler;
  ff.on("progress", handler);
}
