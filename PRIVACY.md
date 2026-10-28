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
- We do **not** sell, share, or transfer any data to third parties.
- We do **not** have a backend server that touches your files.

## 3. How file processing works

All compression, conversion, OCR and local-AI operations run entirely
inside your browser using WebAssembly, the Canvas API, and Web platform
APIs. Your files are read from your device into browser memory (RAM),
processed locally, and the output is written back to your device. At no
point do your files traverse a network connection to our infrastructure.

You can verify this yourself by opening your browser's Network tab
while using CompressZ — you will see no requests containing your file
data.

## 4. Third-party libraries loaded at runtime

Some processing engines and model weights are loaded from a CDN on
first use and cached by your browser thereafter. Full attribution and
licenses for all of these are in [CREDITS.md](CREDITS.md); the
privacy-relevant summary is:

- **FFmpeg.wasm** — loaded from `esm.sh` (video/audio/GIF). The CDN serves
  the JavaScript wrapper, core scripts, worker, and WebAssembly binaries; no
  file data is sent to esm.sh.
- **Mediabunny** — loaded from `esm.sh` only when the browser supports
  WebCodecs and the requested output codec configuration is encodable
  (video fast path). It demuxes and muxes media in-memory; no file data is
  sent to esm.sh.
- **PDF.js** — loaded from `cdn.jsdelivr.net` (PDF rendering).
- **pdf-lib** — loaded from `cdn.jsdelivr.net` (PDF generation).
- **Tesseract.js** — loaded from `cdn.jsdelivr.net` and
  `tessdata.projectnaptha.com` (OCR engine and trained language data).
- **🤗 Transformers.js** — bundled at build time; model weights are
  downloaded from Hugging Face's CDN the first time you use Settings →
  AI Engine, then cached by your browser. Images are classified
  on-device — nothing is uploaded to Hugging Face or anywhere else.
- **PaddleOCR / PP-OCRv3** — loaded from `cdn.jsdelivr.net` and
  `paddlejs.bj.bcebos.com` (optional OCR runtime and model weights).
- **mammoth.js** and **html2canvas** — loaded from `cdn.jsdelivr.net`
  (Word document conversion).
- **heic2any** — loaded from `esm.sh` only when a HEIC/HEIF file can't
  be decoded natively.
- **onnxruntime-web** — loaded from `cdn.jsdelivr.net` for local AI
  inference.

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

## 5. Local storage

CompressZ stores these keys in your browser's `localStorage`:

- `theme` — your appearance preference: `light`, `dark`, or `system`
  (follow the operating system).
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
