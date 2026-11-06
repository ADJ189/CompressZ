<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import { navigate } from "../router";
  import { convertVideo } from "../lib/convertMedia";
  import { compressAudio } from "../lib/compressAudio";
  import { compressImage } from "../lib/compressImage";
  import { pdfToImages } from "../lib/convertPdf";
  import { docxToPdf, docxToText, pptxToPdf, pptxToText } from "../lib/convertOffice";
  import { formatBytes } from "../lib/types";
  import { toast } from "../toast";

  type Category = "video" | "audio" | "image" | "pdf2img" | "docx" | "pptx";

  let activeCat = $state<Category>("video");
  let selectedFiles = $state<File[]>([]);
  let targetFormat = $state<string>("mp4");
  let isConverting = $state(false);
  let convertedResults = $state<Array<{ name: string; blob: Blob }>>([]);

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

<div class="cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">Format Converter</h1>
    <p class="cz-tool-desc">
      Convert video, audio, office documents, and images on-device without remote servers.
    </p>
  </div>

  <div class="cz-pdf-markdown-banner">
    <div class="cz-banner-text">
      <strong>Looking for PDF to Markdown?</strong> Extract text, tables, formulas, and visual figures into clean Markdown.
    </div>
    <button
      type="button"
      class="cz-btn cz-btn-primary cz-btn-sm"
      onclick={() => navigate("convert/pdf-markdown")}
    >
      Open PDF to Markdown
    </button>
  </div>

  <div class="cz-cat-tabs">
    {#each Object.entries(CATS) as [catKey, meta]}
      <button
        type="button"
        class="cz-cat-btn {activeCat === catKey ? 'is-active' : ''}"
        onclick={() => handleCatChange(catKey as Category)}
      >
        <span aria-hidden="true">{meta.icon}</span>
        <span>{meta.label}</span>
      </button>
    {/each}
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="target-fmt">Convert to</label>
      <select id="target-fmt" class="cz-select" bind:value={targetFormat}>
        {#each CATS[activeCat].targets as t}
          <option value={t.value}>{t.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <FileDropzone
    accept={CATS[activeCat].accept}
    icon={CATS[activeCat].icon}
    title="Drop {CATS[activeCat].label} files here"
    subtitle="Convert directly in your browser"
    hasFiles={selectedFiles.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if selectedFiles.length > 0}
    <div class="cz-convert-queue">
      <div class="cz-convert-toolbar">
        <span class="cz-convert-count">{selectedFiles.length} files selected</span>
        <div class="cz-convert-actions">
          <button
            type="button"
            class="cz-btn cz-btn-primary cz-btn-sm"
            disabled={isConverting}
            onclick={handleConvertAll}
          >
            {isConverting ? "Converting..." : "Convert all"}
          </button>
          <button
            type="button"
            class="cz-btn cz-btn-ghost cz-btn-sm"
            onclick={handleClear}
            disabled={isConverting}
          >
            Clear
          </button>
        </div>
      </div>

      <div class="cz-convert-list">
        {#each selectedFiles as file, idx}
          {@const res = convertedResults[idx]}
          <div class="cz-convert-item">
            <div class="cz-convert-item-meta">
              <span class="cz-convert-name">{file.name}</span>
              <span class="cz-convert-size">{formatBytes(file.size)}</span>
            </div>
            {#if res}
              <button
                type="button"
                class="cz-btn cz-btn-secondary cz-btn-sm"
                onclick={() => downloadItem(res)}
              >
                Download {res.name}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .cz-tool-view {
    max-width: 1060px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .cz-tool-header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .cz-tool-title {
    font-family: var(--display);
    font-size: 1.85rem;
    font-weight: 800;
    color: var(--text);
  }
  .cz-tool-desc {
    font-size: 0.95rem;
    color: var(--text-3);
    max-width: 65ch;
  }
  .cz-pdf-markdown-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.15rem;
    border-radius: var(--r);
    background: var(--accent-soft);
    border: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 0.85rem;
  }
  .cz-banner-text {
    font-size: 0.88rem;
    color: var(--text);
  }
  .cz-cat-tabs {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 0.25rem;
  }
  .cz-cat-btn {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.85rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-size: 0.86rem;
    font-weight: 500;
    transition: background var(--t), border-color var(--t), color var(--t);
  }
  .cz-cat-btn:hover {
    background: var(--surface2);
    color: var(--text);
  }
  .cz-cat-btn.is-active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    font-weight: 600;
  }
  .cz-tool-settings-bar {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface);
  }
  .cz-setting-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .cz-setting-label {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-convert-queue {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cz-convert-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .cz-convert-count {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-convert-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-convert-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cz-convert-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
  }
  .cz-convert-item-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cz-convert-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
  }
  .cz-convert-size {
    font-size: 0.8rem;
    font-family: var(--mono);
    color: var(--text-3);
  }
</style>
