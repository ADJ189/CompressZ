# Changelog

All notable changes to CompressZ are documented in this file.

## [Unreleased] — Sidebar Overflow Fix, More Group, Floating Theme Toggle, Font System

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

## [Unreleased] — Batch Queue, Multi-track Audio, Subtitle Passthrough, 2-pass

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

## [Unreleased] — Video Container Fix, 10-bit/Proxy/Passthrough, PDF Metadata Control

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

## [Unreleased] — OCR Layout Rework & Docs Cleanup

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

## [Unreleased] — OCR Symbols & Dedicated Convert Page

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
