import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// Optional: point at a pre-installed Chromium (e.g. offline CI / sandboxes
// where `npx --no-install playwright install chromium` can't download a browser).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const launchOptions = executablePath ? { executablePath } : {};

// This project's canonical CI runner is Node/npm (see .github/workflows).
// When the suite is launched through Deno locally (`deno task test:e2e`),
// `globalThis.Deno` exists and the Deno tasks build/serve the app instead.
const isDenoRun = !!(globalThis as { Deno?: unknown }).Deno;
const buildAndPreview = isDenoRun
  ? `deno task build && deno task preview --port ${PORT} --strictPort`
  : `npm run build && npm run preview -- --port ${PORT} --strictPort`;

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
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], launchOptions },
    },
  ],
  webServer: {
    // Serve the real production build (COOP/COEP headers included).
    // Node/npm is the GitHub CI path; Deno is supported for local runs.
    command: buildAndPreview,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
