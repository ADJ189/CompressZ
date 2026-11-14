import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crc32 as zlibCrc32 } from "node:zlib";
import { test, expect, type Browser, type Download, type Page } from "@playwright/test";

/**
 * End-to-end conversion matrix.
 *
 * The smoke suite only proves that every route *renders*. These tests drive the
 * real UI — upload a real file into `#dz-mount input[type=file]`, press the
 * route's primary action, wait for the file card to reach "done", then click the
 * card's download button and inspect the bytes that come out. That is the only
 * layer that catches route → engine option mismatches (the class of bug that
 * made Images → PDF throw "`width` must be of type `number`" and made the image
 * quality slider a no-op).
 *
 * Fixtures are synthetic and generated here (no checked-in binaries, no network
 * fetch of sample media). Tests that need a CDN engine (pdf-lib, PDF.js,
 * mammoth, FFmpeg.wasm) are marked and get a longer timeout.
 */

const CDN_TIMEOUT = 240_000;

// ── Fixture generation ─────────────────────────────────────────

/** Smallest valid PDF (one A4 page, one line of Helvetica text). */
function makePdf(text = "CompressZ sample page"): Buffer {
  const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Store-only ZIP writer (method 0) — enough for a minimal DOCX. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = zlibCrc32(data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: store
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, end]);
}

/** Minimal WordprocessingML document mammoth.js can read. */
function makeDocx(text = "CompressZ document text"): Buffer {
  const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return makeZip({
    "[Content_Types].xml":
      xmlHead +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
    "_rels/.rels":
      xmlHead +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
    "word/document.xml":
      xmlHead +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
      "</w:body></w:document>",
  });
}

/** 16-bit mono PCM WAV — 1 s of a 440 Hz tone. */
function makeWav(seconds = 1, rate = 44_100): Buffer {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000),
      i * 2,
    );
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** 1×1 GIF89a — the smallest thing FFmpeg's palettegen will accept. */
const GIF_1PX = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

/** Render a photo-like PNG/JPEG/WebP in a throwaway page. */
async function makeImage(
  browser: Browser,
  type: "image/png" | "image/jpeg" | "image/webp",
  width = 640,
  height = 480,
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const base64 = await page.evaluate(
      async ({ type, width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#0b6e4f");
        gradient.addColorStop(1, "#e0b100");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        // Deterministic texture blocks so lossy encoders have real work to do.
        for (let i = 0; i < 300; i++) {
          ctx.fillStyle = `hsl(${(i * 47) % 360} 70% ${30 + (i % 40)}%)`;
          ctx.fillRect((i * 37) % width, (i * 61) % height, 14, 14);
        }
        ctx.fillStyle = "#101010";
        ctx.font = "bold 48px sans-serif";
        ctx.fillText("CompressZ", 32, 88);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), type, 0.92),
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      },
      { type, width, height },
    );
    return Buffer.from(base64, "base64");
  } finally {
    await page.close();
  }
}

/** Record a short real WebM clip (canvas capture → MediaRecorder). */
async function makeVideo(browser: Browser): Promise<Buffer | null> {
  const page = await browser.newPage();
  try {
    const base64 = await page.evaluate(async () => {
      if (typeof MediaRecorder === "undefined") return null;
      const mime = ["video/webm;codecs=vp8", "video/webm"]
        .find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime) return null;

      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
      recorder.start();

      const started = performance.now();
      await new Promise<void>((resolve) => {
        const frame = () => {
          const t = performance.now() - started;
          ctx.fillStyle = `hsl(${t / 8} 70% 45%)`;
          ctx.fillRect(0, 0, 320, 240);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 28px sans-serif";
          ctx.fillText(`${Math.round(t)}ms`, 40, 130);
          if (t < 1200) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      recorder.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunks, { type: mime });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
      return new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(blob);
      });
    });
    return base64 ? Buffer.from(base64, "base64") : null;
  } finally {
    await page.close();
  }
}

// ── UI helpers ─────────────────────────────────────────────────

async function upload(page: Page, ...paths: string[]) {
  await page.locator("#dz-mount input[type=file]").setInputFiles(paths);
}

