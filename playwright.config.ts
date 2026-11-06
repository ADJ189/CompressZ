import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

const PORT = 4173;
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

let hasNpm = false;
try {
  execSync(process.platform === "win32" ? "where npm" : "which npm", { stdio: "ignore" });
  hasNpm = true;
} catch {
  hasNpm = false;
}

// Optional: point at a pre-installed Chromium (e.g. offline CI / sandboxes
// where `npx --no-install playwright install chromium` can't download a
// browser). Chromium only — never pass a Chromium executable to WebKit.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const chromiumLaunch = executablePath ? { executablePath } : {};

// Node/npm is the default runtime for CI and Cloudflare Pages.
// When npm is absent (e.g. running under Deno), fallback to Deno running Vite directly.
const buildAndPreview = hasNpm
  ? `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`
  : `deno run -A node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`;

// Two opt-in suites import the real TypeScript engine modules, so they need
// Vite's dev server instead of the production preview build:
//   • BENCH=1            — `npm run bench` (image pipeline benchmark)
//   • WEBCODECS_E2E=1    — `npm run test:webcodecs` (real Mediabunny encode)
// Neither may run as part of test:e2e. The WebCodecs suite also needs network
// access to esm.sh and a browser with a working WebCodecs encoder.
const isBench = !!process.env.BENCH;
const isWebCodecsE2E = !!process.env.WEBCODECS_E2E;
const usesDevServer = isBench || isWebCodecsE2E;
const webServerCommand = process.env.PW_WEB_SERVER_CMD || (usesDevServer
  ? (hasNpm ? `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort` : `deno run -A node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${PORT} --strictPort`)
  : buildAndPreview);

const ignored = [
  ...(isBench ? [] : ["**/bench.spec.ts"]),
  ...(isWebCodecsE2E ? [] : ["**/webcodecs.spec.ts"]),
];

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ignored,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Eight local Chromium workers overloaded constrained machines and produced
  // 30s timeouts in mobile tests; two is plenty for a smoke suite this size.
  workers: process.env.CI ? 4 : 2,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], launchOptions: chromiumLaunch },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"], launchOptions: chromiumLaunch },
    },
    {
      name: "webkit-desktop",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    // Production build by default (COOP/COEP headers included). The opt-in
    // benchmark and WebCodecs suites use `vite dev` so they can import
    // src/lib modules directly. Those suites normally start their own server
    // (never reuse a production preview); PW_REUSE_SERVER=1 is an explicit
    // escape hatch for npm-less environments that started Vite manually.
    command: webServerCommand,
    url: BASE_URL,
    reuseExistingServer:
      !process.env.CI && (!usesDevServer || !!process.env.PW_REUSE_SERVER),
    timeout: 180_000,
  },
});
