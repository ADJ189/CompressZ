# CompressZ Technical Reference: Policies, Architecture, UI Specs & Security Audit

Unified operational reference synthesized from `docs/` policies, implemented `docs/superpowers/plans/`, `docs/security/AUDIT-REPORT.md`, and the cross-browser engine audit, aligned with the current codebase (`v1.15.7`).

---

## 1. Core Guarantees & Architectural Boundaries

- **100% Client-Side Execution**: Media, PDF, Office, AI, OCR, and archive workloads run locally in the browser (Svelte 5, TypeScript 5.9, Vite, WebAssembly, WebCodecs, Web Streams, WebCrypto, Canvas 2D / `OffscreenCanvas` / WebGL2 / WebGPU). Zero file bytes are uploaded to any server.
- **Zero Analytics / Zero Replays**: No third-party marketing trackers, cookies, or DOM/session replay scripts. The only outbound runtime data are CDN asset/model fetches and opt-out anonymous crash diagnostics via Sentry (`src/lib/telemetry.ts`).
- **Layer Separation**:
  - `src/lib/` contains pure, framework-independent TypeScript engines with **zero Svelte imports** (testable headlessly via `node scripts/test.mjs` / Deno).
  - `src/app/`, `src/components/`, and `src/routes/` use Svelte 5 runes (`$state`, `$derived`, `$props`). React and `animejs` are forbidden; motion uses native Web Animations API (`src/lib/motion.ts`).
- **Isolation & Deployment Constraints**:
  - **COOP/COEP**: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` in `public/_headers` and `vite.config.ts` enable `SharedArrayBuffer` for multithreaded WASM while permitting CORS `*` CDN assets.
  - **CSP**: `public/_headers` and `vite.config.ts` stay identical (`tests/securityCsp.test.ts`), disallow `'unsafe-inline'` in `script-src`, restrict `worker-src 'self' blob: https://cdn.jsdelivr.net`, and use synchronous theme bootstrapping via `public/earlyTheme.js`.
  - **Cloudflare Pages 25 MiB Cap**: `scripts/strip-oversized-assets.mjs` (invoked by `npm run build`) strips build assets `>= 24 MiB` (e.g., oversized ONNX asyncify WASM).

---

## 2. Processing Engine Architecture & Invariants

### 2.1 Engine Matrix

| Engine | Duties | Technologies | Isolation | Memory / Size Cap |
| :--- | :--- | :--- | :--- | :--- |
| **Image** | Compression, WebP/AVIF/JPEG/PNG/SVG conversion | Canvas 2D, `OffscreenCanvas`, WebGL2 resize, `@jsquash/avif` ST WASM | `'self'` module worker (`avifWorker.ts`) / Main thread | Resource Guard admission |
| **Video** | Transcoding, bitrate budgeting, scaling | WebCodecs + Mediabunny, FFmpeg.wasm, MediaRecorder | Dedicated `blob:` Worker | 1.5 GiB / task |
| **Audio** | Transcoding, sample-rate conversion | Web Audio (`AudioContext`), FFmpeg/LAME WASM | Dedicated `blob:` Worker | 256 MiB / task |
| **PDF Suite** | Compress, split, merge, watermark, crop, forms, redact, protect, repair | QPDF WASM, `pdf-lib`, PDF.js (`blob:` worker) | Same-origin `blob:` Worker / Virtual FS | 1.0 GiB / task |
| **Office** | Bidirectional PDF <-> DOCX/XLSX/PPTX | Native OOXML streaming, LibreOffice WASM | Worker / Isolated WASM | 1.0 GiB / task |
| **OCR** | Printed text, math/Greek, English handwriting | Tesseract.js 5, Transformers.js (TrOCR) | Worker / WebGPU | 1.0 GiB / task |
| **Archive** | Multi-file `.zip`, `.tar`, `.tar.gz`, `.gz` | `CompressionStream` / `DecompressionStream`, pure TS | In-memory stream | 4 GiB ZIP / 256 MiB decompressed |

### 2.2 Cross-Browser Worker Isolation & Image/SVG (`avifEncode.ts`, `avifWorker.ts`, `compressImage.ts`, `qualityGuard.ts`, `imageDecode.ts`, `optimizeSvg.ts`)

