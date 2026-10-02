// FFmpeg.wasm singleton — loaded once per session, reused for all compressions.
// Uses multithreaded core when SharedArrayBuffer is available (requires COOP/COEP headers).

const FFMPEG_PKG = "https://esm.sh/@ffmpeg/ffmpeg@0.12.10";
const FFMPEG_UTIL = "https://esm.sh/@ffmpeg/util@0.12.2";
const CORE_MT = "https://esm.sh/@ffmpeg/core-mt@0.12.6/dist/esm";
const CORE_ST = "https://esm.sh/@ffmpeg/core@0.12.6/dist/esm";

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
      const hasMT = hasMultiThreadSupport();
      const base = hasMT ? CORE_MT : CORE_ST;

      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(
          `${base}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
        ...(hasMT
          ? {
              workerURL: await toBlobURL(
                `${base}/ffmpeg-core.worker.js`,
                "text/javascript",
              ),
            }
          : {}),
      });

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

export async function ffFetch(file: File | string): Promise<Uint8Array> {
  const { fetchFile } = await import(/* @vite-ignore */ FFMPEG_UTIL);
  return fetchFile(file);
}

// `SharedArrayBuffer` can exist as a global without the page actually being
// cross-origin isolated (behavior has varied across browsers/versions), and
// the multithreaded core specifically needs COOP/COEP-driven isolation for
// its worker-shared memory to behave — loading it without that can throw or
// silently misbehave. `crossOriginIsolated` is the actual signal that those
// headers are in effect; require both.
function hasMultiThreadSupport(): boolean {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    typeof crossOriginIsolated !== "undefined" &&
    crossOriginIsolated === true
  );
}

export function ffHasMT(): boolean {
  return hasMultiThreadSupport();
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
