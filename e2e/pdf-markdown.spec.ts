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
  let getErrors: () => string[];
  test.beforeEach(({ page }) => {
    getErrors = createPageErrorCollector(page);
  });
  test.afterEach(() => {
    expect(getErrors(), "uncaught exception in the page").toEqual([]);
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
});
