/**
 * batch.ts — Hardware-aware batch concurrency.
 *
 * platform.ts already derives a `batchConcurrency` recommendation from real
 * device signals (CPU cores, memory, GPU, save-data) — but nothing actually
 * consulted it. Canvas-based engines (Images, PDF) instead fired every
 * queued file's compress() at once via a bare `.forEach()` with no limit,
 * so a 40-image batch meant 40 concurrent createImageBitmap()/toBlob()
 * jobs even on a 2-core/2GB phone that platform.ts had already flagged as
 * 'efficient' (batchConcurrency: 1). runBatch() closes that gap: it pulls
 * the recommended concurrency for the current device and runs at most that
 * many jobs at once, so the batch actually respects the hardware it's
 * running on instead of a single one-size-fits-all default.
 *
 * FFmpeg-backed engines (video/audio/gif/convert) are deliberately NOT
 * routed through this — they all share one FFmpeg.wasm singleton
 * (see ffmpeg.ts), so true concurrent jobs would just queue on the same
 * WASM module anyway; those stay sequential regardless of tier.
 */
import { recommend } from './platform';

/**
 * Run `worker(item)` across `items`, at most `concurrency` at a time
 * (falls back to the device's recommended batchConcurrency when omitted).
 * Items are started in order but complete in whatever order they finish —
 * each freed slot immediately picks up the next queued item, so a device
 * with room for 3 concurrent jobs never sits idle waiting for a slow one.
 */
export async function runBatch<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number = recommend().batchConcurrency,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let cursor = 0;

  async function lane() {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
