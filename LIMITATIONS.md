# Browser Engine & Architecture Limitations

CompressZ executes **100% locally inside your web browser** using WebAssembly (WASM), WebCodecs, WebGL2, and HTML5 canvas APIs. No files, documents, or personal data are ever uploaded to an external server or cloud service. Anonymous crash diagnostics are enabled by default and can be opted out of in Settings (see [docs/TELEMETRY_POLICY.md](docs/TELEMETRY_POLICY.md)).

Because computation takes place entirely on client hardware within the browser sandbox, specific platform and memory boundaries apply. The matrix below outlines the safe operating thresholds for in-browser execution, followed by the advanced technical breakdown.

---

## Operational Limits Summary Matrix

| Workload | Inherent Browser Boundary | Safe Operating Ceiling | Processing Engine |
| :--- | :--- | :--- | :--- |
| **Video Transcoding** | 2 GiB WASM 32-bit linear memory ceiling | 1.5 GiB per file (1080p / 4K under 15 min) | WebCodecs (HW/SW) / ffmpeg.wasm |
| **Audio Processing** | Buffer limits for uncompressed audio frames | 500 MB per batch (unlimited duration) | ffmpeg.wasm software pipeline |
| **Image Compression** | Canvas texture limits (16384x16384 px) | 100 MB per image, 150 images per batch | OffscreenCanvas + WASM SSIM Guard |
| **PDF Merging & Shrink** | In-memory document buffers & vector trees | 200 MB per document, 500 pages per merge | pdf-lib + PDF.js parser |
| **PDF Suite & Studio**  | True redaction (300 DPI raster purge), AES-256 | 150 MB per document, interactive forms | pdf-lib + QPDF WASM + Canvas Studio |
| **Two-Way Office (Fast)**| Structural OOXML text/table reconstruction | Instant (<50ms), 50 MB RAM, offline | Native OOXML Generator + zip.ts |
| **Two-Way Office (WASM)**| Desktop-grade LibreOffice WASM layout | ~85–110 MB WASM, 2 GiB memory ceiling | @bentopdf/libreoffice-wasm |
| **PDF to Markdown & OCR**| Working RAM during figure crop extraction | 100 pages per document (multilingual) | Tesseract.js WASM + layout analyzer |
| **Multi-threading** | Requires COOP/COEP headers for SharedArrayBuffer | 4 to 8 Web Worker threads | Web Workers + SharedArrayBuffer |
| **Mobile & Battery** | OS suspends or throttles background tabs | Keep tab in foreground during processing | Efficient Mode concurrency governor |
| **File Storage Sandbox**| Direct disk writes blocked by browser security | Memory Blobs up to available RAM | Streamed Blobs + ZIP packaging |

---

## Technical Architecture & Advanced Breakdown

### 1. WebAssembly Memory Ceilings

- **32-Bit Pointer Ceiling (2 GiB / 4 GiB)**: Standard WebAssembly modules (`ffmpeg.wasm`, `tesseract.wasm`) run on a 32-bit linear memory architecture. While the WebAssembly specification supports up to 4 GiB with Memory64 extensions, most production browser engines allocate a maximum contiguous ArrayBuffer of 2 GiB per WASM instance.
- **Safe Working Buffer**: For stable transcode and compression operations, input video files should ideally remain under **1.5 GiB** to allow headroom for intermediate frame buffers, audio resamplers, and muxing overhead.
- **Out of Memory (OOM)**: Attempting to transcode multi-gigabyte files (e.g., raw 4K 60 FPS ProRes or high-bitrate MKV) in a single pass may trigger browser tab eviction or `WebAssembly.RuntimeError: memory access out of bounds`.

---

### 2. Video Processing & ffmpeg.wasm Constraints

- **Software Encoding Speed**: When using `ffmpeg.wasm` software encoders (`libx264`, `libvpx`, `libwebp`), encoding speed is bounded by CPU core performance and lack of AVX-512 instructions in standard WASM runtimes.
- **Threading & Cross-Origin Isolation**:
  - Full multi-threaded encoding requires `SharedArrayBuffer`, which mandates `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` HTTP headers.
  - On platforms where cross-origin isolation is unavailable (or when opened from file URLs), `ffmpeg.wasm` operates in single-threaded mode, reducing throughput.
