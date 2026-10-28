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

## Quick start (npm is canonical)

GitHub Actions and Cloudflare Pages use **Node/npm**. CompressZ requires Node
`^20.19.0 || ^22.13.0 || >=24`.

```bash
npm ci                       # install from package-lock.json
npm run dev                  # http://localhost:5173
npm run build                # dist/ + strip >25 MiB assets
npm run preview              # serve dist/
npm run typecheck            # tsc --noEmit
npm run lint                 # ESLint (0 errors expected; warnings tolerated)
npm run test:e2e             # Playwright, Chromium + WebKit + Firefox, desktop + mobile
npm run test:webcodecs       # opt-in real Mediabunny encode (needs esm.sh + WebCodecs)
npm run bench                # opt-in image benchmark → bench-results/ (not CI)
npm run lighthouse           # optional Lighthouse CI
```

One-time browser install for e2e:

```bash
npx --no-install playwright install chromium webkit firefox
```

There is no second toolchain to keep in sync: `package.json` is the canonical
manifest for CI, Cloudflare Pages, Playwright and Lighthouse.

### Verification checklist (run all four before calling work done)

1. `npm run typecheck` — must be clean.
2. `npm run lint` — must be **0 errors**. The repo currently has ~100
   pre-existing `@typescript-eslint/no-explicit-any` warnings; do not add new
   ones, but do not treat the existing count as failure.
3. `npm run build` — must succeed. The log should show
   `[strip-oversized-assets] Removing ort-wasm-simd-threaded.asyncify-*.wasm`;
   `dist/assets` must contain **no file ≥ 24 MiB** (Cloudflare Pages rejects
   any single file over 25 MiB).
4. `npm run test:e2e` — the `chromium-desktop`, `chromium-mobile`,
   `webkit-desktop`, `webkit-mobile` and `firefox-desktop` projects must pass.
   The config caps workers at 2 locally / 4 in CI because 8 Chromium workers
   caused timeout flakes on constrained machines. It builds and serves `dist/`
   itself. Benchmarks are excluded unless `BENCH=1`; `npm run bench` also
   switches the server to `vite dev` so they can import engine modules.

Optional local extra: `npm run lighthouse`.

`npm run test:webcodecs` is the real-encode proof for the fast path: it records
a VP8/Opus clip with MediaRecorder, runs the shipped `videoViaWebCodecs()`, and
re-opens the result with Mediabunny to assert a readable MP4 with decodable
video **and** audio. It is opt-in (`WEBCODECS_E2E=1`, `vite dev`, network to
`esm.sh`) and excluded from normal runs and CI, because encoder availability
and CDN access vary by machine. Run it when changing `webcodecsVideo.ts`.

If a change affects only docs, 1–2 are still required; run e2e when routed UI,
settings, routing, or privacy copy changes.

### Benchmarks (opt-in, never CI)

`npm run bench` sets `BENCH=1`, switches the Playwright web server to
`vite dev` (so the spec can import the real `compressImage()` module) and runs
`e2e/bench.spec.ts` on Chromium desktop. Pass `-- --project=webkit-desktop` to
compare engines. Output JSON is written to `bench-results/` (gitignored) and a
table is printed. Timings are machine-dependent; the benchmark is a
repeatability harness, not a pass/fail gate. Normal `npm run test:e2e` ignores
the file entirely. Both opt-in suites refuse to reuse a running production
preview; `PW_REUSE_SERVER=1` is only for npm-less environments that started
`vite dev` manually.

## Repository map