/** Wait for every queued card to reach `done`, surfacing the engine's error. */
async function waitForCards(page: Page, count: number) {
  const cards = page.locator("#file-list .file-card");
  await expect(cards).toHaveCount(count);

  const deadline = Date.now() + 120_000;
  for (;;) {
    const errors = page.locator("#file-list .cz-card-error-msg");
    if ((await errors.count()) > 0) {
      throw new Error(
        `conversion failed: ${(await errors.allInnerTexts()).join(" | ")}`,
      );
    }
    const done = await page.locator("#file-list .file-card.is-done").count();
    if (done === count) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${count} finished cards (${done} done)`,
      );
    }
    await page.waitForTimeout(100);
  }
}

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("download had no local path");
  return readFileSync(path);
}

/** Convert page: pick a source category (its button is `icon + label`). */
function category(page: Page, label: string) {
  return page
    .locator(".cz-cat-segmented button")
    .filter({ hasText: new RegExp(`\\b${label}\\b`) });
}

/** Convert page: the per-result download button. */
function convertDownload(page: Page) {
  return page.locator('button[title="Download converted file"]').first();
}

async function clickDownload(page: Page, index = 0): Promise<{ name: string; bytes: Buffer }> {
  const button = page.locator('button[aria-label="Download"]').nth(index);
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    button.click(),
  ]);
  return { name: download.suggestedFilename(), bytes: await readDownload(download) };
}

async function clickConvertDownload(
  page: Page,
  timeout = CDN_TIMEOUT,
): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    convertDownload(page).click({ timeout }),
  ]);
  return { name: download.suggestedFilename(), bytes: await readDownload(download) };
}

async function runCompression(
  page: Page,
  count = 1,
): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole("button", { name: "Compress all" }).click();
  await waitForCards(page, count);
  return clickDownload(page);
}

// ── Suite ──────────────────────────────────────────────────────

let fixtures: {
  png: string;
  jpg: string;
  pdf: string;
  pdfB: string;
  gif: string;
  docx: string;
  wav: string;
  webm: string | null;
};

test.beforeAll(async ({ browser }, testInfo) => {
  const workerFixtures = resolve("test-results", "conversion-fixtures", `worker-${testInfo.workerIndex}`);
  mkdirSync(workerFixtures, { recursive: true });
  const write = (name: string, bytes: Buffer) => {
    const path = join(workerFixtures, name);
    writeFileSync(path, bytes);
    return path;
  };

  fixtures = {
    png: write("photo.png", await makeImage(browser, "image/png")),
    jpg: write("photo.jpg", await makeImage(browser, "image/jpeg")),
    pdf: write("sample.pdf", makePdf("CompressZ sample page")),
    pdfB: write("sample-b.pdf", makePdf("Second sample page")),
    gif: write("pixel.gif", GIF_1PX),
    docx: write("sample.docx", makeDocx()),
    wav: write("tone.wav", makeWav()),
    webm: null,
  };

  const video = await makeVideo(browser);
  if (video) fixtures.webm = write("clip.webm", video);
});

test.describe("conversion matrix", () => {
  // Uncaught exceptions are the failure mode that leaves the UI looking fine
  // (a "done" card, an enabled download button) while nothing was produced —
  // exactly how the Merge PDF download used to throw inside createObjectURL.
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });
  test.afterEach(() => {
    expect(pageErrors, "uncaught exception in the page").toEqual([]);
  });

  test("Images: two photos compress to WebP with blob-derived names", async ({ page }) => {
    await page.goto("/compress/images");
    await upload(page, fixtures.png, fixtures.jpg);
    await page.getByRole("button", { name: "Compress all" }).click();
    await waitForCards(page, 2);

    const { name, bytes } = await clickDownload(page);
    expect(name).toMatch(/-compressed\.webp$/);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(bytes.length).toBeGreaterThan(200);
  });

  test("Images → PDF: two images become one readable PDF", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/compress/images-to-pdf");
    await upload(page, fixtures.png, fixtures.jpg);
    await page.getByRole("button", { name: "Create PDF" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download PDF" }).click({ timeout: CDN_TIMEOUT }),
    ]);
    const bytes = await readDownload(download);
    expect(download.suggestedFilename()).toBe("compiled-document.pdf");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  test("PDF: compression returns a valid PDF", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/compress/pdf");
    await upload(page, fixtures.pdf);
    await page.getByRole("button", { name: "Compress all" }).click();
    await waitForCards(page, 1);

    const { name, bytes } = await clickDownload(page);
    expect(name).toMatch(/-compressed\.pdf$/);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  test("Merge PDF: two PDFs merge into one document", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/compress/merge-pdf");
    await upload(page, fixtures.pdf, fixtures.pdfB);
    await page.getByRole("button", { name: "Merge documents" }).click();

    const button = page.getByRole("button", { name: "Download merged PDF" });
    await expect(button).toBeVisible({ timeout: CDN_TIMEOUT });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      button.click(),
    ]);
    const bytes = await readDownload(download);
    expect(download.suggestedFilename()).toBe("merged-document.pdf");
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  test("Convert: image → WebP", async ({ page }) => {
    await page.goto("/convert");
    await category(page, "Image").click();
    await upload(page, fixtures.png);
    await page.getByRole("button", { name: "Convert All" }).click();
    await expect(page.locator(".cz-status-pill.is-done").first()).toBeVisible({
      timeout: 60_000,
    });

    const { name, bytes } = await clickConvertDownload(page, 60_000);
    expect(name).toMatch(/\.webp$/);
    expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP");
  });

  test("Convert: images → PDF", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/convert");
    await category(page, "Images to PDF").click();
    await upload(page, fixtures.png, fixtures.jpg);
    await page.getByRole("button", { name: "Convert All" }).click();

    const { name, bytes } = await clickConvertDownload(page);
    expect(name).toMatch(/-combined-2\.pdf$/);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  test("Convert: PDF → PNG uses the returned blob", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/convert");
    await category(page, "PDF to Images").click();
    await upload(page, fixtures.pdf);
    await page.getByRole("button", { name: "Convert All" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      convertDownload(page).click({ timeout: CDN_TIMEOUT }),
    ]);
    const bytes = await readDownload(download);
    expect(download.suggestedFilename()).toMatch(/-images\.png$/);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("Convert: DOCX → TXT", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/convert");
    await category(page, "DOCX").click();
    await page.getByRole("button", { name: "Plain Text" }).click();
    await upload(page, fixtures.docx);
    await page.getByRole("button", { name: "Convert All" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      convertDownload(page).click({ timeout: CDN_TIMEOUT }),
    ]);
    const bytes = await readDownload(download);
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
    expect(bytes.toString("utf8")).toContain("CompressZ document text");
  });

  test("Convert: DOCX → HTML", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/convert");
    await category(page, "DOCX").click();
    await page.getByRole("button", { name: "HTML", exact: true }).click();
    await upload(page, fixtures.docx);
    await page.getByRole("button", { name: "Convert All" }).click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      convertDownload(page).click({ timeout: CDN_TIMEOUT }),
    ]);
    const bytes = await readDownload(download);
    expect(download.suggestedFilename()).toMatch(/\.html$/);
    expect(bytes.toString("utf8")).toContain("CompressZ document text");
  });

  test("GIF: re-optimise keeps a GIF", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/compress/gif");
    await upload(page, fixtures.gif);
    await page.getByRole("button", { name: "Compress all" }).click();
    await waitForCards(page, 1);

    const { name, bytes } = await clickDownload(page);
    expect(name).toMatch(/-compressed\.gif$/);
    expect(bytes.subarray(0, 6).toString("latin1")).toMatch(/^GIF8[79]a$/);
  });

  test("GIF → WebM toggle produces a WebM file", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/compress/gif");
    const webmBtn = page.getByRole("button", { name: /Convert to WebM/i });
    await expect(webmBtn).toHaveAttribute("aria-pressed", "false");
    await webmBtn.click();
    await expect(webmBtn).toHaveAttribute("aria-pressed", "true");
    await upload(page, fixtures.gif);
    const { name, bytes } = await runCompression(page);
    expect(name).toMatch(/-compressed\.webm$/);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3"); // EBML
  });

  test("Audio: WAV → MP3", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/compress/audio");
    await upload(page, fixtures.wav);
    await page.getByRole("button", { name: "Compress all" }).click();
    await waitForCards(page, 1);

    const { name, bytes } = await clickDownload(page);
    expect(name).toMatch(/-compressed\.mp3$/);
    // ID3 tag or a raw MPEG frame sync.
    const id3 = bytes.subarray(0, 3).toString("latin1") === "ID3";
    const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    expect(id3 || frameSync).toBe(true);
  });

  test("Video: WebM → MP4", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    test.skip(!fixtures.webm, "MediaRecorder produced no WebM clip in this browser");
    await page.goto("/compress/video");
    await upload(page, fixtures.webm!);
    await page.getByRole("button", { name: "Compress all" }).click();
    await waitForCards(page, 1);

    const { name, bytes } = await clickDownload(page);
    expect(name).toMatch(/-compressed\.mp4$/);
    expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  });
});
