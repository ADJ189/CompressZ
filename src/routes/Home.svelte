<script lang="ts">
  import { onMount } from "svelte";
  import { navigate } from "../router";
  import { mountWorkbench } from "../lib/workbench";
  import MacIcon from "../components/MacIcon.svelte";
  import UniversalUpload from "../components/UniversalUpload.svelte";

  let rootEl: HTMLElement;

  onMount(() => {
    if (rootEl) {
      mountWorkbench(rootEl);
    }
  });

  function handleNav(route: string, e: MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(route);
  }

  function scrollToHowItWorks() {
    const el = document.getElementById("how-it-works");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }

  const TOOLS = [
    {
      id: "images",
      route: "compress/images",
      icon: "🖼️",
      iconName: "image",
      name: "Images",
      desc: "GPU-accelerated encoding via OffscreenCanvas. Binary search to hit exact target sizes. SSIM quality guard.",
      tags: ["JPEG", "PNG", "WebP", "AVIF", "HEIC", "✨ AI"],
      keywords: "image photo jpg jpeg png webp avif jxl svg gif compress quality reduce shrink ssim",
    },
    {
      id: "pdf",
      route: "compress/pdf",
      icon: "📄",
      iconName: "pdf",
      name: "PDF",
      desc: "Structural image resampling — text and vectors untouched. Compress to exact MB/KB target.",
      tags: ["Structural", "pdf-lib", "Target size"],
      keywords: "pdf document shrink compress clean fonts downscale dpi",
    },
    {
      id: "merge",
      route: "compress/merge-pdf",
      icon: "🧷",
      iconName: "merge",
      name: "Merge PDF",
      desc: "Combine multiple PDFs into one, in any order — pages copied directly, nothing rasterised.",
      tags: ["pdf-lib", "Reorderable", "Preview"],
      keywords: "merge pdf combine join concatenate append reorder pages",
    },
    {
      id: "images-to-pdf",
      route: "compress/images-to-pdf",
      icon: "🧩",
      iconName: "image",
      name: "Images → PDF",
      desc: "Combine photos or screenshots into one PDF, one page each, reorderable with visual previews.",
      tags: ["pdf-lib", "Reorderable", "GPU", "✨ AI"],
      keywords: "images to pdf photo jpg png sequence pages sheet album",
    },
    {
      id: "video",
      route: "compress/video",
      icon: "🎬",
      iconName: "video",
      name: "Video",
      desc: "WebCodecs hardware acceleration with FFmpeg.wasm multi-threaded fallback for edit proxies.",
      tags: ["H.264", "H.265", "VP9", "AV1"],
      keywords: "video mp4 webm h264 h265 av1 webcodecs mediabunny ffmpeg",
    },
    {
      id: "audio",
      route: "compress/audio",
      icon: "🎵",
      iconName: "audio",
      name: "Audio",
      desc: "FFmpeg.wasm encodes to 6 formats with custom bitrate, sample rate, and volume normalization.",
      tags: ["MP3", "AAC", "Opus", "FLAC", "WAV"],
      keywords: "audio mp3 aac opus flac wav normalize bitrate transcode",
    },
    {
      id: "gif",
      route: "compress/gif",
      icon: "🎞️",
      iconName: "gif",
      name: "GIF",
      desc: "Gold-standard two-pass palettegen + paletteuse Bayer dithering or WebM VP9 conversion.",
      tags: ["GIF", "WebM VP9", "FFmpeg"],
      keywords: "gif webm vp9 palettegen animation motion",
    },
    {
      id: "ocr",
      route: "compress/ocr",
      icon: "🔍",
      iconName: "ocr",
      name: "PDF OCR",
      desc: "Make scanned PDFs searchable. Tesseract.js LSTM neural OCR running in WebAssembly (100+ langs).",
      tags: ["Tesseract", "WASM", "Searchable PDF"],
      keywords: "ocr pdf searchable tesseract scanned text document extract",
    },
    {
      id: "convert",
      route: "convert",
      icon: "🔁",
      iconName: "convert",
      name: "Convert",
      desc: "Format conversion for video, audio, images, PDF ⇄ images, Word DOCX, and PowerPoint PPTX.",
      tags: ["Video", "DOCX", "PPTX", "PDF"],
      keywords: "convert video audio images docx pptx pdf transcode",
    },
    {
      id: "pdf-markdown",
      route: "convert/pdf-markdown",
      icon: "📝",
      iconName: "markdown",
      name: "PDF to Markdown",
      desc: "High-fidelity structural extraction with column-aware reading order, table preservation, and figure crops.",
      tags: ["Markdown", "TrOCR", "ZIP Bundle", "✨ New"],
      keywords: "pdf markdown convert export extract tables text layout doc handwriting math",
    },
  ];
</script>

