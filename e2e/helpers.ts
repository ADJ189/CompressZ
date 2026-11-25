import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Download, Page } from "@playwright/test";

/** Shared minimal multi-page PDF generator for e2e tests */
export function makeMultiPagePdf(pageTexts: string[]): Buffer {
  const count = pageTexts.length;
  const fontObjNum = 3 + count * 2;
  const kids = pageTexts.map((_, i) => `${3 + i} 0 R`).join(" ");
  const pageObjs = pageTexts.map(
    (_, i) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ` +
      `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${3 + count + i} 0 R >>`,
  );
  const contentObjs = pageTexts.map((text) => {
    const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`,
    ...pageObjs,
    ...contentObjs,
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

/** Shared minimal single-page PDF generator for e2e tests */
export function makePdf(text = "CompressZ sample page"): Buffer {
  return makeMultiPagePdf([text]);
}

/** Truncated PDF fixture missing xref and trailer */
export function makeTruncatedPdf(): Buffer {
  const content = `BT /F1 18 Tf 50 100 Td (Salvaged Object) Tj ET`;
  const body =
    "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n" +
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  return Buffer.from(body, "latin1");
}

/** Minimal 1x1 PNG fixture */
export function makeTestImage(): Buffer {
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(pngBase64, "base64");
}

/** Upload helper for standard CompressZ file dropzone */
export async function upload(page: Page, path: string): Promise<void> {
  await page.locator("#dz-mount input[type=file]").setInputFiles(path);
}

/** Read playwright Download stream into Buffer */
export async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("empty download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** Synchronously persists a temporary test fixture and returns its absolute path */
export function createE2eFixture(subfolder: string, filename: string, data: Buffer | string): string {
  const dir = join(process.cwd(), ".test-dist", subfolder);
  mkdirSync(dir, { recursive: true });
  const fullPath = join(dir, filename);
  writeFileSync(fullPath, data);
  return fullPath;
}

/** Attaches a listener to track unhandled page errors and returns an accessor */
export function createPageErrorCollector(page: Page): () => string[] {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  return () => pageErrors;
}

/** Awaits a Playwright download triggered by `triggerAction` and returns the download and buffered bytes */
export async function triggerDownload(
  page: Page,
  triggerAction: () => Promise<unknown>,
): Promise<{ download: Download; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    triggerAction(),
  ]);
  const bytes = await readDownload(download);
  return { download, bytes };
}
