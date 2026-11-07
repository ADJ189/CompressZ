# Contributing to CompressZ

Thanks for taking the time to contribute. CompressZ is a privacy-first tool —
everything runs in the browser and your files are never uploaded — and
contributions are expected to keep it that way. This guide covers how to get
set up, the project's conventions, and how to submit changes.

---

## Ground rules

- **No backend, ever.** No feature should require a server round-trip for
  user files. Everything is Canvas/WebAssembly/Web platform APIs in-browser.
  Video may use WebCodecs with Mediabunny muxing only when the exact codec
  configuration is supported, and must always fall back to FFmpeg.wasm. If a
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
- **Review & Deployment Standards.** See [STANDARDS.md](STANDARDS.md) for
  the manual re-review checklist, toolchain isolation standards, Cloudflare Pages
  build limits, and GitHub Actions specifications.

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
npm test           # unit & compliance test suite (node scripts/test.mjs)
deno test --allow-read # optional local offline Deno runner
npm run test:e2e   # Playwright matrix (Chromium + WebKit + Firefox)
npm run test:webcodecs # opt-in real MP4 encode (esm.sh + WebCodecs)
npm run bench      # opt-in benchmark → bench-results/ (not CI)
npm run lighthouse # Lighthouse CI (optional)
```

Run `npm run typecheck`, `npm run lint`, and `npm test` before opening a PR.
`npm run test:e2e` builds and serves `dist/` automatically, and needs the
Playwright browsers once:
`npx --no-install playwright install chromium webkit firefox`.

The matrix covers `chromium-desktop`, `chromium-mobile`, `webkit-desktop`,
`webkit-mobile`, and `firefox-desktop`. Playwright's WebKit is not real Safari
or iOS; changes that affect Safari behaviour need the manual
[real-device checklist](docs/SAFARI_DEVICE_CHECKLIST.md).

npm is the only supported runner. CI and Cloudflare Pages use these scripts.

Heavy third-party engines are fetched from CDNs at runtime, so a fully offline
dev server only exercises the parts you have already cached.

---

## Project layout

```
src/
  main.ts            # Svelte 5 app bootstrap (mounts App to #app)
  App.svelte         # root coordinator: AppShell + routed views
  app/               # application shell components (Svelte 5)
    AppShell.svelte, Header.svelte, Navigation.svelte,
    ToolsDialog.svelte, SettingsDialog.svelte
  routes/            # route components (Svelte 5)
    Home.svelte, Images.svelte, Pdf.svelte, Video.svelte, Audio.svelte,
    Gif.svelte, Ocr.svelte, MergePdf.svelte, ImagesToPdf.svelte,
    Convert.svelte, PdfMarkdown.svelte, About.svelte, Docs.svelte,
    Privacy.svelte, Settings.svelte
  components/        # UI atoms: FileDropzone, FileCard, FileQueue, ProgressStatus
  router.ts          # History API page router
  store.ts           # reactive pure TypeScript store (Svelte 5 subscribe contract)
  toast.ts           # toast notifications
  style.css          # tokens + CSS floor rules
  styles/workbench.css # scoped utility styles (`.cz-*`)
  lib/               # pure framework-independent TypeScript engines
    compressImage.ts, compressPdf.ts, compressVideo.ts, compressAudio.ts,
    webcodecsVideo.ts, videoMeta.ts, qualityGuard.ts,
    compressGif.ts, optimizeSvg.ts, convertMedia.ts, convertOffice.ts,
    convertPdf.ts, pdfToMarkdown.ts, ocrEngines.ts, ocrHandwriting.ts,
    motion.ts (native Web Animations API), ffmpeg.ts, zip.ts, types.ts,
    settings.ts, resourceManager.ts, recommendations.ts,
    recents.ts, workbench.ts, theme.ts, platform.ts, aiEngine.ts,
    gpu.ts, webgl.ts, batch.ts, imageDecode.ts, thumb.ts, pdfLibs.ts
test/                # Deno test suite (verified 100% passing)
  assert.ts, hallmark.test.ts, ocr.test.ts, pdfToMarkdown.test.ts,
  qualityGuard.test.ts, recommendations.test.ts, resourceManager.test.ts,
  settings.test.ts, zip.test.ts
