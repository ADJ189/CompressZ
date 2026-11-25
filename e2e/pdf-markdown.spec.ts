import { test, expect } from "@playwright/test";
import {
  makePdf,
  upload,
  triggerDownload,
  createE2eFixture,
  createPageErrorCollector,
} from "./helpers";

const CDN_TIMEOUT = 120_000;

let fixturePath: string;

test.beforeAll(async () => {
  fixturePath = createE2eFixture(
    "pdf-markdown-e2e",
    "extract-sample.pdf",
    makePdf("CompressZ Markdown Heading"),
  );
});

test.describe("PDF to Markdown extractor", () => {
  let getErrors: (() => string[]) | undefined;
  test.beforeEach(({ page }) => {
    getErrors = createPageErrorCollector(page);
  });
  test.afterEach(() => {
    if (getErrors) {
      expect(getErrors(), "uncaught exception in the page").toEqual([]);
    }
  });

  test("PDF to Markdown: extracts text and downloads standalone .md", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/convert/pdf-markdown");
    await upload(page, fixturePath);

    const extractBtn = page.getByRole("button", { name: "Extract Markdown" });
    await expect(extractBtn).toBeVisible({ timeout: CDN_TIMEOUT });
    await extractBtn.click();

    const downloadBtn = page.getByRole("button", { name: /Download \.md/i });
    await expect(downloadBtn).toBeVisible({ timeout: CDN_TIMEOUT });

    const { download, bytes } = await triggerDownload(page, () => downloadBtn.click());
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const md = bytes.toString("utf8");
    expect(md.length).toBeGreaterThan(10);
  });

  test("Markdown Preview: remote images without CORS headers render successfully", async ({ page }) => {
    const testRemoteUrl = "https://cdn.remote-media.test/sample-photo.png";
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.route(testRemoteUrl, (route) => {
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: png1x1,
        // Explicitly omit Access-Control-Allow-Origin to verify no-CORS mode
      });
    });

    await page.goto("/convert/pdf-markdown");
    const loaded = await page.evaluate(async (url) => {
      const img = document.createElement("img");
      img.className = "cz-rendered-img";
      img.alt = "Remote non-CORS test";
      const loadPromise = new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
      });
      img.src = url;
      document.body.appendChild(img);
      const ok = await loadPromise;
      img.remove();
      return ok;
    }, testRemoteUrl);

    expect(loaded).toBe(true);
  });
});
