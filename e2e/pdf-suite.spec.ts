import { test, expect, type Page } from "@playwright/test";
import {
  makePdf,
  makeMultiPagePdf,
  makeTruncatedPdf,
  extractPdfStreamText,
  upload,
  triggerDownload,
  createE2eFixture,
  createPageErrorCollector,
} from "./helpers";

const CDN_TIMEOUT = 120_000;

let fixtures: {
  pdf: string;
  pdfWithAuthor: string;
  twoPagePdf: string;
  threePagePdf: string;
  manyPagePdf: string;
  truncated: string;
};

test.beforeAll(async () => {
  const pages28 = Array.from({ length: 28 }, (_, i) => `Page ${i + 1} Content`);
  fixtures = {
    pdf: createE2eFixture("pdf-suite-e2e", "suite-sample.pdf", makePdf("PDF Suite Test Document")),
    pdfWithAuthor: createE2eFixture(
      "pdf-suite-e2e",
      "suite-authored.pdf",
      makeMultiPagePdf(["PDF Metadata Test"], "ConfidentialAuthorXYZ"),
    ),
    twoPagePdf: createE2eFixture(
      "pdf-suite-e2e",
      "suite-two-page.pdf",
      makeMultiPagePdf(["Page One", "Page Two"]),
    ),
    threePagePdf: createE2eFixture(
      "pdf-suite-e2e",
      "suite-three-page.pdf",
      makeMultiPagePdf(["Keep Alpha Page 1", "Delete Secret Page 2", "Keep Omega Page 3"]),
    ),
    manyPagePdf: createE2eFixture(
      "pdf-suite-e2e",
      "suite-28-pages.pdf",
      makeMultiPagePdf(pages28),
    ),
    truncated: createE2eFixture("pdf-suite-e2e", "corrupt-sample.pdf", makeTruncatedPdf()),
  };
});

async function executeSuiteWorkbench(
  page: Page,
  route: string,
  fixturePath: string,
  buttonText: string,
) {
  test.setTimeout(CDN_TIMEOUT);
  await page.goto(route);
  await upload(page, fixturePath);
  await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });

  const action = page.getByRole("button", { name: buttonText });
  await expect(action).toBeVisible({ timeout: CDN_TIMEOUT });
  await expect(action).toBeEnabled({ timeout: CDN_TIMEOUT });
  return await triggerDownload(page, () => action.click());
}

