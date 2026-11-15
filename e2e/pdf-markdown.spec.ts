import { test, expect, type Download } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CDN_TIMEOUT = 120_000;

function makePdf(text = "CompressZ Markdown Heading"): Buffer {
  const content = `BT /F1 20 Tf 50 720 Td (${text}) Tj ET`;
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

let fixturePath: string;

test.beforeAll(async () => {
  const tmp = join(process.cwd(), ".test-dist", "pdf-markdown-e2e");
  mkdirSync(tmp, { recursive: true });
  fixturePath = join(tmp, "extract-sample.pdf");
  writeFileSync(fixturePath, makePdf());
});

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("empty download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

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
