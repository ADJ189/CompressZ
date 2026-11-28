/**
 * batchDownload.ts — Safe single-action batch download helper.
 *
 * Browsers revoke user activation shortly after a click, causing delayed
 * `setTimeout` download cascades to be blocked as unauthorised popups.
 * This helper guarantees atomic delivery:
 *  - 0 items: no-op
 *  - 1 item: direct single-file download within the user gesture
 *  - 2+ items: packaged into a single ZIP archive downloaded immediately
 */

import { writeZip, exceedsZipLimit, MAX_ZIP_32_BYTES, type ZipEntryIn } from "./zip";

export interface BatchFileItem {
  name: string;
  blob: Blob;
}

/** 32-bit ZIP limit (4 GiB). Batches at or above this cannot be packaged safely without Zip64. */
export const MAX_ZIP_BATCH_BYTES = MAX_ZIP_32_BYTES;
export { exceedsZipLimit };

/**
 * Maximum total uncompressed payload memory budget for creating an in-memory ZIP archive in the browser.
 * Batches exceeding this threshold fall back to individual direct downloads to prevent tab OOM crashes.
 */
export const MAX_ZIP_MEMORY_BUDGET = 512 * 1024 * 1024; // 512 MiB

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function splitNameExt(name: string): { stem: string; ext: string } {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, idx), ext: name.slice(idx) };
}

/**
 * Ensure every item in a batch has a unique filename (case-insensitive)
 * before packaging into a ZIP archive, so e.g. `photo.png` and `photo.jpg`
 * converted to `.avif` become `photo.avif` and `photo (2).avif`.
 */
export function deduplicateBatchNames(items: BatchFileItem[]): BatchFileItem[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const raw = item.name || "file";
    const lower = raw.toLowerCase();
    const count = seen.get(lower) ?? 0;
    if (count === 0) {
      seen.set(lower, 1);
      return item;
    }
    const { stem, ext } = splitNameExt(raw);
    let n = count + 1;
    let candidate = `${stem} (${n})${ext}`;
    while (seen.has(candidate.toLowerCase())) {
      n++;
      candidate = `${stem} (${n})${ext}`;
    }
    seen.set(lower, n);
    seen.set(candidate.toLowerCase(), 1);
    return { ...item, name: candidate };
  });
}

export async function downloadBatch(
  items: BatchFileItem[],
  archiveName: string,
): Promise<void> {
  const validItems = deduplicateBatchNames(items.filter((item) => item && item.blob));
  if (validItems.length === 0) return;

  if (validItems.length === 1) {
    triggerDownload(validItems[0].blob, validItems[0].name);
    return;
  }

  // Pre-check total projected archive size including headers before allocating arrays and packaging.
  // Standard ZIP supports up to 0xfffe (65534) entries; 0xffff or more overflows the 16-bit entry count.
  // If entry count reaches 0xffff, total size exceeds memory budget (512 MiB), or projected size exceeds
  // the 32-bit (4 GiB) ZIP threshold, fall back immediately to individual downloads within user gesture.
  const totalRawBytes = validItems.reduce((sum, item) => sum + item.blob.size, 0);
  if (
    validItems.length >= 0xffff ||
    totalRawBytes > MAX_ZIP_MEMORY_BUDGET ||
    exceedsZipLimit(validItems.map((item) => ({ name: item.name, size: item.blob.size })))
  ) {
    for (const item of validItems) {
      triggerDownload(item.blob, item.name);
    }
    return;
  }

  try {
    // Multi-file batch: create a single ZIP archive
    const zipEntries: ZipEntryIn[] = await Promise.all(
      validItems.map(async (item) => ({
        name: item.name,
        data: new Uint8Array(await item.blob.arrayBuffer()),
      })),
    );

    const zipBytes = await writeZip(zipEntries);
    const zipBlob = new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" });
    const safeArchiveName = archiveName.endsWith(".zip")
      ? archiveName
      : `${archiveName}.zip`;
    triggerDownload(zipBlob, safeArchiveName);
  } catch {
    // Fallback: if in-memory ZIP packaging fails (e.g. limit reached), provide individual downloads
    for (const item of validItems) {
      triggerDownload(item.blob, item.name);
    }
  }
}
