import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const PORT = 4199;
const SCREENSHOT_DIR = "C:/Users/user/.gemini/antigravity/brain/a4d72f61-95d7-46e0-9dfe-2d91b98fe29b/screenshots";

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  console.log("Starting preview server on port", PORT);
  const server = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { stdio: "pipe" }
  );

  let started = false;
  server.stdout.on("data", (d) => {
    const msg = d.toString();
    if (msg.includes("Local:") || msg.includes("http://")) started = true;
  });

  for (let i = 0; i < 40; i++) {
    if (started) break;
    await wait(200);
  }

  const browser = await chromium.launch();

  const mobileProfiles = [
    { name: "Pixel-7", device: devices["Pixel 7"] },
    { name: "iPhone-14", device: devices["iPhone 14"] },
    { name: "Compact-360px", device: { viewport: { width: 360, height: 740 }, userAgent: "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36", isMobile: true, hasTouch: true } },
  ];

  const routes = [
    { name: "home", path: "/" },
    { name: "pdf-suite", path: "/pdf" },
    { name: "pdf-remove-pages", path: "/pdf/remove-pages" },
    { name: "compress-images", path: "/compress/images" },
    { name: "compress-pdf", path: "/compress/pdf" },
    { name: "compress-video", path: "/compress/video" },
    { name: "convert", path: "/convert" },
    { name: "settings", path: "/settings" },
  ];

  const results = [];

  for (const { name: profName, device } of mobileProfiles) {
    console.log(`\nTesting Profile: ${profName} (${device.viewport.width}x${device.viewport.height})`);
    const context = await browser.newContext({
      ...device,
      colorScheme: "dark",
    });

    const page = await context.newPage();

    for (const route of routes) {
      await page.goto(`http://127.0.0.1:${PORT}${route.path}`, { waitUntil: "networkidle" });
      await wait(300);

      // Check horizontal overflow (blowout)
      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        const bodyWidth = document.body.scrollWidth;
        const hasOverflow = docWidth > winWidth || bodyWidth > winWidth;
        
        // Find offending element if any
        let offendingSelector = null;
        if (hasOverflow) {
          const all = document.querySelectorAll("*");
          for (const el of all) {
            const rect = el.getBoundingClientRect();
            if (rect.right > winWidth + 2) {
              offendingSelector = `${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".")}`;
              break;
            }
          }
        }
        return {
          hasOverflow,
          docWidth,
          winWidth,
          offendingSelector,
        };
      });

      const shotPath = join(SCREENSHOT_DIR, `${profName}-${route.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });

      results.push({
        profile: profName,
        route: route.path,
        viewport: `${device.viewport.width}x${device.viewport.height}`,
        hasOverflow: overflow.hasOverflow,
        docWidth: overflow.docWidth,
        winWidth: overflow.winWidth,
        offendingSelector: overflow.offendingSelector,
        screenshot: shotPath,
      });

      console.log(`  ✓ ${route.name}: ${overflow.hasOverflow ? "⚠️ OVERFLOW (" + overflow.offendingSelector + ")" : "OK (no horizontal overflow)"}`);
    }

    await context.close();
  }

  await browser.close();
  server.kill();

  console.log("\nDone! Tested", results.length, "configurations.");
}

main().catch((err) => {
  console.error("Error running mobile audit:", err);
  process.exit(1);
});