- **Same-Origin AVIF WASM Worker (`avifWorker.ts`, `avifEncode.ts`)**:
  - `@jsquash/avif` multi-threaded (`avif_enc_mt`) spawns cross-origin pthread workers on `esm.sh` under COOP/COEP, failing Same-Origin Policy and CSP `worker-src`.
  - `avifEncode.ts` instead routes to single-threaded `https://esm.sh/@jsquash/avif@1.3.0/codec/enc/avif_enc.js` inside a same-origin `'self'` module worker (`src/lib/avifWorker.ts`), copying encoded bytes out of WASM heap memory before `postMessage` buffer transfer, with main-thread fallback if `Worker` is unavailable.
- **SSIM Quality Guard**: Evaluates lossy outputs on a `<= 96x96` luma grid. If global SSIM drops below `0.90` (`SSIM_FLOOR`), retries **once** at a higher quality floor—unless a byte target is active (warns instead) or requested quality is `< 0.70`. Never upscales (`planOutputSize()`).
- **HEIC/HEIF**: Uses native `createImageBitmap` decode first, falling back lazily to `heic2any`. Error messages must never leak raw user filenames.
- **SVG Sanitization & Entity Resolution (`optimizeSvg.ts`)**:
  - `resolveAndStripDocTypeEntities()` expands internal DTD entities safely (capped by `MAX_EXPANDED_SVG_BYTES = 4 MiB`), prevents quadratic/XXE expansion, strips `<!DOCTYPE>`, and validates numeric code points (`0 <= n <= 0x10FFFF`, otherwise `\uFFFD`) so outputs remain valid XML.
  - Strips XML declarations, Inkscape/Sodipodi metadata, `<script>`, `<foreignObject>`, inline event handlers (`onload`, `onclick`, etc.), and `javascript:` URIs across quoted, unquoted (`href=javascript:...`), numeric-entity, and named-entity (`&colon;`, `&Tab;`, `&NewLine;`) forms.
  - Hidden-element removal inspects only `style`, `display`, and `visibility` attributes (never text-bearing attributes like `aria-label`). Text nodes stay verbatim; numeric rounding/collapsing is restricted to tag markup.

### 2.3 Video & Audio (`compressVideo.ts`, `webcodecsVideo.ts`, `compressAudio.ts`, `ffmpeg.ts`)

- **Video Fallback Chain**: Capability-gated WebCodecs + Mediabunny (`canEncodeVideo` / `canEncodeAudio`, default `fast` preset, no 10-bit/two-pass/passthrough) -> FFmpeg.wasm (inlined `blob:` worker) -> MediaRecorder canvas fallback.
- **Audio Preservation**: Audio tracks are preserved or cleanly rejected back to FFmpeg—never silently dropped.
- **Target-Size Budgeting**: Dynamically reserves audio bitrate and container overhead from the target byte budget above a safe visual floor.
- **Resource Cleanup**: `videoViaMediaRecorder` stops all tracks on `videoStream` and `combinedStream` in `finally` blocks and clears playback timers/abort handlers across all exit paths.
- **Audio Engine**: Decodes via `AudioContext.decodeAudioData`, normalizes sample rates (44.1 / 48 kHz) with linear interpolation, and releases buffers on stream finalization.

### 2.4 PDF Compression, Worker Isolation, Repair & Office Conversions (`pdfLibs.ts`, `compressPdf.ts`, `qpdfWasm.ts`, `pdfTools/`, `conversions/`)

- **PDF.js WebKit-Safe Worker (`pdfLibs.ts`)**: `getPdfJs()` fetches `${PDFJS_BASE}/build/pdf.worker.mjs` once into a same-origin `blob:` URL (`GlobalWorkerOptions.workerSrc`), avoiding WebKit's restriction on cross-origin dynamic `import()` inside `blob:` worker wrappers. Falls back cleanly to the CDN worker URL with an `EngineWarning` (`getPdfWorkerFallbackWarning()`) if the fetch fails.
- **Structural Stream Decoding (`compressPdf.ts`)**:
  - `decodeAsciiHex()` enforces ISO 32000-1 §7.4.2: non-hex/non-whitespace characters and unclosed non-empty streams return `null`.
  - `decompressFlate()` returns `null` on web/Node decompression failure instead of echoing raw bytes.
  - `getPageContentText()` bounds scan memory (`MAX_PAGE_SCAN_STREAM_BYTES = 4 MiB`, `MAX_PAGE_SCAN_TOTAL_BYTES = 32 MiB`) and propagates `null` to `incomplete = true`, refusing to downsample unverified image placements.
