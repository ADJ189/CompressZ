import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string };

// Every routed view. `ready` is a selector that must exist once it has mounted.
const ROUTES: { path: string; ready: string }[] = [
  { path: "/", ready: "#page-view .cz-workbench" },
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

/** Open Settings and switch to one of its sections. */
async function openSettingsSection(page: Page, label: string) {
  if (!(await page.locator("#settings-dialog").isVisible())) {
    await page.locator("#settings-btn").click();
  }
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await page
    .locator("#settings-nav")
    .getByRole("button", { name: label, exact: true })
    .click();
  return page.locator("#settings-dialog");
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
  await expect(page.locator("#page-view .cz-workbench").first()).toBeAttached();
});

test("quick actions navigate client-side and tab state follows", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('#page-view .cz-wb-quick__card[data-nav="compress/pdf"]')
    .click();
  await expect(page).toHaveURL(/\/compress\/pdf$/);
  await expect(
    page.locator('[data-tab][data-nav="compress/pdf"]'),
  ).toHaveClass(/active/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#page-view .cz-workbench").first()).toBeAttached();
});

test("home search filters tools and Enter opens the first match", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/");
  const workbench = page.locator("#page-view .cz-workbench");
  await expect(workbench).toBeVisible();

  const search = page.locator("#wb-search");
  await search.fill("ocr");

  const visibleCards = page.locator(
    "#wb-all .cz-wb-all__card:not([hidden])",
  );
  await expect(visibleCards).toHaveCount(1);
  await expect(visibleCards.first()).toContainText("PDF OCR");
  // Quick actions are filtered by the same query, so unrelated ones hide too.
  await expect(
    page.locator('#page-view .cz-wb-quick__card[data-nav="compress/pdf"]'),
  ).toBeHidden();

  await search.press("Enter");
  await expect(page).toHaveURL(/\/compress\/ocr$/);
  await expect(page.locator("#page-view .tool-wrap")).toBeVisible();
  expect(problems).toEqual([]);
});

