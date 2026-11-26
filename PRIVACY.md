# Privacy Policy

_Last updated: October 2026_

This is the same privacy policy shown at [/privacy](https://compressz.pages.dev/privacy)
inside the app. It's mirrored here so it's readable directly from the
repo without running the site.

**The short version:** CompressZ processes all files locally in your
browser. We do not have servers that receive your files. We collect no
personal data, run no analytics, and set no cookies. Your files and
their contents are never transmitted to us or any third party.

## 1. Who we are

CompressZ is an open-source, client-side web application for file
compression and OCR. The application is served as a static website
hosted on Cloudflare Pages. Source code is publicly available on
GitHub.

## 2. Data we do NOT collect

- We do **not** collect or store any files you process.
- We do **not** collect names, email addresses, or any personal identifiers.
- We do **not** use cookies for tracking or advertising.
- We do **not** run analytics scripts (no Google Analytics, Mixpanel, or similar).
- We do **not** sell, share, or transfer user files to third parties (anonymous crash diagnostics may be transmitted to Sentry when enabled; see §7).
- We do **not** have a backend server that touches your files.

## 3. How file processing works

All compression, conversion, PDF Suite & Studio operations (splitting, permanent cropping,
watermarking, signing, AcroForm filling, true redaction with 300-DPI raster stream purge,
AES-256 password protection, and corrupt file recovery), two-way Office document conversions,
PDF to Markdown extraction, OCR (printed and English handwriting recognition), and local-AI
operations run entirely inside your browser using WebAssembly, the Canvas API, and Web platform
APIs. Your files are read from your device into browser memory (RAM), processed locally,
and the output is written back to your device. At no point do your files traverse a network
connection to our infrastructure.

When extracting Markdown from a PDF, document layout analysis, reading order
reconstruction, figure crop generation, and ZIP packaging run entirely client-side.
When using the English handwriting recognition engine, line segmentation and
TrOCR neural inference occur completely within your browser's WebGPU or WASM runtime.
Zero text or visual crop data leaves your device.

You can verify this yourself by opening your browser's Network tab
while using CompressZ — you will see no requests containing your file
data.

## 4. Third-party libraries loaded at runtime

Some processing engines and model weights are loaded from a CDN on
first use and cached by your browser thereafter. Full attribution and
licenses for all of these are in [CREDITS.md](CREDITS.md); the
privacy-relevant summary is:

- **FFmpeg.wasm** — loaded from `esm.sh` and jsDelivr (`cdn.jsdelivr.net`) (video/audio/GIF). `esm.sh` serves
  the package wrapper and utilities; jsDelivr (`cdn.jsdelivr.net`) serves the core scripts, worker, and WebAssembly binaries.
  No file data is sent to either host.
- **Mediabunny** — loaded from `esm.sh` only when the browser supports
  WebCodecs and the requested output codec configuration is encodable
  (video fast path). It demuxes and muxes media in-memory; no file data is
  sent to esm.sh.
- **PDF.js** — loaded from jsDelivr (`cdn.jsdelivr.net`) (PDF rendering).
- **pdf-lib** — loaded from `cdn.jsdelivr.net` (PDF generation).
- **Tesseract.js** — loaded from `cdn.jsdelivr.net` and
  `tessdata.projectnaptha.com` (OCR engine and trained language data).
- **🤗 Transformers.js** — bundled at build time; model weights for image
  classification (`Xenova/mobilenet_v2_1.0_224`, `Xenova/vit-base-patch16-224`)
  and English handwriting recognition (`Xenova/trocr-small-handwritten`) are
  downloaded from Hugging Face's CDN on first use, then cached by your browser.
  Inference is executed on-device — nothing is uploaded to Hugging Face or anywhere else.
- **PaddleOCR / PP-OCRv3** — loaded from `cdn.jsdelivr.net` and
  `paddlejs.bj.bcebos.com` (optional OCR runtime and model weights).
- **mammoth.js** and **html2canvas** — loaded from jsDelivr (`cdn.jsdelivr.net`)
  (Word document conversion).
- **heic2any** — loaded from `esm.sh` only when a HEIC/HEIF file can't
  be decoded natively.
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
MIME types and the options you picked); the rules have no network access and
never run a model unless you explicitly allow local AI for suggestions. No
file metadata, file contents, or file paths are stored in localStorage. The
home page's "Pinned & recent" panel stores tool route names only.

Model/binary caches are managed by the browser's own HTTP/IndexedDB cache and
can be cleared through browser settings, or through
Settings → AI engine → Clear model cache.

## 6. Hosting and infrastructure

CompressZ is served from **Cloudflare Pages**. When you access the
website, Cloudflare's servers handle the HTTP request to deliver the
static HTML, CSS, and JavaScript files. Cloudflare may log access
requests (IP address, browser user agent, timestamp) per their
[privacy policy](https://www.cloudflare.com/privacypolicy/). These
logs do not contain your file data.

## 7. Children's privacy

CompressZ does not knowingly collect any information from anyone,
including children under 13. Because we collect no personal data
whatsoever, there is nothing age-specific to disclose.

## 8. Changes to this policy

If we make material changes to this policy, we will update the "Last
updated" date at the top, in both this file and the in-app privacy
page. Because CompressZ collects no contact information, we cannot
notify you directly — please check this page periodically if you are
concerned.

## 9. Contact

If you have questions about this privacy policy or CompressZ's data
practices, please open an issue on our
[GitHub repository](https://github.com/ADJ189/compressz).