<div class="home-wrap page-enter cz-workbench" bind:this={rootEl}>
  <!-- Progressive-enhancement queue and settings links -->
  <div class="cz-wb-panel__head" style="position: fixed; bottom: 8px; right: 8px; z-index: 10; opacity: 0.05;">
    <button type="button" data-nav="settings" onclick={(e) => handleNav("settings", e)}>Settings</button>
  </div>
  <div id="wb-queue" style="display: none;">Idle — nothing is being processed</div>

  <div class="home-hero">
    <div class="home-eyebrow">
      <span class="ey-pill">New</span>
      Client-side · Zero uploads · WASM & WebCodecs accelerated
    </div>

    <h1 class="home-title">
      <span class="ht-plain">Compress anything.</span>
      <span class="ht-grad">Stay private.</span>
    </h1>

    <p class="home-sub">
      Compress images, PDFs, video, audio, and GIFs — and extract structured documents to Markdown — entirely in your browser. Nothing leaves your device, ever.
    </p>

    <div class="home-actions">
      <a
        href="/compress/images"
        class="btn-primary"
        onclick={(e) => handleNav("compress/images", e)}
      >
        <span>Start compressing</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
      <UniversalUpload label="Drop or Pick Any File" />
      <button
        type="button"
        class="btn-ghost"
        onclick={scrollToHowItWorks}
      >
        How it works
      </button>
    </div>

    <div class="trust-row">
      <div class="trust-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        No uploads
      </div>
      <div class="trust-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        No accounts
      </div>
      <div class="trust-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        No tracking
      </div>
      <div class="trust-chip">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Open source
      </div>
    </div>
  </div>

  <div id="wb-pinned" class="cz-wb-pinned" style="display: flex; gap: 0.5rem; flex-wrap: wrap;"></div>

  <div class="home-tools-bar">
    <div class="home-tools-title">Tools</div>
    <div class="cz-wb-search">
      <input
        id="wb-search"
        type="search"
        placeholder="Filter tools (e.g. PDF, WebP, Video)..."
        aria-label="Filter tools"
      />
    </div>
  </div>

  <div id="wb-all" class="home-tools-grid cz-wb-quick">
    {#each TOOLS as tool}
      <a
        href="/{tool.route}"
        class="htc cz-wb-quick__card cz-wb-all__card"
        data-t={tool.id}
        data-nav={tool.route}
        data-label={tool.name}
        data-icon={tool.icon}
        data-keywords={tool.keywords}
        data-wb-tool
        data-wb-quick
        onclick={(e) => handleNav(tool.route, e)}
      >
        <div class="htc-head">
          <div class="htc-icon">
            <MacIcon name={tool.iconName} variant="squircle" squircleSize={40} />
          </div>
          <button
            type="button"
            class="cz-wb-all__fav"
            data-wb-fav
            aria-label="Pin {tool.name}"
            onclick={(e) => { e.stopPropagation(); }}
          >☆</button>
          <svg class="htc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M7 17L17 7M7 7h10v10"/>
          </svg>
        </div>
        <div class="htc-name cz-wb-quick__name">{tool.name}</div>
        <div class="htc-desc cz-wb-quick__desc">{tool.desc}</div>
        <div class="htc-tags">
          {#each tool.tags as tag}
            <span class="htc-tag">{tag}</span>
          {/each}
        </div>
      </a>
    {/each}
  </div>

  <div id="how-it-works" class="how-row">
    <div class="how-card">
      <div class="how-num">01</div>
      <div class="how-title">Drop your file</div>
      <div class="how-desc">Drag & drop or click to browse. All file processing starts immediately in your browser memory.</div>
    </div>
    <div class="how-card">
      <div class="how-num">02</div>
      <div class="how-title">Set options</div>
      <div class="how-desc">Choose quality, format, target size, codec, or use the intelligent device-aware defaults.</div>
    </div>
    <div class="how-card">
      <div class="how-num">03</div>
      <div class="how-title">Compress</div>
      <div class="how-desc">WebAssembly, Canvas API, and WebCodecs handle everything locally at native speed.</div>
    </div>
    <div class="how-card">
      <div class="how-num">04</div>
      <div class="how-title">Download</div>
      <div class="how-desc">Save your file. Nothing was uploaded. Nothing was logged. Your data is yours alone.</div>
    </div>
  </div>

  <div class="priv-highlight">
    <div class="ph-title">🔒 Your files never leave your device</div>
    <p class="ph-sub">
      CompressZ has no backend servers. All compression, transcoding, and OCR processing takes place 100% locally using WebAssembly, WebCodecs, and HTML5 Web APIs. We don't collect personal data, run zero telemetry, and never touch your files.
    </p>
    <div class="ph-actions">
      <a
        href="/privacy"
        class="btn-white"
        onclick={(e) => handleNav("privacy", e)}
      >
        Read Privacy Policy
      </a>
      <a
        class="btn-white-ghost"
        href="https://github.com/ADJ189/compressz"
        target="_blank"
        rel="noopener"
      >
        View Source Code ↗
      </a>
    </div>
  </div>
</div>