- **FastStart & Streaming**: MP4 containers created client-side require moving the `moov` atom to the beginning of the file (`-movflags +faststart`) to allow immediate playback before the entire file finishes downloading. CompressZ enables this automatically when targeting web playback.

---

### 3. WebCodecs Browser Encoding Constraints

- **Browser Hardware / Software Selection**: WebCodecs (`VideoEncoder` / `VideoDecoder`) delegates codec execution to the browser and OS media stack; whether encoding runs on dedicated hardware or software depends on the host driver and codec profile:
  - **H.264 / AVC**: Widely supported across Windows, macOS, Android, and iOS.
  - **VP9 / AV1**: Hardware encoding is typically limited to recent GPU architectures (Intel 11th Gen+, Apple M-series, AMD RDNA3, NVIDIA RTX 30/40 series). When the requested configuration is unsupported or unavailable, CompressZ falls back to FFmpeg.wasm and then MediaRecorder.
- **Variable Bitrate Control**: Some browser WebCodecs implementations restrict fine-grained CRF (Constant Rate Factor) rate control, instead operating in Constant Bitrate (CBR) or Variable Bitrate (VBR) target modes.

---

### 4. PDF Processing & Vector Ceilings

- **In-Memory Document Buffers**: PDF manipulation (`pdf-lib`, `pdfjs-dist`) decodes and stitches page objects entirely in memory.
- **High-DPI Rasterization**: Rendering PDF pages to canvas at 300+ DPI requires significant RAM per page. Rendering batches of over 100 high-DPI pages concurrently can cause memory spikes; CompressZ enforces sequential rendering with resource garbage collection to protect browser stability.
- **Encrypted / Password-Protected PDFs**: PDFs protected with proprietary owner passwords or DRM certificates cannot be processed without supplying the password.

---

### 5. Mobile & Battery Throttling

- **Aggressive Background Suspension**: Mobile operating systems (especially Apple iOS Safari and Android Chrome) aggressively throttle or freeze background tabs to preserve battery life and prevent overheating.
  - **Recommendation**: Keep the CompressZ browser tab active and in the foreground while heavy video transcodes or large batch jobs are running.
- **Thermal Throttling**: Sustained 100% CPU utilization on mobile devices will prompt the OS thermal governor to downclock CPU cores, noticeably reducing processing speed. CompressZ provides an **Efficient Mode** in Settings that limits worker concurrency on mobile devices.

---

### 6. File Storage & Sandboxing

- **Zero Direct Filesystem Access**: The browser security sandbox prevents direct arbitrary writes to host disk folders. All converted files are accumulated in temporary memory Blobs and downloaded via browser download triggers or packaged into a standard ZIP archive.
- **Blob Storage Limits**: Browser storage quotas restrict how much temporary blob data can be kept active simultaneously before being downloaded or revoked. CompressZ automatically revokes unused object URLs once jobs complete or are dismissed.

---

### 7. ZIP Archive 4 GiB (32-Bit) Boundaries

- **Classic ZIP Specification Ceiling**: Standard single-disk ZIP archives store byte counts and central directory offsets in 32-bit unsigned integers (`0xffffffff` or 4 GiB).
- **Overhead Pre-flight Verification**: Generating an archive whose data plus local/central headers exceed 4 GiB corrupts standard ZIP readers. CompressZ calculates total projected archive size (including 30-byte local headers, 46-byte central headers, filename lengths, and EOCD records) before reading blobs into memory.
- **Graceful Download Fallback**: When a batch is estimated to exceed 4 GiB, CompressZ immediately falls back to sequential individual file downloads within the active user click gesture, preventing browser popup blocking and memory exhaustion.

For in-depth operational policies, see:
- [docs/TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md) — Consolidated technical reference, engine invariants & audit summary
- [docs/ENGINE_POLICY.md](docs/ENGINE_POLICY.md) — Comprehensive engine breakdown
- [docs/AI_ENGINE_POLICY.md](docs/AI_ENGINE_POLICY.md) — On-device AI/ML runtime specifications
- [docs/TELEMETRY_POLICY.md](docs/TELEMETRY_POLICY.md) — Error reporting and anonymization pipeline
