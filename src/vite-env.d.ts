/**
 * The onnxruntime-web version actually installed (read from
 * node_modules/onnxruntime-web/package.json and injected via Vite's
 * `define`, see vite.config.ts) — used to point onnxruntime-web's WASM
 * loading at the matching build on a CDN instead of bundling it locally.
 * See src/lib/aiEngine.ts.
 */
declare const __ORT_VERSION__: string;
