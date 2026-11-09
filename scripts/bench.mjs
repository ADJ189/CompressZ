#!/usr/bin/env node
/**
 * Opt-in benchmark runner.
 *
 *   npm run bench                          # Chromium desktop (default)
 *   npm run bench -- --project=webkit-desktop
 *
 * Sets BENCH=1, which makes playwright.config.ts ignore the benchmark in
 * normal runs, include it now, and serve the app with `vite dev` so the spec
 * can import the real TypeScript engine modules. Results are written to
 * bench-results/ (gitignored) and echoed as a table.
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
  "e2e/bench.spec.ts",
  ...(hasProject ? [] : ["--project=chromium-desktop"]),
  ...userArgs,
];

const child = spawn(process.execPath, [cli, ...args], {
  stdio: "inherit",
  env: { ...process.env, BENCH: "1" },
});

child.on("error", (error) => {
  console.error(`[bench] failed to start Playwright: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[bench] Playwright exited on signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
