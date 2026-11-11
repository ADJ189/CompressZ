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

// App version for Settings → General.
let appVersion = "1.14.1";
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
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
});