e2e/                 # Playwright tests + pure rule/estimator tests
```

Heavy engines (FFmpeg.wasm, Mediabunny, PDF.js, pdf-lib, Tesseract.js,
PaddleOCR, mammoth.js, html2canvas, heic2any) are **not** npm dependencies —
they're loaded lazily from jsDelivr/esm.sh at the point of use, inside the
relevant `lib/*.ts` file. This keeps the initial bundle small and means a user who only
ever compresses images never downloads the OCR or video stack. Keep this
pattern for any new heavy library rather than adding it to `package.json`.
Real npm dependencies are intentionally minimal: `@huggingface/transformers`
and `svelte`. React and `animejs` have been completely removed.

---

## Conventions

- **TypeScript, no `any` where avoidable.** Shared types live in
  `src/lib/types.ts`.
- **Svelte 5 for UI, Pure TypeScript for Engines.** The user interface is built
  with Svelte 5 runes (`$state`, `$derived`, `$props`). The core engines in
  `src/lib/` remain strictly framework-independent TypeScript with **zero**
  Svelte imports, ensuring they can be imported and verified in headless runners
  (like Deno).
- **Anti-Slop & Four-Skill UI Design:** All user interface work must follow the
  antigravity design skills:
  - `design-taste-frontend`: Compact density, verb + noun actions ("Extract Markdown",
    "Process Document", "Download ZIP"), zero tech violet/lavender.
  - `frontend-design`: No AI tells (no isolated colored accent words, no all-caps
    tracked labels, no em-dash fragments, no glued arrows `→`).
  - `hallmark`: The Floor compliance (design tokens for colors/radii, instant
    `:focus-visible`, `overflow-x: clip`, reduced-motion compliance, zero
    `transition: all`).
  - `impeccable`: High scanability, dense layout, robust empty/error states.
- **Motion:** Built using the native Web Animations API (`el.animate`) in
  `src/lib/motion.ts`. No external animation libraries. Respects
  `prefers-reduced-motion` with instant bypass.
- **CSS lives in two files.** `src/style.css` holds the design tokens and the
  floor rules (`overflow-x: clip`, `:focus-visible`, reduced motion). New UI
  goes in `src/styles/workbench.css`, and every selector there is prefixed `.cz-`.
  Both use the existing custom properties (`--accent`, `--text-3`, `--r`, `--t`, etc.)
  instead of hardcoded colors, radii, or transition timings.
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
  `runBatch()` from `batch.ts`, which is the one intentional exception. Every
  batch item still goes through `runScheduled()` from `resourceManager.ts`.
- **One execution profile.** `resourceMode` (Settings → Performance) is a
  *resource* profile, not a quality goal. Resolve it once through
  `resolveExecutionProfile()` in `settings.ts`; don't call
  `recommend(detectPlatform())` independently in a page, and don't let a
  manual mode silently change output quality. Explicit per-engine overrides
  (`ai.modelTier`, `resourceLimits`, video preset) win over the mode.
- **Suggestions never act on their own.** `recommendations.ts` rules may only
  read metadata already on the page; applying a suggestion is an ordinary user
  action that re-renders the visible UI. Don't add a modal, a toast on every
  visit, or an AI-dependent rule without gating it on
  `settings.recommendations.allowAi`.
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

1. `npm run typecheck` passes (0 errors).
2. `npm run lint` passes (0 errors; warnings tolerated).
3. `npm test` passes all unit and floor compliance tests (29/29).
4. `npm run build` succeeds with no errors, and the build log shows
   the oversized onnxruntime WASM asset being stripped.
5. `npm run test:e2e` passes for all five projects (`chromium-desktop`,
   `chromium-mobile`, `webkit-desktop`, `webkit-mobile`, `firefox-desktop`).
6. If you touched `src/lib/webcodecsVideo.ts`, run `npm run test:webcodecs`
   (opt-in: needs network access to `esm.sh` and a browser with a WebCodecs
   encoder). It records a real clip, transcodes it, and asserts the output MP4
   is readable with decodable video **and** audio.
7. New third-party code (npm or CDN) is credited in `CREDITS.md` with its
   license.
8. If you touched `PRIVACY.md`-relevant behavior (anything involving data
   leaving the browser, new CDN hosts, or localStorage keys), update
   `PRIVACY.md` and the in-app `/privacy` template in the same PR.
9. Update `CHANGELOG.md` under an `## [Unreleased]` heading (add one if it
   doesn't exist) — a short bullet describing the change is enough.
10. Keep PRs scoped to one feature/fix. Large refactors are welcome but
    should be discussed in an issue first so they don't collide with other
    work in flight.

Optional local extra: `npm run lighthouse` for Lighthouse CI.

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
