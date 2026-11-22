# Privacy Policy — CompressZ

CompressZ is an open-source, local-first web application designed for
compression, format conversion, structural editing, optical character
recognition (OCR), and local machine learning classification of multimedia,
documents, and office files.

CompressZ is a client-side fork of [CompressF](https://github.com/ADJ189/CompressF).
The deployed application is hosted at <https://compressz.pages.dev>.

**The core architectural guarantee of CompressZ is that your file bytes never
leave your device.**

---

## 1. Zero file uploads

All core file processing operations execute strictly within your local web
browser runtime environment utilizing:
- **HTML5 Canvas 2D and WebGL2** rendering contexts for raster operations,
- **WebAssembly (WASM)** modules for binary format encoding, decoding, OCR,
  and PDF manipulations,
- **Hardware-accelerated WebCodecs API** for native client-side video and audio
  transcoding, and
- **WebGPU / WASM SIMD** for localized neural network tensor inference.

Your source files, converted outputs, extracted text, and document metadata are
never transmitted across the network, stored on a remote server, or retained
beyond your active browser session.

---

## 2. In-memory and local execution

File data read via drag-and-drop or file pickers is retained exclusively in your
browser tab's transient memory (`ArrayBuffer`, `Blob`, `ImageData`, or
ephemeral `blob:` object URLs). Once a file card is removed, the queue is
cleared, or the browser tab is closed, these references are dereferenced and
garbage collected.

---

## 3. Network activity and runtime dependencies

CompressZ operates with minimal outbound network requests:

