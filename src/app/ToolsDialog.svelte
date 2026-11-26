<script lang="ts">
  import { navigate } from "../router";
  import UniversalUpload from "../components/UniversalUpload.svelte";
  import MacIcon from "../components/MacIcon.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  let searchQuery = $state("");
  let selectedCategory = $state("all");

  interface ToolItem {
    route: string;
    name: string;
    desc: string;
    icon: string;
    badge?: string;
  }

  interface ToolCategory {
    id: string;
    title: string;
    icon: string;
    items: ToolItem[];
  }

  const TOOL_CATEGORIES: ToolCategory[] = [
    {
      id: "pdf",
      title: "PDF Suite & Studio",
      icon: "pdf",
      items: [
        { route: "pdf/split", name: "Split PDF", desc: "Extract page ranges, chunk into N-parts, or burst to ZIP", icon: "split", badge: "Studio" },
        { route: "pdf/remove-pages", name: "Remove Pages", desc: "Delete unwanted pages or ranges with instant preview", icon: "remove-pages", badge: "Fast" },
        { route: "pdf/page-numbers", name: "Page Numbers & Bates", desc: "Add custom page numbers, header/footer, or Bates legal numbering", icon: "page-numbers", badge: "Bates" },
        { route: "pdf/nup", name: "Multi-Page (N-Up)", desc: "Combine 2, 4, or 9 pages per sheet for compact printing", icon: "nup", badge: "Layout" },
        { route: "pdf/metadata", name: "Edit & Strip Metadata", desc: "Inspect, update, or erase document metadata and dates for privacy", icon: "metadata", badge: "Privacy" },
        { route: "pdf/organize", name: "Organize Pages", desc: "Drag-drop visual reorder, rotate, duplicate, and delete pages", icon: "organize", badge: "Studio" },
        { route: "compress/merge-pdf", name: "Merge PDFs", desc: "Combine multiple PDF documents without rasterisation", icon: "merge" },
        { route: "pdf/edit", name: "Edit & Annotate", desc: "FreeText annotations, ink drawing, highlighting, and stamps", icon: "studio", badge: "New" },
        { route: "pdf/sign", name: "Fill & Sign", desc: "Vector signature pad, cursive typography, and stamp placement", icon: "sign", badge: "New" },
        { route: "pdf/watermark", name: "Add Watermark", desc: "Apply dynamic text, angle, opacity, or image stamp overlay", icon: "watermark" },
        { route: "pdf/crop", name: "Crop Pages", desc: "Adjust cropbox boundaries and trim margins permanently", icon: "crop" },
        { route: "pdf/forms", name: "Fill Forms", desc: "Fill AcroForm fields and flatten to immutable vectors", icon: "forms" },
        { route: "pdf/redact", name: "Redact Content", desc: "Purge text streams and burn-in permanent redaction blocks", icon: "redact", badge: "Security" },
        { route: "pdf/protect", name: "Password Protect", desc: "AES 128/256-bit encryption with user/owner permissions & decrypt", icon: "security" },
        { route: "pdf/repair", name: "Repair File", desc: "Rebuild corrupted PDF xref tables and salvage unreadable files", icon: "repair" },
      ],
    },
    {
      id: "compress",
      title: "Media Compression",
      icon: "compress",
      items: [
        { route: "compress/images", name: "Compress Images", desc: "Compress WebP, JPEG, PNG, AVIF with SSIM quality guard", icon: "image" },
        { route: "compress/pdf", name: "Compress PDF", desc: "Reduce document size via downsampling and deduplication", icon: "pdf" },
        { route: "compress/video", name: "Compress Video", desc: "WebCodecs + Mediabunny fast path and FFmpeg transcoding", icon: "video" },
        { route: "compress/audio", name: "Compress Audio", desc: "Optimize MP3, AAC, OGG, Opus, FLAC, and WAV", icon: "audio" },
        { route: "compress/gif", name: "Compress GIF", desc: "FFmpeg two-pass palettegen optimization and GIF-to-WebM export", icon: "gif" },
      ],
    },
    {
      id: "convert",
      title: "Format Conversions",
      icon: "convert",
      items: [
        { route: "convert", name: "Universal Converter", desc: "Cross-format converter for video, audio, images, office, and PDF", icon: "convert" },
        { route: "convert/pdf-markdown", name: "Extract to Markdown", desc: "High-fidelity text, table, and LaTeX math preservation", icon: "markdown", badge: "Advanced" },
        { route: "convert?type=pdf-word", name: "PDF to Word (DOCX)", desc: "Export PDF layout directly into formatted Word document", icon: "word", badge: "Office" },
        { route: "convert?type=pdf-excel", name: "PDF to Excel (XLSX)", desc: "Extract tabular coordinates into editable spreadsheet sheets", icon: "excel", badge: "Office" },
        { route: "convert?type=pdf-ppt", name: "PDF to PowerPoint (PPTX)", desc: "Render slide decks with vector text and visual assets", icon: "ppt", badge: "Office" },
        { route: "convert?type=office-pdf", name: "Office to PDF", desc: "Render DOCX, PPTX, and XLSX into PDF via native/WASM engines", icon: "pdf", badge: "Office" },
        { route: "compress/images-to-pdf", name: "Images to PDF", desc: "Compile image sequence into clean multi-page PDF", icon: "image" },
      ],
    },
    {
      id: "ai",
      title: "AI & Neural OCR",
      icon: "ocr",
      items: [
        { route: "compress/ocr", name: "Searchable PDF OCR", desc: "Generate searchable PDFs or plain text via Tesseract.js", icon: "ocr", badge: "AI" },
        { route: "compress/ocr?profile=handwriting", name: "Handwriting Recognition", desc: "TrOCR English neural line recognition for handwriting", icon: "studio", badge: "TrOCR" },
      ],
    },
    {
      id: "resources",
      title: "Resources & System",
      icon: "docs",
      items: [
        { route: "docs", name: "Documentation", desc: "Engine specifications, limits, and technical guides", icon: "docs" },
        { route: "privacy", name: "Privacy Guarantee", desc: "Local-only document processing & privacy guarantee", icon: "security" },
        { route: "about", name: "About CompressZ", desc: "Architecture, mission, and offline privacy model", icon: "home" },
      ],
    },
  ];

  const totalToolCount = $derived(
    TOOL_CATEGORIES.reduce((acc, cat) => acc + cat.items.length, 0),
  );

  const filteredCategories = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    return TOOL_CATEGORIES
      .filter((cat) => selectedCategory === "all" || cat.id === selectedCategory)
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((it) => {
          if (!q) return true;
          return (
            it.name.toLowerCase().includes(q) ||
            it.desc.toLowerCase().includes(q) ||
            cat.title.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((cat) => cat.items.length > 0);
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
  <div class="cz-dialog-backdrop" onclick={onClose} role="presentation"></div>
  <div
    class="cz-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="tools-dialog-title"
  >
    <!-- macOS Native Sheet Window Header -->
    <div class="cz-dialog-header">
      <div class="cz-mac-traffic-lights" aria-label="Window controls">
        <button
          type="button"
          class="cz-mac-dot cz-mac-dot-close"
          onclick={onClose}
          aria-label="Close window (Escape)"
          title="Close (ESC)"
        ></button>
        <span class="cz-mac-dot cz-mac-dot-min" aria-hidden="true"></span>
        <span class="cz-mac-dot cz-mac-dot-zoom" aria-hidden="true"></span>
      </div>

      <div class="cz-dialog-title-block">
        <h2 id="tools-dialog-title" class="cz-dialog-title">Tools Palette</h2>
        <span class="cz-dialog-count">{totalToolCount} local tools</span>
      </div>

      <button
        type="button"
        class="cz-mac-close-btn"
        aria-label="Close dialog (Escape)"
        title="Close (ESC)"
        onclick={onClose}
      >
        <MacIcon name="close" size={12} strokeWidth={2.4} />
      </button>
    </div>

    <!-- macOS Universal Upload Pill -->
    <div class="cz-dialog-universal-upload">
      <UniversalUpload
        variant="pill"
        label="Universal Drop & Route"
        onActionSelected={onClose}
      />
    </div>

    <!-- macOS Toolbar Category Segments & Spotlight Search -->
    <div class="cz-dialog-toolbar">
      <div class="cz-mac-segmented-bar" role="tablist" aria-label="Tool categories">
        <button
          type="button"
          class="cz-mac-seg-btn {selectedCategory === 'all' ? 'is-active' : ''}"
          role="tab"
          aria-selected={selectedCategory === 'all'}
          onclick={() => (selectedCategory = "all")}
        >
          <span class="cz-seg-icon"><MacIcon name="tools" size={13} /></span>
          <span>All</span>
        </button>
        {#each TOOL_CATEGORIES as cat}
          <button
            type="button"
            class="cz-mac-seg-btn {selectedCategory === cat.id ? 'is-active' : ''}"
            role="tab"
            aria-selected={selectedCategory === cat.id}
            onclick={() => (selectedCategory = cat.id)}
          >
            <span class="cz-seg-icon"><MacIcon name={cat.icon} size={13} /></span>
            <span>{cat.title.split('&')[0].trim()}</span>
          </button>
        {/each}
      </div>

      <div class="cz-dialog-search-wrap">
        <span class="cz-search-icon" aria-hidden="true">
          <MacIcon name="search" size={14} />
        </span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="search"
          placeholder="Search tools... (⌘K)"
          bind:value={searchQuery}
          class="cz-dialog-input"
          autofocus
        />
        {#if searchQuery}
          <button
            type="button"
            class="cz-search-clear"
            aria-label="Clear search"
            onclick={() => (searchQuery = "")}
          >
            <MacIcon name="close" size={11} strokeWidth={2.5} />
          </button>
        {/if}
      </div>
    </div>

    <!-- Tool Cards Body -->
    <div class="cz-dialog-body" role="list">
      {#if filteredCategories.length === 0}
        <div class="cz-empty-state">
          <span class="cz-empty-icon">
            <MacIcon name="search" size={32} />
          </span>
          <p class="cz-empty-text">No tools matching "{searchQuery}"</p>
          <button
            type="button"
            class="cz-empty-clear-btn"
            onclick={() => { searchQuery = ""; selectedCategory = "all"; }}
          >
            Reset filter
          </button>
        </div>
      {:else}
        {#each filteredCategories as group}
          <section class="cz-tools-group" aria-label={group.title}>
            <div class="cz-tools-group-header">
              <span class="cz-tools-group-icon" aria-hidden="true">
                <MacIcon name={group.icon} size={14} />
              </span>
              <span class="cz-tools-group-title">{group.title}</span>
              <span class="cz-tools-group-badge">{group.items.length}</span>
            </div>

            <div class="cz-tools-grid">
              {#each group.items as tool}
                <button
                  type="button"
                  class="cz-tool-card"
                  onclick={() => selectTool(tool.route)}
                >
                  <span class="cz-tool-icon" aria-hidden="true">
                    <MacIcon
                      name={tool.icon || "tools"}
                      variant="squircle"
                      squircleSize={38}
                    />
                  </span>
                  <div class="cz-tool-meta">
                    <div class="cz-tool-name-row">
                      <span class="cz-tool-name">{tool.name}</span>
                      {#if tool.badge}
                        <span class="cz-tool-badge cz-badge-{tool.badge.toLowerCase()}">{tool.badge}</span>
                      {/if}
                    </div>
                    <p class="cz-tool-desc">{tool.desc}</p>
                  </div>
                  <span class="cz-tool-chevron" aria-hidden="true">
                    <MacIcon name="chevron-right" size={14} />
                  </span>
                </button>
              {/each}
            </div>
          </section>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .cz-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 1000;
  }

  .cz-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 92%;
    max-width: 760px;
    max-height: 86vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-xl, 20px);
    box-shadow: 0 24px 64px -12px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.08);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* macOS Window Titlebar */
  .cz-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.95rem 1.25rem 0.8rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }

  .cz-mac-traffic-lights {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 60px;
  }

  .cz-mac-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
    cursor: pointer;
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.4);
  }

  .cz-mac-dot-close {
    background: #ff5f57;
    border: 0.5px solid #e0443e;
  }

  .cz-mac-dot-min {
    background: #febc2e;
    border: 0.5px solid #d89e24;
  }

  .cz-mac-dot-zoom {
    background: #28c840;
    border: 0.5px solid #1aab29;
  }

  .cz-dialog-title-block {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .cz-dialog-title {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.015em;
    margin: 0;
  }

  .cz-dialog-count {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-3);
    padding: 0.12rem 0.45rem;
    border-radius: 9999px;
    background: var(--surface);
    border: 1px solid var(--border);
  }

  .cz-mac-close-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
    transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
  }

  @media (hover: hover) and (pointer: fine) {
    .cz-mac-close-btn:hover {
      background: var(--surface3, var(--surface2));
      color: var(--text);
      border-color: var(--border-mid);
    }
  }

  .cz-mac-close-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Universal Upload Container in Dialog */
  .cz-dialog-universal-upload {
    padding: 0.85rem 1.25rem 0.55rem;
    background: var(--surface);
  }

  /* macOS Toolbar Bar */
  .cz-dialog-toolbar {
    padding: 0.65rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .cz-mac-segmented-bar {
    display: inline-flex;
    align-items: center;
    background: var(--surface);
    padding: 3px;
    border-radius: var(--r-md, 8px);
    border: 1px solid var(--border);
    gap: 2px;
    overflow-x: auto;
    max-width: 100%;
  }

  .cz-mac-seg-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-3);
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }

  .cz-mac-seg-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  @media (hover: hover) and (pointer: fine) {
    .cz-mac-seg-btn:hover {
      color: var(--text);
      background: var(--surface2);
    }
  }

  .cz-mac-seg-btn.is-active {
    background: var(--surface2);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .cz-seg-icon {
    display: inline-flex;
    align-items: center;
  }

  /* Spotlight Search Wrap */
  .cz-dialog-search-wrap {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 200px;
  }

  .cz-search-icon {
    position: absolute;
    left: 0.65rem;
    color: var(--text-3);
    pointer-events: none;
    display: flex;
    align-items: center;
  }

  .cz-dialog-input {
    width: 100%;
    padding: 0.45rem 1.8rem 0.45rem 2rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.84rem;
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
  }

  .cz-dialog-input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft, rgba(59, 91, 219, 0.15));
  }

  .cz-search-clear {
    position: absolute;
    right: 0.55rem;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: var(--surface3, var(--border));
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  /* Dialog Body */
  .cz-dialog-body {
    padding: 1.15rem 1.25rem 1.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.45rem;
  }

  .cz-tools-group-header {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 0.65rem;
  }

  .cz-tools-group-icon {
    color: var(--text-3);
    display: flex;
    align-items: center;
  }

  .cz-tools-group-title {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }

  .cz-tools-group-badge {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-3);
    background: var(--surface2);
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
  }

  /* Grid of Mac-like Cards */
  .cz-tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
    gap: 0.75rem;
  }

  .cz-tool-card {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 0.95rem;
    border: 1px solid var(--border);
    border-radius: var(--r-md, 12px);
    background: var(--surface);
    text-align: left;
    cursor: pointer;
    outline: none;
    position: relative;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
    transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1),
                border-color 0.16s cubic-bezier(0.16, 1, 0.3, 1),
                background-color 0.16s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @media (hover: hover) and (pointer: fine) {
    .cz-tool-card:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
      background: var(--surface2);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
    }
    .cz-tool-card:hover .cz-tool-chevron {
      transform: translateX(2px);
      color: var(--accent);
    }
  }

  .cz-tool-card:active {
    transform: translateY(0) scale(0.985);
  }

  .cz-tool-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-color: var(--accent);
  }

  .cz-tool-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cz-tool-meta {
    flex: 1;
    min-width: 0;
  }

  .cz-tool-name-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .cz-tool-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .cz-tool-badge {
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .cz-badge-studio {
    background: rgba(255, 69, 58, 0.12);
    color: #ff453a;
  }

  .cz-badge-new {
    background: rgba(10, 132, 255, 0.12);
    color: #0a84ff;
  }

  .cz-badge-office {
    background: rgba(48, 209, 88, 0.12);
    color: #30d158;
  }

  .cz-badge-advanced {
    background: rgba(191, 90, 242, 0.12);
    color: #bf5af2;
  }

  .cz-badge-security {
    background: rgba(48, 209, 88, 0.12);
    color: #30d158;
  }

  .cz-badge-ai, .cz-badge-trocr {
    background: rgba(191, 90, 242, 0.12);
    color: #bf5af2;
  }

  .cz-tool-desc {
    font-size: 0.77rem;
    color: var(--text-3);
    margin: 0.2rem 0 0 0;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cz-tool-chevron {
    color: var(--text-3);
    opacity: 0.6;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    transition: transform 0.16s ease, color 0.16s ease;
  }

  /* Empty State */
  .cz-empty-state {
    padding: 3rem 1rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .cz-empty-icon {
    color: var(--text-3);
    opacity: 0.5;
  }

  .cz-empty-text {
    font-size: 0.95rem;
    color: var(--text-2);
    margin: 0;
  }

  .cz-empty-clear-btn {
    padding: 0.35rem 0.85rem;
    font-size: 0.8rem;
    font-weight: 600;
    border-radius: var(--r-sm, 6px);
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    cursor: pointer;
  }

  /* Narrow-screen mobile responsiveness */
  @media (max-width: 520px) {
    .cz-dialog {
      width: calc(100vw - 16px);
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - 24px);
      max-height: 92dvh;
      border-radius: var(--r, 16px);
      margin: 0;
    }
    .cz-dialog-header {
      padding: 0.75rem 0.85rem;
    }
    .cz-mac-traffic-lights {
      width: auto;
      gap: 5px;
    }
    .cz-mac-dot-min,
    .cz-mac-dot-zoom {
      display: none;
    }
    .cz-mac-dot-close {
      width: 14px;
      height: 14px;
    }
    .cz-dialog-title {
      font-size: 0.95rem;
    }
    .cz-dialog-count {
      font-size: 0.68rem;
      padding: 0.1rem 0.35rem;
    }
    .cz-mac-close-btn {
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
    }
    .cz-dialog-universal-upload {
      padding: 0.55rem 0.85rem 0.35rem;
    }
    .cz-dialog-toolbar {
      padding: 0.5rem 0.85rem;
      gap: 0.5rem;
    }
    .cz-mac-segmented-bar {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding: 3px 2px;
    }
    .cz-mac-segmented-bar::-webkit-scrollbar {
      display: none;
    }
    .cz-mac-seg-btn {
      flex: 0 0 auto;
      min-height: 34px;
      padding: 0.35rem 0.65rem;
      font-size: 0.78rem;
    }
    .cz-dialog-search-wrap {
      width: 100%;
      min-width: 0;
    }
    .cz-dialog-input {
      font-size: 16px; /* Prevents iOS auto-zoom on input focus */
      padding: 0.45rem 1.8rem 0.45rem 2rem;
    }
    .cz-dialog-body {
      padding: 0.85rem 0.85rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
      overflow-x: hidden;
      gap: 1.15rem;
    }
    .cz-tools-grid {
      grid-template-columns: 1fr;
      gap: 0.55rem;
      width: 100%;
    }
    .cz-tool-card {
      padding: 0.7rem 0.85rem;
      min-height: 48px;
    }
    .cz-tool-name {
      font-size: 0.88rem;
    }
    .cz-tool-desc {
      font-size: 0.75rem;
    }
  }

  @media (max-width: 360px) {
    .cz-dialog-header {
      padding: 0.65rem 0.65rem;
    }
    .cz-dialog-title-block {
      gap: 0.35rem;
    }
    .cz-dialog-count {
      display: none;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .cz-tool-card,
    .cz-mac-seg-btn,
    .cz-tool-chevron,
    .cz-mac-close-btn {
      transition: none;
      transform: none !important;
    }
  }
</style>