- **Content Stream & Redaction**: Parsers for `TJ`/`Tj`, `[`/`]`, and `(`/`)` enforce bounded forward progress. Redaction excises underlying content stream operators and applies a 300-DPI raster purge.
- **QPDF WASM (`qpdfWasm.ts`)**: Handles AES-256 encryption, linearization, and recovery inside an emulated virtual FS; preserves the `console.*` bridge across `initQpdf()` and `callMain()` so diagnostics are captured.
- **Office OOXML (`src/lib/conversions/common.ts`, `pdfToWord.ts`, `pdfToPpt.ts`, `pdfToExcel.ts`)**:
  - `stripInvalidXml()` removes `[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]` prior to entity escaping in `escapeXml()`. All OOXML XML builders must route text through `escapeXml()`.
  - LibreOffice WASM loads on demand inside an isolated worker for high-fidelity/legacy conversions.

### 2.5 Archives & Cryptography (`zip.ts`, `tar.ts`, `archives.ts`, `fileEncryption.ts`)

- **ZIP (`zip.ts`)**:
  - 32-bit ceiling (`MAX_ZIP_32_BYTES = 0xFFFFFFFF`, 4 GiB) checked via `estimateZipArchiveSize()` (30 B local header + 46 B central dir + filename bytes + 22 B EOCD); batches exceeding 4 GiB fall back to sequential individual downloads within the active user gesture.
  - `writeZip()` rejects `entries.length >= 0xFFFF` preflight to prevent 16-bit EOCD count truncation.
  - `readZip()` bounds-checks EOCD, central-directory, local header, and entry data offsets before reading/slicing, throwing descriptive `Error`s instead of raw `RangeError`s.
- **TAR (`tar.ts`)**:
  - `sanitizeTarPath()` runs on both read and write.
  - `readTar()` resets `pendingName = null` on skipped non-regular entries (e.g., symlinks) so GNU long-names cannot bleed onto subsequent files.
  - Verifies non-empty header checksums (unsigned or signed sum; empty checksum tolerated for historic/synthetic fixtures), charges GNU `L` and PAX `x`/`g` metadata payloads to `maxTotalBytes`, truncates UTF-8 filenames on character boundaries, and rejects negative or `> Number.MAX_SAFE_INTEGER` octal fields.
- **GZIP / Streaming (`archives.ts`)**: Enforces `MAX_DECOMPRESSED_BYTES = 256 MiB` (checked via `gzipUncompressedSize()` and streaming read cap) and settles `writer.write()` on source errors in `streamCompressBytes()` to prevent unhandled rejections.
- **WebCrypto Vault (`fileEncryption.ts`)**: PBKDF2 key derivation + AES-256-GCM encryption/decryption with unique IVs and authentication tag verification.

### 2.6 Markdown Preview (`markdownPreview.ts`)

- Renders Markdown and math without raw HTML injection; escapes image alt text once and neutralizes `-->` comment terminators in image fallbacks.

---

## 3. Unified Fallback & Fidelity Warning System (`types.ts`, `warnings.ts`, `WarningBanner.svelte`, `FileCard.svelte`)

- **Contract (`EngineWarning` in `src/lib/types.ts`)**: `{ code, engine, message, severity?: "warn" | "info", detail?: string }` attached to `CompressResult.warnings`, `FileEntry.warnings`, `PdfToImagesResult.warnings`, `RepairPdfResult.warnings`, `OcrPageResult.engineWarnings`, and `getAiRuntimeInfo().lastFallbackWarning`.
- **Instrumented Fallback Paths**:
  - Image: `avif-wasm-fallback`, `webp-canvas-fallback`, `resolution-lost`, `target-size-quality`, `low-ssim`.
  - Video: `webcodecs-fallback`, `ffmpeg-mediarecorder-fallback` (explicitly names substituted MIME/container vs requested codec/container).
  - PDF / Repair: `pdf-canvas-fallback`, `pdf-worker-cdn-fallback`, `qpdf-repair-warnings`, `qpdf-js-salvage-fallback`.
  - OCR / AI: `paddle-fallback-tesseract`, `ocr-low-confidence`, `ocr-text-layer-gap`, `ai-webgpu-wasm-fallback`.
