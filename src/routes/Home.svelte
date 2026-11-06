<script lang="ts">
  import { onMount } from "svelte";
  import { mountWorkbench } from "../lib/workbench";

  let rootEl: HTMLElement;

  onMount(() => {
    if (rootEl) {
      mountWorkbench(rootEl);
    }
  });
</script>

<div class="cz-workbench cz-workbench-view" bind:this={rootEl}>
  <section class="cz-wb-head">
    <div class="cz-wb-head__text">
      <p class="cz-wb-eyebrow">Local-first browser suite</p>
      <h1 class="cz-wb-title">Compress and convert files locally.</h1>
      <p class="cz-wb-sub">
        Fast, private document and media processing running inside your browser. No server uploads, no data transmission, and zero telemetry.
      </p>
    </div>
    <div class="cz-wb-search">
      <span class="cz-wb-search__icon" aria-hidden="true">🔍</span>
      <input
        id="wb-search"
        type="search"
        placeholder="Filter tools (e.g. PDF, WebP, Video)..."
        aria-label="Filter tools"
      />
    </div>
  </section>

  <section class="cz-wb-section">
    <div class="cz-wb-section__head">
      <h2 class="cz-wb-section__title">Quick Actions</h2>
    </div>
    <div class="cz-wb-quick">
      <button
        type="button"
        class="cz-wb-quick__card"
        data-nav="compress/images"
        data-wb-quick
        data-label="Images"
        data-keywords="image photo jpg jpeg png webp avif jxl svg gif compress quality reduce shrink ssim"
      >
        <span class="cz-wb-quick__icon" aria-hidden="true">🖼️</span>
        <span class="cz-wb-quick__name">Images</span>
        <span class="cz-wb-quick__desc">SSIM-guarded image compress</span>
      </button>

      <button
        type="button"
        class="cz-wb-quick__card"
        data-nav="compress/pdf"
        data-wb-quick
        data-label="PDF"
        data-keywords="pdf document shrink compress clean fonts downscale dpi"
      >
        <span class="cz-wb-quick__icon" aria-hidden="true">📄</span>
        <span class="cz-wb-quick__name">PDF</span>
        <span class="cz-wb-quick__desc">Lossless & raster compression</span>
      </button>

      <button
        type="button"
        class="cz-wb-quick__card"
        data-nav="compress/merge-pdf"
        data-wb-quick
        data-label="Merge PDF"
        data-keywords="merge pdf combine join concatenate append reorder pages"
      >
        <span class="cz-wb-quick__icon" aria-hidden="true">🧷</span>
        <span class="cz-wb-quick__name">Merge PDF</span>
        <span class="cz-wb-quick__desc">Combine PDF files in order</span>
      </button>

      <button
        type="button"
        class="cz-wb-quick__card"
        data-nav="compress/images-to-pdf"
        data-wb-quick
        data-label="Images to PDF"
        data-keywords="images to pdf photo jpg png sequence pages sheet album"
      >
        <span class="cz-wb-quick__icon" aria-hidden="true">🧩</span>
        <span class="cz-wb-quick__name">Images to PDF</span>
        <span class="cz-wb-quick__desc">Photos to single document</span>
      </button>

      <button
        type="button"
        class="cz-wb-quick__card"
        data-nav="compress/video"
        data-wb-quick
        data-label="Video"
        data-keywords="video mp4 webm h264 h265 av1 webcodecs mediabunny ffmpeg"
      >
        <span class="cz-wb-quick__icon" aria-hidden="true">🎬</span>
        <span class="cz-wb-quick__name">Video</span>
        <span class="cz-wb-quick__desc">WebCodecs fast path</span>
      </button>

      <button
        type="button"
        class="cz-wb-quick__card"
        data-nav="convert/pdf-markdown"
        data-wb-quick
        data-label="PDF to Markdown"
        data-keywords="pdf markdown convert export extract tables text layout doc handwriting math"
      >
        <span class="cz-wb-quick__icon" aria-hidden="true">📝</span>
        <span class="cz-wb-quick__name">PDF to Markdown</span>
        <span class="cz-wb-quick__desc">Extract tables & text</span>
      </button>
    </div>
  </section>

  <div class="cz-wb-grid2">
    <section class="cz-wb-panel">
      <div class="cz-wb-panel__head">
        <h2 class="cz-wb-panel__title">Pinned & Recent</h2>
      </div>
      <div id="wb-pinned" class="cz-wb-pinned"></div>
    </section>

    <section class="cz-wb-panel">
      <div class="cz-wb-panel__head">
        <h2 class="cz-wb-panel__title">Resource Guard</h2>
        <button type="button" class="cz-wb-panel__link" data-nav="settings">Configure</button>
      </div>
      <div id="wb-queue"></div>
    </section>
  </div>

  <section class="cz-wb-section">
    <div class="cz-wb-section__head">
      <h2 class="cz-wb-section__title">All Tools</h2>
    </div>
    <div id="wb-all" class="cz-wb-all">
      <div
        class="cz-wb-all__card"
        data-nav="compress/images"
        data-wb-tool
        data-icon="🖼️"
        data-label="Images"
        data-keywords="image photo jpg jpeg png webp avif jxl svg gif compress quality reduce shrink ssim"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🖼️</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">Image Compressor</span>
          <span class="cz-wb-all__desc">SSIM-guarded image compress</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin Images">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="compress/pdf"
        data-wb-tool
        data-icon="📄"
        data-label="PDF"
        data-keywords="pdf document shrink compress clean fonts downscale dpi"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">📄</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">PDF Compressor</span>
          <span class="cz-wb-all__desc">Lossless & raster compression</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin PDF">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="compress/merge-pdf"
        data-wb-tool
        data-icon="🧷"
        data-label="Merge PDF"
        data-keywords="merge pdf combine join concatenate append reorder pages"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🧷</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">Merge PDF</span>
          <span class="cz-wb-all__desc">Combine PDF files in order</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin Merge PDF">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="compress/images-to-pdf"
        data-wb-tool
        data-icon="🧩"
        data-label="Images to PDF"
        data-keywords="images to pdf photo jpg png sequence pages sheet album"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🧩</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">Images to PDF</span>
          <span class="cz-wb-all__desc">Photos to single document</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin Images to PDF">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="compress/video"
        data-wb-tool
        data-icon="🎬"
        data-label="Video"
        data-keywords="video mp4 webm h264 h265 av1 webcodecs mediabunny ffmpeg"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🎬</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">Video Compressor</span>
          <span class="cz-wb-all__desc">WebCodecs fast path</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin Video">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="compress/audio"
        data-wb-tool
        data-icon="🎵"
        data-label="Audio"
        data-keywords="audio mp3 aac ogg opus flac wav sound music compress"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🎵</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">Audio Compressor</span>
          <span class="cz-wb-all__desc">Optimize bitrates & formats</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin Audio">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="compress/gif"
        data-wb-tool
        data-icon="🎞️"
        data-label="GIF"
        data-keywords="gif animation shrink colors lossy compress"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🎞️</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">GIF Compressor</span>
          <span class="cz-wb-all__desc">Color reduction & lossy LZW</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin GIF">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="compress/ocr"
        data-wb-tool
        data-icon="🔍"
        data-label="PDF OCR"
        data-keywords="ocr optical character recognition tesseract paddle handwriting text extract pdf"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🔍</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">PDF OCR</span>
          <span class="cz-wb-all__desc">Printed & handwriting recognition</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin PDF OCR">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="convert"
        data-wb-tool
        data-icon="🔁"
        data-label="Convert"
        data-keywords="convert format media office documents images audio"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">🔁</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">Format Converter</span>
          <span class="cz-wb-all__desc">Convert media, docs, and images</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin Convert">☆</button>
      </div>

      <div
        class="cz-wb-all__card"
        data-nav="convert/pdf-markdown"
        data-wb-tool
        data-icon="📝"
        data-label="PDF to Markdown"
        data-keywords="pdf markdown convert export extract tables text layout doc handwriting math"
      >
        <span class="cz-wb-all__icon" aria-hidden="true">📝</span>
        <div class="cz-wb-all__text">
          <span class="cz-wb-all__name">PDF to Markdown</span>
          <span class="cz-wb-all__desc">Extract tables & text</span>
        </div>
        <button type="button" class="cz-wb-all__fav" data-wb-fav aria-label="Pin PDF to Markdown">☆</button>
      </div>
    </div>
    <p id="wb-empty" class="cz-wb-empty" hidden>No tools match your search.</p>
  </section>

  <footer class="cz-wb-footer">
    <p>
      <strong>On-Device Privacy Invariant:</strong> Your documents and media are decoded and processed in memory using WebAssembly, WebCodecs, and WebGPU. File bytes never leave this browser tab.
    </p>
    <div class="cz-wb-footer__links">
      <a href="/about" class="cz-wb-footer__link" data-nav="about">About</a>
      <a href="/docs" class="cz-wb-footer__link" data-nav="docs">Documentation</a>
      <a href="/privacy" class="cz-wb-footer__link" data-nav="privacy">Privacy Notice</a>
    </div>
  </footer>
</div>

<style>
  .cz-workbench {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding-bottom: 2rem;
  }
</style>
