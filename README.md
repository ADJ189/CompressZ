<div align="center">

<img src="public/favicon.svg" width="64" alt="CompressZ logo" />

# CompressZ

**Private, browser-native file compression and OCR.**  
Nothing ever leaves your device.

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-deployed-F38020?logo=cloudflare&logoColor=white)](https://compressz.pages.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-22c55e.svg)](LICENSE)

</div>

---

## Overview

CompressZ compresses images, PDFs, video, audio, and GIFs; converts between video, audio, image, PDF, DOCX, and PPTX formats; and runs OCR on scanned PDFs — entirely inside your browser using WebAssembly, Canvas API, WebCodecs, and two neural OCR engines. No backend. No uploads. No tracking.

CompressZ is forked from [CompressF](https://github.com/ADJ189/CompressF). 
CompressF is still maintained as its own project .

---

## Tools

| Tool | Formats | Engine |
|------|---------|--------|
| **Images** | JPEG · PNG · WebP · AVIF · HEIC · BMP | OffscreenCanvas (GPU) |
| **PDF Compress** | PDF | PDF.js + pdf-lib (structural image resampling) |
| **Video** | MP4 · WebM · MOV · AVI · MKV | FFmpeg.wasm → WebCodecs → MediaRecorder |
| **Audio** | MP3 · AAC · OGG · Opus · FLAC · WAV | FFmpeg.wasm |
| **GIF** | GIF → GIF or WebM VP9 | FFmpeg.wasm (two-pass palettegen) |
| **SVG** | SVG | Pure TypeScript, zero dependencies |
| **PDF OCR** | Scanned PDF → searchable PDF + TXT | PaddleOCR-VL 1.5 (primary) + Tesseract.js 5, optional Greek/math symbols |
| **Convert** | Video ⇄ video · Audio ⇄ audio · Image ⇄ image · PDF ⇄ Images · DOCX → PDF/TXT/HTML · PPTX → PDF/TXT | FFmpeg.wasm, pdf-lib, mammoth.js, html2canvas, zero-dep ZIP |
| **Images → PDF** | Images → single PDF, one page each | pdf-lib, with an optional local AI sort pass |

---

## Device-Aware Performance & Local AI

Settings now includes three sections beyond the per-engine defaults:

- **This Device** — a read-only snapshot of what your browser exposes locally (OS, CPU cores, memory,
  GPU/WebGL2/WebGPU, cross-origin isolation, network type) and the performance tier CompressZ derived from it.
  Nothing here is sent anywhere; it's computed by `src/lib/platform.ts` on load.
- **Performance Mode** — `Auto` (follows the device's tier) or a manual `Efficient` / `Balanced` / `Powerful`
  override, controlling GPU-acceleration defaults, the video encode preset, and batch concurrency.
- **AI Engine — Local** — an on/off switch for **Smart Analyze / Smart Sort** on the Images and Images → PDF
  pages. When enabled, a small image-classification model (`Xenova/mobilenet_v2_1.0_224` on `Efficient`,
  `Xenova/vit-base-patch16-224` on `Powerful`, both via [`@huggingface/transformers`](https://github.com/huggingface/transformers.js))
  runs entirely in your browser — WASM, or WebGPU where available — to tag what's in each image and group
  similar ones together. A second, model-free heuristic looks at edge density and palette size to guess
  "photo" vs. "graphic/document" and can optionally auto-apply a matching format/quality. No image or file
  ever leaves your device; model weights are cached by the browser after the first download, the same way
  PaddleOCR and Tesseract already work.

---

## OCR Engines

### PaddleOCR-VL 1.5 — Primary Engine ⭐

| Attribute | Detail |
|-----------|--------|
| Technology | PP-OCRv3 detection + direction classification + CRNN recognition via WebGL/ONNX |
| Model size | ~25 MB (cached after first use) |
| Best for | **Handwriting** (print and cursive), tables, forms, multi-column layouts, rotated text, CJK scripts, low-quality and noisy scans |
| Strengths | Document structure understanding, complex layout handling, Chinese/Japanese/Korean, robust to image quality |
| Limitations | Heavier first load, requires WebGL, slower on large batches |
| Rating | Handwriting ●●●●● · Tables ●●●●● · Print ●●●●● · Low quality ●●●●● · Speed ●●●○○ |

### Tesseract.js 5 — Secondary Engine

| Attribute | Detail |
|-----------|--------|
| Technology | LSTM neural model compiled to SIMD-accelerated WebAssembly |
| Model size | ~10 MB per language (cached after first use) |
| Best for | Clean typeset documents, batch processing, rare languages |
| Strengths | 100+ languages (Arabic, Hebrew, Thai, Vietnamese and more), fast on clean high-DPI scans, predictable accuracy, fully offline |
| Limitations | Poor on handwriting, struggles with complex layouts, needs high DPI |
| Rating | Handwriting ●●○○○ · Tables ●●●○○ · Print ●●●●● · Low quality ●●○○○ · Speed ●●●●● |

An optional **Math & Greek symbols** toggle loads Tesseract's `grc` (Greek)
and `equ` (equation layout) traineddata alongside the selected language —
reliable for inline Greek letters (θ, π, Σ, …), best-effort for full
equations. Always runs on Tesseract regardless of the engine picked above.

### Auto Mode

Auto selects PaddleOCR-VL 1.5 by default. Language/script is auto-detected from the first page render using Tesseract's OSD (Orientation & Script Detection, PSM=0), mapping detected scripts to the correct language model.

### When to use which

| Document type | Recommended engine |
|--------------|-------------------|
| Handwritten notes, letters | PaddleOCR-VL 1.5 |
| Printed books, reports | Either (Tesseract slightly faster) |
| Tables, invoices, forms | PaddleOCR-VL 1.5 |
| CJK documents | PaddleOCR-VL 1.5 |
| Arabic / Hebrew / RTL | Tesseract.js (dedicated models) |
| Rare languages | Tesseract.js (100+ lang coverage) |
| Low-quality / noisy scans | PaddleOCR-VL 1.5 |
| Batch processing (speed) | Tesseract.js |

---

## Convert

A dedicated format-conversion tool, separate from the compressors above —
these change the *format*, not primarily the size:

| Direction | Formats | Notes |
|-----------|---------|-------|
| Video → Video | MP4 · WebM · MOV · MKV · AVI · GIF | FFmpeg.wasm, near-lossless (CRF 18) |
| Audio → Audio | MP3 · AAC · OGG · Opus · FLAC · WAV | FFmpeg.wasm |
| Image → Image | JPEG · PNG · WebP · AVIF | Canvas, quality 0.95 |
| PDF → Images | PNG · JPEG (one per page, zipped if multi-page) | pdf.js |
| Images → PDF | Any number of images → one PDF | pdf-lib, reorderable before combining |
| Word (.docx) → PDF/TXT/HTML | — | mammoth.js + html2canvas + pdf-lib |
| PowerPoint (.pptx) → PDF/TXT | — | Text extracted directly from slide XML |

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

| Preset | DPI | JPEG quality | Strategy |
|--------|-----|-------------|----------|
| Low | 220 | 0.85 | Structural |
| Recommended | 150 | 0.72 | Structural |
| Extreme | 96 | 0.45 | Canvas |

**Target size mode** — enter a specific MB or KB value; CompressZ binary-searches JPEG quality over 10 iterations to hit it.

---

## Architecture

```
compressz/
├── public/
│   ├── _headers          # COOP/COEP → SharedArrayBuffer (FFmpeg MT)
│   ├── _redirects        # SPA fallback
│   ├── favicon.svg / .png
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── lib/
│   │   ├── types.ts
│   │   ├── compress.ts
│   │   ├── compressImage.ts
│   │   ├── compressPdf.ts    # Two-strategy PDF compression
│   │   ├── compressVideo.ts  # FFmpeg → WebCodecs → MediaRecorder
│   │   ├── compressAudio.ts
│   │   ├── compressGif.ts
│   │   ├── optimizeSvg.ts
│   │   └── ffmpeg.ts
│   ├── pages/
│   │   ├── images.ts
│   │   ├── pdf.ts
│   │   ├── video.ts
│   │   ├── audio.ts
│   │   ├── gif.ts
│   │   └── ocr.ts            # PaddleOCR-VL 1.5 + Tesseract.js 5
│   ├── components.ts
│   ├── router.ts
│   ├── toast.ts
│   ├── style.css
│   └── main.ts
├── index.html                # App shell + page templates
├── vite.config.ts            # Vite 6, esnext, COOP/COEP dev headers
├── tsconfig.json
├── package.json
├── CHANGELOG.md
├── CREDITS.md                # Open-source attributions & licenses
├── PRIVACY.md                # Standalone copy of the in-app privacy page
└── .github/dependabot.yml    # Weekly grouped updates, major versions pinned
```

---

## Local Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
npm run preview    # serve dist/ locally
npm run typecheck  # TypeScript check
```

---

## Cloudflare Pages Deployment

**Dashboard settings** (no other config needed — `wrangler.json` is intentionally absent):

| Setting | Value |
|---------|-------|
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `20` |

The `public/_headers` file sets COOP/COEP automatically, enabling SharedArrayBuffer for multithreaded FFmpeg.

---

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Image (JPEG/WebP) | 80+ | 80+ | 14+ | 80+ |
| Image (AVIF) | 85+ | 93+ | 16.1+ | 85+ |
| PDF compress | 80+ | 80+ | 14+ | 80+ |
| FFmpeg.wasm | 91+ | 91+ | 15.2+ | 91+ |
| FFmpeg MT (SharedArrayBuffer) | 91+ | 91+ | 15.4+ | 91+ |
| WebCodecs GPU video | 94+ | — | 16.4+ | 94+ |
| PaddleOCR (WebGL) | 91+ | 91+ | 15.2+ | 91+ |
| Tesseract.js (WASM) | 91+ | 91+ | 15.2+ | 91+ |

---

## Privacy

CompressZ has no backend. Files never leave your browser. See [PRIVACY.md](PRIVACY.md) (also live at [/privacy](https://compressz.pages.dev/privacy)) for full details.

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
dev setup, project conventions, and PR checklist. Participation is governed
by the [Code of Conduct](CODE_OF_CONDUCT.md).

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