- **UI Presentation**:
  - `src/components/WarningBanner.svelte` (`role="status"`, `aria-live="polite"`) deduplicates identical warnings via `deduplicateWarnings()` (`src/lib/warnings.ts`) with file counts and expandable `<details>` blocks.
  - `FileCard.svelte` and `Convert.svelte` rows render `.cz-status-pill.is-warn` and `.cz-card-warn-box`. Routes (`Images`, `Video`, `Pdf`, `Ocr`, `Convert`, `PdfSuite`, `ImagesToPdf`) emit `"warn"` toasts instead of `"success"` when fallbacks/degradations occur.

---

## 4. AI & Neural OCR Policy (`src/lib/aiEngine.ts`, `ocrEngines.ts`, `ocrHandwriting.ts`)

- **Supported Runtimes**:
  - `@huggingface/transformers`: Image classification (`Xenova/mobilenet_v2_1.0_224` / `Xenova/vit-base-patch16-224`) and English handwriting (`Xenova/trocr-small-handwritten`, line-segmented via `detectTextLines`, never full-page unsegmented scans, zero LaTeX math hallucination). Probes `navigator.gpu.requestAdapter()` + `requestDevice()` for WebGPU before falling back to WASM SIMD (`cpu`).
  - **Tesseract.js 5**: Default printed text OCR engine (`auto` resolves to Tesseract; math/Greek mode uses `<lang>+equ`; selecting `paddle` resolves to Tesseract with an explicit `paddle-fallback-tesseract` warning).
- **Model Weights & Privacy**:
  - Weights are never bundled in the initial app shell; fetched on demand via HTTPS from verified public CDNs (Hugging Face, jsDelivr) and cached in `CacheStorage`/`IndexedDB` (shell + ONNX WASM still require network until an offline pack exists).
  - Zero remote LLM APIs; input textures are freed after inference; production ONNX/Transformers debug logs are suppressed.
- **Lifecycle & Concurrency**:
  - Heavy AI runs are capped at 1 concurrent execution through `resourceManager.ts`; sessions expose `.dispose()`/`.release()` on tool switches/queue clear.
- **AI Smart Sort Queue Safety (`src/routes/ImagesToPdf.svelte`)**:
  - Gated behind `settings.ai?.enabled`; resolves `"auto"` tier via `resolvedAiModelTier(settings)`.
  - Snapshots `rawFiles` before awaiting `smartAnalyze()`, aborts if the queue became empty, falls back to natural sort if no predictions return, and reconciles concurrent queue additions/removals (`remainingSorted` filtered to current queue + `newlyAdded`).

---

## 5. Telemetry, Privacy & Support Diagnostics (`src/lib/telemetry.ts`)

- **Default & Opt-Out**: Anonymous crash diagnostics via `@sentry/svelte` are **ON by default** to catch WebGPU/WASM/WebCodecs crashes, with instant live opt-out/re-enable (no page reload) in **Settings -> Privacy & data**.
- **Storage Key**: `cz-telemetry-opt-out`. All storage reads/writes are wrapped in `try/catch` (`isTelemetryOptedOut()`, `setTelemetryOptOut()`). `clearStoragePreservingTelemetry()` keeps opt-out intact when clearing local data.
- **Strict Sanitization Pipeline**:
  - `sendDefaultPii: false`, `sendClientReports: false`, strips `BrowserSession`, `Breadcrumbs`, and `Console` integrations, sets `beforeBreadcrumb: () => null`, and filters events through `beforeSend: sanitizeSentryEvent`.
  - `scrubDiagnosticText()` / `sanitizeSentryEvent()` drops events if opted out, redacts Windows/Unix paths (`[path]`), quoted strings (`"[redacted]"`), and filenames with extensions across Unicode/spaces (`[filename]`), deletes `event.user` and `event.request.headers`, strips request URLs to root origin, and clears `event.extra`, `event.tags`, and `contexts.state`.
  - **Socket IP Disclosure**: JSON payloads contain zero IP data; HTTPS transport to `ingest.us.sentry.io` uses transient TCP socket metadata at Sentry's ingest layer.
