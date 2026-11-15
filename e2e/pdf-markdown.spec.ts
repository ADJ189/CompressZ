import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makePdf, readDownload } from "./helpers";

const CDN_TIMEOUT = 120_000;

let fixturePath: string;

test.beforeAll(async () => {
  const tmp = join(process.cwd(), ".test-dist", "pdf-markdown-e2e");
  mkdirSync(tmp, { recursive: true });
  fixturePath = join(tmp, "extract-sample.pdf");
  writeFileSync(fixturePath, makePdf("CompressZ Markdown Heading"));
});

test.describe("PDF to Markdown extractor", () => {
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });
  test.afterEach(() => {
    expect(pageErrors, "uncaught exception in the page").toEqual([]);
  });

  test("PDF to Markdown: extracts text and downloads standalone .md", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/convert/pdf-markdown");
    await page.locator("#dz-mount input[type=file]").setInputFiles(fixturePath);

    const extractBtn = page.getByRole("button", { name: "Extract Markdown" });
    await expect(extractBtn).toBeVisible({ timeout: CDN_TIMEOUT });
    await extractBtn.click();

    const downloadBtn = page.getByRole("button", { name: /Download \.md/i });
    await expect(downloadBtn).toBeVisible({ timeout: CDN_TIMEOUT });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      downloadBtn.click(),
    ]);

    const bytes = await readDownload(download);
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const md = bytes.toString("utf8");
    expect(md.length).toBeGreaterThan(10);
  });
});
