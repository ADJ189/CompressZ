# Changelog

All notable changes to CompressZ are documented in this file.

**Versioning:** `1.MM.P` (major.minor.patch). Unreleased/in-progress builds
carry an `-a`/`-b` prerelease suffix (`-a` = early/alpha, `-b` = beta,
close to ready) with a trailing counter, e.g. `1.12.0-b1`, `1.12.0-b2`.
The suffix is dropped on the release that ships it (`1.12.0`). Current
released version: **1.11.0**.

## [1.12.0-b1] — Unreleased

### Fixed — Horizontal tab bar regressions from the sidebar→tab-bar redesign

- **"More" dropdown was unusable**: `#tab-more-menu` was `position: absolute`
  nested inside `.tabbar-scroll`, which has `overflow-y: hidden` (needed so
  the row's horizontal drag-scroll doesn't also scroll vertically). That
  silently clipped the dropdown to zero visible height every time it
  opened — it wasn't broken, it was invisible and un-clickable, clipped by
  its own scrolling ancestor. Menu is now `position: fixed`, positioned by
  JS (`positionMoreMenu()` in `main.ts`, via `getBoundingClientRect()`) so
  it escapes that ancestor's clip box entirely.
- **Tab items didn't look or act clickable**: every `<a data-nav>` in the
  tab bar (and the header logo) had no `href` attribute, so browsers gave
  them the default non-interactive cursor instead of a pointer, and they
  weren't keyboard-focusable or middle-click/"open in new tab"-able. All
  of them now carry a real `href` alongside `data-nav`; the router still
  intercepts the click for client-side navigation.
- **OCR page's side panel could render off-screen**: `.ocr-side`'s
  `max-height: calc(100vh - 2.5rem)` was sized against the whole viewport,
  left over from before the redesign. The fixed header + tab bar now eat
  `var(--header-h) + var(--tabbar-h)` (98px) off the top before the
  scrollable content area even starts, so on shorter viewports the bottom
  of the engine picker could sit below the fold. Now subtracts both.

### Changed — About/Docs promoted out of "More"

- Ported CompressF's flat nav structure: About and Docs are now
  always-visible tabs in the main row instead of hidden behind the (now
  also just-fixed) "More" menu, matching how CompressF surfaces them
  directly. "More" now holds Privacy only. (Content itself wasn't ported
  from CompressF — CompressZ's About/Docs already cover its own broader
  feature set in more depth; this was about visibility, not text.)

### Added — Lighting animation + snappier press feedback on the tab bar

- The active-tab indicator now has a slow animated gradient sweep and a
  breathing glow (`thumbGlow`) instead of a flat static bar.
- Hovering a tab plays a quick diagonal light-sweep across it (`tabSweep`).
- Added a fast (120ms), smooth scale-down `:active` press state to tab
  items, the "More" menu items, `.htc` home tool cards, and the
  `.btn-primary`/`.btn-ghost`/`.btn-white` buttons.

### Fixed — Cloudflare Pages build failure

- `package-lock.json` had drifted out of sync with `package.json` (a stale
  `proxy-agent@6.5.0` subtree where the `@puppeteer/browsers` override now
  resolves to `proxy-agent@8.x`), so `npm ci` failed on Cloudflare Pages
  with `Missing: proxy-agent@8.0.2 from lock file` before the build could
  even start. Regenerated the lockfile; `npm ci` now completes cleanly.

### Fixed — Dependabot security alerts

- **adm-zip** (transitive, via `onnxruntime-node` — never reaches the
  browser bundle, only flagged in the lockfile): pinned to `^0.6.0` via
  `package.json` overrides, fixing the crafted-ZIP 4GB memory-allocation
  advisory. `npm audit` confirmed `<0.6.0` is the actual vulnerable range
  (not `<0.5.18` as the advisory title implies).
- **sharp** (transitive, via `@huggingface/transformers`'s Node-side image
  path — also never reaches the browser bundle): pinned to `^0.35.3` via
  overrides, resolving to `0.35.4`, which bundles a libvips release fixing
  CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, and CVE-2026-35591.
- `npm audit --omit=dev` now reports 0 vulnerabilities.

### Fixed — Hardware-aware batch concurrency wasn't actually wired up

- `platform.ts` already computed a per-device `batchConcurrency`
  recommendation (1/2/3 depending on CPU cores, memory, and GPU), but the
  Images and PDF pages' "Compress All" ignored it entirely — firing every
  queued file's compression at once via an unbounded `.forEach()`. On a
  low-power device that meant dozens of concurrent `canvas`/`toBlob()` jobs
  competing for the same CPU/GPU the recommendation had already flagged as
  weak.
