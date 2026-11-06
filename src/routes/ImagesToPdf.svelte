<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import { imagesToPdfStore, type ImagesToPdfState } from "../store";
  import { imagesToPdf } from "../lib/imagesToPdf";
  import { formatBytes } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<ImagesToPdfState>(imagesToPdfStore.get());
  let isConverting = $state(false);
  let convertedBlob = $state<Blob | null>(null);

  $effect(() => {
    const unsub = imagesToPdfStore.subscribe((val) => {
      state = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<ImagesToPdfState>) {
    imagesToPdfStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(newFiles: File[]) {
    updateStore({ files: [...state.files, ...newFiles] });
  }

  function handleRemove(index: number) {
    const next = [...state.files];
    next.splice(index, 1);
    updateStore({ files: next });
  }

  async function handleConvert() {
    if (state.files.length === 0) {
      toast("Please add images to convert", "error");
      return;
    }

    isConverting = true;
    try {
      const blob = await imagesToPdf(state.files, {
        pageSize: state.pageSize,
        quality: state.quality,
        maxDim: state.maxDim > 0 ? state.maxDim : undefined,
      });
      convertedBlob = blob;
      toast("Images successfully converted to PDF", "success");
    } catch (err) {
      console.error("[imagesToPdf] error:", err);
      toast(`Conversion failed: ${(err as Error).message}`, "error");
    } finally {
      isConverting = false;
    }
  }

  function handleDownload() {
    if (!convertedBlob) return;
    const url = URL.createObjectURL(convertedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "compiled-document.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handleClear() {
    updateStore({ files: [] });
    convertedBlob = null;
  }
</script>

<div class="cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">Images to PDF</h1>
    <p class="cz-tool-desc">
      Convert photo sequences into a single clean PDF document with configurable page layout.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="page-size">Page Size</label>
      <select
        id="page-size"
        class="cz-select"
        value={state.pageSize}
        onchange={(e) => updateStore({ pageSize: (e.target as HTMLSelectElement).value as any })}
      >
        <option value="auto">Auto (Match image dimensions)</option>
        <option value="a4">A4 Portrait</option>
        <option value="letter">US Letter</option>
      </select>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="img-pdf-q">Quality ({state.quality}%)</label>
      <input
        id="img-pdf-q"
        type="range"
        min="10"
        max="100"
        value={state.quality}
        class="cz-range"
        oninput={(e) => updateStore({ quality: Number((e.target as HTMLInputElement).value) })}
      />
    </div>
  </div>

  <FileDropzone
    accept="image/*"
    icon="🧩"
    title="Drop images to compile into PDF"
    subtitle="JPEG, PNG, WebP, AVIF photos"
    hasFiles={state.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if state.files.length > 0}
    <div class="cz-merge-queue">
      <div class="cz-merge-toolbar">
        <span class="cz-merge-count">{state.files.length} images queued</span>
        <div class="cz-merge-actions">
          <button
            type="button"
            class="cz-btn cz-btn-primary cz-btn-sm"
            disabled={isConverting}
            onclick={handleConvert}
          >
            {isConverting ? "Creating PDF..." : "Create PDF"}
          </button>
          {#if convertedBlob}
            <button
              type="button"
              class="cz-btn cz-btn-secondary cz-btn-sm"
              onclick={handleDownload}
            >
              Download PDF
            </button>
          {/if}
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

      <div class="cz-merge-list">
        {#each state.files as file, idx (file.name + idx)}
          <div class="cz-merge-item">
            <div class="cz-merge-item-info">
              <span class="cz-merge-index">{idx + 1}</span>
              <span class="cz-merge-name" title={file.name}>{file.name}</span>
              <span class="cz-merge-size">{formatBytes(file.size)}</span>
            </div>
            <button
              type="button"
              class="cz-btn cz-btn-ghost cz-btn-sm"
              disabled={isConverting}
              onclick={() => handleRemove(idx)}
              aria-label="Remove"
            >
              ✕
            </button>
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
  .cz-tool-settings-bar {
    display: flex;
    flex-wrap: wrap;
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
  .cz-range {
    width: 110px;
  }
  .cz-merge-queue {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cz-merge-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .cz-merge-count {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-merge-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-merge-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .cz-merge-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    gap: 1rem;
  }
  .cz-merge-item-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }
  .cz-merge-index {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg2);
    font-size: 0.76rem;
    font-weight: 600;
    font-family: var(--mono);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    flex-shrink: 0;
  }
  .cz-merge-name {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cz-merge-size {
    font-size: 0.8rem;
    font-family: var(--mono);
    color: var(--text-3);
    flex-shrink: 0;
  }
</style>