test.describe("PDF Suite workstation", () => {
  let getErrors: (() => string[]) | undefined;
  test.beforeEach(({ page }) => {
    getErrors = createPageErrorCollector(page);
  });
  test.afterEach(() => {
    if (getErrors) {
      expect(getErrors(), "uncaught exception in the page").toEqual([]);
    }
  });

  test("PDF Suite: split document extracts and downloads", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/split",
      fixtures.pdf,
      "Execute PDF Split",
    );
    expect(bytes.length).toBeGreaterThan(100);
    expect(download.suggestedFilename()).toMatch(/(\.pdf|\.zip)$/);
  });

  test("PDF Suite: watermark document applies and downloads", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/watermark",
      fixtures.pdf,
      "Apply Watermark",
    );
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-watermarked\.pdf$/);
  });

  test("PDF Suite: repair truncated PDF salvages valid document", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/repair",
      fixtures.truncated,
      "Execute Deep Repair",
    );
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/repaired-.*\.pdf$/);
  });

  test("PDF Suite: page-numbers inserts counters and downloads", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/page-numbers",
      fixtures.pdf,
      "Add Page Numbers & Download",
    );
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-numbered\.pdf$/);
    const pdfText = extractPdfStreamText(bytes);
    expect(pdfText).toContain("Page 1 of 1");
  });

  test("PDF Suite: nup generates multi-page sheet and downloads", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/nup",
      fixtures.twoPagePdf,
      "Generate 2-Up PDF & Download",
    );
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-2up\.pdf$/);
    const pdfText = extractPdfStreamText(bytes);
    expect(pdfText).toMatch(/\/Count\s+1\b/);
    expect(pdfText).toContain("Page One");
    expect(pdfText).toContain("Page Two");
  });

  test("PDF Suite: metadata strips and downloads sanitized document", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/metadata",
      fixtures.pdfWithAuthor,
      "Strip Document Metadata & Dates (Privacy Mode)",
    );
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-sanitized\.pdf$/);
    expect(bytes.toString("latin1")).not.toContain("ConfidentialAuthorXYZ");
    expect(extractPdfStreamText(bytes)).not.toContain("ConfidentialAuthorXYZ");
  });

  test("PDF Studio: pending text annotation clears on page change and file replacement", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/studio");
    await upload(page, fixtures.twoPagePdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });

    // Select Text tool and click canvas on page 1 to open inline text popover
    await page.getByRole("button", { name: /Text/i }).click();
    const overlay = page.locator(".cz-overlay-ann-canvas");
    await expect(overlay).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(overlay).toHaveAttribute("data-rendered-page", "1", { timeout: CDN_TIMEOUT });
    await overlay.click({ position: { x: 80, y: 80 } });
    const popover = page.locator(".cz-inline-text-popover");
    await expect(popover).toBeVisible();

    // Switching thumbnails clears the pending popover instead of committing to page 2
    const page1Thumb = page.locator(".cz-studio-thumb-card").nth(0);
    const page2Thumb = page.locator(".cz-studio-thumb-card").nth(1);
    await expect(page2Thumb).toBeVisible({ timeout: CDN_TIMEOUT });
    await page2Thumb.click();
    await expect(overlay).toHaveAttribute("data-rendered-page", "2", { timeout: CDN_TIMEOUT });
    await expect(popover).toHaveCount(0);
    await expect(page.locator(".cz-floating-text-ann")).toHaveCount(0);

    // Returning to Page 1 confirms no pending/floating text annotation was added there either
    await page1Thumb.click();
    await expect(overlay).toHaveAttribute("data-rendered-page", "1", { timeout: CDN_TIMEOUT });
    await expect(popover).toHaveCount(0);
    await expect(page.locator(".cz-floating-text-ann")).toHaveCount(0);

    // Reopen popover on page 1, then replace the document
    await overlay.click({ position: { x: 80, y: 80 } });
    await expect(popover).toBeVisible();
    await page.getByRole("button", { name: "Change File" }).click();
    await expect(popover).toHaveCount(0);

    // Reload a fresh file and confirm pending text state was not carried over
    await upload(page, fixtures.pdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(page.locator(".cz-inline-text-popover")).toHaveCount(0);
    await expect(page.locator(".cz-floating-text-ann")).toHaveCount(0);
  });

  test("PDF Remove Pages: lazily renders thumbnail previews for pages 25+ when scrolled into view", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/remove-pages");
    await upload(page, fixtures.manyPagePdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(page.locator(".cz-remove-card")).toHaveCount(28, { timeout: CDN_TIMEOUT });

    const page28Card = page.locator(".cz-remove-card").nth(27);
    await page28Card.scrollIntoViewIfNeeded();
    await expect(page28Card.locator("img.cz-remove-thumb-img")).toBeVisible({ timeout: CDN_TIMEOUT });
  });

  test("PDF Remove Pages: removes selected page and preserves remaining pages in order", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/remove-pages");
    await upload(page, fixtures.threePagePdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(page.getByText("3 pages")).toBeVisible({ timeout: CDN_TIMEOUT });

    await page.locator(".cz-remove-card").nth(1).click();
    const action = page.getByRole("button", { name: "Remove 1 Page & Download PDF" });
    await expect(action).toBeEnabled({ timeout: CDN_TIMEOUT });

    const { download, bytes } = await triggerDownload(page, () => action.click());
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-pages-removed\.pdf$/);

    const pdfText = extractPdfStreamText(bytes);
    expect(pdfText).toMatch(/\/Count\s+2\b/);
    expect(pdfText).toContain("Keep Alpha Page 1");
    expect(pdfText).toContain("Keep Omega Page 3");
    expect(pdfText).not.toContain("Delete Secret Page 2");
  });
});