test("pinning and recent tools survive navigation", async ({ page }) => {
  await page.goto("/");
  const imagesCard = page.locator(
    '#page-view .cz-wb-all__card[data-nav="compress/images"]',
  );
  await imagesCard.locator("[data-wb-fav]").click();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cz-favourite-tools")))
    .toContain("compress/images");
  await expect(
    page.locator('#wb-pinned .cz-wb-chip.is-fav', { hasText: "Images" }),
  ).toBeVisible();

  await page
    .locator('#page-view .cz-wb-quick__card[data-nav="compress/pdf"]')
    .click();
  await expect(page).toHaveURL(/\/compress\/pdf$/);
  await page.goBack();

  await expect(
    page.locator('#wb-pinned .cz-wb-chip.is-fav', { hasText: "Images" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cz-recent-tools")))
    .toContain("compress/pdf");
  await expect(
    page.locator('#wb-pinned .cz-wb-chip.is-recent', { hasText: "PDF" }),
  ).toBeVisible();
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

test("system theme follows the OS and can be pinned to light/dark", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");

  // Playwright's Firefox build does not apply `prefers-color-scheme`
  // emulation on all platforms (matchMedia still reports the real OS value).
  // Detect that instead of asserting a theme the browser never received; the
  // live-switch half of this test still runs on Chromium and WebKit.
  const emulationWorks = await page.evaluate(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );

  const dialog = await openSettingsSection(page, "Appearance");
  await dialog.getByRole("button", { name: /^System \(/ }).click();

  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe(
    "system",
  );

  if (emulationWorks) {
    await expect(html).toHaveAttribute("data-theme", "dark");

    // A live OS switch must re-resolve without a reload.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveAttribute("data-theme", "light");
  } else {
    const resolved = await page.evaluate(() =>
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
    await expect(html).toHaveAttribute("data-theme", resolved);
  }

  // Picking a side opts out of `system` and survives a reload.
  await dialog.getByRole("button", { name: "Dark", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
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

test("Settings → General reports the real app version", async ({ page }) => {
  await page.goto("/");
  const dialog = await openSettingsSection(page, "General");
  await expect(
    dialog.locator(".device-info-row", { hasText: "Version" }),
  ).toContainText(pkg.version);
});

test("AI settings expose model tier and inference backend", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/");
  const dialog = await openSettingsSection(page, "AI engine");

  await expect(dialog.getByText(/AI engine — local/i)).toBeVisible();
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

test("Execution diagnostics follow GPU and manual concurrency choices", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/");
  let dialog = await openSettingsSection(page, "Performance");

  // The Auto label must show what Auto would actually use, even while a
  // manual limit is selected. It must not echo the selected manual value.
  const concurrency = dialog.getByRole("group", {
    name: "Files processed at once (batches)",
  });
  const auto = concurrency.getByRole("button", { name: /^Auto \(/ });
  const autoLabel = await auto.textContent();
  await concurrency.getByRole("button", { name: "4", exact: true }).click();
  await expect(auto).toHaveText(autoLabel!);
  await expect(auto).not.toHaveText("Auto (4)");

  // The image path must reflect the Images GPU toggle, not just browser
  // support. Resolve the expected label from the same feature tests the app
  // uses so this stays honest on runners with and without WebGL2.
  const caps = await page.evaluate(() => ({
    webgl2: !!document.createElement("canvas").getContext("webgl2"),
    offscreen: typeof OffscreenCanvas !== "undefined",
  }));
  const canvasOnly = caps.offscreen
    ? "Canvas/OffscreenCanvas only (no WebGL2 resize)"
    : "DOM canvas only";

  const imageSwitch = dialog.getByRole("switch", {
    name: "GPU acceleration for Images",
  });
  if ((await imageSwitch.getAttribute("aria-checked")) === "true") {
    await imageSwitch.click();
  }

  dialog = await openSettingsSection(page, "Diagnostics");
  const imagePath = () =>
    dialog
      .locator(".device-info-row", { hasText: "Image path" })
      .locator(".device-info-val");
  await expect(imagePath()).toHaveText(canvasOnly);
  await expect(
    dialog
      .locator(".device-info-row", { hasText: "Batch concurrency" })
      .locator(".device-info-val"),
  ).toHaveText("4 files at once");
  await expect(
    dialog
      .locator(".device-info-row", { hasText: "Video path" })
      .locator(".device-info-val"),
  ).toContainText("WebCodecs + Mediabunny");
  await expect(
    dialog
      .locator(".device-info-row", { hasText: "Image quality guard" })
      .locator(".device-info-val"),
  ).toContainText("never silently rescales");

  if (caps.webgl2) {
    dialog = await openSettingsSection(page, "Performance");
    await dialog
      .getByRole("switch", { name: "GPU acceleration for Images" })
      .click();
    dialog = await openSettingsSection(page, "Diagnostics");
    await expect(imagePath()).toHaveText(
      "Canvas/OffscreenCanvas + WebGL2 resize",
    );
  }

  expect(problems).toEqual([]);
});

test("Resource Guard status is live and honest about estimates", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#wb-queue")).toContainText("Idle");

  await page.locator('.cz-wb-panel__head [data-nav="settings"]').click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await page
    .locator("#settings-nav")
    .getByRole("button", { name: "Performance", exact: true })
    .click();

  const status = page.locator('[data-testid="resource-status"]');
  await expect(status).toBeVisible();
  await expect(status).toContainText("0 running");
  await expect(status).toContainText("admission:");
  await expect(status).toContainText("not a memory meter");
});

test.describe("responsive layout", () => {
  for (const width of [320, 360, 390, 420, 768, 1024, 1280, 1440]) {
    test(`home does not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.locator("#page-view .cz-workbench")).toBeVisible();

      const overflow = await page.evaluate(() => {
        const view = document.querySelector<HTMLElement>("#page-view");
        return view ? view.scrollWidth - view.clientWidth : -1;
      });
      expect(overflow).toBeLessThanOrEqual(1);

      const box = await page.locator("#page-view .cz-workbench").boundingBox();
      expect(box!.width).toBeLessThanOrEqual(width);
    });
  }
});

test("Images suggestion sorts files naturally instead of 1, 10, 2", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/compress/images");
  await expect(page.locator("#page-view .tool-wrap")).toBeVisible();

  const files = ["page10.png", "page2.png", "page1.png"].map((name) => ({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(`fake-image-bytes-${name}`),
  }));
  await page.locator('#dz-mount input[type="file"]').setInputFiles(files);

  const notice = page.locator("#rec-mount .cz-recommendation");
  await expect(notice).toBeVisible();
  await expect(notice.locator(".cz-recommendation__title")).toHaveText(
    "Sort by filename",
  );

  // One primary suggestion at a time: dismiss/apply controls are not stacked.
  await expect(notice.locator(".cz-recommendation--primary")).toHaveCount(1);

  await notice.getByRole("button", { name: "Sort naturally" }).click();

  const names = page.locator("#file-list .file-card .fc-name");
  await expect(names).toHaveCount(3);
  await expect(names.nth(0)).toHaveText("page1.png");
  await expect(names.nth(1)).toHaveText("page2.png");
  await expect(names.nth(2)).toHaveText("page10.png");

  // Once the order is natural the suggestion is gone rather than repeating.
  await expect(notice).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("dismissed suggestions stay dismissed and can be cleared", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/compress/images");
  await page.locator("#fmt-sel").selectOption("image/png");

  await page.locator('#dz-mount input[type="file"]').setInputFiles({
    name: "holiday.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-jpeg-bytes"),
  });

  const notice = page.locator("#rec-mount .cz-recommendation");
  await expect(notice).toBeVisible();
  await expect(notice.locator(".cz-recommendation__title")).toHaveText(
    "Use WebP instead of PNG",
  );
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("cz-recommendations-v1");
        return raw ? (JSON.parse(raw) as string[]).length : 0;
      }),
    )
    .toBe(1);

  // Reload: the same rule + action choice must not come back.
  await page.reload();
  await page.locator("#fmt-sel").selectOption("image/png");
  await page.locator('#dz-mount input[type="file"]').setInputFiles({
    name: "holiday.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-jpeg-bytes"),
  });
  await expect(page.locator("#file-list .file-card")).toHaveCount(1);
  await expect(page.locator("#rec-mount .cz-recommendation")).toHaveCount(0);

  // Settings can forget dismissals, which makes them eligible again.
  const dialog = await openSettingsSection(page, "Suggestions");
  await expect(dialog.getByText(/1 dismissed suggestion/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "Clear dismissed suggestions" })
    .click();
  await expect(dialog.getByText(/0 dismissed suggestions/)).toBeVisible();
  expect(problems).toEqual([]);
});

const BASE_URL = "http://localhost:4173";

test("every Settings section opens with its own content", async ({ page }) => {
  await page.goto("/");
  await page.locator("#settings-btn").click();
  const dialog = page.locator("#settings-dialog");
  await expect(dialog).toBeVisible();

  const sections: [string, RegExp][] = [
    ["General", /About CompressZ/],
    ["Appearance", /Theme/],
    ["Performance", /Adaptive Resource Guard/],
    ["AI engine", /AI engine — local/],
    ["Suggestions", /Contextual suggestions/],
    ["Compression", /engine/i],
    ["Privacy & data", /Stored in this browser/],
    ["Diagnostics", /This Device|Image path|Capabilities/i],
  ];

  await expect(page.locator("#settings-nav .cz-settings__nav-btn")).toHaveCount(
    sections.length,
  );

  for (const [label, text] of sections) {
    await page
      .locator("#settings-nav")
      .getByRole("button", { name: label, exact: true })
      .click();
    await expect(
      page.locator("#settings-nav").getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator("#settings-panel")).toContainText(text);
  }
});

test("Escape returns focus to the Settings trigger", async ({ page }) => {
  await page.goto("/");
  await page.locator("#settings-btn").click();
  await expect(page.locator("#settings-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-dialog")).toBeHidden();
  await expect(page.locator("#settings-btn")).toBeFocused();
});

test("legacy performanceMode migrates to Maximum resource mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "cz-settings-v2",
      JSON.stringify({ performanceMode: "powerful" }),
    );
  });
  await page.goto("/");
  const dialog = await openSettingsSection(page, "Performance");
  await expect(
    dialog.getByRole("button", { name: "Maximum", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // The legacy key is kept for migration only; it must not add a second control.
  await expect(
    dialog.locator('button[data-id="powerful"]'),
  ).toHaveCount(0);
});

test("destructive Settings actions need a second, explicit click", async ({
  page,
}) => {
  await page.goto("/");
  let dialog = await openSettingsSection(page, "Performance");
  await dialog.getByRole("button", { name: "Maximum", exact: true }).click();
  expect(
    await page.evaluate(() => {
      const raw = localStorage.getItem("cz-settings-v2");
      return raw ? JSON.parse(raw).resourceMode : null;
    }),
  ).toBe("maximum");

  dialog = await openSettingsSection(page, "General");
  await dialog.getByRole("button", { name: "Reset all settings" }).click();
  const confirm = dialog.getByRole("button", {
    name: "Confirm reset — click again",
  });
  await expect(confirm).toBeVisible();

  // Arming the button must not have reset anything yet.
  expect(
    await page.evaluate(() => {
      const raw = localStorage.getItem("cz-settings-v2");
      return raw ? JSON.parse(raw).resourceMode : null;
    }),
  ).toBe("maximum");

  await confirm.click();
  await expect(
    page.locator("#toast").getByText("All settings reset to defaults"),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const raw = localStorage.getItem("cz-settings-v2");
      return raw ? JSON.parse(raw).resourceMode : null;
    }),
  ).toBe("auto");
});

test("local-first: interactions never send file data or non-GET requests", async ({
  page,
}) => {
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  const writes: string[] = [];
  const externalBodies: string[] = [];

  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      writes.push(`${method} ${url}`);
    }
    if (!url.startsWith(BASE_URL)) {
      const body = request.postData();
      if (body && body.length) externalBodies.push(`${url} (${body.length} bytes)`);
    }
  });

  await page.goto("/");
  await page.locator("#wb-search").fill("pdf");
  await page.locator("#wb-search").press("Enter");
  await expect(page).toHaveURL(/\/compress\/pdf$/);

  await page.locator("#settings-btn").click();
  await page
    .locator("#settings-nav")
    .getByRole("button", { name: "Privacy & data", exact: true })
    .click();
  await page.keyboard.press("Escape");

  await page.goto("/compress/images");
  await page.locator('#dz-mount input[type="file"]').setInputFiles({
    name: "private-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image-bytes"),
  });
  await expect(page.locator("#file-list .file-card")).toHaveCount(1);

  expect(writes).toEqual([]);
  expect(externalBodies).toEqual([]);
});

test("mobile shell keeps the tab bar and a two-column quick grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#page-view .cz-workbench")).toBeVisible();
  await expect(page.locator("#tabbar")).toBeVisible();

  const columns = await page
    .locator("#page-view .cz-wb-quick")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(2);

  // The header controls stay on screen at phone width.
  for (const id of ["#settings-btn", "#theme-btn"]) {
    const box = await page.locator(id).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
  }
});

test.describe("tool and Settings overflow on phones", () => {
  for (const width of [320, 390]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/compress/images");
      await expect(page.locator("#page-view .tool-wrap")).toBeVisible();

      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageOverflow).toBeLessThanOrEqual(1);

      await page.locator("#settings-btn").click();
      await expect(page.locator("#settings-dialog")).toBeVisible();
      const dialogOverflow = await page
        .locator("#settings-panel")
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(dialogOverflow).toBeLessThanOrEqual(1);

      const navOverflow = await page
        .locator("#settings-nav")
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      // The section nav is allowed to scroll horizontally on phones, but it
      // must not widen the dialog.
      expect(navOverflow).toBeGreaterThanOrEqual(0);
    });
  }
});

test("Images suggestion Undo restores the original order", async ({ page }) => {
  await page.goto("/compress/images");
  await expect(page.locator("#page-view .tool-wrap")).toBeVisible();

  const files = ["page10.png", "page2.png", "page1.png"].map((name) => ({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(`fake-image-bytes-${name}`),
  }));
  await page.locator('#dz-mount input[type="file"]').setInputFiles(files);

  const names = page.locator("#file-list .file-card .fc-name");
  await expect(names.nth(0)).toHaveText("page10.png");

  const notice = page.locator("#rec-mount .cz-recommendation");
  await notice.getByRole("button", { name: "Sort naturally" }).click();
  await expect(names.nth(0)).toHaveText("page1.png");

  const undo = page.locator("#toast .cz-toast-action");
  await expect(undo).toHaveText("Undo");
  await undo.click();

  await expect(names.nth(0)).toHaveText("page10.png");
  await expect(names.nth(1)).toHaveText("page2.png");
  await expect(names.nth(2)).toHaveText("page1.png");
  await expect(page.locator("#toast .cz-toast-action")).toHaveCount(0);
  await expect(notice).toBeVisible();
});

test("Images → PDF suggestion sorts pages and Undo restores them", async ({
  page,
}) => {
  await page.goto("/compress/images-to-pdf");
  await expect(page.locator("#page-view .tool-wrap")).toBeVisible();

  const files = ["scan10.png", "scan2.png", "scan1.png"].map((name) => ({
    name,
    mimeType: "image/png",
    buffer: Buffer.from(`fake-image-bytes-${name}`),
  }));
  await page.locator('#dz-mount input[type="file"]').setInputFiles(files);

  const notice = page.locator("#itp-rec .cz-recommendation");
  await expect(notice.locator(".cz-recommendation__title")).toHaveText(
    "Sort by filename",
  );
  await notice.getByRole("button", { name: "Sort naturally" }).click();

  const names = page.locator("#itp-list .file-card .fc-name");
  await expect(names.nth(0)).toHaveText(/scan1\.png$/);
  await expect(names.nth(1)).toHaveText(/scan2\.png$/);
  await expect(names.nth(2)).toHaveText(/scan10\.png$/);

  await page.locator("#toast .cz-toast-action").click();
  await expect(names.nth(0)).toHaveText(/scan10\.png$/);
  await expect(names.nth(1)).toHaveText(/scan2\.png$/);
  await expect(names.nth(2)).toHaveText(/scan1\.png$/);
});

test("Images → PDF page-size suggestion applies Auto and can be undone", async ({
  page,
}) => {
  await page.goto("/compress/images-to-pdf");
  await expect(page.locator("#page-view .tool-wrap")).toBeVisible();

  await page.locator("#itp-sizes .pdf-preset", { hasText: "A4" }).click();
  await expect(
    page.locator("#itp-sizes .pdf-preset", { hasText: "A4" }),
  ).toHaveAttribute("aria-checked", "true");

  await page.locator('#dz-mount input[type="file"]').setInputFiles({
    name: "single.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image-bytes"),
  });

  const notice = page.locator("#itp-rec .cz-recommendation");
  await expect(notice.locator(".cz-recommendation__title")).toHaveText(
    "Use Auto page size",
  );
  await notice.getByRole("button", { name: "Use Auto" }).click();
  await expect(
    page.locator("#itp-sizes .pdf-preset", { hasText: "Auto" }),
  ).toHaveAttribute("aria-checked", "true");

  await page.locator("#toast .cz-toast-action").click();
  await expect(
    page.locator("#itp-sizes .pdf-preset", { hasText: "A4" }),
  ).toHaveAttribute("aria-checked", "true");
});