```
index.html                 app shell + all page templates + in-app docs/privacy
src/main.ts                bootstrap, router mount, header/tabbar/settings wiring
src/router.ts              History API router
src/store.ts               persisted per-tool state (localStorage-backed)
src/components.ts          shared DOM helpers (file cards, tags, progress)
src/toast.ts               toasts
src/style.css              app stylesheet: tokens + legacy `.tool-*`/`.settings-*`
src/styles/workbench.css   new UI only, every selector `.cz-*`
src/lib/                   engines, one file per format
  settings.ts              cz-settings-v2 + resolveExecutionProfile()
  resourceManager.ts       Adaptive Resource Guard (admission, queue, snapshot)
  recommendations.ts       deterministic contextual suggestions + dismissals
  recents.ts               cz-recent-tools / cz-favourite-tools helpers
  workbench.ts             home search, pins, live queue panel
  theme.ts                 light / dark / system preference
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
  webcodecsVideo.ts        capability-gated WebCodecs + Mediabunny route
  videoMeta.ts             shared video metadata + no-upscale size planner
  qualityGuard.ts          SSIM / scale guard for lossy image output
  compressGif.ts / optimizeSvg.ts / convertMedia.ts / convertOffice.ts
  convertPdf.ts / imagesToPdf.ts / mergePdf.ts / zip.ts / types.ts
src/pages/                 one file per route: images, pdf, video, audio, gif,
                           ocr, convert, imagesToPdf, mergePdf, settings
src/components/            standalone React component library (unused by app)
e2e/smoke.spec.ts          Playwright tests (routes, workbench, settings, responsive)
e2e/rules.spec.ts          pure Node tests: rules engine + Resource Guard estimators
e2e/engines.spec.ts        pure Node tests: video routing/planning + SSIM guard
e2e/bench.spec.ts          opt-in (BENCH=1) image-pipeline benchmark
e2e/webcodecs.spec.ts      opt-in (WEBCODECS_E2E=1) real MP4 encode with audio
scripts/bench.mjs          benchmark runner (sets BENCH=1, picks Chromium)
scripts/webcodecs-e2e.mjs  real-encode runner (sets WEBCODECS_E2E=1)
scripts/strip-oversized-assets.mjs  Cloudflare 25 MiB guard
lighthouserc.json          Lighthouse CI config
docs/SAFARI_DEVICE_CHECKLIST.md  manual real-device Safari release gate
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
- `planOutputSize()` in `qualityGuard.ts` is the only scale planner: a max
  dimension is a ceiling and images are **never upscaled**.
- After a lossy encode, `measureEncoded()` decodes the output at the ≤96px
  sample size (not full resolution), samples source and output to a ≤96×96 luma
  grid and computes global SSIM. Below `SSIM_FLOOR` (0.90) the
  guard retries **once at a higher quality** — never lower — unless a byte
  target is active (then it warns) or the user explicitly requested quality
  <0.70 (an intentional soft look). It never rescales to chase a score, and a
  remaining warning is shown on the file card via the result `format` note.

### PDF
- Structural strategy (Low/Recommended): walk XObjects, downscale embedded
  images, re-encode JPEG in place; text/vectors untouched.
- Canvas strategy (Extreme, encrypted-PDF fallback): render pages with PDF.js
  (`colorSpace: 'srgb'`, `intent: 'print'`), assemble with pdf-lib.
- Presets: Low 220 DPI/0.85, Recommended 150/0.72, Extreme 96/0.45.
- Target-size mode binary-searches JPEG quality over **10 iterations**.
- Merge PDF uses `copyPages()` — no rasterisation, text stays selectable.

### Video / Audio / GIF
- Video: **WebCodecs + Mediabunny fast path → FFmpeg.wasm → MediaRecorder**.
  Only simple request shapes take the fast path: H.264/HEVC/AV1 in MP4,
  VP8/VP9 in WebM, AAC (MP4) or Opus (WebM), the default `fast` video preset,
  and **no** 10-bit, edit proxy, two-pass, audio passthrough, multi-audio or
  subtitle passthrough. Mediabunny has no encoder-speed preset, so an explicit
  ultrafast/medium/slow choice routes to FFmpeg.
- The fast path is capability-gated per run: `canEncodeVideo` and
  `canEncodeAudio` must accept the exact output configuration, the input and
  its tracks must decode, and any discarded video/audio track aborts back to
  FFmpeg. Audio is never silently dropped.
- Mediabunny always writes a real container (`Mp4OutputFormat` /
  `WebMOutputFormat` + `BufferTarget`). Never concatenate raw NAL units.
  It is a lazy `esm.sh` import, not an npm dependency.
- WebCodecs is **not** "GPU acceleration": the browser picks hardware or
  software encoding. The Settings Video GPU toggle still only affects the
  MediaRecorder fallback's per-frame canvas.
- Audio and GIF: FFmpeg.wasm only, CPU/WASM. Their GPU toggles are documented
  no-ops, shown for layout consistency.
- VP8/VP9 mux to `.webm`; H.264/H.265/AV1 to `.mp4`; multi-track audio or
  subtitle passthrough forces `.mkv`. Keep filename, MIME type, and container
  in sync in `types.ts`.
- Multi-track/subtitle handling uses ffmpeg stream wildcards; subtitle burn-in
  is not implemented (no libass guarantee in the CDN core).
- Video/Audio/GIF queues are intentionally sequential. Canvas-only
  Images/PDF batches use `runBatch()`, and every batch item still passes
  through `runScheduled()` for global admission.

### OCR
- **Tesseract.js 5 is the stable default.** `auto` resolves to Tesseract.
- **PaddleOCR PP-OCRv3 is optional and experimental.** It is the lightweight
  PP-OCRv3 detection/classification/recognition pipeline via Paddle.js/WebGL,
  *not* PaddleOCR-VL 1.5 (a ~0.9B vision-language model the app never loads).
  Never label it as a VLM or as layout/table-aware.
- Math/Greek symbol mode always runs on Tesseract (`grc` + `equ`), regardless
  of the selected engine.
- OCR page seeds engine/language from Settings → Compression → OCR defaults
  and render DPI from the resolved resource mode: Memory Saver 200, Balanced
  250, Maximum 300.
- OCR renders and embeds one page at a time (`openPageRenderer()` +
  incremental `createSearchablePdfBuilder()`), releasing each page blob after
  recognition. Don't go back to rendering every page up front.
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
- Settings → AI Engine → **Inference backend** (`ai.backend`) offers `auto`,
  `webgpu` and `wasm`. `wasm` is an explicit CPU opt-out and skips the WebGPU
  probe entirely; `webgpu` still falls back to WASM rather than disabling the
  feature. Changing it calls `unloadModels()` so the next Smart action uses
  the new path; cached weights stay in the browser.
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
  migrate GPU/engine choices (including the old `performanceMode` tier, which
  is mapped onto `resourceMode`). `theme` is separate.
- `resolveExecutionProfile()` in `src/lib/settings.ts` is the **single source
  of truth** for this session's resource profile: tier, AI model tier,
  backend preference, concurrency, image-dimension cap, FFmpeg threading,
  video preset, GPU recommendation.
- Before it existed, each resolver independently called
  `recommend(detectPlatform())`, so a manual resource mode changed the label
  but not the AI model/concurrency/threading. Do not reintroduce that.
- `resourceMode` (`auto` / `memory-saver` / `balanced` / `maximum`) is the
  supported control. It replaced the old `performanceMode`
  (`efficient`/`balanced`/`powerful`), which is migration-only and must not be
  rendered as a second overlapping control. It is a **resource** mode, not a
  quality goal: it must not silently lower output quality or resolution.
  Explicit per-engine overrides win: `ai.modelTier`, `ai.backend`,
  `resourceLimits.concurrency`, `resourceLimits.maxImageDim`, and the video
  preset.
- Tier defaults: concurrency 1/2/3; image cap 6000/10000/0 (0 = uncapped);
  AI tier efficient/efficient/powerful; video preset
  ultrafast/fast/medium. `resourceLimits.*: 'auto'` defers to the tier.
- GPU toggles are seeded from device detection on first run only; after that
  they are explicit user choices. `GPU_CAPABLE` is images/pdf/ocr/video.
- Settings is a sectioned dialog (`src/pages/settings.ts`): General,
  Appearance, Performance, AI engine, Suggestions, Compression, Privacy &
  data, Diagnostics. Tests must click `#settings-nav` before asserting
  section content.