- **Settings Support Tab (`src/app/SettingsDialog.svelte`)**:
  - Sections: `general`, `appearance`, `performance`, `ai`, `suggestions`, `compression`, `privacy`, `diagnostics`, `support`.
  - `Support & Issues` provides a GitHub Issues link (`https://github.com/ADJ189/CompressZ/issues/new`), runtime capability diagnostics (version, UA, resolution/DPR, `hardwareConcurrency`, COOP/COEP, WebCodecs, WebGPU, SIMD, resource profile), and one-click **"Copy Diagnostic Info"** (zero document/filename data).
- **Privacy Parity Contract (`tests/privacy-parity.test.ts`)**: Every `localStorage` key (`theme`, `cz-color-scheme`, `cz-settings-v2`, `cz-settings-v1`, `cz-recommendations-v1`, `cz-recent-tools`, `cz-favourite-tools`, `cz-convert-profile`, `cz-pdfsuite-profile`, `cz-telemetry-opt-out`), CDN host, and lazily loaded CDN package in `src/` must be documented in `PRIVACY.md` (and kept consistent with `src/routes/Privacy.svelte`).

---

## 6. Resource Governance, Settings & Memory Lifecycle

- **Settings Validation (`src/lib/settings.ts`)**: `mergeSettings(base, raw)` validates types, enums, and numeric ranges on both v1 migration and `cz-settings-v2` load so malformed stored JSON cannot pass invalid options to engines. `resolveExecutionProfile()` is the single source of truth for execution tier, AI tier, backend, concurrency, image cap, FFmpeg threading, and video preset.
- **Adaptive Resource Guard (`src/lib/resourceManager.ts`)**:
  - All heavyweight/batch work passes through `runScheduled()`.
  - Capacity changes mutate existing semaphores via `setCapacity()` (never replacing semaphores with active waiters), clamp queued weights on shrink, and apply immediately via `onSettingsChange()`.
- **Blob URL Lifecycle**: Preview/download object URLs are tracked and revoked via `URL.revokeObjectURL()` within 4 seconds of generation.

---

## 7. UI Design System, Themes & Universal Upload

- **Themes & Color Schemes (`src/lib/theme.ts`, `public/earlyTheme.js`, `src/style.css`)**:
  - Theme preference (`theme` key): `light` / `dark` / `system`, resolved onto `<html data-theme="light|dark">`.
  - Color scheme (`cz-color-scheme` key): `polished` (default emerald `#059669` / `#10b981`), `origin` (classic blue `#3b5bdb` / `#4c6ef5`), `blood-moon` (ruby/scarlet `#be123c` / `#f43f5e`), applied synchronously via `data-color-scheme` in `public/earlyTheme.js` to avoid FOUC.
  - Status/toast tokens (`--toast-success-bg`, `--toast-success-text`, `--toast-success-border`) and `.cz-warn-banner` / `.cz-card-warn-box` / `.cz-status-pill.is-warn` enforce WCAG AA/AAA contrast across light and dark modes.
- **macOS Tools Palette (`src/app/ToolsDialog.svelte`) & Universal Upload Pill (`src/components/UniversalUpload.svelte`)**:
  - Sheet-style window with close/esc controls, `UniversalUpload` pill (`variant="pill"`, `Cmd/Ctrl+U` shortcut), Spotlight search, segmented category filter across 5 ranked groups (`PDF Suite & Studio`, `Media Compression`, `Format Conversions`, `AI & Neural OCR`, `Resources & System`), and `MacIcon.svelte` squircles.
  - Mobile `@media (max-width: 520px)` declares `max-height: calc(100vh - 24px);` before `max-height: 92dvh;`.
- **CloudConvert-Style Universal Upload Modal (`src/components/ActionPalette.svelte`, `src/lib/fileRouter.ts`)**:
  - Scoped strictly to the upload modal (preserving existing workbench layouts).
  - Inspects magic bytes (`identifyHeader()`, `readFileHeaderBytes()`, `detectFileTypeAndActions()`), displays device optimization hints derived from `resolveExecutionProfile()` + `hasWebGL2()` + WebCodecs, grouped `ConversionGroup` format target pills (`ConversionTarget`), and quick `FileAction` cards with `MacIcon` squircles that route 1-click into pre-staged routes (`stagedUniversalFile`).
