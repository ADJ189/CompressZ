<script lang="ts">
  import { navigate } from "../router";
  import UniversalUpload from "../components/UniversalUpload.svelte";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  let searchQuery = $state("");

  const ALL_TOOLS = [
    {
      category: "PDF Suite & Studio",
      items: [
        { route: "compress/merge-pdf", name: "Merge PDF", desc: "Combine multiple PDF documents without rasterisation", icon: "🧷" },
        { route: "pdf/split", name: "Split PDF", desc: "Extract page ranges, chunk into N-parts, or burst to ZIP", icon: "✂️", isNew: true },
        { route: "pdf/organize", name: "Organize Pages", desc: "Drag-drop visual reorder, rotate, duplicate, and delete pages", icon: "📑", isNew: true },
        { route: "pdf/edit", name: "PDF Studio & Editor", desc: "FreeText annotations, ink drawing, highlighting, and stamps", icon: "✏️", isNew: true },
        { route: "pdf/sign", name: "Sign PDF", desc: "Vector signature pad, cursive typography, and stamp placement", icon: "🖋️", isNew: true },
        { route: "pdf/watermark", name: "Watermark", desc: "Apply dynamic text, angle, opacity, or image stamp overlay", icon: "💧", isNew: true },
        { route: "pdf/crop", name: "Crop PDF", desc: "Adjust cropbox boundaries and trim margins permanently", icon: "📐", isNew: true },
        { route: "pdf/forms", name: "Interactive Forms", desc: "Fill AcroForm fields and flatten to immutable vectors", icon: "📋", isNew: true },
        { route: "pdf/redact", name: "True Redaction", desc: "Purge text streams and burn-in permanent redaction blocks", icon: "⬛", isNew: true },
        { route: "pdf/protect", name: "Protect & Unlock", desc: "AES 128/256-bit encryption with user/owner permissions & decrypt", icon: "🔐", isNew: true },
        { route: "pdf/repair", name: "Repair & Recover", desc: "Rebuild corrupted PDF xref tables and salvage unreadable files", icon: "🩹", isNew: true },
        { route: "compress/images-to-pdf", name: "Images to PDF", desc: "Compile image sequence into clean multi-page PDF", icon: "🧩" },
        { route: "compress/pdf", name: "Compress PDF", desc: "Reduce document size via downsampling and deduplication", icon: "📄" },
        { route: "compress/ocr", name: "PDF OCR", desc: "Extract text and generate searchable PDFs via Tesseract", icon: "🔍" },
        { route: "convert/pdf-markdown", name: "PDF to Markdown", desc: "High-fidelity text, table, and visual preservation export", icon: "📝" },
      ],
    },
    {
      category: "Compression",
      items: [
        { route: "compress/images", name: "Images", desc: "Compress WebP, JPEG, PNG, AVIF with quality guard", icon: "🖼️" },
        { route: "compress/pdf", name: "PDF", desc: "Reduce document size via downsampling and deduplication", icon: "📄" },
        { route: "compress/video", name: "Video", desc: "WebCodecs hardware acceleration and FFmpeg transcoding", icon: "🎬" },
        { route: "compress/audio", name: "Audio", desc: "Optimize MP3, AAC, OGG, Opus, FLAC, and WAV", icon: "🎵" },
        { route: "compress/gif", name: "GIF", desc: "Lossy LZW compression and GIF-to-video conversion", icon: "🎞️" },
      ],
    },
    {
      category: "Conversions & Document Engines",
      items: [
        { route: "convert", name: "Format Converter", desc: "Two-way Office (Word, Excel, PPT), Video, Audio & Images", icon: "🔁" },
        { route: "convert?type=pdf-word", name: "PDF to Word (DOCX)", desc: "Export PDF layout directly into formatted Word document", icon: "📘", isNew: true },
        { route: "convert?type=pdf-excel", name: "PDF to Excel (XLSX)", desc: "Extract tabular coordinates into editable spreadsheet sheets", icon: "📗", isNew: true },
        { route: "convert?type=pdf-ppt", name: "PDF to PowerPoint (PPTX)", desc: "Render slide decks with vector text and visual assets", icon: "📙", isNew: true },
        { route: "convert?type=office-pdf", name: "Office to PDF", desc: "Render DOCX, PPTX, and XLSX into PDF via native/WASM engines", icon: "📑", isNew: true },
        { route: "about", name: "About", desc: "Architecture, mission, and offline privacy model", icon: "ℹ️" },
        { route: "docs", name: "Documentation", desc: "Engine specifications, limits, and technical guides", icon: "📖" },
        { route: "privacy", name: "Privacy", desc: "Local-only invariants and zero-telemetry guarantee", icon: "🔒" },
      ],
    },
  ];

  const filteredCategories = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return ALL_TOOLS;
    return ALL_TOOLS.map((cat) => ({
      category: cat.category,
      items: cat.items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.desc.toLowerCase().includes(q) ||
          cat.category.toLowerCase().includes(q),
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
  <div class="cz-dialog-backdrop" onclick={onClose} role="presentation"></div>
  <div
    class="cz-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="tools-dialog-title"
  >
    <div class="cz-dialog-header">
      <h2 id="tools-dialog-title" class="cz-dialog-title">All Tools</h2>
      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        aria-label="Close dialog"
        onclick={onClose}
      >
        ✕
      </button>
    </div>

    <div class="cz-dialog-universal-upload">
      <UniversalUpload compact={false} onActionSelected={onClose} />
    </div>

    <div class="cz-dialog-search">
      <input
        type="search"
        placeholder="Search tools..."
        bind:value={searchQuery}
        class="cz-dialog-input"
        autofocus
      />
    </div>

    <div class="cz-dialog-body">
      {#each filteredCategories as group}
        <div class="cz-tools-group">
          <div class="cz-tools-group-title">{group.category}</div>
          <div class="cz-tools-grid">
            {#each group.items as tool}
              <button
                type="button"
                class="cz-tool-card"
                onclick={() => selectTool(tool.route)}
              >
                <span class="cz-tool-icon" aria-hidden="true">{tool.icon}</span>
                <div class="cz-tool-meta">
                  <div class="cz-tool-name">
                    {tool.name}
                    {#if tool.isNew}
                      <span class="cz-tool-new-badge">New</span>
                    {/if}
                  </div>
                  <div class="cz-tool-desc">{tool.desc}</div>
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .cz-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    z-index: 1000;
  }
  .cz-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    max-width: 680px;
    max-height: 82vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    box-shadow: var(--shadow-xl);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cz-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.15rem 1.35rem 0.85rem;
    border-bottom: 1px solid var(--border);
  }
  .cz-dialog-title {
    font-family: var(--display);
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-dialog-universal-upload {
    padding: 0.85rem 1.35rem 0.5rem;
    background: var(--surface);
  }
  .cz-dialog-search {
    padding: 0.85rem 1.35rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }
  .cz-dialog-input {
    width: 100%;
    padding: 0.55rem 0.85rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 0.92rem;
  }
  .cz-dialog-input:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .cz-dialog-body {
    padding: 1.15rem 1.35rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.35rem;
  }
  .cz-tools-group-title {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-3);
    margin-bottom: 0.55rem;
  }
  .cz-tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.65rem;
  }
  .cz-tool-card {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    text-align: left;
    transition: transform var(--t), border-color var(--t), background-color var(--t);
  }
  .cz-tool-card:hover {
    transform: translateY(-1px);
    border-color: var(--border-mid);
    background: var(--surface2);
  }
  .cz-tool-icon {
    font-size: 1.35rem;
    line-height: 1;
    margin-top: 0.1rem;
  }
  .cz-tool-meta {
    min-width: 0;
  }
  .cz-tool-name {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .cz-tool-new-badge {
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-size: 0.68rem;
    font-weight: 600;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .cz-tool-desc {
    font-size: 0.8rem;
    color: var(--text-3);
    margin-top: 0.2rem;
    line-height: 1.35;
  }
</style>
