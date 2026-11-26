import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PORT = 4199;
const SCREENSHOT_DIR =
  process.env.AUDIT_SCREENSHOT_DIR ??
  join(process.cwd(), "test-results", "mobile-audit");

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const distHtml = join(process.cwd(), "dist", "index.html");
  if (!existsSync(distHtml)) {
    console.error(
      "❌ Error: Production build output 'dist/index.html' not found.\nPlease run 'npm run build' before running the mobile audit."
    );
    process.exit(1);
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true });
  console.log("Saving mobile audit screenshots to:", SCREENSHOT_DIR);

  let server = null;
  let browser = null;

  try {
    console.log("Starting preview server on port", PORT);
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(PORT),
        "--strictPort",
      ],
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

    if (!started) {
      throw new Error(`Preview server failed to start on port ${PORT} within timeout.`);
    }

    browser = await chromium.launch();

    const mobileProfiles = [
      { name: "Pixel-7", device: devices["Pixel 7"] },
      { name: "iPhone-14", device: devices["iPhone 14"] },
      {
        name: "Compact-360px",
        device: {
          viewport: { width: 360, height: 740 },
          userAgent:
            "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36",
          isMobile: true,
          hasTouch: true,
        },
      },
    ];

    const routes = [
      { name: "home", path: "/" },
      { name: "pdf-suite", path: "/pdf" },
      { name: "pdf-remove-pages", path: "/pdf/remove-pages" },
      { name: "pdf-page-numbers", path: "/pdf/page-numbers" },
      { name: "pdf-nup", path: "/pdf/nup" },
      { name: "pdf-metadata", path: "/pdf/metadata" },
      { name: "compress-images", path: "/compress/images" },
      { name: "compress-pdf", path: "/compress/pdf" },
      { name: "compress-video", path: "/compress/video" },
      { name: "convert", path: "/convert" },
      { name: "settings", path: "/settings" },
    ];

    const results = [];

    for (const { name: profName, device } of mobileProfiles) {
      console.log(
        `\nTesting Profile: ${profName} (${device.viewport.width}x${device.viewport.height})`
      );
      const context = await browser.newContext({
        ...device,
        colorScheme: "dark",
      });

      const page = await context.newPage();

      for (const route of routes) {
        await page.goto(`http://127.0.0.1:${PORT}${route.path}`, {
          waitUntil: "networkidle",
        });
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
                offendingSelector = `${el.tagName.toLowerCase()}.${Array.from(
                  el.classList
                ).join(".")}`;
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

        console.log(
          `  ✓ ${route.name}: ${
            overflow.hasOverflow
              ? "⚠️ OVERFLOW (" + overflow.offendingSelector + ")"
              : "OK (no horizontal overflow)"
          }`
        );
      }

      await context.close();
    }

    console.log("\nDone! Tested", results.length, "configurations.");

    const overflowing = results.filter((r) => r.hasOverflow);
    if (overflowing.length > 0) {
      console.error(
        `\n❌ Failed: ${overflowing.length} configuration(s) exhibited horizontal overflow:\n`
      );
      for (const o of overflowing) {
        console.error(
          `  - [${o.profile}] ${o.route} (${o.viewport}): overflowed by ${
            o.docWidth - o.winWidth
          }px (offender: ${o.offendingSelector || "unknown"})\n    Screenshot: ${
            o.screenshot
          }`
        );
      }
      process.exitCode = 1;
    } else {
      console.log(
        `\n✅ All ${results.length} configurations passed with 0 horizontal overflow!`
      );
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server) {
      server.kill();
    }
  }
}

main().catch((err) => {
  console.error("Error running mobile audit:", err);
  process.exit(1);
});
