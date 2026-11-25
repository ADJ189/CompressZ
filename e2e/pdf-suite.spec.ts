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
  twoPagePdf: string;
  truncated: string;
};

function makeTwoPagePdf(): Buffer {
  const c1 = "BT /F1 24 Tf 72 720 Td (Page One) Tj ET";
  const c2 = "BT /F1 24 Tf 72 720 Td (Page Two) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`,
    `<< /Length ${c2.length} >>\nstream\n${c2}\nendstream`,
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

test.beforeAll(async () => {
  fixtures = {
    pdf: createE2eFixture("pdf-suite-e2e", "suite-sample.pdf", makePdf("PDF Suite Test Document")),
    twoPagePdf: createE2eFixture("pdf-suite-e2e", "suite-two-page.pdf", makeTwoPagePdf()),
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

  test("PDF Studio: pending text annotation clears on page change and file replacement", async ({ page }) => {
    test.setTimeout(CDN_TIMEOUT);
    await page.goto("/pdf/studio");
    await upload(page, fixtures.twoPagePdf);
    await expect(page.locator(".cz-suite-file-bar")).toBeVisible({ timeout: CDN_TIMEOUT });

    // Select Text tool and click canvas on page 1 to open inline text popover
    await page.getByRole("button", { name: /Text/i }).click();
    const overlay = page.locator(".cz-overlay-ann-canvas");
    await expect(overlay).toBeVisible({ timeout: CDN_TIMEOUT });
    await overlay.click({ position: { x: 80, y: 80 } });
    const popover = page.locator(".cz-inline-text-popover");
    await expect(popover).toBeVisible();

    // Switching thumbnails clears the pending popover instead of committing to page 2
    const page2Thumb = page.locator(".cz-studio-thumb-card").nth(1);
    await expect(page2Thumb).toBeVisible({ timeout: CDN_TIMEOUT });
    await page2Thumb.click();
    await expect(popover).toHaveCount(0);
    await expect(page.locator(".cz-floating-text-ann")).toHaveCount(0);

    // Reopen popover on page 2, then replace the document
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
});
