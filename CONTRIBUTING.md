# Contributing to CompressZ

Thanks for taking the time to contribute. CompressZ is a privacy-first tool —
everything runs in the browser and your files are never uploaded — and
contributions are expected to keep it that way. This guide covers how to get
set up, the project's conventions, and how to submit changes.

---

## Ground rules

- **No backend, ever.** No feature should require a server round-trip for
  user files. Everything is Canvas/WebAssembly/Web platform APIs in-browser
  (there is no WebCodecs/muxer video path today — don't claim one). If a
  feature seems to need a backend, it's probably out of scope — open an
  issue to discuss first.
- **No telemetry, analytics, or third-party trackers.** See
  [PRIVACY.md](PRIVACY.md) for the commitments this project has already
  made to users; don't add anything that would break them.
- **License compatibility.** CompressZ is Apache 2.0. Any dependency you add
  (npm package, CDN-loaded library, font, icon set) must use a license
  compatible with that — Apache 2.0, MIT, BSD, and OFL are all fine; GPL and
  AGPL are not. Add new third-party code to [CREDITS.md](CREDITS.md) in the
  same PR.

---

## Getting set up

CompressZ requires **Node.js `^20.19.0 || ^22.13.0 || >=24`**. npm is the
canonical runner for GitHub Actions and Cloudflare Pages.

```bash
git clone <your fork URL>
cd CompressZ
npm ci             # reproducible install from package-lock.json
npm run dev        # http://localhost:5173
```

Other useful scripts:

```bash
npm run build      # production build → dist/ (+ oversized-asset strip)
npm run preview    # serve the production build locally
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run test:e2e   # Playwright smoke tests (both desktop + mobile Chrome)
npm run lighthouse # Lighthouse CI (optional)
```

Run `npm run typecheck` and `npm run lint` before opening a PR — CI runs both.
`npm run test:e2e` builds and serves `dist/` automatically, and needs
Playwright's Chromium once: `npx --no-install playwright install chromium`.

**Deno is optional local tooling.** If you prefer it, `deno install` followed
by `deno task typecheck|lint|build|test:e2e` runs the same toolchain through
`deno.json`. `deno task test` also runs the unit suite in `tests/` (settings
resolution, AI backend preference, predicted-label sorting). CI does not
require Deno and uses the npm scripts above, so keep `package.json` and
`deno.json` in sync when adding a new task.

Heavy third-party engines are fetched from CDNs at runtime, so a fully offline
dev server only exercises the parts you have already cached.

---

## Project layout

```
src/
  main.ts            # app bootstrap, router mount, sidebar/topbar wiring
  router.ts           # History API page router
  store.ts             # persisted app/tool state (localStorage-backed)
  components.ts        # shared DOM component helpers (file cards, etc.)
  toast.ts             # toast notifications
  style.css            # single global stylesheet (no CSS modules/framework)
  lib/                  # compression/conversion engines, one file per format
    compressImage.ts, compressPdf.ts, compressVideo.ts, compressAudio.ts,
    compressGif.ts, optimizeSvg.ts, convertMedia.ts, convertOffice.ts,
    convertPdf.ts, ffmpeg.ts (FFmpeg.wasm singleton), zip.ts, types.ts
    settings.ts         # cz-settings-v2 + resolveExecutionProfile()
    platform.ts         # device detection + performance-tier recommendation
    aiEngine.ts         # local image classifier (WebGPU→WASM fallback)
    gpu.ts / webgl.ts   # canvas + WebGL2 helpers, one shared GL context
    batch.ts, imageDecode.ts, thumb.ts, motion.ts, pdfLibs.ts
  pages/                # one file per route (images, pdf, video, audio,
    gif, ocr, convert, imagesToPdf, mergePdf, settings)
  components/, utils/   # standalone React library (see Conventions)
  index.ts, styles.css  # library entry + styles
e2e/                    # Playwright smoke tests (npm run test:e2e)
tests/                  # Deno unit tests (deno task test; optional local)
```

Heavy engines (FFmpeg.wasm, PDF.js, pdf-lib, Tesseract.js, PaddleOCR,
mammoth.js, html2canvas, heic2any) are **not** npm dependencies — they're
loaded lazily from jsDelivr/esm.sh at the point of use, inside the relevant
`lib/*.ts` file. This keeps the initial bundle small and means a user who only
ever compresses images never downloads the OCR or video stack. Keep this
pattern for any new heavy library rather than adding it to `package.json`.
The exceptions are `@huggingface/transformers` (bundled, with
`onnxruntime-web` WASM loaded from jsDelivr) and `animejs`, both of which are
real npm dependencies.

---

## Conventions

- **TypeScript, no `any` where avoidable.** Shared types live in
  `src/lib/types.ts`.
- **Vanilla DOM, no framework.** Pages build DOM nodes directly or via the
  helpers in `components.ts`. Don't introduce React/Svelte/etc. into this
  codebase — if you want a framework-based rewrite, open an issue to discuss
  first, since it's a much bigger conversation than a single PR.
  The one exception is the standalone React library entry (`src/index.ts`,
  `src/components/*.tsx`, `src/styles.css`): React is a devDependency there
  and the app (`src/main.ts`) never imports it, so it stays out of the bundle.
- **CSS lives in `src/style.css`.** It's intentionally one file with
  section banner comments (`═══`) rather than split per-component — search
  for the relevant banner before adding a new one. Use the existing custom
  properties (`--accent`, `--text-3`, `--r`, `--t`, etc.) instead of hardcoding
  colors, radii, or transition timings.
- **Font stack:** headings/branding use `var(--display)`, the wordmark next
  to the logo uses `var(--brand)`, body/UI text uses `var(--sans)`, code/meta
  text uses `var(--mono)`. Don't add a new `@font-face`/Google Fonts family
  for a one-off use — check whether an existing variable already fits before
  introducing a fifth (or sixth) family, since every family is a render-blocking
  network request on first load.
- **Sequential batch processing.** Queue/batch operations (`compressAll`,
  `processAll` in the page files) must `await` each file in turn rather than
  firing them concurrently — the FFmpeg.wasm and OCR engines are loaded as
  singletons and don't tolerate concurrent jobs. This has been a real bug
  before; don't reintroduce it. Canvas-only engines (Images, PDF) use
  `runBatch()` from `batch.ts`, which is the one intentional exception.
- **One execution profile.** Settings → Performance Mode is a *resource*
  profile, not a quality goal. Resolve it once through
  `resolveExecutionProfile()` in `settings.ts`; don't call
  `recommend(detectPlatform())` independently in a page, and don't let a
  manual tier silently change output quality. Explicit per-engine overrides
  (`ai.modelTier`, `resourceLimits`, video preset) win over the tier.
- **Report the backend you actually got.** WebGPU is opportunistic: probe
  `navigator.gpu.requestAdapter()` *and* `requestDevice()`, attempt WebGPU,
  then fall back to WASM, and surface the successful backend via
  `getAiRuntimeInfo()`. Never label a WASM run as GPU-accelerated.
- **Engine names are promises.** The optional OCR engine is **PaddleOCR
  PP-OCRv3**, not PaddleOCR-VL (the app never loads those weights).
  Smart Analyze produces ImageNet-style labels and sorts by *predicted
  label* — it does not compute embeddings or visual-similarity groups.
  Keep UI copy, README, and Settings diagnostics consistent with that.
- **Format-agnostic file naming.** When an engine changes container/codec
  (e.g. VP8/VP9 → `.webm`), make sure the output filename and MIME type in
  `types.ts` are updated together.

---

## Commit / PR checklist

1. `npm run typecheck` passes.
2. `npm run lint` passes (warnings are currently tolerated; new errors are not).
3. `npm run build` succeeds with no new warnings, and the build log shows
   the oversized onnxruntime WASM asset being stripped.
4. `npm run test:e2e` passes for both Chromium projects.
5. New third-party code (npm or CDN) is credited in `CREDITS.md` with its
   license.
6. If you touched `PRIVACY.md`-relevant behavior (anything involving data
   leaving the browser, new CDN hosts, or localStorage keys), update
   `PRIVACY.md` and the in-app `/privacy` template in the same PR.
7. Update `CHANGELOG.md` under an `## [Unreleased]` heading (add one if it
   doesn't exist) — a short bullet describing the change is enough.
8. Keep PRs scoped to one feature/fix. Large refactors are welcome but
   should be discussed in an issue first so they don't collide with other
   work in flight.

Optional local extras: `deno task test` for the unit suite, and
`deno task lighthouse` / `npm run lighthouse` for Lighthouse CI.

---

## Reporting bugs / requesting features

Open a GitHub issue. For bugs, include:

- Browser + version (compression/OCR behavior is very browser-dependent —
  see the compatibility table in the README)
- Steps to reproduce, and the file type/size involved if relevant
- Whether it reproduces in a fresh/incognito window (rules out
  extension/localStorage interference)

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

---

## Questions

If something in this guide doesn't cover your case, open an issue — that's
also how this document gets improved.