- Theme preference is three-way (`light`/`dark`/`system`) in `lib/theme.ts`
  under the existing `theme` key. `data-theme` always receives the *resolved*
  value (`light`/`dark`), so `[data-theme="dark"]` rules stay valid.

## Adaptive Resource Guard

- `src/lib/resourceManager.ts` is the only admittance path for heavyweight
  work. `runScheduled(job, fn)` takes a job descriptor
  (`kind`, `label`, optional `bytes`/`pages`/`pixels`) and resolves with the
  function's result. Heavy pools: ffmpeg, OCR, PDF rasterisation, AI.
  Light pool: Canvas image/PDF encode.
- `getResourceSnapshot()` returns `estimateOnly: true` plus honest mode
  labels, active/queued counts, `concurrencyLabel`, `engineHint` and a
  pressure notice. It must never claim to read free RAM — browsers don't
  expose it.
- Video/audio/GIF/OCR loops stay sequential end to end (shared FFmpeg
  singleton / one OCR worker). The guard adds global admission control; it
  does not parallelise those engines.
- `resourceStatusLine()` feeds the Settings/queue UI. Do not add a second
  scheduler or bypass `runScheduled()` in a new engine.

## Contextual recommendations

- `src/lib/recommendations.ts` is deterministic and model-free. Rules read
  metadata already on the page (names, byte sizes, MIME types, current
  options) and never mutate anything: the caller applies an action.
