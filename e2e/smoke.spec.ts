import { test, expect, type Page } from "@playwright/test";

// Every routed view. `ready` is a selector that must exist once it has mounted.
const ROUTES: { path: string; ready: string }[] = [
  { path: "/", ready: "#page-view .htc" },
  { path: "/compress/images", ready: "#page-view .tool-wrap" },
  { path: "/compress/pdf", ready: "#page-view .tool-wrap" },
  { path: "/compress/merge-pdf", ready: "#page-view .tool-wrap" },
  { path: "/compress/images-to-pdf", ready: "#page-view .tool-wrap" },
  { path: "/compress/video", ready: "#page-view .tool-wrap" },
  { path: "/compress/audio", ready: "#page-view .tool-wrap" },
  { path: "/compress/gif", ready: "#page-view .tool-wrap" },
  { path: "/compress/ocr", ready: "#page-view .tool-wrap" },
  { path: "/convert", ready: "#page-view .tool-wrap" },
  { path: "/about", ready: "#page-view .page-enter" },
  { path: "/docs", ready: "#page-view .page-enter" },
  { path: "/privacy", ready: "#page-view .page-enter" },
];

/**
 * Collects uncaught exceptions + console errors that originate from the app.
 * External hosts (Google Fonts, jsDelivr, esm.sh) are stubbed out so tests are
 * hermetic and don't depend on — or get noisy from — network access.
 */
async function watch(page: Page) {
  const problems: string[] = [];
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Aborted third-party requests surface as generic load failures.
    if (/Failed to load resource|net::ERR_/i.test(t)) return;
    problems.push(`console.error: ${t}`);
  });
  return problems;
}

test.describe("deep links render without errors", () => {
  for (const { path, ready } of ROUTES) {
    test(path, async ({ page }) => {
      const problems = await watch(page);
      await page.goto(path);
      await expect(page.locator(ready).first()).toBeAttached({
        timeout: 15_000,
      });
      await expect(page.locator(".page-loading")).toHaveCount(0);
      expect(problems).toEqual([]);
    });
  }
});

test("document title and cross-origin isolation (COOP/COEP)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/CompressZ/);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});

test("splash overlay is removed from the click path", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#splash")).toHaveClass(/done/, { timeout: 5_000 });
});

test("unknown route falls back to home", async ({ page }) => {
  await page.goto("/definitely/not/a/route");
  await expect(page.locator("#page-view .htc").first()).toBeAttached();
});

test("tool cards navigate client-side and tab state follows", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('#page-view .htc[data-nav="compress/pdf"]').click();
  await expect(page).toHaveURL(/\/compress\/pdf$/);
  await expect(
    page.locator('[data-tab][data-nav="compress/pdf"]'),
  ).toHaveClass(/active/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#page-view .htc").first()).toBeAttached();
});

test("theme toggle flips and persists across reload", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  await page.locator("#theme-btn").click();
  const after = await html.getAttribute("data-theme");
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", after!);
});

test("settings dialog opens and closes with Escape", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/");
  await page.locator("#settings-btn").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-dialog")).toBeHidden();
  expect(problems).toEqual([]);
});

test("legacy /settings link opens the dialog on home", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("Back after /settings is not a redirect trap", async ({ page }) => {
  await page.goto("/about");
  await page.goto("/settings");
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
});

test("AI Engine settings expose model tier and inference backend", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/");
  await page.locator("#settings-btn").click();

  const dialog = page.locator("#settings-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("AI Engine — Local")).toBeVisible();
  await expect(dialog.getByText("Inference backend")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "WebGPU first" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "CPU (WASM)" })).toBeVisible();

  // Picking the CPU path must persist the explicit preference (not just look
  // selected), so a later session does not silently re-enable WebGPU.
  await dialog.getByRole("button", { name: "CPU (WASM)" }).click();
  const backend = await page.evaluate(() => {
    const raw = localStorage.getItem("cz-settings-v2");
    return raw ? JSON.parse(raw).ai?.backend : null;
  });
  expect(backend).toBe("wasm");
  expect(problems).toEqual([]);
});
