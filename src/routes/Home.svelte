<script lang="ts">
  import { navigate } from "../router";
  import { getRecents, getFavourites } from "../lib/recents";
  import { onMount } from "svelte";

  let searchQuery = $state("");
  let recents = $state<string[]>([]);
  let favourites = $state<string[]>([]);

  onMount(() => {
    recents = getRecents();
    favourites = getFavourites();
  });

  interface ToolItem {
    route: string;
    name: string;
    desc: string;
    icon: string;
    isNew?: boolean;
    tag: string;
  }

  const TOOLS: ToolItem[] = [
    {
      route: "convert/pdf-markdown",
      name: "PDF to Markdown",
      desc: "Extract structured Markdown, tables, and visual formulas from any PDF.",
      icon: "📝",
      isNew: true,
      tag: "Document",
    },
    {
      route: "compress/images",
      name: "Image Compressor",
      desc: "Compress WebP, AVIF, JPEG, and PNG with visual SSIM quality verification.",
      icon: "🖼️",
      tag: "Media",
    },
    {
      route: "compress/pdf",
      name: "PDF Compressor",
      desc: "Downscale images and deduplicate objects to shrink document byte size.",
      icon: "📄",
      tag: "Document",
    },
    {
      route: "compress/ocr",
      name: "PDF OCR",
      desc: "Optical character recognition with printed text and handwriting modes.",
      icon: "🔍",
      tag: "Document",
    },
    {
      route: "compress/video",
      name: "Video Compressor",
      desc: "WebCodecs hardware acceleration and FFmpeg transcoding for MP4 and WebM.",
      icon: "🎬",
      tag: "Media",
    },
    {
      route: "compress/audio",
      name: "Audio Compressor",
      desc: "Optimize MP3, AAC, OGG, Opus, FLAC, and WAV with custom bitrates.",
      icon: "🎵",
      tag: "Media",
    },
    {
      route: "compress/merge-pdf",
      name: "Merge PDF",
      desc: "Combine multiple PDF files into one clean document with selectable text.",
      icon: "🧷",
      tag: "Document",
    },
    {
      route: "compress/images-to-pdf",
      name: "Images to PDF",
      desc: "Convert photo batches into a single organized PDF file.",
      icon: "🧩",
      tag: "Document",
    },
    {
      route: "convert",
      name: "Format Converter",
      desc: "Convert media, office documents, and images entirely in your browser.",
      icon: "🔁",
      tag: "Utility",
    },
  ];

  const filteredTools = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return TOOLS;
    return TOOLS.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        t.tag.toLowerCase().includes(q),
    );
  });

  function openTool(route: string) {
    navigate(route);
  }
</script>

<div class="cz-workbench-view">
  <section class="cz-hero-section">
    <div class="cz-hero-text">
      <h1 class="cz-hero-title">Compress and convert files locally.</h1>
      <p class="cz-hero-desc">
        Fast, private document and media processing running inside your browser.
        No server uploads, no data transmission, and zero telemetry.
      </p>
    </div>

    <div class="cz-search-row">
      <div class="cz-search-input-wrap">
        <span class="cz-search-icon" aria-hidden="true">🔍</span>
        <input
          type="search"
          placeholder="Search tools (e.g. PDF, WebP, Video)..."
          bind:value={searchQuery}
          class="cz-search-input"
        />
      </div>
    </div>
  </section>

  <section class="cz-tools-section">
    <div class="cz-section-header">
      <h2 class="cz-section-heading">Available Tools</h2>
      <span class="cz-section-meta">{filteredTools.length} tools</span>
    </div>

    <div class="cz-tools-grid">
      {#each filteredTools as tool}
        <button
          type="button"
          class="cz-tool-card"
          onclick={() => openTool(tool.route)}
        >
          <div class="cz-tool-top">
            <span class="cz-tool-icon" aria-hidden="true">{tool.icon}</span>
            <div class="cz-tool-tags">
              {#if tool.isNew}
                <span class="cz-badge-new">New</span>
              {/if}
              <span class="cz-badge-tag">{tool.tag}</span>
            </div>
          </div>
          <h3 class="cz-tool-name">{tool.name}</h3>
          <p class="cz-tool-desc">{tool.desc}</p>
        </button>
      {/each}
    </div>
  </section>

  <section class="cz-privacy-callout">
    <div class="cz-callout-icon" aria-hidden="true">🔒</div>
    <div class="cz-callout-content">
      <h3 class="cz-callout-title">On-Device Privacy Invariant</h3>
      <p class="cz-callout-desc">
        Your documents and media are decoded and processed in memory using WebAssembly,
        WebCodecs, and WebGPU. File bytes never leave this browser tab.
      </p>
    </div>
  </section>
</div>

<style>
  .cz-workbench-view {
    max-width: 1060px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 2.25rem;
  }
  .cz-hero-section {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .cz-hero-title {
    font-family: var(--display);
    font-size: clamp(1.8rem, 3.5vw, 2.5rem);
    font-weight: 800;
    line-height: 1.15;
    color: var(--text);
    letter-spacing: -0.025em;
  }
  .cz-hero-desc {
    font-size: 1rem;
    color: var(--text-3);
    max-width: 60ch;
    line-height: 1.5;
  }
  .cz-search-row {
    margin-top: 0.5rem;
  }
  .cz-search-input-wrap {
    position: relative;
    max-width: 480px;
  }
  .cz-search-icon {
    position: absolute;
    left: 0.85rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.9rem;
    color: var(--text-4);
  }
  .cz-search-input {
    width: 100%;
    padding: 0.65rem 0.85rem 0.65rem 2.4rem;
    border-radius: var(--r);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.92rem;
    transition: border-color var(--t), box-shadow var(--t);
  }
  .cz-search-input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }
  .cz-tools-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cz-section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .cz-section-heading {
    font-family: var(--display);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-section-meta {
    font-size: 0.82rem;
    color: var(--text-3);
    font-family: var(--mono);
  }
  .cz-tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 1rem;
  }
  .cz-tool-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 1.15rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface);
    text-align: left;
    transition: transform var(--t), border-color var(--t), box-shadow var(--t);
  }
  .cz-tool-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-mid);
    box-shadow: var(--shadow-sm);
  }
  .cz-tool-top {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .cz-tool-icon {
    font-size: 1.5rem;
    line-height: 1;
  }
  .cz-tool-tags {
    display: flex;
    gap: 0.35rem;
  }
  .cz-badge-new {
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .cz-badge-tag {
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-size: 0.7rem;
    background: var(--bg2);
    color: var(--text-3);
  }
  .cz-tool-name {
    font-family: var(--display);
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 0.25rem;
  }
  .cz-tool-desc {
    font-size: 0.85rem;
    color: var(--text-3);
    line-height: 1.4;
  }
  .cz-privacy-callout {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.15rem 1.35rem;
    border-radius: var(--r);
    background: var(--surface2);
    border: 1px solid var(--border);
  }
  .cz-callout-icon {
    font-size: 1.4rem;
    margin-top: 0.1rem;
  }
  .cz-callout-title {
    font-family: var(--display);
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-callout-desc {
    font-size: 0.84rem;
    color: var(--text-3);
    margin-top: 0.15rem;
    line-height: 1.4;
  }
</style>
