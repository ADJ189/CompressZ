<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import { navigate } from "../router";
  import { convertVideo } from "../lib/convertMedia";
  import { compressAudio } from "../lib/compressAudio";
  import { compressImage } from "../lib/compressImage";
  import { pdfToImages } from "../lib/convertPdf";
  import { docxToPdf, docxToText, pptxToPdf, pptxToText } from "../lib/convertOffice";
  import { naturalOrder } from "../lib/recommendations";
  import { formatBytes } from "../lib/types";
  import { toast } from "../toast";
  import { getPlatformInfo } from "../lib/platform";

  type Category = "video" | "audio" | "image" | "pdf2img" | "docx" | "pptx";

  let activeCat = $state<Category>("video");
  let selectedFiles = $state<File[]>([]);
  let targetFormat = $state<string>("mp4");
  let isConverting = $state(false);
  let convertedResults = $state<Array<{ name: string; blob: Blob }>>([]);

  const platform = $derived(getPlatformInfo());

  const CATS: Record<
    Category,
    {
      label: string;
      icon: string;
      accept: string;
      targets: { value: string; label: string }[];
    }
  > = {
    video: {
      label: "Video",
      icon: "🎬",
      accept: "video/*",
      targets: [
        { value: "mp4", label: "MP4 (H.264/AAC)" },
        { value: "webm", label: "WebM (VP9/Opus)" },
        { value: "mov", label: "MOV" },
        { value: "mkv", label: "MKV" },
        { value: "gif", label: "GIF" },
      ],
    },
    audio: {
      label: "Audio",
      icon: "🎵",
      accept: "audio/*",
      targets: [
        { value: "mp3", label: "MP3" },
        { value: "aac", label: "AAC (.m4a)" },
        { value: "ogg", label: "OGG Vorbis" },
        { value: "opus", label: "Opus" },
        { value: "flac", label: "FLAC" },
        { value: "wav", label: "WAV" },
      ],
    },
    image: {
      label: "Image",
      icon: "🖼️",
      accept: "image/*,.heic,.heif",
      targets: [
        { value: "webp", label: "WebP" },
        { value: "jpeg", label: "JPEG" },
        { value: "png", label: "PNG" },
        { value: "avif", label: "AVIF" },
      ],
    },
    pdf2img: {
      label: "PDF to Images",
      icon: "📄",
      accept: "application/pdf,.pdf",
      targets: [
        { value: "png", label: "PNG images" },
        { value: "jpeg", label: "JPEG images" },
        { value: "webp", label: "WebP images" },
      ],
    },
    docx: {
      label: "DOCX",
      icon: "📝",
      accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      targets: [
        { value: "pdf", label: "PDF Document" },
        { value: "txt", label: "Plain Text" },
      ],
    },
    pptx: {
      label: "PPTX",
      icon: "📊",
      accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
      targets: [
        { value: "pdf", label: "PDF Document" },
        { value: "txt", label: "Plain Text" },
      ],
    },
  };

  function handleCatChange(cat: Category) {
    activeCat = cat;
    selectedFiles = [];
    convertedResults = [];
    targetFormat = CATS[cat].targets[0].value;
  }

  function handleFilesAdded(files: File[]) {
    selectedFiles = [...selectedFiles, ...files];
  }

  function handleReorder() {
    if (selectedFiles.length < 2) return;
    const names = selectedFiles.map((f) => f.name);
    const indices = naturalOrder(names);
    const prev = [...selectedFiles];
    selectedFiles = indices.map((i) => prev[i]);
    toast("Reordered files numerically", "success");
  }

  async function handleConvertAll() {
    if (!selectedFiles.length) return;
    isConverting = true;
    convertedResults = [];

    for (const file of selectedFiles) {
      try {
        let blob: Blob | null = null;
        let outName = file.name.replace(/\.[^/.]+$/, "") + `.${targetFormat}`;

        if (activeCat === "video") {
          const res = await convertVideo(file, targetFormat as any);
          blob = res.blob;
        } else if (activeCat === "audio") {
          const res = await compressAudio(file, { format: targetFormat as any });
          blob = res.blob;
        } else if (activeCat === "image") {
          const mime = targetFormat === "jpeg" ? "image/jpeg" : targetFormat === "png" ? "image/png" : targetFormat === "avif" ? "image/avif" : "image/webp";
          const res = await compressImage(file, { format: mime as any });
          blob = res.blob;
        } else if (activeCat === "pdf2img") {
          const res = await pdfToImages(file, { format: targetFormat as any });
          blob = res.zipBlob;
          outName = file.name.replace(/\.[^/.]+$/, "") + "-images.zip";
        } else if (activeCat === "docx") {
          if (targetFormat === "pdf") blob = await docxToPdf(file);
          else blob = new Blob([await docxToText(file)], { type: "text/plain" });
        } else if (activeCat === "pptx") {
          if (targetFormat === "pdf") blob = await pptxToPdf(file);
          else blob = new Blob([await pptxToText(file)], { type: "text/plain" });
        }

        if (blob) {
          convertedResults = [...convertedResults, { name: outName, blob }];
        }
      } catch (err) {
        console.error("[convert] error:", err);
        toast(`Failed to convert ${file.name}: ${(err as Error).message}`, "error");
      }
    }

    isConverting = false;
    if (convertedResults.length > 0) {
      toast("Conversion completed", "success");
    }
  }

  function downloadItem(item: { name: string; blob: Blob }) {
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handleClear() {
    selectedFiles = [];
    convertedResults = [];
  }
</script>

<div class="tool-wrap cz-apple-workbench">
  <!-- Left Main Column: Converter Workspace -->
  <main class="cz-card-main">
    <div class="cz-main-header">
      <div>
        <h1 class="cz-main-title">Multi-Format Converter</h1>
        <p class="cz-main-sub">Convert video, audio, office files, and images</p>
      </div>

      <!-- Quick Fast Organize Reorder Action -->
      {#if selectedFiles.length > 1}
        <button
          type="button"
          class="cz-segmented-item"
          onclick={handleReorder}
        >
          🔀 Reorder Files
        </button>
      {/if}
    </div>

    <!-- Category Selector (Apple Segmented Bar) -->
    <div class="cz-segmented-track cz-cat-segmented">
      {#each Object.entries(CATS) as [catKey, meta]}
        <button
          type="button"
          class="cz-segmented-item {activeCat === catKey ? 'is-active' : ''}"
          onclick={() => handleCatChange(catKey as Category)}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
        </button>
      {/each}
    </div>

    <!-- Compact Options Bar -->
    <div class="cz-options-pill-bar">
      <div class="cz-opt-group">
        <span class="cz-opt-label">Target Format</span>
        <div class="cz-segmented-track">
          {#each CATS[activeCat].targets as t}
            <button
              type="button"
              class="cz-segmented-item {targetFormat === t.value ? 'is-active' : ''}"
              onclick={() => (targetFormat = t.value)}
            >
              {t.label}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- Ingestion Dropzone -->
    <FileDropzone
      accept={CATS[activeCat].accept}
      icon={CATS[activeCat].icon}
      title="Click or drag {CATS[activeCat].label} files here"
      subtitle="Convert directly inside browser memory"
      hasFiles={selectedFiles.length > 0}
      onFiles={handleFilesAdded}
    />

    <!-- Conversion Queue -->
    {#if selectedFiles.length > 0}
      <div class="cz-queue">
        <div class="cz-queue-toolbar">
          <span class="cz-queue-count">{selectedFiles.length} files selected</span>
          <div class="cz-queue-actions">
            <button
              type="button"
              class="cz-btn cz-btn-primary cz-btn-sm cz-btn-pill"
              disabled={isConverting}
              onclick={handleConvertAll}
            >
              {isConverting ? "Converting…" : "Convert All"}
            </button>
            <button
              type="button"
              class="cz-btn cz-btn-ghost cz-btn-sm"
              disabled={isConverting}
              onclick={handleClear}
            >
              Clear
            </button>
          </div>
        </div>

        <div class="cz-inset-table">
          {#each selectedFiles as file, idx}
            {@const res = convertedResults.find((r) => r.name.startsWith(file.name.replace(/\.[^/.]+$/, "")))}
            <div class="cz-inset-row">
              <div class="cz-inset-row-left">
                <div class="cz-file-badge">{activeCat.toUpperCase().slice(0, 4)}</div>
                <div class="cz-card-meta">
                  <span class="cz-inset-row-name" title={file.name}>{file.name}</span>
                  <span class="cz-inset-row-meta">{formatBytes(file.size)}</span>
                </div>
              </div>

              <div class="cz-inset-row-right">
                {#if isConverting}
                  <div class="cz-status-pill is-busy">Converting...</div>
                {:else if res}
                  <div class="cz-status-pill is-done">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>{formatBytes(res.blob.size)}</span>
                  </div>
                  <button
                    type="button"
                    class="cz-icon-btn-download"
                    title="Download converted file"
                    onclick={() => downloadItem(res)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if convertedResults.length > 0}
          <div class="cz-summary-bar">
            <span>{convertedResults.length} of {selectedFiles.length} converted</span>
            <button
              type="button"
              class="cz-btn-download-all"
              onclick={() => {
                for (const r of convertedResults) downloadItem(r);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Download All</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </main>

  <!-- Right Sidebar: Shortcuts & History -->
  <aside class="cz-card-side">
    <!-- Quick PDF to Markdown shortcut -->
    <div class="cz-sidebar-card">
      <div class="cz-sidebar-header">
        <span class="cz-sidebar-title">PDF to Markdown</span>
      </div>
      <p class="cz-sidebar-meta">
        Extract column-aware text, tables, formulas, and visual figures into a clean Markdown ZIP bundle.
      </p>
      <button
        type="button"
        class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
        onclick={() => navigate("convert/pdf-markdown")}
      >
        Open PDF to Markdown →
      </button>
    </div>

    <!-- Engine Diagnostics -->
    <div class="cz-sidebar-card">
      <div class="cz-sidebar-header">
        <span class="cz-sidebar-title">Active Engines</span>
        <span class="cz-tier-tag">{platform?.tier ?? "balanced"}</span>
      </div>
      <div class="cz-sidebar-meta flex-col gap-1">
        <div>Video: {platform?.webCodecs ? "WebCodecs + Mediabunny" : "FFmpeg.wasm"}</div>
        <div>Images: {platform?.webgl2 ? "WebGL2 + Canvas2D" : "Canvas2D"}</div>
      </div>
    </div>
  </aside>
</div>

<style>
  .cz-main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .cz-main-title {
    font-family: var(--display);
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-main-sub {
    font-size: 0.8rem;
    color: var(--text-3);
  }
  .cz-cat-segmented {
    flex-wrap: wrap;
    align-self: flex-start;
  }
  .cz-options-pill-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface2);
  }
  .cz-opt-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    flex-wrap: wrap;
  }
  .cz-opt-label {
    font-weight: 500;
    color: var(--text-3);
  }
  .cz-queue {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .cz-queue-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
  }
  .cz-queue-count {
    font-weight: 600;
    color: var(--text);
  }
  .cz-queue-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-btn-pill {
    border-radius: 9999px;
  }
  .cz-icon-btn-download {
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--accent);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--t), border-color var(--t), transform var(--t);
  }
  .cz-icon-btn-download:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
    transform: scale(1.05);
  }
  .cz-sidebar-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .cz-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cz-sidebar-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-tier-tag {
    font-size: 0.68rem;
    text-transform: uppercase;
    font-weight: 700;
    font-family: var(--mono);
    padding: 0.1rem 0.4rem;
    border-radius: 9999px;
    background: var(--green-soft);
    color: var(--accent);
  }
  .cz-sidebar-meta {
    font-size: 0.76rem;
    color: var(--text-3);
    line-height: 1.4;
  }
</style>
