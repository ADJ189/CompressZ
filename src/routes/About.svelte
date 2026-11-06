<div class="cz-content-page">
  <div class="cz-content-header">
    <span class="cz-content-badge" aria-hidden="true">ℹ️</span>
    <h1 class="cz-content-title">About CompressZ</h1>
  </div>
  <p class="cz-content-sub">
    Local-first, client-side document and media processing architecture.
  </p>

  <section class="cz-content-section">
    <p>
      CompressZ runs entirely in your browser using WebAssembly, the Canvas API, WebCodecs, and
      Web platform APIs. Every byte of your files stays on your device throughout the entire process.
    </p>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">CompressZ & CompressF</h2>
    <p>
      CompressZ is a fork of <a href="https://github.com/ADJ189/CompressF" target="_blank" rel="noopener">CompressF</a>,
      ADJ's browser-native compression tool. CompressF is maintained as a format-focused sister site,
      while CompressZ provides a comprehensive local workbench: Svelte 5 reactive interface, high-fidelity
      PDF to Markdown extraction, dual-mode OCR (printed and English handwriting), WebCodecs hardware
      acceleration, and the Adaptive Resource Guard.
    </p>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">Technology Stack</h2>
    <div class="cz-tech-grid">
      <div class="cz-tech-card">
        <h3>⚡ Svelte 5 + TypeScript</h3>
        <p>Compiled, reactive UI layer with framework-independent TypeScript processing engines.</p>
      </div>
      <div class="cz-tech-card">
        <h3>📝 PDF to Markdown</h3>
        <p>High-fidelity extraction preserving native text, reading order, tables, equations, and visual references.</p>
      </div>
      <div class="cz-tech-card">
        <h3>🦀 FFmpeg.wasm</h3>
        <p>WebAssembly audio, video, and GIF processing with multithreading via SharedArrayBuffer.</p>
      </div>
      <div class="cz-tech-card">
        <h3>🎞️ Mediabunny + WebCodecs</h3>
        <p>Browser hardware-accelerated encoding for MP4 and WebM containers with automatic fallback.</p>
      </div>
      <div class="cz-tech-card">
        <h3>🔤 Tesseract.js 5</h3>
        <p>LSTM neural OCR compiled to SIMD-accelerated WASM covering 100+ languages locally.</p>
      </div>
      <div class="cz-tech-card">
        <h3>✍️ TrOCR Handwriting</h3>
        <p>Dedicated on-device English handwriting recognition via Transformers.js.</p>
      </div>
    </div>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">Credits & Attribution</h2>
    <p>
      CompressZ is built upon open-source foundations including PDF.js, pdf-lib, FFmpeg.wasm,
      Mediabunny, Tesseract.js, PaddleOCR, Transformers.js, and Svelte. Full licenses and
      attributions are recorded in <a href="https://github.com/ADJ189/compressz/blob/main/CREDITS.md" target="_blank" rel="noopener">CREDITS.md</a>.
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
  .cz-tech-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.85rem;
    margin-top: 0.5rem;
  }
  .cz-tech-card {
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .cz-tech-card h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-tech-card p {
    font-size: 0.84rem;
    color: var(--text-3);
    line-height: 1.4;
  }
</style>
