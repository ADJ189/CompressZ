import { test, expect } from "@playwright/test";
import { makeTestImage, upload, createE2eFixture, createPageErrorCollector } from "./helpers";

const CDN_TIMEOUT = 120_000;

let fixtureImg: string;

test.beforeAll(async () => {
  fixtureImg = createE2eFixture("ocr-e2e", "ocr-input.png", makeTestImage());
});

test.describe("OCR workbench", () => {
  let getErrors: (() => string[]) | undefined;
  test.beforeEach(({ page }) => {
    getErrors = createPageErrorCollector(page);
  });
  test.afterEach(() => {
    if (getErrors) {
      expect(getErrors(), "uncaught exception in the page").toEqual([]);
    }
  });

  test("OCR: image input stages with Recognise action and output mode selector", async ({ page }) => {
    await page.goto("/compress/ocr");
    await upload(page, fixtureImg);

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

  test("OCR: navigating from handwriting shortcut to bare route restores printed profile and PDF output", async ({ page }) => {
    // 1. Enter via handwriting shortcut
    await page.goto("/compress/ocr?profile=handwriting");
    const profSelect = page.locator("#ocr-prof");
    await expect(profSelect).toBeVisible();
    expect(await profSelect.inputValue()).toBe("handwriting");

    // In handwriting mode, the PDF output selector is hidden
    await expect(page.locator("#ocr-output")).toHaveCount(0);

    // 2. Navigate to bare Searchable PDF OCR route (simulating shortcut click)
    await page.goto("/compress/ocr");
    await expect(profSelect).toHaveValue("printed");

    // Output selector must now be restored with PDF selected
    const outputKind = page.locator("#ocr-output");
    await expect(outputKind).toBeVisible();
    expect(await outputKind.inputValue()).toBe("pdf");
  });
});
