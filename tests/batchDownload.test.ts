import { assertEquals, assert } from "./assert.ts";
import { downloadBatch, MAX_ZIP_MEMORY_BUDGET, type BatchFileItem } from "../src/lib/batchDownload.ts";
import { readZip, estimateZipArchiveSize, exceedsZipLimit } from "../src/lib/zip.ts";

Deno.test("batchDownload: single file downloads directly without zip", async () => {
  let createdUrl: string | null = null;
  let clicked = false;
  let downloadedName = "";

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origDoc = (globalThis as any).document;

  try {
    URL.createObjectURL = (_b: Blob) => {
      createdUrl = "blob:mock-single";
      return createdUrl;
    };
    URL.revokeObjectURL = () => {};

    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "a") {
          return {
            set href(_val: string) { /* mock */ },
            set download(val: string) { downloadedName = val; },
            click: () => { clicked = true; },
          };
        }
        return {};
      },
    };

    const item: BatchFileItem = {
      name: "test.pdf",
      blob: new Blob(["sample content"], { type: "application/pdf" }),
    };

    await downloadBatch([item], "bundle.zip");

    assertEquals(clicked, true);
    assertEquals(downloadedName, "test.pdf");
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    (globalThis as any).document = origDoc;
  }
});

Deno.test("batchDownload: multiple files package into single zip archive", async () => {
  let clicked = false;
  let downloadedName = "";
  let zipBlobCaptured: Blob | null = null;

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origDoc = (globalThis as any).document;

  try {
    URL.createObjectURL = (b: Blob) => {
      zipBlobCaptured = b;
      return "blob:mock-zip";
    };
    URL.revokeObjectURL = () => {};

    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "a") {
          return {
            set href(_val: string) { /* mock */ },
            set download(val: string) { downloadedName = val; },
            click: () => { clicked = true; },
          };
        }
        return {};
      },
    };

    const items: BatchFileItem[] = [
      { name: "track1.mp3", blob: new Blob(["audio-1"], { type: "audio/mp3" }) },
      { name: "track2.mp3", blob: new Blob(["audio-2"], { type: "audio/mp3" }) },
    ];

    await downloadBatch(items, "audio-compressed.zip");

    assertEquals(clicked, true);
    assertEquals(downloadedName, "audio-compressed.zip");
    const capturedBlob = zipBlobCaptured as Blob | null;
    assert(capturedBlob !== null, "Zip blob must be created");

    // Verify zip contains both files
    const zipBuf = await capturedBlob.arrayBuffer();
    const extracted = await readZip(zipBuf);
    assertEquals(extracted.size, 2);
    assertEquals(extracted.has("track1.mp3"), true);
    assertEquals(extracted.has("track2.mp3"), true);
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    (globalThis as any).document = origDoc;
  }
});

Deno.test("batchDownload: oversized batch exceeding 4 GiB limit falls back to individual downloads", async () => {
  const downloadedNames: string[] = [];
  let clickCount = 0;

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origDoc = (globalThis as any).document;

  try {
    URL.createObjectURL = (_b: Blob) => "blob:mock-oversized";
    URL.revokeObjectURL = () => {};

    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "a") {
          return {
            set href(_val: string) { /* mock */ },
            set download(val: string) { downloadedNames.push(val); },
            click: () => { clickCount++; },
          };
        }
        return {};
      },
    };

    // Create 2 mock blobs whose sizes sum to > 4 GiB (0xffffffff = 4,294,967,295 bytes)
    const blob1 = new Blob(["part1"]);
    Object.defineProperty(blob1, "size", { value: 2.5 * 1024 * 1024 * 1024 });

    const blob2 = new Blob(["part2"]);
    Object.defineProperty(blob2, "size", { value: 2.5 * 1024 * 1024 * 1024 });

    const items: BatchFileItem[] = [
      { name: "video1-compressed.mp4", blob: blob1 },
      { name: "video2-compressed.mp4", blob: blob2 },
    ];

    await downloadBatch(items, "video-compressed.zip");

    // Both files should have been clicked individually instead of creating an oversized zip
    assertEquals(clickCount, 2);
    assertEquals(downloadedNames, ["video1-compressed.mp4", "video2-compressed.mp4"]);
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    (globalThis as any).document = origDoc;
  }
});

Deno.test("batchDownload: batch exceeding in-memory budget falls back to individual downloads", async () => {
  assertEquals(MAX_ZIP_MEMORY_BUDGET, 512 * 1024 * 1024);
  const downloadedNames: string[] = [];
  let clickCount = 0;

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origDoc = (globalThis as any).document;

  try {
    URL.createObjectURL = (_b: Blob) => "blob:mock-memory-budget";
    URL.revokeObjectURL = () => {};

    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "a") {
          return {
            set href(_val: string) { /* mock */ },
            set download(val: string) { downloadedNames.push(val); },
            click: () => { clickCount++; },
          };
        }
        return {};
      },
    };

    // 2 files of 300 MiB each (total 600 MiB, passing 4 GiB zip limit but exceeding 512 MiB memory budget)
    const blob1 = new Blob(["part1"]);
    Object.defineProperty(blob1, "size", { value: 300 * 1024 * 1024 });

    const blob2 = new Blob(["part2"]);
    Object.defineProperty(blob2, "size", { value: 300 * 1024 * 1024 });

    const items: BatchFileItem[] = [
      { name: "movie-part1.mp4", blob: blob1 },
      { name: "movie-part2.mp4", blob: blob2 },
    ];

    await downloadBatch(items, "movies.zip");

    assertEquals(clickCount, 2);
    assertEquals(downloadedNames, ["movie-part1.mp4", "movie-part2.mp4"]);
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    (globalThis as any).document = origDoc;
  }
});

Deno.test("batchDownload: entry overhead accounts for archives near 4 GiB threshold", () => {
  // A batch of 100 files where raw bytes = 0xffffffff - 5000 (just under 4 GiB)
  const fileCount = 100;
  const rawBytes = 0xffffffff - 5000;
  const perFileSize = Math.floor(rawBytes / fileCount);

  const items = Array.from({ length: fileCount }, (_, i) => ({
    name: `video_segment_${i}.mp4`,
    size: perFileSize,
  }));

  // Overhead per entry is at least 76 bytes + 2*nameLen.
  // 100 entries * ~120 bytes overhead = ~12,000 bytes overhead.
  // 5000 bytes below limit + 12000 overhead pushes projected size over 4 GiB!
  const estimated = estimateZipArchiveSize(items);
  assertEquals(estimated >= 0xffffffff, true);
  assertEquals(exceedsZipLimit(items), true);
});

Deno.test("batchDownload: 0xffff or more items fall back to individual downloads to prevent 16-bit entry overflow", async () => {
  let clickCount = 0;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origDoc = (globalThis as any).document;

  try {
    URL.createObjectURL = () => "blob:mock";
    URL.revokeObjectURL = () => {};

    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "a") {
          return {
            set href(_val: string) { /* mock */ },
            set download(_val: string) { /* mock */ },
            click: () => { clickCount++; },
          };
        }
        return {};
      },
    };

    const dummyBlob = new Blob(["test"]);
    const items: BatchFileItem[] = Array.from({ length: 0xffff }, (_, i) => ({
      name: `item_${i}.txt`,
      blob: dummyBlob,
    }));

    await downloadBatch(items, "huge-batch.zip");
    assertEquals(clickCount, 0xffff);
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    (globalThis as any).document = origDoc;
  }
});
