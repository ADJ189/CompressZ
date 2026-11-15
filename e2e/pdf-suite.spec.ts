import { test, expect, type Page, type Download } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CDN_TIMEOUT = 120_000;

function makePdf(text = "PDF Suite Test Document"): Buffer {
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

function makeTruncatedPdf(): Buffer {
  const content = `BT /F1 18 Tf 50 100 Td (Salvaged Object) Tj ET`;
  const body =
    "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n" +
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  return Buffer.from(body, "latin1");
}

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
  writeFileSync(fixtures.pdf, makePdf());
  writeFileSync(fixtures.truncated, makeTruncatedPdf());
});

async function upload(page: Page, path: string) {
  await page.locator("#dz-mount input[type=file]").setInputFiles(path);
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("empty download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

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
