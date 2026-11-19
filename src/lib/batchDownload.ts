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

import { writeZip, type ZipEntryIn } from "./zip";

export interface BatchFileItem {
  name: string;
  blob: Blob;
}

export async function downloadBatch(
  items: BatchFileItem[],
  archiveName: string,
): Promise<void> {
  const validItems = items.filter((item) => item && item.blob);
  if (validItems.length === 0) return;

  if (validItems.length === 1) {
    const single = validItems[0];
    const url = URL.createObjectURL(single.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = single.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }

  // Multi-file batch: create a single ZIP archive
  const zipEntries: ZipEntryIn[] = await Promise.all(
    validItems.map(async (item) => ({
      name: item.name,
      data: new Uint8Array(await item.blob.arrayBuffer()),
    })),
  );

  const zipBytes = await writeZip(zipEntries);
  const zipBlob = new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  const safeArchiveName = archiveName.endsWith(".zip")
    ? archiveName
    : `${archiveName}.zip`;
  a.download = safeArchiveName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
