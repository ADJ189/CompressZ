#!/usr/bin/env node
// strip-oversized-assets.mjs
//
// Cloudflare Pages rejects any single deployed file over 25MiB
// ("Pages only supports files up to 25 MiB in size"). Vite statically
// bundles onnxruntime-web's threaded+SIMD+asyncify WASM binary
// (ort-wasm-simd-threaded.asyncify-*.wasm, ~26MB) into dist/assets purely
// because it's referenced via `new URL(..., import.meta.url)` somewhere in
// onnxruntime-web's loader — regardless of whether that specific backend
// variant is ever actually selected at runtime.
//
// aiEngine.ts sets `env.backends.onnx.wasm.wasmPaths` to load onnxruntime-web's
// WASM binaries from a CDN instead of a local path, so this bundled local
// copy is always dead weight. Delete anything over the limit (with a safety
// margin) from the build output so a future dependency bump that produces a
// different/larger asset fails loudly in CI instead of silently breaking
// deployment — and so this script isn't hardcoded to one specific filename.
//
// Run automatically as part of `npm run build` (see package.json).

import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const DIST_DIR = new URL("../dist/assets", import.meta.url).pathname;
const CLOUDFLARE_PAGES_LIMIT = 25 * 1024 * 1024; // 25 MiB, Cloudflare Pages' hard per-file cap
const SAFETY_MARGIN = 1 * 1024 * 1024; // strip anything within 1MiB of the cap too
const THRESHOLD = CLOUDFLARE_PAGES_LIMIT - SAFETY_MARGIN;

async function main() {
  let entries;
  try {
    entries = await readdir(DIST_DIR);
  } catch {
    console.warn(
      `[strip-oversized-assets] ${DIST_DIR} not found, skipping (did the build produce no assets?)`,
    );
    return;
  }

  let removed = 0;
  for (const name of entries) {
    const path = join(DIST_DIR, name);
    const st = await stat(path);
    if (!st.isFile() || st.size <= THRESHOLD) continue;

    const mb = (st.size / (1024 * 1024)).toFixed(1);
    console.log(
      `[strip-oversized-assets] Removing ${name} (${mb}MiB — exceeds Cloudflare Pages' 25MiB per-file limit)`,
    );
    await unlink(path);
    removed++;
  }

  if (removed === 0) {
    console.log(
      "[strip-oversized-assets] No oversized assets found — nothing to strip.",
    );
  } else {
    console.log(
      `[strip-oversized-assets] Stripped ${removed} file(s). Make sure any code referencing them (e.g. aiEngine.ts's onnxruntime wasmPaths) loads them from a CDN instead of a local path.`,
    );
  }
}

main().catch((err) => {
  console.error("[strip-oversized-assets] Failed:", err);
  process.exit(1);
});
