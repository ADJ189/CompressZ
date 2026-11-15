import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CDN_TIMEOUT = 120_000;

// Minimal 100x100 PNG fixture with a white background and red box
function makeTestImage(): Buffer {
  // 1x1 PNG or small PNG buffer
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(pngBase64, "base64");
}

let fixtureImg: string;

test.beforeAll(async () => {
  const tmp = join(process.cwd(), ".test-dist", "ocr-e2e");
  mkdirSync(tmp, { recursive: true });
  fixtureImg = join(tmp, "ocr-input.png");
  writeFileSync(fixtureImg, makeTestImage());
});

test.describe("OCR workbench", () => {
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });
  test.afterEach(() => {
    expect(pageErrors, "uncaught exception in the page").toEqual([]);
  });

  test("OCR: image input stages with Recognise action and output mode selector", async ({ page }) => {
    await page.goto("/compress/ocr");
    await page.locator("#dz-mount input[type=file]").setInputFiles(fixtureImg);

    // Verify card appears with "Recognise"
    const card = page.locator("#file-list .file-card");
    await expect(card).toBeVisible({ timeout: CDN_TIMEOUT });
    await expect(card.getByRole("button", { name: "Recognise" })).toBeVisible();

    // Verify output format selector (Searchable PDF, Plain text, Both)
    const outputKind = page.locator("#ocr-output");
    await expect(outputKind).toBeVisible();
    await outputKind.selectOption("txt");
    expect(await outputKind.inputValue()).toBe("txt");

    await outputKind.selectOption("pdf");
    expect(await outputKind.inputValue()).toBe("pdf");
  });
});
