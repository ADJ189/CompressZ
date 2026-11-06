<div class="cz-content-page">
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
</style>
