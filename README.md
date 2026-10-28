<div align="center">

<img src="public/favicon.svg" width="64" alt="CompressZ logo" />

# CompressZ

**Private, browser-native file compression and OCR.**  
Your files never leave your device.

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-deployed-F38020?logo=cloudflare&logoColor=white)](https://compressz.pages.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-22c55e.svg)](LICENSE)

</div>

---

## Overview

CompressZ compresses images, PDFs, video, audio, and GIFs; converts between video, audio, image, PDF, DOCX, and PPTX formats; and runs OCR on scanned PDFs — entirely inside your browser using WebAssembly, the Canvas API, and Web platform APIs. No backend. No uploads. No tracking.

CompressZ is forked from [CompressF](https://github.com/ADJ189/CompressF).
CompressF is still maintained as its own project.

---

## Tools

| Tool             | Formats                                                                                             | Engine                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Images**       | JPEG · PNG · WebP · AVIF · HEIC · BMP                                                               | Canvas/OffscreenCanvas · optional WebGL2 resize                          |
| **PDF Compress** | PDF                                                                                                 | PDF.js + pdf-lib (structural image resampling)                           |
| **Video**        | MP4 · WebM · MOV · AVI · MKV                                                                        | FFmpeg.wasm → MediaRecorder fallback                                     |
| **Audio**        | MP3 · AAC · OGG · Opus · FLAC · WAV                                                                 | FFmpeg.wasm                                                              |
| **GIF**          | GIF → GIF or WebM VP9                                                                               | FFmpeg.wasm (two-pass palettegen)                                        |
| **SVG**          | SVG                                                                                                 | Pure TypeScript, zero dependencies                                       |
| **PDF OCR**      | Scanned PDF → searchable PDF + TXT                                                                  | Tesseract.js 5 (default) + optional PaddleOCR PP-OCRv3, Greek/math symbols |
| **Convert**      | Video ⇄ video · Audio ⇄ audio · Image ⇄ image · PDF ⇄ Images · DOCX → PDF/TXT/HTML · PPTX → PDF/TXT | FFmpeg.wasm, pdf-lib, mammoth.js, html2canvas, zero-dep ZIP              |
| **Images → PDF** | Images → single PDF, one page each                                                                  | pdf-lib, with an optional local AI sort-by-label pass                    |

---

## Device-Aware Performance, Workbench &amp; Local AI

Settings is a dialog split into eight sections: **General**, **Appearance**, **Performance**, **AI engine**,
**Suggestions**, **Compression**, **Privacy &amp; data**, and **Diagnostics**.

- **Appearance** — `Light`, `Dark`, or `System` (follow the operating system). The header button remains a quick
  light/dark flip; picking a side there opts out of `System`. The resolved value is always written to
  `data-theme`, so the whole stylesheet keeps working unchanged.
- **This Device / Diagnostics** — a read-only snapshot of what your browser exposes locally (OS, CPU cores,
  memory, GPU/WebGL2/WebGPU, cross-origin isolation, network type) plus the execution profile CompressZ derived
  from it. Nothing here is sent anywhere; it is computed by `src/lib/platform.ts`. **Copy diagnostics** writes a
  JSON report containing capability and preference data only — never file names or contents.
- **Resource mode** — `Auto` (follows the device tier), `Memory Saver`, `Balanced`, or `Maximum`. It is a
  *resource* mode, not a quality goal: it controls how many heavyweight jobs the **Adaptive Resource Guard**
  admits at once, the automatic image-dimension cap, FFmpeg threading and which AI model tier `Auto` uses.
  Explicit per-engine overrides (including `resourceLimits.concurrency`, `resourceLimits.maxImageDim` and the
  video preset) still win, and output quality/resolution is never silently lowered.
- **Adaptive Resource Guard** — every heavy engine asks the guard for a slot before it starts. Heavy jobs
  (FFmpeg, OCR, PDF rasterisation, AI inference) and light jobs (Canvas image work) use separate pools, and job
  weight is estimated from file size, pixel count and page count. Browsers do not expose free RAM, so this is a
  scheduling boundary — **not a memory meter**; Settings and the home queue panel say so explicitly. Video,
  audio, GIF and OCR still run one file at a time end to end because they share a single FFmpeg/OCR engine.
- **AI engine — local** — an on/off switch for **Smart Analyze** and **sort by predicted label** on the Images
  and Images → PDF pages. When enabled, a small image-classification model (`Xenova/mobilenet_v2_1.0_224` on
  `Efficient`, `Xenova/vit-base-patch16-224` on `Powerful`, both via
  [`@huggingface/transformers`](https://github.com/huggingface/transformers.js)) runs entirely in your browser.
  WebGPU is attempted only after a real adapter/device probe; unsupported or failed loads fall back to WASM
  (q8). **Inference backend** lets you choose `Auto`, `WebGPU first`, or `CPU (WASM)`; the CPU choice skips the
  GPU probe entirely, and `WebGPU first` still falls back to WASM if the adapter cannot be created. The
  classifier produces an ImageNet-style label, so the sort orders by that predicted label — it does
  **not** compute embeddings or visual-similarity groups. A second, model-free heuristic looks at edge density
  and palette size to guess "photo" vs. "graphic/document" and can optionally auto-apply a matching
  format/quality. No image or file ever leaves your device; model weights are cached by the browser after the
  first download, the same way PaddleOCR and Tesseract already work. **Clear model cache** releases the in-memory
  session and deletes matching Cache Storage entries where the browser allows it.
- **Suggestions** — compact, dismissible, one-primary-at-a-time hints inside a workflow (natural filename order,
  photo→WebP output, Recommended instead of Extreme PDF, PaddleOCR for CJK). Rules are deterministic and read
  only metadata already on the page; they never reorder files, change quality or start a job on their own.
  Dismissals live in `cz-recommendations-v1` and can be forgotten here.

### Home workbench

The home page is a searchable workbench rather than a static hero: filter tools by name or keyword, pin
favourites, and see recently opened tools (`cz-favourite-tools`, `cz-recent-tools` — route names only). A
**Processing queue** panel shows the live Resource Guard state, so a long batch is visible from the home page.

---

## OCR Engines

### Tesseract.js 5 — Default Engine ⭐

| Attribute   | Detail                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Technology  | LSTM neural model compiled to SIMD-accelerated WebAssembly                                                                    |
| Model size  | ~10 MB per language (cached after first use)                                                                                  |
| Best for    | Clean typeset documents, batch processing, rare languages                                                                     |
| Strengths   | 100+ languages (Arabic, Hebrew, Thai, Vietnamese and more), fast on clean high-DPI scans, predictable accuracy, fully offline |
| Limitations | Poor on handwriting, struggles with complex layouts, needs high DPI                                                           |
| Rating      | Handwriting ●●○○○ · Tables ●●●○○ · Print ●●●●● · Low quality ●●○○○ · Speed ●●●●●                                              |

### PaddleOCR PP-OCRv3 — Optional Experimental Engine

| Attribute   | Detail                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Technology  | PP-OCRv3 detection + direction classification + recognition via `@paddle-js-models/ocr` / WebGL |
| Model size  | ~20–25 MB (cached after first use)                                                              |
| Best for    | Printed Latin/CJK text where the PP-OCRv3 recognizer fits; a second opinion for CJK scans       |
| Strengths   | Printed Chinese/Japanese/Korean, separate Latin and CJK recognition models, runs locally        |
| Limitations | Not a vision-language model; no table/form understanding; weak on handwriting and complex layouts |
| Rating      | Handwriting ●●○○○ · Tables ●●○○○ · Print ●●●●○ · Low quality ●●●○○ · Speed ●●●○○                |

> **Naming note:** this is the lightweight PP-OCRv3 pipeline, not
> **PaddleOCR-VL 1.5** (a ~0.9B vision-language document model). The app no
> longer uses that name because it never loaded those weights. Evaluating the
> official PaddleOCR.js PP-OCRv5 path is future work, not a shipped feature.

An optional **Math & Greek symbols** toggle loads Tesseract's `grc` (Greek)
and `equ` (equation layout) traineddata alongside the selected language —
reliable for inline Greek letters (θ, π, Σ, …), best-effort for full
equations. Always runs on Tesseract regardless of the engine picked above.

### Auto Mode

`auto` currently resolves to Tesseract.js, the stable default. Language/script
is auto-detected from the first page render using Tesseract's OSD
(Orientation & Script Detection, PSM=0), mapping detected scripts to the
correct language model. Settings → OCR defaults seed the live engine and
language on a fresh OCR page; Eco mode starts at a lower render DPI.

### When to use which

| Document type              | Recommended engine                    |
| -------------------------- | ------------------------------------- |
| Handwritten notes, letters | Tesseract.js (best available fallback) |
| Printed books, reports     | Tesseract.js                          |
| Tables, invoices, forms    | Tesseract.js (no layout-aware engine) |
| CJK documents              | Try both; PaddleOCR PP-OCRv3 optional |
| Arabic / Hebrew / RTL      | Tesseract.js (dedicated models)       |
| Rare languages             | Tesseract.js (100+ lang coverage)     |
| Low-quality / noisy scans  | Tesseract.js with a higher render DPI |
| Batch processing (speed)   | Tesseract.js                          |

---

## Convert

A dedicated format-conversion tool, separate from the compressors above —
these change the _format_, not primarily the size:

| Direction                    | Formats                                         | Notes                                  |
| ---------------------------- | ----------------------------------------------- | -------------------------------------- |
| Video → Video                | MP4 · WebM · MOV · MKV · AVI · GIF              | FFmpeg.wasm, near-lossless (CRF 18)    |
| Audio → Audio                | MP3 · AAC · OGG · Opus · FLAC · WAV             | FFmpeg.wasm                            |
| Image → Image                | JPEG · PNG · WebP · AVIF                        | Canvas, quality 0.95                   |
| PDF → Images                 | PNG · JPEG (one per page, zipped if multi-page) | pdf.js                                 |
| Images → PDF                 | Any number of images → one PDF                  | pdf-lib, reorderable before combining  |
| Word (.docx) → PDF/TXT/HTML  | —                                               | mammoth.js + html2canvas + pdf-lib     |
| PowerPoint (.pptx) → PDF/TXT | —                                               | Text extracted directly from slide XML |

**Honesty about limits, on purpose:** DOCX→PDF is an image-based PDF (text
isn't selectable — use the TXT output if you need that), and PPTX
conversion is a text reconstruction, not a visual/layout-accurate one —
there's no realistic client-side engine for full OOXML slide rendering.
Legacy `.doc`/`.ppt` aren't supported; save as `.docx`/`.pptx` first.
Multi-page PDF→Images bundling needs `CompressionStream` (Chrome/Edge 80+,
Firefox 113+, Safari 16.4+) — single-page PDFs work everywhere regardless.

---

## PDF Compression

Two strategies, selected automatically:

**Strategy A — Structural** (Low and Recommended presets)  
Walks the PDF XObject resource dictionary, finds embedded images, downscales to target DPI via OffscreenCanvas, re-encodes as JPEG in-place. Text and vectors untouched.

**Strategy B — Canvas render** (Extreme preset + fallback for encrypted PDFs)  
PDF.js renders each page to OffscreenCanvas with `colorSpace: 'srgb'` and `intent: 'print'`, embedded via pdf-lib.

| Preset      | DPI | JPEG quality | Strategy   |
| ----------- | --- | ------------ | ---------- |
| Low         | 220 | 0.85         | Structural |
| Recommended | 150 | 0.72         | Structural |
| Extreme     | 96  | 0.45         | Canvas     |

**Target size mode** — enter a specific MB or KB value; CompressZ binary-searches JPEG quality over 10 iterations to hit it.

---

## Architecture

```
compressz/
├── .github/
│   ├── workflows/        # ci.yml (typecheck/lint/build), e2e.yml, lighthouse.yml
│   └── dependabot.yml    # Weekly grouped updates, major versions pinned
├── e2e/
│   ├── smoke.spec.ts     # Playwright: routes, workbench, settings, responsive, privacy
│   └── rules.spec.ts     # Pure Node tests: recommendation rules + Resource Guard estimators
├── public/
│   ├── _headers          # COOP/COEP → SharedArrayBuffer (FFmpeg MT)
│   ├── _redirects        # SPA fallback
│   ├── favicon.svg / .png
│   ├── robots.txt
│   └── sitemap.xml
├── scripts/
│   └── strip-oversized-assets.mjs  # Drops files over Cloudflare Pages' 25 MiB limit
├── src/
│   ├── lib/              # Engines, one file per format
│   │   ├── types.ts
│   │   ├── compress.ts       # Type dispatcher (not imported by the app yet)
│   │   ├── compressImage.ts
│   │   ├── compressPdf.ts    # Two-strategy PDF compression
│   │   ├── compressVideo.ts  # FFmpeg → MediaRecorder fallback
│   │   ├── compressAudio.ts
│   │   ├── compressGif.ts
│   │   ├── optimizeSvg.ts    # Pure TypeScript SVG optimizer
│   │   ├── convertMedia.ts / convertOffice.ts / convertPdf.ts
│   │   ├── imagesToPdf.ts / mergePdf.ts
│   │   ├── imageDecode.ts / thumb.ts / aiEngine.ts
│   │   ├── resourceManager.ts # Adaptive Resource Guard (admission + queue)
│   │   ├── recommendations.ts # Deterministic contextual suggestions
│   │   ├── recents.ts / workbench.ts # Home pins, recents, live queue panel
│   │   ├── theme.ts          # light / dark / system preference
│   │   ├── settings.ts       # cz-settings-v2 + resolveExecutionProfile()
│   │   └── ffmpeg.ts / pdfLibs.ts / zip.ts / …
│   ├── pages/            # One file per route
│   │   ├── images.ts / pdf.ts / video.ts / audio.ts / gif.ts
│   │   ├── convert.ts / imagesToPdf.ts / mergePdf.ts / settings.ts
│   │   └── ocr.ts            # Tesseract.js 5 + optional PaddleOCR PP-OCRv3
│   ├── components/       # React component library (not used by the app)
│   ├── utils/            # cn, prefersReducedMotion, canHover, assignRef
│   ├── index.ts          # Library entry for src/components
│   ├── styles.css        # Library styles (imported by index.ts)
│   ├── components.ts     # Shared DOM helpers for the app
│   ├── router.ts
│   ├── store.ts
│   ├── toast.ts
│   ├── styles/workbench.css  # `.cz-*` scoped styles for new UI
│   ├── style.css         # App stylesheet (legacy components + tokens)
│   └── main.ts
├── index.html                # App shell + page templates
├── vite.config.ts            # Vite 8, esnext, COOP/COEP dev headers
├── playwright.config.ts
├── lighthouserc.json         # Lighthouse CI config
├── tsconfig.json
├── package.json              # Canonical npm scripts (CI + Cloudflare Pages)
├── AGENTS.md                 # Engine invariants + agent/contributor checklist
├── CHANGELOG.md
├── CONTRIBUTING.md           # Dev setup, conventions, PR checklist
├── CREDITS.md                # Open-source attributions & licenses
├── PRIVACY.md                # Standalone copy of the in-app privacy page
└── SECURITY.md               # Vulnerability reporting policy
```

---

## Local Development

Requires **Node.js `^20.19.0 || ^22.13.0 || >=24`** (see `package.json`).
npm is the canonical runner for GitHub Actions and Cloudflare Pages.

```bash
npm ci             # reproducible install from package-lock.json
npm run dev        # http://localhost:5173
npm run build      # → dist/ (also strips oversize assets)
npm run preview    # serve dist/ locally
npm run typecheck  # TypeScript check
npm run lint       # ESLint
npx --no-install playwright install chromium webkit   # once
npm run test:e2e   # Playwright matrix (builds, then serves dist/)
npm run lighthouse # Lighthouse CI
```

Node/npm is the only supported runner. GitHub Actions, Cloudflare Pages,
Playwright and Lighthouse all use these scripts; there is no second toolchain
to keep in sync.

See [AGENTS.md](AGENTS.md) for the engine invariants and verification checklist.

## Browser Compatibility

| Feature                       | Chrome | Firefox | Safari | Edge |
| ----------------------------- | ------ | ------- | ------ | ---- |
| Image (JPEG/WebP)             | 80+    | 80+     | 14+    | 80+  |
| Image (AVIF)                  | 85+    | 93+     | 16.1+  | 85+  |
| PDF compress                  | 80+    | 80+     | 14+    | 80+  |
| FFmpeg.wasm                   | 91+    | 91+     | 15.2+  | 91+  |
| FFmpeg MT (SharedArrayBuffer) | 91+    | 91+     | 15.4+  | 91+  |
| WebGL2 resize                 | 56+    | 51+     | 15+    | 79+  |
| WebGPU local AI (optional)    | Feature-tested | Feature-tested | Feature-tested | Feature-tested |
| PaddleOCR PP-OCRv3 (WebGL)    | 91+    | 91+     | 15.2+  | 91+  |
| Tesseract.js (WASM)           | 91+    | 91+     | 15.2+  | 91+  |

WebGPU AI is optional: the app probes for a real adapter/device on first use and silently uses the WASM
classifier when the API is missing, blocked, or the model fails to load. "WebCodecs API present" is reported
in Settings for diagnostics only; the video compressor does not currently use a WebCodecs/muxer path.

---

## Privacy

CompressZ has no backend. Files never leave your browser. See [PRIVACY.md](PRIVACY.md) (also live at [/privacy](https://compressz.pages.dev/privacy)) for full details.

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
dev setup, project conventions, and PR checklist.

---

## Credits & Acknowledgments

CompressZ is built on PDF.js, pdf-lib, FFmpeg.wasm, Tesseract.js,
PaddleOCR/Paddle.js, mammoth.js, html2canvas, Hugging Face `transformers.js`,
anime.js, Vite, and TypeScript — see [CREDITS.md](CREDITS.md) for the full
list with licenses and links. None of those projects are affiliated with
or endorse CompressZ.

CompressZ is a fork of [CompressF](https://github.com/ADJ189/CompressF) —
also maintained, and worth a look if you want a leaner, format-focused
sister tool instead of CompressZ's broader engine set.

---

See [CHANGELOG.md](CHANGELOG.md) for release history.

Made with ❤️ by ADJ and team · Apache License 2.0
