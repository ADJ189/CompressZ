# AGENTS.md — CompressZ contributor & agent guide

This file is the fast path for anyone (human or AI) changing CompressZ. It
records the engine invariants, the settings model, privacy constraints, and
the exact verification commands. **Read this before editing engine code or
user-facing claims.** When this file and the code disagree, the code wins —
then fix this file in the same change.

## What CompressZ is

CompressZ is a client-side, no-backend file utility: it compresses images,
PDFs, video, audio and GIFs; converts between media/office/PDF formats; runs
OCR on scanned PDFs; and optionally classifies images locally to tag them and
sort by predicted label. Everything runs in the browser through Canvas,
WebAssembly, and Web platform APIs. There is no server that receives files,
no analytics, and no cookies.

It is a fork of [CompressF](https://github.com/ADJ189/CompressF). The deployed
site is <https://compressz.pages.dev>; the repo lives at
<https://github.com/ADJ189/compressz>.

## Quick start (Deno is the supported runner)

Node is **not** required. Deno 2.9+ runs the existing Vite/TypeScript/ESLint/
Playwright toolchain via `npm:` specifiers declared in `deno.json`.

```bash
deno install                 # install npm deps from package.json
deno task dev                # http://localhost:5173
deno task build              # dist/ + strip >25 MiB assets
deno task preview            # serve dist/
deno task typecheck          # tsc --noEmit
deno task lint               # ESLint (0 errors expected; warnings tolerated)
deno task test:e2e           # Playwright, desktop + mobile Chrome
deno task lighthouse         # optional Lighthouse CI
```

One-time browser install for e2e:

```bash
deno run -A npm:@playwright/test/cli install chromium
```

`package.json` keeps parallel npm scripts for Cloudflare Pages and for
contributors who prefer npm; CI uses Deno. Do not let the two drift: if you
add a task, add it to both `deno.json` and `package.json`.

### Verification checklist (run all four before calling work done)

1. `deno task typecheck` — must be clean.
2. `deno task lint` — must be **0 errors**. The repo currently has ~100
   pre-existing `@typescript-eslint/no-explicit-any` warnings; do not add new
   ones, but do not treat the existing count as failure.
3. `deno task build` — must succeed. The log should show
   `[strip-oversized-assets] Removing ort-wasm-simd-threaded.asyncify-*.wasm`;
   `dist/assets` must contain **no file ≥ 24 MiB** (Cloudflare Pages rejects
   any single file over 25 MiB).
4. `deno task test:e2e` — 42 tests (21 per browser project) must pass. The
   config caps workers at 2 locally / 4 in CI because 8 Chromium workers caused
   timeout flakes on constrained machines. It builds and serves `dist/` itself.

If a change affects only docs, 1–2 are still required; run e2e when routed UI,
settings, routing, or privacy copy changes.

## Repository map

```
index.html                 app shell + all page templates + in-app docs/privacy
src/main.ts                bootstrap, router mount, header/tabbar/settings wiring
src/router.ts              History API router
src/store.ts               persisted per-tool state (localStorage-backed)
src/components.ts          shared DOM helpers (file cards, tags, progress)
src/toast.ts               toasts
src/style.css              one global stylesheet, section banners with ═══
src/lib/                   engines, one file per format
  settings.ts              cz-settings-v2 + resolveExecutionProfile()
  platform.ts              device detection + performance-tier recommendation
  gpu.ts / webgl.ts        shared canvas helpers + one shared WebGL2 context
  aiEngine.ts              transformers.js classifier, WebGPU→WASM fallback
  imageDecode.ts           native decode + lazy heic2any fallback
  batch.ts                 concurrency-limited batch runner
  thumb.ts                 cached preview thumbnails
  ffmpeg.ts                FFmpeg.wasm singleton + single progress handler
  pdfLibs.ts               cached pdf.js / pdf-lib loaders
  motion.ts                anime.js wrappers honoring reduced motion
  compressImage.ts / compressPdf.ts / compressVideo.ts / compressAudio.ts
  compressGif.ts / optimizeSvg.ts / convertMedia.ts / convertOffice.ts
  convertPdf.ts / imagesToPdf.ts / mergePdf.ts / zip.ts / types.ts
src/pages/                 one file per route: images, pdf, video, audio, gif,
                           ocr, convert, imagesToPdf, mergePdf, settings
src/components/            standalone React component library (unused by app)
e2e/smoke.spec.ts          Playwright smoke tests
scripts/strip-oversized-assets.mjs  Cloudflare 25 MiB guard
```

Heavy runtime engines (FFmpeg.wasm, PDF.js, pdf-lib, Tesseract.js,
PaddleOCR/Paddle.js, mammoth.js, html2canvas, heic2any) are **not** npm
dependencies. They are dynamically loaded from CDNs at first use, inside the
relevant `lib/*.ts` file, so the initial bundle stays small. Keep that
pattern for new heavy libraries. Real npm dependencies are intentionally few:
`@huggingface/transformers`, `animejs`, plus build/test tooling.

## Engine truths (do not overstate these)

These are the claims the UI, README, Settings diagnostics, and changelog must
match. Several were previously wrong; don't regress them.

### Images

- Canvas 2D; `OffscreenCanvas` when available; optional WebGL2 texture-draw
  resize (`resizeViaWebGL`) with silent Canvas2D fallback.
- GPU acceleration for images means **WebGL2 resize + `desynchronized` 2D
  hint**, nothing else.
- HEIC/HEIF: native decode first; `heic2any` (lazy CDN) only when native
  decode fails.
- Default output is WebP at quality **82** (`settings.ts`), not 92.
- EXIF/GPS is stripped as a side effect of canvas re-encoding; say so.

### PDF

- Structural strategy (Low/Recommended): walk XObjects, downscale embedded
  images, re-encode JPEG in place; text/vectors untouched.
- Canvas strategy (Extreme, encrypted-PDF fallback): render pages with PDF.js
  (`colorSpace: 'srgb'`, `intent: 'print'`), assemble with pdf-lib.
- Presets: Low 220 DPI/0.85, Recommended 150/0.72, Extreme 96/0.45.
- Target-size mode binary-searches JPEG quality over **10 iterations**.
- Merge PDF uses `copyPages()` — no rasterisation, text stays selectable.

### Video / Audio / GIF

- Video: **FFmpeg.wasm primary → MediaRecorder fallback**. There is **no
  WebCodecs/muxer path**; the Settings diagnostic reports WebCodecs presence
  for information only. Do not describe a three-tier GPU pipeline.
- Audio and GIF: FFmpeg.wasm only, CPU/WASM. Their GPU toggles are documented
  no-ops, shown for layout consistency.
- VP8/VP9 mux to `.webm`; H.264/H.265/AV1 to `.mp4`; multi-track audio or
  subtitle passthrough forces `.mkv`. Keep filename, MIME type, and container
  in sync in `types.ts`.
- Multi-track/subtitle handling uses ffmpeg stream wildcards; subtitle burn-in
  is not implemented (no libass guarantee in the CDN core).
- Audio/GIF/Video queues are intentionally sequential (shared FFmpeg
  singleton). Canvas-only Images/PDF batches use `runBatch()`.

### OCR

- **Tesseract.js 5 is the stable default.** `auto` resolves to Tesseract.
- **PaddleOCR PP-OCRv3 is optional and experimental.** It is the lightweight
  PP-OCRv3 detection/classification/recognition pipeline via Paddle.js/WebGL,
  _not_ PaddleOCR-VL 1.5 (a ~0.9B vision-language model the app never loads).
  Never label it as a VLM or as layout/table-aware.
- Math/Greek symbol mode always runs on Tesseract (`grc` + `equ`), regardless
  of the selected engine.
- OCR page seeds engine/language from Settings and render DPI from the
  resolved performance mode: Efficient 200, Balanced 250, Powerful 300.
- Batch OCR is sequential and awaits each file; a bare `forEach()` here was a
  real crash bug.

### Local AI / Smart Analyze

- `@huggingface/transformers` with ImageNet-style classification:
  `Xenova/mobilenet_v2_1.0_224` (efficient) or
  `Xenova/vit-base-patch16-224` (powerful).
- Backend selection is honest: feature-test `navigator.gpu.requestAdapter()`
  **and** `requestDevice()`, try WebGPU fp16/fp32, then fall back to WASM
  (q8/default). `getAiRuntimeInfo()` must report the backend that actually
  succeeded. Never call a WASM run GPU-accelerated.
- `onnxruntime-web` WASM binaries load from jsDelivr via `wasmPaths`; the
  locally bundled asyncify WASM is dead weight and is stripped after build.
- `sortByPredictedLabel()` orders by the classifier's predicted label. Smart
  Analyze does **not** compute embeddings or visual-similarity groups. The
  separate `guessContentType()` heuristic (edge density + palette size) only
  guesses photo vs graphic/document.
- Models are downloaded on first use and cached by the browser; no image is
  uploaded.

### Other tools

- SVG optimiser is pure TypeScript, zero dependencies; it strips `<script>`,
  inline event handlers, and `javascript:` URLs.
- DOCX→PDF is an image-based PDF (use TXT for selectable text);
  PPTX→PDF/TXT is text reconstruction, not layout-accurate. Legacy
  `.doc`/`.ppt` are unsupported.
- ZIP read/write is zero-dependency, built on `CompressionStream` /
  `DecompressionStream('deflate-raw')`.

## Settings and the execution profile

- Persisted key: `cz-settings-v2`. Legacy `cz-settings-v1` is read once to
  migrate GPU/engine choices. `theme` is separate.
- `resolveExecutionProfile()` in `src/lib/settings.ts` is the **single source
  of truth** for this session's resource profile: tier, AI model tier,
  backend preference, concurrency, image-dimension cap, FFmpeg threading,
  video preset, GPU recommendation.
- Before it existed, each resolver independently called
  `recommend(detectPlatform())`, so a manual Performance Mode changed the
  label but not the AI model/concurrency/threading. Do not reintroduce that.
- Performance Mode (`Auto`/`Efficient`/`Balanced`/`Powerful`) is a
  **resource** mode, not a quality goal. It must not silently lower output
  quality or resolution. Explicit per-engine overrides win:
  `ai.modelTier`, `resourceLimits.concurrency`, `resourceLimits.maxImageDim`,
  and the video preset.
- Tier defaults: concurrency 1/2/3; image cap 6000/10000/0 (0 = uncapped);
  AI tier efficient/efficient/powerful; video preset
  ultrafast/fast/medium.
- GPU toggles are seeded from device detection on first run only; after that
  they are explicit user choices. `GPU_CAPABLE` is images/pdf/ocr/video.

### GPU / platform semantics

- `gpuAvailable()` means **WebGL2 only**. OffscreenCanvas is not proof of GPU
  acceleration and must not be reported as such.
- `canvasPathAvailable()` means WebGL2 **or** OffscreenCanvas (the
  `desynchronized` 2D hint works without WebGL2).
- WebGPU is reported separately from WebGL2; don't conflate them.
- Settings → "This Device" is read-only and computed locally.

## Privacy invariants

- No backend, no uploads, no analytics, no tracking cookies. Never add a
  feature that sends file bytes to a server.
- CDN hosts currently used at runtime: `cdn.jsdelivr.net` (PDF.js, pdf-lib,
  Tesseract.js, PaddleOCR, mammoth.js, html2canvas, heic2any,
  onnxruntime-web), `esm.sh` (FFmpeg.wasm, heic2any), `tessdata.projectnaptha.com`
  (Tesseract language data), `paddlejs.bj.bcebos.com` (PaddleOCR weights),
  `fonts.googleapis.com` (typography), and Hugging Face for model weights.
- Only static assets/model weights leave the device; never file content.
- localStorage keys: `theme`, `cz-settings-v2`, and legacy `cz-settings-v1`.
- If you add a CDN host, storage key, or data flow, update **both**
  `PRIVACY.md` and the `/privacy` template in `index.html` in the same change.
- `CREDITS.md` must credit any new third-party code with its license
  (Apache-2.0-compatible only; no GPL/AGPL).

## Code conventions

- TypeScript, no new `any` where avoidable; shared types in `src/lib/types.ts`.
- Vanilla DOM for the app. Don't introduce React/Svelte/etc. into
  `src/main.ts` or `src/pages/*`; the React library under `src/components` is
  standalone and unused by the app.
- CSS lives in `src/style.css`, one file with `═══` section banners. Reuse
  existing custom properties (`--accent`, `--text-3`, `--r`, `--t`, …) rather
  than hardcoding colors/radii/timings.
- Respect `prefers-reduced-motion`; motion helpers apply the end state
  instantly instead of skipping the state change.
- Canvas-based engines use `makeCanvas`/`get2D` from `gpu.ts`; don't add local
  copies.
- Loaders (`ffmpeg.ts`, `pdfLibs.ts`, Tesseract/Paddle, imageDecode) must
  clear their cached promise/lock on failure so a transient CDN error doesn't
  poison the rest of the session. Use the single `setProgressHandler()` in
  `ffmpeg.ts`; never stack `ff.on('progress')` listeners.
- File-card error text must be escaped (`esc()`), never interpolated raw into
  `innerHTML`.
- Keep docs truthful. If a claim mentions a backend, tier, format, limit, or
  model name, verify it against the code before shipping.

## Deployment

- Cloudflare Pages serves the static `dist/`. The 25 MiB per-file limit is the
  reason `scripts/strip-oversized-assets.mjs` exists; it uses
  `fileURLToPath()` so it also works on Windows (`new URL(...).pathname`
  produced an invalid `/C:/…` path and silently skipped everything).
- `npm run build` remains the Cloudflare-compatible command. `deno task build`
  runs the same Vite build plus the strip script.
- COOP/COEP headers in `vite.config.ts` (dev) and `public/_headers`
  (production) enable SharedArrayBuffer for multithreaded FFmpeg.

## Known limitations / deferred work

Do not claim these ship until they do:

- WebCodecs/Mediabunny video path (prototype only, not implemented).
- SSIM/quality guard after image compression.
- AST-aware SVG optimisation (current optimiser is regex/token based).
- Embedding-based visual-similarity grouping for Smart Analyze.
- Pinned model revisions / offline model packs.
- PaddleOCR PP-OCRv5 benchmark or official PaddleOCR.js migration.
- Full offline mode (heavy engines are cached after first use, but there is
  no offline pack yet).

## Changelog & docs

- Add user-visible changes under `## [Unreleased]` in `CHANGELOG.md`.
- Versioning is `1.MM.P`, with `-a1`/`-b1` prerelease suffixes.
- Keep `README.md`, `PRIVACY.md`, `CREDITS.md`, `CONTRIBUTING.md`, and the
  in-app templates in `index.html` consistent with this file.
