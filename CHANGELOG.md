# Changelog

All notable changes to CompressZ are documented in this file.

## [Unreleased] — Alignment, Security & OCR Engine Pass

### Fixed — Layout / Alignment

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
