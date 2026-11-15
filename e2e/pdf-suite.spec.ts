import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makePdf, makeTruncatedPdf, upload, readDownload } from "./helpers";

const CDN_TIMEOUT = 120_000;

let fixtures: {
  pdf: string;
  truncated: string;
};

test.beforeAll(async () => {
  const tmp = join(process.cwd(), ".test-dist", "pdf-suite-e2e");
  mkdirSync(tmp, { recursive: true });
  fixtures = {
    pdf: join(tmp, "suite-sample.pdf"),
    truncated: join(tmp, "corrupt-sample.pdf"),
  };
  writeFileSync(fixtures.pdf, makePdf("PDF Suite Test Document"));
  writeFileSync(fixtures.truncated, makeTruncatedPdf());
});

test.describe("PDF Suite workstation", () => {
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });
  test.afterEach(() => {
    expect(pageErrors, "uncaught exception in the page").toEqual([]);
  });

  test("PDF Suite: split document extracts and downloads", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/split");
    await upload(page, fixtures.pdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });

    const execBtn = page.getByRole("button", { name: "Execute PDF Split" });
    await expect(execBtn).toBeVisible({ timeout: CDN_TIMEOUT });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      execBtn.click(),
    ]);

    const bytes = await readDownload(download);
    expect(bytes.length).toBeGreaterThan(100);
    expect(download.suggestedFilename()).toMatch(/(\.pdf|\.zip)$/);
  });

  test("PDF Suite: watermark document applies and downloads", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/watermark");
    await upload(page, fixtures.pdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });

    const execBtn = page.getByRole("button", { name: "Apply Watermark" });
    await expect(execBtn).toBeVisible({ timeout: CDN_TIMEOUT });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      execBtn.click(),
    ]);

    const bytes = await readDownload(download);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/-watermarked\.pdf$/);
  });

  test("PDF Suite: repair truncated PDF salvages valid document", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/repair");
    await upload(page, fixtures.truncated);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });

    const execBtn = page.getByRole("button", { name: "Execute Deep Repair" });
    await expect(execBtn).toBeVisible({ timeout: CDN_TIMEOUT });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      execBtn.click(),
    ]);

    const bytes = await readDownload(download);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(download.suggestedFilename()).toMatch(/repaired-.*\.pdf$/);
  });
});
