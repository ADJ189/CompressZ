import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// Optional: point at a pre-installed Chromium (e.g. offline CI / sandboxes
// where `npx --no-install playwright install chromium` can't download a
// browser). Chromium only — never pass a Chromium executable to WebKit.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const chromiumLaunch = executablePath ? { executablePath } : {};

// Node/npm is the only supported runtime for the build, preview, and tests.
// CI and Cloudflare Pages both use the npm scripts in package.json.
const buildAndPreview = `npm run build && npm run preview -- --port ${PORT} --strictPort`;

export default defineConfig({
  testDir: "./e2e",
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
  ],
  webServer: {
    // Serve the real production build (COOP/COEP headers included).
    command: buildAndPreview,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
