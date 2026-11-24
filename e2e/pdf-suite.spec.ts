import { test, expect, type Page } from "@playwright/test";
import {
  makePdf,
  makeTruncatedPdf,
  upload,
  triggerDownload,
  createE2eFixture,
  createPageErrorCollector,
} from "./helpers";

const CDN_TIMEOUT = 120_000;

let fixtures: {
  pdf: string;
  truncated: string;
};

test.beforeAll(async () => {
  fixtures = {
    pdf: createE2eFixture("pdf-suite-e2e", "suite-sample.pdf", makePdf("PDF Suite Test Document")),
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
  return await triggerDownload(page, () => action.click());
}

test.describe("PDF Suite workstation", () => {
  let getErrors: () => string[];
  test.beforeEach(({ page }) => {
    getErrors = createPageErrorCollector(page);
  });
  test.afterEach(() => {
    expect(getErrors(), "uncaught exception in the page").toEqual([]);
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
  });

  test("PDF Suite: nup generates multi-page sheet and downloads", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/nup",
      fixtures.pdf,
      "Generate 2-Up PDF & Download",
    );
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-2up\.pdf$/);
  });

  test("PDF Suite: metadata strips and downloads sanitized document", async ({ page }) => {
    const { download, bytes } = await executeSuiteWorkbench(
      page,
      "/pdf/metadata",
      fixtures.pdf,
      "Strip All Metadata & Dates (Privacy Mode)",
    );
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-sanitized\.pdf$/);
  });
});
