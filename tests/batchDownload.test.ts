import { assertEquals, assert } from "./assert.ts";
import { downloadBatch, type BatchFileItem } from "../src/lib/batchDownload.ts";
import { readZip } from "../src/lib/zip.ts";

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
            set href(val: string) {},
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
  let zipBlobCaptured: any = null;

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
            set href(val: string) {},
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
    assert(zipBlobCaptured !== null, "Zip blob must be created");

    // Verify zip contains both files
    const zipBuf = await zipBlobCaptured!.arrayBuffer();
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