- Added `src/lib/batch.ts`: a small concurrency-limited task runner that
  defaults to `platform.recommend().batchConcurrency`. Wired it into
  `images.ts` and `pdf.ts`'s `compressAll()`.
- Video/Audio/GIF/Convert are intentionally left sequential — they share
  one FFmpeg.wasm singleton, so concurrent jobs there would just queue on
  the same WASM module rather than actually parallelize.

### Added — More anime.js coverage

- Toasts now pop in/out via a real spring animation (`lib/motion.ts`
  `toastIn`/`toastOut`) instead of a plain CSS `@keyframes` entrance with no
  matching exit animation; removal is now awaited so it never gets yanked
  mid-fade.
- Images and PDF file-card lists now reveal with the same staggered
  fade+rise already used for Smart Analyze results and the Settings page,
  applied only on actual list changes (add/clear/reorder) — not on every
  per-file progress tick, which still goes through the lighter
  `patchFileCard` path.

## [1.11.0] — Device-Aware Performance, Local AI Engine, Settings Overhaul

### Added — Forked from CompressF

- CompressZ is a fork of [CompressF](https://github.com/ADJ189/CompressF).
  README now says so up front, and notes that CompressF is still maintained
  as its own project (a leaner, format-focused sister site) rather than a
  predecessor CompressZ replaced.

### Added — Platform detection engine (`src/lib/platform.ts`)

- New module that feature-detects (never UA-sniffs alone) OS family, device
  class (mobile/tablet/desktop), browser rendering engine, CPU core count,
  device memory (where the browser reports it), GPU/WebGL2/WebGPU
  availability and renderer string, cross-origin isolation (gates
  multi-threaded WASM), effective network type, and `prefers-reduced-motion`.
- Derives a `PerformanceTier` (`efficient` / `balanced` / `powerful`) from
  those signals and a `recommend()` function that turns the tier into
  concrete engine choices: GPU toggle defaults, video encode preset, FFmpeg
  threading eligibility, batch concurrency, and which AI model tier to use.
  Everything runs locally and synchronously — no network calls.

### Added — Settings: Performance Mode & Device info

- New "This Device" section: a read-only snapshot of everything
  `platform.ts` detected, plus the resolved performance tier as a pill.
- New "Performance Mode" section: `Auto` (follows the device recommendation)
  or a manual `Efficient` / `Balanced` / `Powerful` override. `Auto` seeds
  GPU-acceleration defaults and the video preset on a device's first visit
  only — it never overwrites a toggle you've already hand-picked.
- `lib/settings.ts` moved to a versioned `cz-settings-v2` storage key; a
  returning user's existing `cz-settings-v1` GPU/engine choices are carried
  over automatically (same shape, no reset), with the new `performanceMode`
  and `ai` fields seeded from device detection on that first v1→v2 read.

### Added — Local AI engine (`src/lib/aiEngine.ts`) + Smart Analyze/Sort

- Real on-device image understanding via `@huggingface/transformers`
  (dynamically imported — zero cost until a "Smart" action is actually
  used, same lazy-load pattern as FFmpeg.wasm/PaddleOCR): an image-
  classification model tags what's actually in each image, entirely in the
  browser (WASM, or WebGPU where available). No image or file is ever
  uploaded — consistent with the rest of the app's privacy stance.
- Two model tiers, picked by Settings → AI Engine → Model tier (`Auto`
  follows Performance Mode): `efficient` (`Xenova/mobilenet_v2_1.0_224`,
  ~14MB) and `powerful` (`Xenova/vit-base-patch16-224`, ~90MB). Weights are
  cached by the browser after first download.
- A second, model-free heuristic (`guessContentType()`) samples a
  downscaled canvas for edge density and palette size to guess "photo" vs.
  "graphic/screenshot/document" and suggest a format + quality for that
  content type.
- **Images page**: new "✨ Smart Analyze & Sort (AI)" action — tags every
  queued file, groups similar ones together (replacing upload order), and
  — if "Auto-apply suggested settings" is on in Settings — rewrites each
  untouched file's format/quality to the content-type suggestion. Tags
  render as a chip on the file card (`components.ts`).
- **Images → PDF page**: new "✨ Smart Sort (AI)" action — same tagging and
  grouping, without touching per-file compression options (this tool has
  none) — reorders the page sequence before combining.
- New Settings → "AI Engine — Local" section: master enable toggle
  (disabled outright if `WebAssembly` isn't available), model tier
  selector, and the auto-apply toggle.

### Added — anime.js for the new UI (`src/lib/motion.ts`)

- Added `animejs` as a dependency, wrapped in a small dynamically-imported
  helper (`revealStagger`, `popIn`, `pulse`, `progressTo`) used for the new
  Settings sections' entrance and the Smart Analyze/Sort file-card
  reordering. Respects `prefers-reduced-motion` (applies the end state
  instantly, no animation, rather than skipping the state change). This is
  additive — the app's existing CSS-transition system (`--t2`/`--t3`/
  `--ease-fluid`) is untouched everywhere else.

### Changed — Small-screen refinements

- Added a `≤420px` breakpoint tightening padding, title sizes, the OCR
  engine-matrix grid, and dialog width for narrow phones, on top of the
  existing `≤768px`/`≤960px` breakpoints.

### Audit — Feature regression check

- Cross-checked every engine page (Video: 10-bit, edit-proxy, 2-pass,
  multi-track audio, subtitle passthrough, per-file editing; PDF: tri-state
  metadata control; OCR: dual engine + Math/Greek symbol mode; Audio:
  passthrough; GIF; Merge PDF; Convert: video/audio/image/PDF⇄images/
  DOCX/PPTX) against this changelog's history. Everything documented as
  shipped is present and wired up — no regressions found.

## [1.0] — Images → PDF, GPU Acceleration, Settings Page, Code Dedup

### Added — Images → PDF tool

- New `compress/images-to-pdf` page: drop two or more images, reorder them
  with ↑/↓ controls, pick a page size (Auto/A4/Letter) and JPEG quality,
  then combine into a single PDF, one image per page, in that order.
  `src/lib/imagesToPdf.ts` is the shared implementation — the Convert
  page's existing PDF ⇄ Images "combine" flow now delegates to it too,
  removing a second copy of the same logic.
- Added to the sidebar (next to Merge PDF) and the home page tools grid.

### Added — GPU acceleration

- `src/lib/gpu.ts`: WebGL2/OffscreenCanvas capability detection, a shared
  `makeCanvas`/`get2D` (applies the `desynchronized` canvas hint when a
  per-engine toggle is on) and a real WebGL2 texture-draw `resizeViaWebGL()`
  used for hardware-filtered image downscaling, with a silent Canvas2D
  fallback if WebGL2 is unavailable or the draw throws.
- Wired into the Images engine (real resize acceleration), PDF/OCR page
  rasterisation, and the Video engine's MediaRecorder fallback canvas.
  FFmpeg.wasm itself (Video's primary path, plus all of Audio and GIF) is
  CPU/WASM-only — browsers don't expose a GPU encode path to WebAssembly —
  so those toggles are shown in Settings for a consistent layout but are
  honest about doing nothing where nothing applies.

### Added — Settings page

- New `compress` sidebar-adjacent `settings` page (Apple/iOS "grouped
  list" style, reusing the existing `.settings-card` component) with a
  GPU Acceleration toggle per engine and default-value controls for every
  engine (Images, PDF, Video, Audio, GIF, OCR). `src/lib/settings.ts`
  persists all of it to localStorage (Safari-private-mode-safe, same
  pattern as the rest of the app) and every tool's store now seeds its
  initial state from these defaults instead of hardcoded numbers.
- Added to the sidebar bottom actions, next to the GitHub link.

### Changed — Code dedup

- `compressImage.ts`, `compressPdf.ts`, `convertPdf.ts`, and `ocr.ts` each
  had their own local canvas-creation helper; all now use the shared ones
  in `gpu.ts`.
- Fixed a stale home-page tile description claiming a three-tier
  "FFmpeg.wasm → WebCodecs GPU → MediaRecorder" video pipeline — the
  WebCodecs tier was removed in an earlier pass (see the note in
  `compressVideo.ts`) but the copy wasn't updated; it now describes the
  actual two-tier chain.

## [0.9] — Merge PDF, Splash Animation Ported from CompressF, Code Dedup

### Added — Merge PDF tool

- New `compress/merge-pdf` page: drop two or more PDFs, reorder them with
  ↑/↓ controls, then merge into a single file in that exact order.
  `src/lib/mergePdf.ts` uses pdf-lib's `PDFDocument.copyPages()` to clone
  each page's content stream and resources directly — no rasterisation, so
  text stays selectable and vectors stay sharp, same principle as the
  structural strategy already used in `compressPdf.ts`.
- Loads PDFs with `ignoreEncryption: true` (same permissive load used
  elsewhere) so owner-password-restricted PDFs still merge; a PDF that
  genuinely needs a password to open is reported by name rather than
  silently failing the whole batch.
- Added to the sidebar (under Compress, next to PDF), the home page tools
  grid, and documented in the Docs page's options reference.

### Changed — Splash animation and wordmark font ported from CompressF

- The startup splash's wave-chevron icon used to just appear; each wave now
  draws itself in via `stroke-dasharray`/`stroke-dashoffset`, matching the
  animation CompressF's splash uses. Icon and wordmark now pop in on their
  own independent spring timings (was one shared container rise), and the
  whole splash fades out starting at .8s over .4s, also matching CompressF.
- Removed the progress-bar fill under the wordmark — CompressF's splash
  doesn't have one, and the ported choreography doesn't call for it.
- The splash wordmark now renders in Plus Jakarta Sans (added to the
  Google Fonts request in `index.html`, splash-only) — the face CompressF's
  splash used. No other typography changed; see the `[0.8]` entry below for
  why a wholesale font swap is out of scope here.

### Changed — Deduplicated repeated markup and constants

- The wordmark icon SVG (rounded square + 3 chevrons) was inlined in full
  three times (splash, mobile topbar, sidebar). Defined once as an SVG
  `<symbol>` in `index.html` and referenced via `<use>` in the topbar and
  sidebar; the splash keeps its own inline copy since its waves are
  individually animated and `<use>` shadow trees can't be targeted by
  external CSS animations.
- The `pdfjs-dist`/`pdf-lib` CDN version pins and URLs were declared
  independently in four places (`compressPdf.ts`, `convertPdf.ts`,
  `convertOffice.ts`, `pages/ocr.ts` — one of them under a differently
  spelled constant name). Consolidated into `src/lib/pdfLibs.ts`, imported
  by all four plus the new `mergePdf.ts`.

## [0.8] — Sidebar Overflow Fix, More Group, Floating Theme Toggle, Font System

### Fixed — Sidebar content could overflow below the visible viewport on mobile

- `#app-shell`, `.sidebar`, and `.main-panel` used a plain `100vh`, which on
  mobile browsers doesn't account for the address bar/toolbar chrome that
  shrinks the actually-visible area — the sidebar's own height could exceed
  what was on screen even though `.sb-nav` already had `overflow-y: auto`.
  Added `100dvh` (with the `100vh` line kept as a fallback for browsers that
  don't support it) so the sidebar's real height always matches the visible
  viewport.
- Fixed a bug the new "More" toggle would otherwise have hit immediately:
  the existing "close mobile sidebar on nav" click listener matched any
  `.sb-item` click, which would have collapsed the drawer the instant you
  tapped "More" — before you could ever see the expanded group. Excluded
  from that listener now.

### Changed — About / Docs / Privacy collapsed into a "More" group

- These three were always-visible sidebar rows under an "Info" label,
  adding a fixed amount of height regardless of whether you use them.
  Replaced with a single "More" disclosure toggle (⋯) that expands to show
  them; state persists in `localStorage` and auto-expands when you're
  actually on one of those three pages.

### Changed — Light/dark toggle moved out of the sidebar

- Was a full-width row in `.sb-bottom`. Moved to a floating button fixed to
  the top-right of the viewport, independent of the sidebar and the mobile
  topbar — repositioned via media query on mobile to sit left of the
  hamburger button instead of overlapping it.

### Added — Font system (IBM Plex Mono / Noto Sans Mono / Space Grotesk / Redaction)

- `--mono` (IBM Plex Mono) — About/Docs/Privacy body copy, tech-card text,
  badges/chips, on top of its existing use for file-size and progress
  labels.
- `--mono-btn` (Noto Sans Mono) — primary action and download buttons only.
- `--feature` (Space Grotesk) — compression-ratio numbers, as a distinct
  accent for the one number users actually came to see.
- `--display` (Redaction, intended) — logo text, page titles, home hero
  heading. Redaction itself isn't on Google Fonts or any CDN worth
  hotlinking in shipped code (the only sources are third-party "free font"
  mirror sites), so the `@font-face` is included **commented out**, ready
  to activate by dropping licensed `.woff2` files at `/fonts/` and
  uncommenting — no other change needed. Until then `--display` resolves to
  Courier Prime (a real, Google-Fonts-hosted typewriter face) so nothing
  404s or shows a missing-font gap in the meantime.
- Base UI font (Inter) left as-is — a wholesale swap wasn't asked for and
  would need visual QA across every page this couldn't verify in a
  browser-less environment.

## [0.7] — Batch Queue, Multi-track Audio, Subtitle Passthrough, 2-pass

### Fixed — Batch "Compress All" raced on the shared FFmpeg.wasm instance

- `compressAll()`/`processAll()` on the Video, Audio, GIF, and Convert pages
  fired every queued file's compression via `.forEach()` without awaiting
  any of them. All four share one FFmpeg.wasm singleton and write to fixed
  in-memory filenames (`vin.*`/`vout.*`, `input{ext}`/`output.{fmt}`, etc.),
  so "concurrent" jobs were actually racing on the same virtual files —
  one file's input or output could get overwritten mid-encode by another
  queued file. Each page now processes its queue strictly one file at a
  time. FFmpeg.wasm was never actually encoding two files in parallel
  anyway, so this is a correctness fix with no real throughput cost.

### Changed — Video queue now supports true per-file settings

- Previously `compressEntry()` re-read the global settings panel at the
  moment "Compress" was clicked, silently discarding whatever a file's
  `options` snapshot held — every queued file always used whatever the
  panel currently showed, regardless of what it looked like when the file
  was added. Fixed: each file now compresses with its own settings.
- Added a ✎ edit button on each queued video file (new optional `onEdit`
  callback on the shared file card component) that loads that file's own
  settings back into the panel for editing, with a "Save to this file" /
  "Cancel" banner so it's clear the edit only affects that one item.

### Added — Multi-track audio (video page)

- "Default track only" (previous behavior, unchanged default) or "Keep all
  tracks", each either transcoded or passed through untouched, with an
  optional stereo downmix for transcoded tracks. Implemented via ffmpeg's
  `-map 0:a?` / `-map 0:a:0?` stream wildcards rather than a manual
  per-track picker with probed indices — simpler and less fragile, at the
  cost of not being able to include track 3 but exclude track 2 from a
  file with several tracks.

### Added — Subtitle track passthrough (video page)

- "Keep all (copy)" mode passthrough-copies every subtitle stream via
  `-map 0:s? -c:s copy`. No burn-in rendering — that needs libass compiled
  into the FFmpeg.wasm core, which the default CDN-loaded core doesn't
  reliably include, so it isn't implemented rather than shipping something
  unverified.
- Multi-track audio and/or subtitles now force the output container to
  `.mkv` regardless of the selected video codec, since MP4/WebM can't
  reliably carry arbitrary passthrough audio/subtitle codecs the way
  Matroska can. Shown in the UI when it applies.

### Added — 2-pass encoding (video page, bitrate/target-size modes)

- Optional second pass for more accurate bitrate targeting, using
  `-pass 1 -f null` followed by `-pass 2` with a per-job `-passlogfile`
  prefix. Not offered in CRF mode, which has no bitrate target for a first
  pass to gather stats against.

## [0.6] — Video Container Fix, 10-bit/Proxy/Passthrough, PDF Metadata Control

### Fixed — VP8/VP9 video output was muxed into a hardcoded `.mp4`

- `compressVideo.ts` wrote every codec's output to `vout.mp4` regardless of
  which codec was selected. VP8 isn't a legal codec inside the MP4/ISO-BMFF
  muxer at all — ffmpeg rejects it, which silently sent VP8 jobs down the
  MediaRecorder fallback path instead of FFmpeg.wasm — and VP9 + Opus inside
  MP4 plays inconsistently outside Chrome. VP8/VP9 now mux into `.webm`
  (their native container); H.264/H.265/AV1 stay in `.mp4`. The result's
  MIME type, filename extension, and `+faststart` flag now follow the
  actual container instead of assuming MP4.

### Added — 10-bit encoding toggle (H.265 / AV1)

- Exposed for H.265 and AV1 only — the default ffmpeg.wasm core's libx264
  is an 8-bit-only build, so H.264 was left out rather than offering a
  toggle that silently no-ops.

### Added — Audio passthrough (stream copy, no re-encode)

- New "Passthrough" mode on the Audio compressor and as an option when
  re-encoding video, using `-c:a copy` to carry the original audio codec
  through untouched — for lossless/surround tracks (TrueHD, DTS, PCM, etc.)
  that a transcode would otherwise degrade or fail on. Falls back to an
  `.mka` (Matroska audio) container when the source extension can't hold
  the copied codec.

### Added — Edit proxy mode for video

- All-intra encoding (`-g 1 -bf 0`, every frame a keyframe, no B-frames) so
  NLEs like DaVinci Resolve can seek/scrub without decoding a GOP. A
  one-click quick-preset applies H.264 · 960px · 24fps · ultrafast on top
  of it. Not intended as a delivery format — trades file size for editing
  responsiveness.

### Changed — PDF metadata stripping is now independent of compression level

- Previously, stripping title/author/producer/creator tags was hardcoded to
  the "Extreme" preset only. Added an explicit Auto / Strip / Keep control
  so metadata can be stripped at "Low" or "Recommended" quality too, or
  kept at "Extreme" if the person wants that instead. "Auto" preserves the
  original per-preset default.

### Note — Image metadata

- No code change needed: the image compressor already strips EXIF/GPS data
  as a side effect of re-encoding through canvas. Added a one-line note in
  the UI so this is visible rather than silent.

## [0.5] — OCR Layout Rework & Docs Cleanup

### Fixed — Sidebar section labels clipped on some browsers

- `.sb-section-label` ("OVERVIEW", "COMPRESS", "TOOLS", "INFO") and
  `.sb-logo-text` had `overflow: hidden` but no explicit `line-height`, so
  each inherited the browser/font-stack default `normal` — a value that
  isn't fixed, it's computed per user agent and active font fallback. On
  browsers where that computed line-height came out shorter than the bold
  uppercase glyphs' actual height, `overflow: hidden` sliced the tops off
  the text. Gave both an explicit `line-height` so the box is always tall
  enough regardless of browser/font metrics.

### Fixed — Duplicated CSS causing layout/scaling bugs

- `.dz`, `.settings-card`, `.seg`, `select.si`, the range slider, `.file-card`,
  `.fc-btn`, and `.btn-sm` were each defined **twice** — an original rule set,
  followed later in the file by a near-identical block re-declaring the same
  selectors with `!important` to win the cascade. That's what produced the
  reported scaling glitches (e.g. the settings rows collapsing to a
  left-aligned sliver at some widths, per the bug the old comment in the CSS
  already documented). Consolidated every duplicated selector into one
  definition, removed all non-essential `!important`s, and shrank the
  shipped CSS from ~52 KB to ~34 KB in the process.

### Changed — PDF OCR page: two-column layout

- Restructured `pages/ocr.ts` and its CSS into a two-column grid on screens
  ≥960px: **drop zone + file queue on the left**, **engine picker and
  customization settings on the right**, with the right-hand settings rail
  `position: sticky` so it stays reachable while a long file queue scrolls.
  Below 960px it stacks into a single column (drop zone first), matching the
  existing mobile breakpoint.
- Narrowed the engine-comparison-matrix label column (110px → 84px) so it
  reads comfortably at the new, narrower right-column width.

### Docs — Credits, privacy, and repo docs

- Added `CREDITS.md`: full attribution and license table for every
  open-source project CompressZ depends on or loads at runtime (PDF.js,
  pdf-lib, FFmpeg.wasm, Tesseract.js + tessdata, PaddleOCR/Paddle.js,
  mammoth.js, html2canvas, Vite, TypeScript).
- Added `PRIVACY.md`: a standalone copy of the in-app `/privacy` page so
  it's readable directly from the repo.
- Updated the in-app **About**, **Docs**, and **Privacy** pages with a
  Credits section / expanded third-party library list, and linked
  `CREDITS.md` from both.
- README: added a Credits & Acknowledgments section, linked `PRIVACY.md`,
  and added both new files to the architecture tree.

## [0.1] to [0.4] — OCR Symbols & Dedicated Convert Page

### Added — OCR: Math & Greek symbol recognition

- New **"Math & Greek symbols (θ π α β Σ Δ ∞ …)"** toggle in the OCR
  settings, shown whenever the selected document language uses a Latin
  script (or is set to Auto-detect). Enabling it loads Tesseract's Greek
  (`grc`) and equation-layout (`equ`) traineddata alongside the base
  language, using Tesseract's native `lang1+lang2` multi-language syntax.
  - `grc` gives reliable recognition of individual Greek letters (θ, π, α,
    β, Σ, Δ, Ω, …) inline with normal text — the common case of a symbol
    like theta showing up in otherwise-English scientific/math text.
  - `equ` improves detection of equation-shaped regions (operators,
    fractions, sub/superscripts). Full formula transcription is still
    rough — there's no drop-in LaTeX-quality math OCR available
    client-side, and the settings UI says so rather than overselling it.
  - Symbol mode always runs on the Tesseract engine, since PaddleOCR-VL's
    recognition models are fixed and can't load extra traineddata; this
    is handled automatically (with an on-screen note) regardless of which
    engine is selected.

### Added — Dedicated Convert page

A new **Convert** tool (sidebar + home page), separate from the existing
compressors, for pure format conversion:

- **Video** — MP4 / WebM / MOV / MKV / AVI / GIF, any → any, via
  FFmpeg.wasm at a near-lossless quality tier (CRF 18) rather than the
  compress-focused defaults used elsewhere in the app.
- **Audio** — MP3 / AAC / OGG / Opus / FLAC / WAV, any → any (reuses the
  existing, already fully format-parameterised `compressAudio`, with a
  higher default bitrate suited to conversion rather than shrinking).
- **Images** — JPEG / PNG / WebP / AVIF, any → any (reuses `compressImage`
  at quality 0.95).
- **PDF → Images** — one PNG/JPEG per page, automatically zipped when a
  PDF has more than one page.
- **Images → PDF** — combine any number of selected images into a single
  PDF, with a reorderable list (move up/down, remove) before combining,
  since this is a many-files-to-one-file operation unlike every other
  conversion on the page.
- **Word (.docx) → PDF / TXT / HTML** — via mammoth.js for the DOCX →
  HTML/text extraction; PDF output rasterises that HTML with html2canvas
  and assembles it page-by-page with pdf-lib. This is an image-based PDF
  like any browser-side HTML→PDF approach without a full layout engine —
  formatting and embedded images carry over well, but text isn't
  selectable, and the UI says so and points to the TXT option for
  selectable output. Legacy `.doc` is explicitly out of scope.
- **PowerPoint (.pptx) → PDF / TXT** — PPTX is a ZIP of XML files, so
  slide text is extracted directly from the DrawingML (`<a:t>`) runs,
  slide-by-slide, and reconstructed as clean, correctly-ordered plain
  text (optionally laid out into a simple PDF). This is explicitly a text
  reconstruction, not a visual/layout-accurate conversion — there's no
  reasonable client-side PPTX rendering engine, and the UI is upfront
  about that rather than shipping something that only half-works and
  claiming otherwise. Legacy `.ppt` is out of scope for the same reason
  DOCX's legacy `.doc` is.

**New zero-dependency ZIP module (`src/lib/zip.ts`).** Rather than adding
a JS zip library, PDF→Images bundling and PPTX reading both use a small
ZIP reader/writer built on the native `CompressionStream` /
`DecompressionStream('deflate-raw')` APIs (Chrome/Edge 80+, Firefox 113+,
Safari 16.4+). Verified bidirectionally against the system `zip`/`unzip`
tools — archives written here open in any standard ZIP tool, and this
reader correctly parses archives written by other tools (which is what
matters, since DOCX/PPTX/XLSX are just ZIP containers). Falls back with a
clear error message on browsers without `CompressionStream` instead of
failing silently.

### Changed — Theme / code consistency for the new page

- Convert's UI reuses the app's existing file-card, batch-bar, and
  settings-card components/classes rather than introducing new visual
  patterns, so it matches every other tool page's look automatically
  under both themes (all colors route through the existing CSS custom
  properties). Only two small additions were needed: a `.badge.convert`
  color (teal, following the same pattern as every other tool's badge
  color) and `.cv-tabs`/`.cv-tab` for the category picker.
- Reused the existing `pdfjs-dist` and `pdf-lib` CDN loading pattern
  (same versions, same jsDelivr URLs) already used by `compressPdf.ts`
  and the OCR page, so there's no new loading behavior to audit there.



### Fixed — Layout / Alignment

- **Root cause of the settings-card alignment issue: every settings row was
  shrink-wrapped and pushed to the right edge, leaving a large empty gap on
  the left of every field.** The original `.s-row` rule was written for a
  row-wrapping flex layout and set `align-items: flex-end`. A later rule
  turned `.s-row` into a **column**-direction flex container (for the
  Apple grouped-list redesign) but never re-declared `align-items` — and
  because only one rule in the whole stylesheet touched that property, the
  old `flex-end` value kept applying. In a column flex container,
  `align-items` controls the *horizontal* axis, so every row was right-
  aligned and sized to its own content instead of stretching full width.
  Fixed by explicitly setting `align-items: stretch` on the scoped
  `.settings-card .s-row` rule.

- **Unstyled tool-page subtitles on Images, Audio, GIF and Video pages.**
  Those four pages used `class="page-desc"` for their subtitle paragraph,
  but no CSS rule for `.page-desc` existed anywhere — only `.page-sub` was
  defined, and only the PDF and OCR pages used that class. The result was
  an unstyled, misaligned subtitle line under the page title on 4 of the 6
  tool pages. All pages now consistently use `.page-sub`.
- **GIF page — "Convert to WebM" info note was squeezed into the 160px
  label column** instead of spanning the settings row. The Apple-style
  grouped-list CSS turns each `.s-field` into a 2-column grid
  (`160px 1fr`), and a lone `<p>` child with no label sibling was
  auto-placed into the narrow first column. Added a `.s-field.full`
  modifier (`display:block`) and applied it to this field.
- **Audio page — "Lossless — no bitrate setting" notice** had the same
  narrow-column squeeze for the same reason; now uses `.s-field.full` too.
- Broadened the `.settings-card .s-field > div[style]` helper selector to
  also match `p[style]`, so future single-paragraph hint text placed
  directly in a field (not just `<div>`s) lays out correctly instead of
  silently falling back to default grid placement.

### Fixed — Security

- **Unescaped error text in file cards (`components.ts`).** The `⚠ {error}`
  message shown on failed compressions was interpolated directly into
  `innerHTML` with no HTML-escaping, unlike the equivalent OCR error
  display, which already escaped it. Any HTML/script-like characters
  surfacing in a thrown error message could have been rendered as markup.
  Now routed through the existing `esc()` helper.
- **SVG optimiser only stripped `<script>` tags.** The "security" cleanup
  pass removed script elements but left inline event-handler attributes
  (`onload`, `onclick`, …) and `javascript:` URIs in `href`/`xlink:href`
  untouched — both are valid SVG XSS vectors if the file is ever rendered
  inline (e.g. via `innerHTML`, `<object>`, or `<img>` in some contexts).
  Both are now stripped/neutralised alongside `<script>` removal.

### Fixed — OCR Engine

- **Tesseract.js loader could permanently break for the rest of a session.**
  `loadTesseract()` cached its loading promise in a module-level variable
  but never cleared it on failure, so a single transient CDN hiccup (e.g. a
  dropped request to the jsDelivr worker/core script) left every later OCR
  call replaying the same cached rejection until the page was reloaded.
  The loader now clears its lock on failure so the next call retries.
- **PaddleOCR-VL loader had the identical permanent-failure lock**, plus a
  second, separate bug: once loaded, the cached instance was reused
  regardless of script family. Because Latin and CJK text use different
  recognition models (`PADDLE_REC_EN` vs `PADDLE_REC_CJK`), OCR-ing a CJK
  document in the same session after a Latin document (or vice versa)
  would silently keep using the wrong recognition model instead of
  reloading it — producing garbled or empty text with no visible error.
  The loader now tracks which model family is loaded and reloads when the
  requested language's script family differs, and releases its lock on
  failure so it can be retried.

### Fixed — Cross-Browser Compatibility

- **AVIF-encode support detection relied on `navigator.userAgent.includes
  ('Firefox/')`**, which only caught one browser that can't encode AVIF via
  canvas and is inherently fragile (breaks on UA spoofing, doesn't cover
  Safari, doesn't adapt to future browser changes). Replaced with a real
  feature-detection check (`canvas.toDataURL('image/avif')`), run once and
  cached, so any browser without AVIF canvas-encode support — Safari
  included — now falls back to WebP automatically instead of silently
  failing or producing an unexpected format.

### Fixed — Reliability / Performance

- **FFmpeg.wasm singleton loader had the same permanent-failure lock bug**
  as the OCR loaders: a failed `ff.load()` (e.g. a dropped wasm fetch) left
  `_loading` pointing at a cached rejected promise forever, permanently
  breaking Video/Audio/GIF compression for the rest of the session. Now
  releases the lock on failure so it can be retried on the next file.
- **Unbounded `'progress'` event listener growth on the shared FFmpeg
  instance.** Video, Audio, and GIF compression each called `ff.on
  ('progress', …)` on every single compress call without ever removing the
  previous listener. Since the FFmpeg instance is a session-wide singleton,
  compressing several files in a row accumulated one listener per file —
  each subsequent progress event then fired every prior file's (already
  finished) callback too, and the listener count grew without bound for
  the life of the tab. Added `setProgressHandler()` in `ffmpeg.ts`, which
  swaps out the single active listener instead of stacking a new one, and
  updated `compressAudio.ts`, `compressGif.ts`, and `compressVideo.ts` to
  use it.

### Changed

- Minor cleanup: removed a hard-to-read unspaced ternary
  (`T?resolve(T):reject(...)`) in the Tesseract script-load handler in
  favor of a normal `if`.

### Documentation

- **README license badge and footer said MIT; the repository's actual
  `LICENSE` file is Apache License 2.0.** Updated the badge and footer to
  correctly reflect Apache 2.0.
- Added this CHANGELOG.

---

## Prior History (from repository README, for context)

- PDF compression: two-strategy (structural resample + canvas-render
  fallback) with binary-search target-size mode.
- PDF OCR: PaddleOCR-VL 1.5 (primary) + Tesseract.js 5 (secondary), with
  Tesseract-OSD-based auto language detection.
- Image, Video, Audio, GIF, and SVG compression tools, all running
  entirely client-side (OffscreenCanvas, FFmpeg.wasm, pure-TS SVG
  optimiser).
- Cloudflare Pages deployment with COOP/COEP headers for SharedArrayBuffer
  (multithreaded FFmpeg).
