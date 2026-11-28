import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Read the installed onnxruntime-web version so aiEngine.ts can
// point its CDN-hosted WASM binaries at the exact matching build.
let ortVersion = "1.18.0";
try {
  const onnxPkgPath = fileURLToPath(
    new URL("./node_modules/onnxruntime-web/package.json", import.meta.url),
  );
  ortVersion =
    (JSON.parse(readFileSync(onnxPkgPath, "utf8")).version as string) ||
    ortVersion;
} catch {
  // Fallback if node_modules is not present
}

// App version for Settings → General. The fallback only matters when
// package.json cannot be read; keep it in sync with package.json's version.
let appVersion = "1.15.7";
try {
  appVersion =
    (JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./package.json", import.meta.url)),
        "utf8",
      ),
    ).version as string) || appVersion;
} catch {
  // Fallback if package.json read fails
}

// Content-Security-Policy. `public/_headers` ships the enforcing copy to
// Cloudflare Pages; the dev server sends the same policy as Report-Only so a
// violation shows up in the console without blocking HMR, and `vite preview`
// enforces it so the built bundle can be checked before deploy.
// `tests/securityCsp.test.ts` asserts the two copies stay identical.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://esm.sh",
  "worker-src 'self' blob: https://cdn.jsdelivr.net",
  "child-src 'self' blob:",
  "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://esm.sh https://tessdata.projectnaptha.com https://paddlejs.bj.bcebos.com https://huggingface.co https://cdn-lfs.huggingface.co https://fonts.googleapis.com https://fonts.gstatic.com https://*.ingest.us.sentry.io https://*.sentry.io",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob: data:",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [svelte()],
  define: {
    __ORT_VERSION__: JSON.stringify(ortVersion),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "dist",
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Content-Security-Policy-Report-Only": CSP,
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Content-Security-Policy": CSP,
    },
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
});
