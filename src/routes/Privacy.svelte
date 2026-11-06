<div class="page-enter cz-content-page">
  <div class="cz-content-header">
    <span class="cz-content-badge" aria-hidden="true">🔒</span>
    <h1 class="cz-content-title">Privacy Policy</h1>
  </div>
  <p class="cz-content-sub">Last updated: November 2026</p>

  <div class="cz-privacy-callout-box">
    <p>
      <strong>Summary:</strong> CompressZ operates as an offline-capable, client-side web application.
      We have no backend servers that receive your documents. We collect no personal data, run no
      telemetry, and store no cookies. Your files remain strictly on your device.
    </p>
  </div>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">1. No Data Collection</h2>
    <ul>
      <li>We do not collect, view, or retain your files, text, images, or metadata.</li>
      <li>We do not collect names, email addresses, or device identifiers.</li>
      <li>We do not run tracking scripts, third-party analytics, or ad pixels.</li>
      <li>All processing executes in temporary browser memory.</li>
    </ul>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">2. Local-First Processing Architecture</h2>
    <p>
      File compression, format conversions, OCR, and PDF to Markdown generation run via WebAssembly
      and browser platform APIs (WebCodecs, OffscreenCanvas, WebGPU). At no point are your file
      bytes transmitted over any network connection. You can verify this by checking your browser's
      developer Network tab.
    </p>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">3. Runtime Asset Disclosures</h2>
    <p>
      Public runtimes and model weights (e.g. Tesseract language data, TrOCR model weights, FFmpeg WASM)
      are downloaded on first use from public CDNs (jsdelivr.net, huggingface.co, esm.sh) and cached
      locally. Your document content is never included in these download requests.
    </p>
  </section>

  <section class="cz-content-section">
    <h2 class="cz-content-heading">4. Local Storage</h2>
    <p>
      CompressZ stores user preferences (theme choice, resource profile, engine defaults) locally in
      <code>localStorage</code> under <code>cz-settings-v2</code> and <code>theme</code>. No document
      bytes or filenames are ever persisted in localStorage.
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
  .cz-privacy-callout-box {
    padding: 1.15rem 1.35rem;
    border-radius: var(--r);
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--text);
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
