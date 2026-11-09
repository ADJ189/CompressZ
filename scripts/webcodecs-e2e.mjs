#!/usr/bin/env node
/**
 * Opt-in real-encode integration runner.
 *
 *   npm run test:webcodecs                       # Chromium desktop (default)
 *   npm run test:webcodecs -- --project=webkit-desktop
 *
 * Sets WEBCODECS_E2E=1, which makes playwright.config.ts include
 * `e2e/webcodecs.spec.ts` (excluded from normal runs), switch the web server to
 * `vite dev` so the spec can import the real engine module, and disable server
 * reuse. The suite needs network access to esm.sh for the lazy Mediabunny
 * import, plus a browser with a working WebCodecs encoder; it skips itself when
 * the browser falls back to FFmpeg instead.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);

const userArgs = process.argv.slice(2);
const hasProject = userArgs.some((arg) => arg.startsWith("--project"));
const args = [
  "test",
  "e2e/webcodecs.spec.ts",
  ...(hasProject ? [] : ["--project=chromium-desktop"]),
  ...userArgs,
];

const child = spawn(process.execPath, [cli, ...args], {
  stdio: "inherit",
  env: { ...process.env, WEBCODECS_E2E: "1" },
});

child.on("error", (error) => {
  console.error(`[webcodecs] failed to start Playwright: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[webcodecs] Playwright exited on signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
