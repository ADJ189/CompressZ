# Credits & Acknowledgments

CompressZ is built on top of the work of a lot of other open-source
projects. None of them are affiliated with CompressZ or endorse it —
they're just excellent tools that make client-side compression and OCR
possible in a browser. This file exists to give them proper credit and
to make the licensing situation clear at a glance.

CompressZ itself is licensed under **Apache 2.0** ([LICENSE](LICENSE)).
Everything below is loaded either as a build-time dependency or fetched
from a CDN at runtime (see [PRIVACY.md](PRIVACY.md) for what that means
for your data).

## OCR

| Project | What it does here | License | Link |
|---|---|---|---|
| **Tesseract.js** | LSTM OCR engine, SIMD WebAssembly build, 100+ languages | Apache 2.0 | https://github.com/naptha/tesseract.js |
| **tesseract.js-core** | WASM core powering Tesseract.js | Apache 2.0 | https://github.com/naptha/tesseract.js-core |
| **Tesseract OCR** | The underlying OCR engine Tesseract.js wraps, originally developed at HP and now maintained by Google | Apache 2.0 | https://github.com/tesseract-ocr/tesseract |
| **tessdata (fast)** | Trained language data, hosted by the Tesseract.js project via `tessdata.projectnaptha.com` | Apache 2.0 | https://github.com/tesseract-ocr/tessdata_fast |
| **PaddleOCR / PP-OCRv3** | Detection + classification + recognition models used by the optional experimental OCR engine | Apache 2.0 | https://github.com/PaddlePaddle/PaddleOCR |
| **@paddle-js-models/ocr** | Browser/WebGL runtime that loads the PP-OCRv3 models client-side | Apache 2.0 | https://github.com/PaddlePaddle/Paddle.js |

## PDF

| Project | What it does here | License | Link |
|---|---|---|---|
| **PDF.js** | Renders PDF pages to canvas for compression, OCR, and PDF→image conversion | Apache 2.0 | https://github.com/mozilla/pdf.js |
| **pdf-lib** | Builds and edits PDFs client-side (structural compression, searchable-PDF output, images→PDF) | MIT | https://github.com/Hopding/pdf-lib |

## Video / Audio / GIF

| Project | What it does here | License | Link |
|---|---|---|---|
| **FFmpeg.wasm** | WebAssembly build of FFmpeg powering video, audio, and GIF compression/conversion | MIT (wasm build) | https://github.com/ffmpegwasm/ffmpeg.wasm |
| **FFmpeg** | The underlying multimedia framework FFmpeg.wasm compiles to WASM | LGPL 2.1+ / GPL 2+ depending on build config | https://ffmpeg.org |
| **Mediabunny** | Demuxes, muxes, and converts media for the capability-gated WebCodecs video fast path | MPL 2.0 | https://github.com/Vanilagy/mediabunny |

CompressZ uses the LGPL-configured build of FFmpeg.wasm — no GPL-only
codecs are enabled, so no source-distribution obligations beyond
FFmpeg's own are triggered by using it as a dynamically-loaded library.

## Office document conversion

| Project | What it does here | License | Link |
|---|---|---|---|
| **mammoth.js** | Converts `.docx` to HTML for the Word → PDF/TXT/HTML tool | BSD 2-Clause | https://github.com/mwilliamson/mammoth.js |
| **html2canvas** | Rasterizes the converted HTML to produce the DOCX → PDF output | MIT | https://github.com/niklasvh/html2canvas |

## Local AI

| Project | What it does here | License | Link |
|---|---|---|---|
| **🤗 Transformers.js** | Runs the on-device image-classification model (Settings → AI Engine) entirely in-browser via WASM, with an optional WebGPU backend when a real adapter/device is available — no upload | Apache 2.0 | https://github.com/huggingface/transformers.js |
| **onnxruntime-web** | WASM/WebGPU inference runtime used by Transformers.js; its binaries are loaded from jsDelivr | MIT | https://github.com/microsoft/onnxruntime |
| **MobileNetV2 / ViT-Base (Xenova ONNX conversions)** | The two selectable model tiers (`Efficient`/`Powerful`) that back Smart Analyze and sort-by-predicted-label | Apache 2.0 | https://huggingface.co/Xenova |

## Image decoding

| Project | What it does here | License | Link |
|---|---|---|---|
| **heic2any** | Lazy-loaded WASM fallback for decoding HEIC/HEIF photos in browsers without native support | MIT | https://github.com/alexcorvi/heic2any |

## Animation

| Project | What it does here | License | Link |
|---|---|---|---|
| **anime.js** | Entrance/reveal animations for the Settings page's new sections and Smart Analyze's re-sorted file cards | MIT | https://github.com/juliangarnier/anime |

## Build tooling

| Project | What it does here | License | Link |
|---|---|---|---|
| **Vite** | Dev server and production bundler | MIT | https://github.com/vitejs/vite |
| **TypeScript** | Language and type checking | Apache 2.0 | https://github.com/microsoft/TypeScript |

## Fonts & hosting

- **Google Fonts** — typography, loaded from `fonts.googleapis.com`. See
  [PRIVACY.md](PRIVACY.md) for what that means for your IP address.
- **Cloudflare Pages** — static hosting.
- **jsDelivr** — CDN used to serve pdf.js, pdf-lib, Tesseract.js, PaddleOCR
  model weights, mammoth.js, html2canvas and onnxruntime-web at runtime.
- **esm.sh** — CDN used to serve FFmpeg.wasm's core and utility packages,
  Mediabunny for the WebCodecs video path, plus heic2any when a HEIC/HEIF file
  needs fallback decoding.
- **Hugging Face** — hosts the Xenova ONNX model weights downloaded on first
  use by the local AI engine.

---

If you notice a missing or incorrect attribution, please open an issue
or a PR — it's not intentional, and we want this list to be accurate.
