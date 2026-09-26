import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Read the actually-installed onnxruntime-web version so aiEngine.ts can
// point its CDN-hosted WASM binaries at the exact matching build (see
// aiEngine.ts and scripts/strip-oversized-assets.mjs for why). A plain fs
// read of the package.json — not a module import — because onnxruntime-web's
// "exports" map doesn't expose package.json as an importable subpath.
const onnxPkgPath = fileURLToPath(
  new URL("./node_modules/onnxruntime-web/package.json", import.meta.url),
);
const ortVersion = JSON.parse(readFileSync(onnxPkgPath, "utf8"))
  .version as string;

export default defineConfig({
  root: ".",
  publicDir: "public",
  define: {
    __ORT_VERSION__: JSON.stringify(ortVersion),
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
