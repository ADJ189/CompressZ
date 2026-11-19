# Processing Engine Policy & Architecture

This document specifies the technical architecture, operational boundaries, and security policies for each media processing engine in CompressZ.

---

## 1. Engine Architecture Matrix

| Engine | Primary Duties | Technologies / Libraries | Isolation Mode | Maximum Memory Cap |
| :--- | :--- | :--- | :--- | :--- |
| **Image Engine** | Compression, format conversion (WebP, AVIF, JPEG, PNG, SVG) | Canvas 2D, OffscreenCanvas, WebAssembly codecs | Dedicated Web Worker / Main thread | Resource Guard concurrency & admission |
| **Video Engine** | Transcoding, bitrate budgeting, downscaling | WebCodecs API (hardware), Mediabunny, FFmpeg WASM | Dedicated Web Worker | 1.5 GiB per task |
| **Audio Engine** | Transcoding (MP3, WAV, OGG, AAC), sample rate conversion | Web Audio API (`AudioContext`), LAME WASM | Dedicated Web Worker | 256 MiB per task |
| **PDF Suite & Studio** | Splitting, merging, watermarking, redaction, AcroForms, repair | QPDF WASM, pdf-lib, PDF.js | Web Worker / Virtual FS | 1.0 GiB per task |
| **Office Conversion** | Two-way conversions (PDF ↔ Word, Excel, PPTX) | Native OOXML streaming, LibreOffice WASM | Web Worker / Isolated WASM | 1.0 GiB per task |
| **OCR Engine** | Printed text extraction, CJK character recognition, handwriting | Tesseract.js, PaddleOCR ONNX, Transformers.js | Web Worker / WebGPU | 1.0 GiB per task |
| **Archive Engine** | Multi-file packaging, ZIP and TAR creation/extraction | Native `CompressionStream`, `DecompressionStream`, pure TS | In-memory stream | 4 GiB hard boundary (32-bit ZIP) |

---

## 2. Detailed Per-Engine Policy

### 2.1 Image Processing Engine
- **Quality Guard**: Evaluates lossy image compressions using SSIM (Structural Similarity Index Measure). If SSIM falls below 0.92, the engine automatically retries once at a higher quality floor to prevent optical degradation.
- **SVG Sanitization**: SVG optimization strips XML declarations, metadata namespaces (Inkscape/Sodipodi), inline event handlers (`onload`, `onclick`), `<script>` elements, and `javascript:` URIs to prevent Cross-Site Scripting (XSS). Decimal precision is trimmed without polynomial backtracking.
- **HEIC/HEIF Decoding**: Handled via browser `createImageBitmap` when supported or dedicated converter; avoids leaking raw user filenames in thrown errors.

### 2.2 Video Processing Engine
- **Fast Path (WebCodecs)**: When hardware encoding is supported, CompressZ uses the `VideoEncoder` and `AudioEncoder` APIs through `Mediabunny`. This achieves near-instantaneous encoding with zero memory copies.
- **Fallback Path (FFmpeg WASM)**: Used when custom bitrates, legacy containers, or non-hardware codecs are requested. Runs inside an isolated Web Worker with shared memory (`SharedArrayBuffer`) protected by COOP/COEP headers.
- **Bitrate Budgeting**: In target-size mode, video bitrates are calculated dynamically by reserving audio bitrate and container overhead from the target byte allocation, never budgeting below a safe visual floor.

### 2.3 Audio Processing Engine
- **Decoding**: Handled via standard `AudioContext.decodeAudioData` in memory.
- **Channel & Rate Conversion**: Normalizes sample rates (e.g. 44.1 kHz / 48 kHz) and bitrates with linear interpolation. Memory is freed immediately upon stream finalization.

### 2.4 PDF Suite & Studio Engine
- **QPDF WASM**: Provides AES-256 password protection, linearized web optimization, and object recovery for corrupt documents inside an emulated memory virtual file system.
- **Content Stream Parsers**: PDF content stream tokens and text arrays (`TJ`/`Tj`) are parsed with guaranteed forward progress. Array delimiters (`[`, `]`) and nested strings (`(`, `)`) are bounded to prevent infinite parser loops.
- **True Redaction**: Redacted page regions are permanently excised from the underlying PDF content streams; visual overlays are accompanied by a 300-DPI raster purge to prevent text extraction from obscured layers.

### 2.5 Office Conversion Engine
- **Native OOXML Fast Path**: Converts structured tables, text runs, and presentations between PDF and Office containers (DOCX, XLSX, PPTX) natively in TypeScript using stream ZIP compression without external binaries.
- **LibreOffice WASM**: Loaded on demand for high-fidelity rendering and legacy format conversions. Sandboxed in an emulated Linux environment within the worker.

### 2.6 Archive & Batch Engine
- **32-Bit ZIP Boundary Enforcement**: Classic ZIP archives cannot exceed $2^{32} - 1$ bytes (4 GiB) in total archive size, central directory offsets, or entry sizes.
- **Overhead Pre-calculation**: `estimateZipArchiveSize()` factors in local headers (30 B), central directory headers (46 B), file name byte lengths, and EOCD records (22 B).
- **Graceful Multi-Download Fallback**: If a batch is projected to exceed the 4 GiB ZIP limit, CompressZ falls back immediately to sequential individual downloads within the active user gesture, preventing popup blocking and avoiding out-of-memory crashes.

---

## 3. Sandboxing & Memory Lifecycle

1. **Cross-Origin Isolation**: Enabled via `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers, allowing secure multi-threading with `SharedArrayBuffer`.
2. **Memory Leak Prevention**: Blob URLs created for previewing or downloading are tracked and explicitly revoked via `URL.revokeObjectURL()` within 4 seconds of generation.
3. **Adaptive Resource Guard**: Monitors active memory usage and CPU core count (`navigator.hardwareConcurrency`). Automatically queues heavy tasks and prevents launching concurrent jobs that would exhaust system RAM.
