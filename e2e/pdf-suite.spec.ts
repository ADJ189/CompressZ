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

    // Wait for page 1 canvas render before activating Text tool so layout/dimensions are settled
    const overlay = page.locator(".cz-overlay-ann-canvas");
    await expect(overlay).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(overlay).toHaveAttribute("data-rendered-page", "1", { timeout: CDN_TIMEOUT });
    const textToolBtn = page.getByRole("button", { name: /Text/i });
    await textToolBtn.click();
    await expect(textToolBtn).toHaveAttribute("aria-pressed", "true");
    await expect(overlay).toHaveClass(/is-interactive/);
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

  test("PDF Remove Pages: lazily renders thumbnail previews for pages 25+ when scrolled into view and cleans up on file change and navigation", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/remove-pages");
    await upload(page, fixtures.manyPagePdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(page.locator(".cz-remove-card")).toHaveCount(28, { timeout: CDN_TIMEOUT });

    // Page 28 starts as a placeholder until scrolled into view
    const page28Card = page.locator(".cz-remove-card").nth(27);
    await expect(page28Card.locator(".cz-remove-placeholder")).toBeVisible();
    await expect(page28Card.locator("img.cz-remove-thumb-img")).toHaveCount(0);

    await page28Card.scrollIntoViewIfNeeded();
    await expect(page28Card.locator("img.cz-remove-thumb-img")).toBeVisible({ timeout: CDN_TIMEOUT });

    // Observable cleanup on Change File: cards and thumbnails reset cleanly and a new smaller PDF renders without stale state
    await page.getByRole("button", { name: "Change File" }).click();
    await expect(page.locator(".cz-remove-card")).toHaveCount(0);
    await upload(page, fixtures.twoPagePdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(page.locator(".cz-remove-card")).toHaveCount(2, { timeout: CDN_TIMEOUT });

    // Observable cleanup on route unmount: navigating away and returning leaves zero lingering renders or errors
    await page.locator('#tabbar a[data-nav=""]').click();
    await expect(page.locator("#page-view .cz-workbench")).toBeVisible();
    await page.goBack();
    await expect(page.locator(".cz-pdf-suite-page")).toBeVisible();
  });

  test("PDF Studio: editor edges remain reachable on narrow viewports and inline text popover stays within narrow canvas", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/pdf/studio");
    await upload(page, fixtures.twoPagePdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });

    const wrap = page.locator(".cz-studio-canvas-wrap");
    const stack = page.locator(".cz-canvas-layer-stack");
    const overlay = page.locator(".cz-overlay-ann-canvas");
    await expect(overlay).toHaveAttribute("data-rendered-page", "1", { timeout: CDN_TIMEOUT });

    // Left edge of canvas is reachable at scrollLeft === 0 (never clipped off-screen to the left)
    const leftEdgeOk = await wrap.evaluate((el) => {
      el.scrollLeft = 0;
      const wRect = el.getBoundingClientRect();
      const sRect = el.querySelector(".cz-canvas-layer-stack")!.getBoundingClientRect();
      return sRect.left >= wRect.left - 1;
    });
    expect(leftEdgeOk).toBe(true);

    // Right edge of canvas is reachable when scrolled to the right end
    const rightEdgeOk = await wrap.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      const wRect = el.getBoundingClientRect();
      const sRect = el.querySelector(".cz-canvas-layer-stack")!.getBoundingClientRect();
      return sRect.right <= wRect.right + 1;
    });
    expect(rightEdgeOk).toBe(true);

    // Inline text popover stays fully inside canvas bounds even when zoomed out to a narrow canvas
    await page.locator(".cz-studio-zoom-group button").first().click();
    await page.locator(".cz-studio-zoom-group button").first().click();
    await page.locator(".cz-studio-zoom-group button").first().click();
    await expect(overlay).toHaveAttribute("data-rendered-page", "1", { timeout: CDN_TIMEOUT });

    await page.getByRole("button", { name: /Text/i }).click();
    const stackBox = (await stack.boundingBox())!;
    await overlay.click({ position: { x: Math.max(10, stackBox.width - 12), y: 40 } });

    const popover = page.locator(".cz-inline-text-popover");
    await expect(popover).toBeVisible();
    const popInput = popover.locator(".cz-inline-text-input");
    const addBtn = popover.getByRole("button", { name: "Add" });
    const cancelBtn = popover.getByRole("button", { name: "Cancel" });
    await expect(popInput).toBeVisible();
    await expect(addBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();

    const updatedStackBox = (await stack.boundingBox())!;
    for (const loc of [popover, popInput, addBtn, cancelBtn]) {
      const box = (await loc.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(updatedStackBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(updatedStackBox.x + updatedStackBox.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(updatedStackBox.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(updatedStackBox.y + updatedStackBox.height + 1);
    }
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
