import { test, expect, type Browser, type Download, type Page } from "@playwright/test";
import { readZip } from "../src/lib/zip";

async function makeImageBuffer(
  browser: Browser,
  type: "image/png" | "image/jpeg" = "image/png",
  width = 160,
  height = 120,
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const base64 = await page.evaluate(
      async ({ type, width, height }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#1a56db";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(20, 20, width - 40, height - 40);
        const blob = await new Promise<Blob>((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob null"))), type, 0.88),
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

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("Download path unavailable");
  const { readFileSync } = await import("node:fs");
  return readFileSync(path);
}

test.describe("batch ZIP download, toast throttling, and AVIF encoding", () => {
  test("Images: batch compression shows top Download All (.zip), suppresses toast flood, and downloads valid ZIP", async ({
    page,
    browser,
  }) => {
    const pngBuf = await makeImageBuffer(browser, "image/png");
    const jpgBuf = await makeImageBuffer(browser, "image/jpeg");

    await page.goto("/compress/images");
    await page.locator("#dz-mount input[type=file]").setInputFiles([
      { name: "photo.png", mimeType: "image/png", buffer: pngBuf },
      { name: "photo.jpg", mimeType: "image/jpeg", buffer: jpgBuf },
      { name: "clip-1.png", mimeType: "image/png", buffer: pngBuf },
      { name: "clip-2.jpg", mimeType: "image/jpeg", buffer: jpgBuf },
    ]);

    await page.getByRole("button", { name: "Compress all" }).click();
    await expect(page.locator(".cz-queue-done")).toHaveText("4 ready", { timeout: 30_000 });

    // Top toolbar must expose Download All (.zip) without scrolling past all cards
    const topZipBtn = page.locator(".cz-queue-toolbar .cz-btn-download-all");
    await expect(topZipBtn).toBeVisible();
    await expect(topZipBtn).toContainText("Download All (.zip)");

    // Batch run must emit a single summary toast rather than flooding the viewport
    const toastCount = await page.locator("#toast .toast-item").count();
    expect(toastCount).toBeLessThanOrEqual(3);
    await expect(page.locator("#toast")).toContainText("Compressed 4 images");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      topZipBtn.click(),
    ]);
    expect(download.suggestedFilename()).toBe("images-compressed.zip");
    const zipBytes = await readDownload(download);
    expect(zipBytes.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");

    // Verify all 4 files (including colliding stems photo.png / photo.jpg) are preserved inside the ZIP
    const archive = await readZip(
      zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) as ArrayBuffer,
    );
    expect(archive.size).toBe(4);
  });

  test("Convert: batch image conversion shows top Download All (.zip) and packages converted files", async ({
    page,
    browser,
  }) => {
    const pngBuf = await makeImageBuffer(browser, "image/png");
    const jpgBuf = await makeImageBuffer(browser, "image/jpeg");

    await page.goto("/convert?cat=image");
    await page.locator("#dz-mount input[type=file]").setInputFiles([
      { name: "one.png", mimeType: "image/png", buffer: pngBuf },
      { name: "two.jpg", mimeType: "image/jpeg", buffer: jpgBuf },
    ]);

    await page.getByRole("button", { name: "Convert All" }).click();
    const topZipBtn = page.locator(".cz-queue-toolbar .cz-btn-download-all");
    await expect(topZipBtn).toBeVisible({ timeout: 30_000 });
    await expect(topZipBtn).toContainText("Download All (.zip)");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      topZipBtn.click(),
    ]);
    expect(download.suggestedFilename()).toBe("converted-files.zip");
    const zipBytes = await readDownload(download);
    expect(zipBytes.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
  });

  test("Images: selecting AVIF uses WASM fallback encoder and outputs .avif (not .webp)", async ({
    page,
    browser,
  }) => {
    // Intercept lazy @jsquash/avif import from esm.sh so test runs hermetically offline
    await page.route("https://esm.sh/@jsquash/avif*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: `
          export async function encode(imageData, opts) {
            // Minimal ISOBMFF ftyp=avif header bytes for verifiable .avif output
            const out = new Uint8Array([
              0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
              0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
              0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x66, 0x31,
              (opts && opts.quality) || 82
            ]);
            return out.buffer;
          }
        `,
      });
    });

    const pngBuf = await makeImageBuffer(browser, "image/png");
    await page.goto("/compress/images");
    await page.locator(".cz-segmented-track button", { hasText: "AVIF" }).click();

    await page.locator("#dz-mount input[type=file]").setInputFiles([
      { name: "hero.png", mimeType: "image/png", buffer: pngBuf },
    ]);
    await page.getByRole("button", { name: "Compress all" }).click();
    await expect(page.locator(".cz-queue-done")).toHaveText("1 ready", { timeout: 30_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".cz-queue-toolbar .cz-btn-download-all").click(),
    ]);
    expect(download.suggestedFilename()).toBe("hero-compressed.avif");
    const bytes = await readDownload(download);
    expect(bytes.subarray(4, 12).toString("latin1")).toBe("ftypavif");
  });
});
