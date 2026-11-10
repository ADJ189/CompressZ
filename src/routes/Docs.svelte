<div class="page-enter cz-content-page">
  <div class="cz-content-header">
    <span class="cz-content-badge" aria-hidden="true">📖</span>
    <h1 class="cz-content-title">Documentation</h1>
  </div>
  <p class="cz-content-sub">
    Technical reference for compression engines, PDF to Markdown extraction, and browser compatibility.
  </p>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">PDF to Markdown Pipeline</h2>
    <p>
      The PDF to Markdown converter extracts structured content from digital, scanned, or mixed PDFs:
    </p>
    <ul>
      <li><strong>Native text priority:</strong> Extracts digital PDF text using PDF.js before falling back to OCR.</li>
      <li><strong>Reading order:</strong> Column-aware reconstruction prevents interleaving multi-column pages.</li>
      <li><strong>Visual preservation:</strong> Equations, charts, diagrams, and tables are preserved as lossless page crops.</li>
      <li><strong>Portable ZIP bundle:</strong> Includes <code>document.md</code>, <code>manifest.json</code>, <code>extraction.json</code>, and the original PDF.</li>
    </ul>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">OCR Profiles</h2>
    <ul>
      <li><strong>Printed text:</strong> Tesseract.js 5 LSTM neural OCR running in WebAssembly. Supports 100+ languages.</li>
      <li><strong>Handwriting (English):</strong> Dedicated line-oriented recognition powered by TrOCR (Xenova/trocr-small-handwritten). Runs locally via Transformers.js with WebGPU or WASM fallback.</li>
      <li><strong>Math & Technical formulas:</strong> Handwritten formulas and equations are visually preserved as crops to prevent synthetic LaTeX hallucinations.</li>
    </ul>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">Image Compression</h2>
    <ul>
      <li><strong>Formats:</strong> WebP (default), JPEG, PNG, and AVIF.</li>
      <li><strong>Quality Guard:</strong> Samples source and output on a 96×96 luma grid to compute structural similarity (SSIM). If quality falls below 0.90, it retries at a higher threshold.</li>
      <li><strong>Ceiling:</strong> Images are never upscaled past their native dimensions.</li>
    </ul>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">Video Compression</h2>
    <ul>
      <li><strong>Fast Path:</strong> Direct WebCodecs frame encoding muxed with Mediabunny into real MP4 or WebM containers.</li>
      <li><strong>Compatibility Path:</strong> Multithreaded FFmpeg.wasm for two-pass, 10-bit color, edit proxies, and complex audio tracks.</li>
    </ul>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">Browser Requirements</h2>
    <ul>
      <li><strong>Core features:</strong> Chrome 91+, Edge 91+, Firefox 113+, Safari 16.4+</li>
      <li><strong>ZIP Archive creation:</strong> Uses native <code>CompressionStream('deflate-raw')</code>.</li>
      <li><strong>WebGPU Acceleration:</strong> Supported browsers utilize hardware WebGPU for local Transformers.js models.</li>
    </ul>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">Browser & Engine Limitations</h2>
    <p>
      CompressZ executes 100% locally on your machine with zero server communication. Operating strictly inside the browser sandbox introduces specific platform constraints:
    </p>

    <div class="cz-table-wrap">
      <table class="cz-matrix-table">
        <thead>
          <tr>
            <th>Workload</th>
            <th>Browser Boundary</th>
            <th>Safe Operating Ceiling</th>
            <th>Processing Engine</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Video Transcoding</strong></td>
            <td>2 GiB WASM address space</td>
            <td>1.5 GiB per file (1080p / 4K)</td>
            <td>WebCodecs (GPU) / FFmpeg.wasm</td>
          </tr>
          <tr>
            <td><strong>Audio Processing</strong></td>
            <td>Uncompressed frame memory</td>
            <td>500 MB per batch</td>
            <td>FFmpeg.wasm pipeline</td>
          </tr>
          <tr>
            <td><strong>Image Compression</strong></td>
            <td>Canvas dimensions (16384px)</td>
            <td>100 MB / 150 images batch</td>
            <td>OffscreenCanvas + WASM SSIM</td>
          </tr>
          <tr>
            <td><strong>PDF Merging & Shrink</strong></td>
            <td>In-memory document objects</td>
            <td>200 MB / 500 pages per merge</td>
            <td>pdf-lib + PDF.js</td>
          </tr>
          <tr>
            <td><strong>PDF Suite & Studio</strong></td>
            <td>True redaction (300 DPI raster purge), AES-256</td>
            <td>150 MB / interactive AcroForms</td>
            <td>pdf-lib + QPDF WASM + Canvas Studio</td>
          </tr>
          <tr>
            <td><strong>Two-Way Office (Fast)</strong></td>
            <td>Structural OOXML text/table reconstruction</td>
            <td>Instant (&lt;50ms), 50 MB RAM, offline</td>
            <td>Native OOXML Generator + zip.ts</td>
          </tr>
          <tr>
            <td><strong>Two-Way Office (WASM)</strong></td>
            <td>Desktop-grade LibreOffice WASM layout</td>
            <td>~85–110 MB WASM, 2 GiB memory ceiling</td>
            <td>@bentopdf/libreoffice-wasm</td>
          </tr>
          <tr>
            <td><strong>PDF to Markdown & OCR</strong></td>
            <td>Working RAM during figure crops</td>
            <td>100 pages per document</td>
            <td>Tesseract.js WASM + layout engine</td>
          </tr>
          <tr>
            <td><strong>Multi-threading</strong></td>
            <td>COOP/COEP isolation required</td>
            <td>4 to 8 Web Workers</td>
            <td>SharedArrayBuffer</td>
          </tr>
          <tr>
            <td><strong>Mobile & Battery</strong></td>
            <td>Background tab sleep by OS</td>
            <td>Keep tab in foreground</td>
            <td>Efficient Mode governor</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul>
      <li><strong>WASM 32-bit Memory Ceiling:</strong> WebAssembly engines operate within 32-bit address spaces (maximum 2 GiB safe allocation). Video files over 1.5 GiB may exceed browser buffer limits during intensive multi-pass transcoding.</li>
      <li><strong>Hardware Video Codecs:</strong> WebCodecs hardware encoding availability depends on your OS and GPU driver. Unsupported codecs (or platforms without WebCodecs) seamlessly fall back to multithreaded WASM software encoding.</li>
      <li><strong>Mobile Background Tab Suspension:</strong> iOS Safari and Android Chrome aggressively throttle or sleep background tabs to conserve battery. For long transcoding or batch jobs, keep the CompressZ tab visible in the foreground.</li>
      <li><strong>High-DPI PDF Memory Footprint:</strong> Rendering dense, multi-hundred-page PDFs at 300+ DPI requires significant working RAM. CompressZ enforces sequential rendering with proactive canvas garbage collection to prevent browser tab crashes.</li>
    </ul>
    <p>
      For a complete technical breakdown of architectural ceilings and engine trade-offs, consult the project <code>LIMITATIONS.md</code> guide.
    </p>
  </section>
</div>

<style>
  .cz-content-page {
    max-width: 840px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
  }
  .cz-content-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cz-content-badge {
    font-size: 1.6rem;
  }
  .cz-content-title {
    font-family: var(--display);
    font-size: 1.95rem;
    font-weight: 800;
    color: var(--text);
  }
  .cz-content-sub {
    font-size: 0.95rem;
    color: var(--text-3);
  }
  .cz-content-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    font-size: 0.94rem;
    line-height: 1.6;
    color: var(--text-2);
  }
  .cz-content-heading {
    font-family: var(--display);
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
    margin-top: 0.5rem;
  }
  .cz-content-section ul {
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .cz-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface);
    margin: 0.5rem 0;
  }
  .cz-matrix-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
    text-align: left;
  }
  .cz-matrix-table th {
    background: var(--surface2);
    color: var(--text-2);
    font-weight: 600;
    padding: 0.65rem 0.85rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .cz-matrix-table td {
    padding: 0.6rem 0.85rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
  }
  .cz-matrix-table tr:last-child td {
    border-bottom: none;
  }
  .cz-matrix-table td strong {
    color: var(--text);
  }
</style>
