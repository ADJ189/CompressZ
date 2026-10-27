/**
 * batch.ts — bounded batch execution on top of the global Resource Guard.
 *
 * This used to be a private concurrency limiter for Images/PDF. It now hands
 * each item to `runScheduled()` in resourceManager.ts, so a batch cannot
 * bypass the app-wide heavy/light budget, and a manual concurrency ceiling
 * still caps the number of lanes. FFmpeg-backed engines stay sequential for
 * correctness (they share one FFmpeg.wasm singleton) but still acquire a heavy
 * slot through the same guard.
 */
import { resolvedConcurrency } from './settings';
import { runScheduled, type JobDescriptor } from './resourceManager';

function inferDescriptor(item: unknown): JobDescriptor {
  if (item instanceof File) {
    const isPdf =
      item.type === 'application/pdf' || /\.pdf$/i.test(item.name);
    return {
      kind: isPdf ? 'pdf' : 'image',
      label: item.name,
      bytes: item.size,
    };
  }
  if (item && typeof item === 'object' && 'file' in item) {
    const file = (item as { file?: File }).file;
    if (file instanceof File) {
      const isPdf =
        file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      return {
        kind: isPdf ? 'pdf' : 'image',
        label: file.name,
        bytes: file.size,
      };
    }
  }
  return { kind: 'document', label: 'Batch item' };
}

/**
 * Run `worker(item)` across `items`, at most `concurrency` lanes at a time.
 * The shared Resource Guard still decides what actually runs simultaneously;
 * a freed lane immediately picks up the next queued item.
 */
export async function runBatch<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number = resolvedConcurrency(),
  describe?: (item: T, index: number) => JobDescriptor,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let cursor = 0;

  async function lane() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      await runScheduled(describe?.(item, i) ?? inferDescriptor(item), () =>
        worker(item, i),
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