- Rules currently shipped: natural filename order (images, images → PDF,
  merge PDF), photo input → WebP instead of PNG, quality ≥ 96 → 82, fixed
  page size → Auto, PDF Extreme/Low-large-file → Recommended, CJK → PaddleOCR
  and Latin/RTL/Indic → Tesseract. Do not add an AI-dependent suggestion
  without gating it on `settings.recommendations.allowAi`.
- Dismissals persist in `cz-recommendations-v1` as `scope:rule:action` keys.
- UI: `createRecommendationNotice()` renders one primary suggestion plus a
  collapsed "Other suggestions (N)"; never a modal or repeated toast.
- Applying a suggestion is reversible: each page snapshots the previous
  state and passes an Undo action to `toast()`. Destructive Settings actions
  (`Reset all settings`, `Clear local data`) use a two-step confirm button,
  and closing Settings returns focus to its trigger.

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
  onnxruntime-web), `esm.sh` (FFmpeg.wasm, Mediabunny, heic2any),
  `tessdata.projectnaptha.com`
  (Tesseract language data), `paddlejs.bj.bcebos.com` (PaddleOCR weights),
  `fonts.googleapis.com` (typography), and Hugging Face for model weights.
- Only static assets/model weights leave the device; never file content.
- localStorage keys: `theme` (`light`/`dark`/`system`), `cz-settings-v2`,
  `cz-recommendations-v1`, `cz-recent-tools`, `cz-favourite-tools`, and
  legacy `cz-settings-v1`. Recent/pinned lists store tool route names only —
  never file names or contents.
- If you add a CDN host, storage key, or data flow, update **both**
  `PRIVACY.md` and the `/privacy` template in `index.html` in the same change.
- `CREDITS.md` must credit any new third-party code with its license
  (Apache-2.0-compatible only; no GPL/AGPL).

## Code conventions

- TypeScript, no new `any` where avoidable; shared types in `src/lib/types.ts`.
- Vanilla DOM for the app. Don't introduce React/Svelte/etc. into
  `src/main.ts` or `src/pages/*`; the React library under `src/components` is
  standalone and unused by the app.
- CSS lives in two files: `src/style.css` (tokens + the legacy
  `.tool-wrap`/`.settings-card` component styles, section banners with ═══)
  and `src/styles/workbench.css` (every selector prefixed `.cz-`). New UI
  goes in the second file so it cannot restyle legacy markup. Reuse existing
  custom properties (`--accent`, `--text-3`, `--r`, `--t`, …) rather than
  hardcoding colours/radii/timings.
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
- `npm run build` remains the Cloudflare-compatible command. CI uses npm only.
- COOP/COEP headers in `vite.config.ts` (dev) and `public/_headers`
  (production) enable SharedArrayBuffer for multithreaded FFmpeg.

## Known limitations / deferred work

Do not claim these ship until they do:

- Real-device Safari/iOS parity. Playwright's WebKit projects are not Safari;
  run `docs/SAFARI_DEVICE_CHECKLIST.md` on physical hardware before release
  claims.
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