### Static hosting
The static HTML, JavaScript, CSS, and manifest assets are served via Cloudflare
Pages. Cloudflare may collect standard HTTP transmission metadata (including
client IP address and user agent) in accordance with
[Cloudflare's Privacy Policy](https://www.cloudflare.com/privacypolicy/).

### Content Delivery Networks (CDNs)
To minimize initial bundle size and enable lazy evaluation of specialized
engines, certain third-party libraries, WebAssembly binaries, and model
weights are fetched on-demand from public CDNs upon first user invocation:

- **FFmpeg.wasm** (`@ffmpeg/ffmpeg`, `@ffmpeg/core`) — loaded from
  `unpkg.com` for advanced video, audio, and animated GIF transcoding.
- **PDF.js** (`pdfjs-dist`) — loaded from `cdnjs.cloudflare.com` for vector
  PDF rendering.
- **pdf-lib** (`pdf-lib`) — loaded from `cdn.jsdelivr.net` for structural PDF
  resampling, splitting, and merging.
- **Tesseract.js** (`tesseract.js`, `tesseract.js-core`) and trained language
  data — loaded from `cdn.jsdelivr.net` and `tessdata.projectnaptha.com`
  for printed character OCR.
- **PaddleOCR PP-OCRv3** (`@paddlejs-models/ocr`) — loaded from
  `cdn.jsdelivr.net` for optional lightweight OCR.
- **Transformers.js** (`@huggingface/transformers`) — model weights for
  optional on-device image classification (`Xenova/mobilenet_v2_1.0_224`,
  `Xenova/vit-base-patch16-224`, `Xenova/trocr-small-handwritten`) are fetched from
  `huggingface.co` or `cdn.jsdelivr.net` on demand and cached locally via the
  Cache API.
- **heic2any** — loaded from `cdn.jsdelivr.net` if native HEIC/HEIF decoding
  is unsupported by your browser.
- **mammoth.js** — loaded from `cdnjs.cloudflare.com` for client-side DOCX
  to HTML/PDF preview conversion.
- **Mediabunny** — loaded from `esm.sh` for fast WebCodecs container muxing.
- **onnxruntime-web** — loaded from `cdn.jsdelivr.net` for local AI
  inference.
- **QPDF WASM** — loaded from `cdn.jsdelivr.net` for AES-256 PDF encryption,
  password removal and deep cross-reference repair in PDF Suite. The PDF bytes
  are processed inside the WebAssembly module in this tab; nothing is uploaded.
- **Noto Sans (OCR text layer)** — the Unicode font embedded into searchable
  PDFs is fetched from `cdn.jsdelivr.net` on the first OCR run. Only the font
  file is downloaded; OCR text and page images stay in this tab.

These CDN requests are for static assets (JavaScript, WebAssembly and
model weights) only. Your file content is never included in these
requests. Standard CDN access logs (IP address, timestamp, asset
requested) may be retained by the CDN providers per their own privacy
policies.

Google Fonts is used for typography and is loaded from
`fonts.googleapis.com`. This may log your IP address per
[Google's privacy policy](https://policies.google.com/privacy). Heavy
engines are downloaded on first use and cached; there is no full
offline pack yet.

- **Anonymous Error Diagnostics (Sentry)** — to detect crashes, unhandled
  exceptions, and WASM engine failures, anonymous diagnostics are sent to
  `sentry.io`. This is enabled by default. Client-side error payloads strictly
  scrub and exclude user identifiers, filenames, file paths, and document contents.
  Client IP addresses are deleted from the event payload; as with all web requests,
  the ingestion endpoint briefly processes socket transport metadata during the HTTPS handshake.
  Users can opt out anytime in Settings under Privacy & data (persisted locally via `cz-telemetry-opt-out`),
  which stops reporting immediately without requiring a reload. For complete details, see [docs/TELEMETRY_POLICY.md](docs/TELEMETRY_POLICY.md).

For comprehensive technical specifications on each processing engine and on-device AI inference, see:
- [docs/ENGINE_POLICY.md](docs/ENGINE_POLICY.md) — Media, PDF, Office, and Archive engine specifications
- [docs/AI_ENGINE_POLICY.md](docs/AI_ENGINE_POLICY.md) — On-device AI/ML runtime and privacy policy
- [docs/TELEMETRY_POLICY.md](docs/TELEMETRY_POLICY.md) — Complete error reporting and anonymization pipeline

## 5. Local storage

CompressZ stores these keys in your browser's `localStorage`:

- `theme` — your appearance preference: `light`, `dark`, or `system`
  (follow the operating system).
- `cz-color-scheme` — the active color palette: `polished` (emerald),
  `origin` (classic royal blue), or `blood-moon` (crimson scarlet).
- `cz-settings-v2` — engine defaults, GPU toggles, the Adaptive Resource
  Guard mode and limits, local-AI options, and whether contextual
  suggestions are enabled.
- `cz-settings-v1` — a legacy settings blob, only read once to migrate an
  older install.
- `cz-recommendations-v1` — the small set of suggestions you have dismissed,
  stored as rule/action ids (no file names).
- `cz-recent-tools` — the route names of tools you opened recently, used for
  the "Pinned & recent" panel on the home page.
- `cz-favourite-tools` — the route names you pinned on the home page.
- `cz-convert-profile` — the last category, target format and quality settings you
  used on the Multi-Format Converter (format names only, never file names).
- `cz-pdfsuite-profile` — the encryption standard, render DPI and permission
  toggles you last picked in PDF Suite.
- `cz-telemetry-opt-out` — indicates whether anonymous error diagnostics have been disabled (enabled by default).

These values never leave your device. Contextual suggestions are evaluated
locally from metadata that is already in the page (file names, byte sizes,
page counts, pixel dimensions). Dismissals are stored only as the suggestion
id, never the input file name.

---

## 6. Cookies and tracking

CompressZ does not use tracking cookies, advertising beacons, third-party
analytics scripts, or device fingerprinting mechanisms. The only outbound
telemetry is anonymous crash diagnostics (Sentry, enabled by default, opt-out
in Settings) and static engine/model assets from CDNs.

---

## 7. Fork parity with CompressF

CompressZ is an independent fork of CompressF. All privacy guarantees of
CompressF (zero uploads, client-side only processing, no account requirements)
are strictly maintained in CompressZ. In addition:
- Added anonymous error diagnostics (Sentry, enabled by default, opt-out in Settings) with client-side scrubbing of filenames, paths, and user data.
- Added English handwriting recognition (TrOCR candidate) running entirely
  locally in the browser tab via WebGPU or WASM.
- Expanded OCR capabilities to produce searchable PDFs with embedded invisible
  text layers and page raster reconstructions completely client-side.
- Added client-side PDF to Markdown extraction with LaTeX formula and GFM table
  preservation.

---

## 8. Open source transparency

The complete source code for CompressZ is publicly auditable at
<https://github.com/ADJ189/compressz>. Users can inspect network calls via
browser developer tools (Network tab) to verify zero file content transmission.

---

## 9. Contact

For security inquiries, audit verifications, or vulnerability disclosures,
please open an issue on the GitHub repository:
<https://github.com/ADJ189/compressz/issues>.