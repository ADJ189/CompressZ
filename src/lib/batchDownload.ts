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

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadBatch(
  items: BatchFileItem[],
  archiveName: string,
): Promise<void> {
  const validItems = items.filter((item) => item && item.blob);
  if (validItems.length === 0) return;

  if (validItems.length === 1) {
    triggerDownload(validItems[0].blob, validItems[0].name);
    return;
  }

  // Pre-check total projected archive size including headers before allocating arrays and packaging.
  // Standard ZIP supports up to 0xfffe (65534) entries; 0xffff or more overflows the 16-bit entry count.
  // If entry count reaches 0xffff or projected size exceeds the 32-bit (4 GiB) ZIP threshold, fall back immediately to
  // individually accessible output downloads within the user gesture so the batch succeeds.
  if (
    validItems.length >= 0xffff ||
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
    const zipBlob = new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
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
