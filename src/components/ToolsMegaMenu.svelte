<script lang="ts">
  import { navigate } from "../router";
  import MacIcon from "./MacIcon.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  let searchQuery = $state("");

  interface ToolItem {
    id: string;
    route: string;
    name: string;
    desc: string;
    icon: string;
    badge?: string;
  }

  interface ToolCategory {
    title: string;
    icon: string;
    items: ToolItem[];
  }

  const CATEGORIES: ToolCategory[] = [
    {
      title: "PDF Suite & Studio",
      icon: "pdf",
      items: [
        { id: "pdf-split", route: "pdf/split", name: "Split PDF", desc: "Extract ranges, chunk into N parts, or burst to ZIP", icon: "split", badge: "Studio" },
        { id: "pdf-organize", route: "pdf/organize", name: "Organize Pages", desc: "Reorder, rotate, duplicate, and delete pages visually", icon: "organize", badge: "Studio" },
        { id: "pdf-merge", route: "compress/merge-pdf", name: "Merge PDF", desc: "Combine multiple PDFs without rasterisation", icon: "merge" },
        { id: "pdf-studio", route: "pdf/edit", name: "PDF Studio", desc: "FreeText annotations, ink drawing, and stamps", icon: "studio", badge: "New" },
        { id: "pdf-sign", route: "pdf/sign", name: "Sign PDF", desc: "Vector signature pad, cursive typography, and stamps", icon: "sign", badge: "New" },
        { id: "pdf-watermark", route: "pdf/watermark", name: "Watermark", desc: "Custom dynamic text, angle, opacity, or image stamp", icon: "watermark" },
        { id: "pdf-crop", route: "pdf/crop", name: "Crop PDF", desc: "Trim document margins and adjust cropbox bounds", icon: "crop" },
        { id: "pdf-forms", route: "pdf/forms", name: "Interactive Forms", desc: "Fill AcroForm fields and flatten to vectors", icon: "forms" },
        { id: "pdf-redact", route: "pdf/redact", name: "True Redaction", desc: "Purge text streams and burn-in permanent redaction", icon: "redact", badge: "Security" },
        { id: "pdf-security", route: "pdf/protect", name: "Protect & Unlock", desc: "AES 128/256-bit encryption with user permissions", icon: "security" },
        { id: "pdf-repair", route: "pdf/repair", name: "Repair PDF", desc: "Rebuild corrupted xref tables and salvage files", icon: "repair" },
        { id: "pdf-markdown", route: "convert/pdf-markdown", name: "PDF to Markdown", desc: "Extract structured text, tables, and math equations", icon: "markdown", badge: "Advanced" },
      ],
    },
    {
      title: "Media Compression",
      icon: "compress",
      items: [
        { id: "cmp-images", route: "compress/images", name: "Compress Images", desc: "WebP, JPEG, PNG, AVIF with SSIM quality guard", icon: "image" },
        { id: "cmp-pdf", route: "compress/pdf", name: "Compress PDF", desc: "Downsample embedded images to target size", icon: "pdf" },
        { id: "cmp-video", route: "compress/video", name: "Compress Video", desc: "WebCodecs hardware acceleration & FFmpeg transcode", icon: "video" },
        { id: "cmp-audio", route: "compress/audio", name: "Compress Audio", desc: "Optimize MP3, AAC, OGG, Opus, FLAC, and WAV", icon: "audio" },
        { id: "cmp-gif", route: "compress/gif", name: "Compress GIF", desc: "Two-pass palettegen Bayer dithering & WebM export", icon: "gif" },
      ],
    },
    {
      title: "Format Conversions",
      icon: "convert",
      items: [
        { id: "conv-hub", route: "convert", name: "Universal Converter", desc: "Video, audio, images, office, and PDF cross-format", icon: "convert" },
        { id: "conv-word", route: "convert?type=pdf-word", name: "PDF to Word (DOCX)", desc: "Export formatted Word document from PDF layout", icon: "word", badge: "Office" },
        { id: "conv-excel", route: "convert?type=pdf-excel", name: "PDF to Excel (XLSX)", desc: "Extract tabular coordinates into editable spreadsheet", icon: "excel", badge: "Office" },
        { id: "conv-ppt", route: "convert?type=pdf-ppt", name: "PDF to PowerPoint (PPTX)", desc: "Vector slides and layout deck generation", icon: "ppt", badge: "Office" },
        { id: "conv-office-pdf", route: "convert?type=office-pdf", name: "Office to PDF", desc: "Convert DOCX, XLSX, and PPTX to PDF via WASM", icon: "pdf" },
        { id: "conv-img-pdf", route: "compress/images-to-pdf", name: "Images to PDF", desc: "Compile image sequence into clean multi-page PDF", icon: "image" },
      ],
    },
    {
      title: "AI & Neural OCR",
      icon: "ocr",
      items: [
        { id: "ocr-printed", route: "compress/ocr", name: "Searchable PDF OCR", desc: "Extract text via Tesseract.js neural LSTM in 100+ langs", icon: "ocr", badge: "AI" },
        { id: "ocr-handwriting", route: "convert/pdf-markdown", name: "Handwriting Recognition", desc: "TrOCR English line recognition for handwriting", icon: "studio", badge: "TrOCR" },
      ],
    },
  ];

  const filtered = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.desc.toLowerCase().includes(q) ||
          it.route.toLowerCase().includes(q) ||
          cat.title.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.items.length > 0);
  });

  function selectTool(route: string) {
    onClose();
    navigate(route);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    class="cz-mega-backdrop"
    onclick={onClose}
    role="presentation"
  ></div>

  <div
    class="cz-mega-tray"
    role="dialog"
    aria-modal="true"
    aria-label="All Tools & Features"
  >
    <!-- Tray Header with Search & Counter -->
    <div class="cz-mega-header">
      <div class="cz-mega-search-wrap">
        <MacIcon name="search" size={16} color="var(--text-3)" />
        <input
          type="search"
          class="cz-mega-search"
          placeholder="Search features (e.g. Split, Word, WebP, Markdown)..."
          bind:value={searchQuery}
          aria-label="Search tools and features"
        />
        {#if searchQuery}
          <button
            type="button"
            class="cz-mega-clear-btn"
            onclick={() => (searchQuery = "")}
            aria-label="Clear search"
          >
            <MacIcon name="close" size={12} color="var(--text-3)" />
          </button>
        {/if}
      </div>

      <button
        type="button"
        class="cz-mega-close"
        onclick={onClose}
        aria-label="Close menu"
      >
        <MacIcon name="close" size={16} color="var(--text-2)" />
      </button>
    </div>

    <!-- Mega Categories Grid -->
    <div class="cz-mega-scroll">
      {#each filtered as cat}
        <div class="cz-mega-section">
          <div class="cz-mega-sec-title">
            <MacIcon name={cat.icon} size={15} color="var(--accent)" />
            <span>{cat.title}</span>
            <span class="cz-mega-count">{cat.items.length}</span>
          </div>

          <div class="cz-mega-cards-grid">
            {#each cat.items as item}
              <button
                type="button"
                class="cz-tool-box"
                onclick={() => selectTool(item.route)}
              >
                <div class="cz-tool-box-icon">
                  <MacIcon name={item.icon} variant="squircle" squircleSize={38} />
                </div>
                <div class="cz-tool-box-info">
                  <div class="cz-tool-box-row">
                    <span class="cz-tool-box-name">{item.name}</span>
                    {#if item.badge}
                      <span class="cz-tool-box-badge">{item.badge}</span>
                    {/if}
                  </div>
                  <p class="cz-tool-box-desc">{item.desc}</p>
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/each}

      {#if filtered.length === 0}
        <div class="cz-mega-empty">
          <p>No features found matching "{searchQuery}"</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .cz-mega-backdrop {
    position: fixed;
    inset: 0;
    z-index: 180;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cz-mega-tray {
    position: fixed;
    top: calc(var(--header-h) + var(--tabbar-h) + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: min(1080px, calc(100vw - 24px));
    max-height: calc(100vh - var(--header-h) - var(--tabbar-h) - 28px);
    z-index: 190;
    background: var(--surface);
    border: 1px solid var(--border-mid);
    border-radius: 20px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28), 0 4px 16px rgba(0, 0, 0, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: czTraySlide 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes czTraySlide {
    from {
      opacity: 0;
      transform: translate(-50%, -10px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }
  }

  .cz-mega-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }

  .cz-mega-search-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.45rem 0.85rem;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
  }

  .cz-mega-search-wrap:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .cz-mega-search {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 0.9rem;
  }

  .cz-mega-clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--bg2);
    color: var(--text-3);
    transition: background 0.16s ease, color 0.16s ease;
  }
  .cz-mega-clear-btn:hover {
    background: var(--border-strong);
    color: var(--text);
  }

  .cz-mega-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: var(--bg2);
    color: var(--text-2);
    transition: background 0.16s ease, color 0.16s ease, transform 0.16s ease;
  }
  .cz-mega-close:hover {
    background: var(--border-mid);
    color: var(--text);
    transform: scale(1.05);
  }

  .cz-mega-scroll {
    overflow-y: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .cz-mega-sec-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
    margin-bottom: 0.75rem;
    padding-left: 0.25rem;
  }

  .cz-mega-count {
    font-size: 0.75rem;
    background: var(--bg2);
    color: var(--text-3);
    padding: 0.1rem 0.45rem;
    border-radius: 100px;
    font-weight: 600;
  }

  .cz-mega-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
  }

  /* Animated macOS Squircle Feature Cards */
  .cz-tool-box {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    padding: 0.75rem 0.9rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 14px;
    text-align: left;
    transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), background 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    cursor: pointer;
  }

  .cz-tool-box:hover {
    transform: translateY(-2px) scale(1.012);
    background: var(--surface);
    border-color: var(--accent);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.10), 0 2px 6px rgba(0, 0, 0, 0.06);
  }

  .cz-tool-box:active {
    transform: translateY(0) scale(0.99);
  }

  .cz-tool-box-icon {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .cz-tool-box-info {
    flex: 1;
    min-width: 0;
  }

  .cz-tool-box-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.2rem;
  }

  .cz-tool-box-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cz-tool-box-badge {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid var(--accent-glow);
    text-transform: uppercase;
  }

  .cz-tool-box-desc {
    font-size: 0.76rem;
    color: var(--text-3);
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cz-mega-empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--text-3);
    font-size: 0.95rem;
  }

  @media (max-width: 640px) {
    .cz-mega-tray {
      top: 0;
      left: 0;
      transform: none;
      width: 100vw;
      height: 100vh;
      max-height: 100vh;
      border-radius: 0;
    }
    .cz-mega-cards-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