- **Layout & Anti-Slop Floor (`tests/hallmark.test.ts`, `tests/toolLanding.test.ts`)**:
  - `HubHeader.svelte` wraps tool chips (`flex-wrap: wrap`) with zero horizontal scrollbars.
  - `Home.svelte` / `ToolCard.svelte`: max 2 curated tags per tool card; standard `line-clamp: 2;` alongside `-webkit-line-clamp: 2;`.
  - CSS floor: `overflow-x: clip` on `html`/`body`, `:focus-visible` outlines, `prefers-reduced-motion` support, zero `transition: all`, minimum 12px typography, verb+noun action labels, and zero `deno` references in `package.json`.

---

## 8. Security Audit & Chaos Hardening Summary

Audited across 10 core modules (`docs/security/AUDIT-REPORT.md`) using the Cloudflare 6-Phase Vulnerability Assessment Harness, Elephant-Goldfish (EGM) invariant checks, and offline chaos/fuzz tests (`tests/chaos.test.ts`). All confirmed findings are remediated and pinned by regression tests:

| ID | Module | Issue & Remediation | Regression Suite |
| :--- | :--- | :--- | :--- |
| **SEC-ZIP-001** | `src/lib/zip.ts` | Reject `>= 0xFFFF` entries in `writeZip()` to prevent 16-bit EOCD truncation. | `tests/zip.test.ts` |
| **BUG-ZIP-005** | `src/lib/zip.ts` | Bounds-check all EOCD, CD, local header, and data offsets in `readZip()`. | `tests/zip.test.ts`, `tests/chaos.test.ts` |
| **SEC-SVG-002** | `src/lib/optimizeSvg.ts` | Strip unquoted `href=javascript:`, numeric-entity bypasses, and `<foreignObject>`. | `tests/optimizeSvg.test.ts` |
| **SEC-SVG-007** | `src/lib/optimizeSvg.ts` | Decode named entities (`&colon;`, etc.), restrict hidden checks to style/display/visibility, keep text nodes verbatim. | `tests/optimizeSvg.test.ts`, `tests/chaos.test.ts` |
| **BUG-VID-003** | `src/lib/compressVideo.ts` | Stop all `videoStream` / `combinedStream` `MediaStreamTrack`s in `finally`. | Full test runner (`npm test`) |
| **BUG-TAR-004** | `src/lib/tar.ts` | Reset `pendingName = null` on skipped non-regular TAR entries. | `tests/archives.test.ts` |
| **BUG-TAR-006** | `src/lib/tar.ts` | Verify present checksums, charge `L`/`x`/`g` metadata to byte budget, UTF-8 char-boundary truncation, reject octal overflow. | `tests/archives.test.ts`, `tests/chaos.test.ts` |
| **BUG-MD-008** | `src/lib/markdownPreview.ts` | Escape image alt text once and neutralize `-->` in fallback comments. | `tests/chaos.test.ts` |
| **BUG-SET-009** | `src/lib/settings.ts` | Validate and clamp all persisted/migrated fields in `mergeSettings()`. | `tests/settings.test.ts`, `tests/chaos.test.ts` |
| **BUG-RES-010** | `src/lib/resourceManager.ts` | Resize existing semaphores via `setCapacity()` and clamp queued weights. | `tests/resourceManager.test.ts`, `tests/chaos.test.ts` |
| **BUG-ARC-011** | `src/lib/archives.ts` | Settle `writer.write()` promise on error in `streamCompressBytes()`. | `tests/chaos.test.ts` |

*(Additional audited modules passing without confirmed vulnerabilities: `src/lib/fileEncryption.ts`, `src/lib/conversions/`, `src/lib/telemetry.ts`.)*

---

## 9. Canonical Verification Commands

```bash
npm test            # Offline unit, security, chaos, privacy-parity, and hallmark suites
npm run typecheck   # tsc --noEmit + svelte-check (covers .svelte files)
npm run lint        # ESLint (0 errors required)
npm run build       # Vite production build + strip assets >= 24 MiB
npm run test:e2e    # Playwright across Chromium, WebKit, Firefox (desktop & mobile)
```
