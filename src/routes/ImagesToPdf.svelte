<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import { imagesToPdfStore, type ImagesToPdfState } from "../store";
  import { imagesToPdf } from "../lib/imagesToPdf";
  import { formatBytes } from "../lib/types";
  import { toast } from "../toast";
  import { flip } from "svelte/animate";
  import { onDestroy } from "svelte";
  import {
    recommendFor,
    dismissRecommendation,
    naturalCompare,
    type Recommendation,
  } from "../lib/recommendations";

  let state = $state<ImagesToPdfState>(imagesToPdfStore.get());
  let isConverting = $state(false);
  let convertedBlob = $state<Blob | null>(null);
  let dismissTrigger = $state(0);
  let draggedIndex = $state<number | null>(null);

  // Thumbnail cache for files
  const thumbnailUrls = new Map<File, string>();

  function getThumbnail(file: File): string {
    let url = thumbnailUrls.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      thumbnailUrls.set(file, url);
    }
    return url;
  }

  onDestroy(() => {
    for (const url of thumbnailUrls.values()) {
      URL.revokeObjectURL(url);
    }
    thumbnailUrls.clear();
  });

  $effect(() => {
    const unsub = imagesToPdfStore.subscribe((val) => {
      state = val;
    });
    return unsub;
  });

  const recommendations = $derived.by(() => {
    void dismissTrigger;
    return recommendFor({
      scope: "images-to-pdf",
      files: state.files.map((f) => ({ name: f.name, size: f.size })),
      pageSize: state.pageSize,
    });
  });

  const activeRec = $derived(recommendations.length > 0 ? recommendations[0] : null);

  function applyRecommendation(rec: Recommendation) {
    if (rec.action.type === "reorder") {
      const prevFiles = [...state.files];
      const sorted = rec.action.order.map((i) => prevFiles[i]);
      updateStore({ files: sorted });
      toast("Sorted files by filename", "success", {
        label: "Undo",
        onClick: () => {
          updateStore({ files: prevFiles });
          dismissTrigger++;
        },
      });
    } else if (rec.action.type === "page-size") {
      const prevSize = state.pageSize;
      updateStore({ pageSize: rec.action.pageSize });
      toast("Applied Auto page size", "success", {
        label: "Undo",
        onClick: () => {
          updateStore({ pageSize: prevSize });
          dismissTrigger++;
        },
      });
    }
  }

  function dismiss(rec: Recommendation) {
    dismissRecommendation(rec);
    dismissTrigger++;
  }

  function updateStore(patch: Partial<ImagesToPdfState>) {
    imagesToPdfStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(newFiles: File[]) {
    updateStore({ files: [...state.files, ...newFiles] });
  }

  function handleRemove(index: number) {
    const next = [...state.files];
    const removed = next.splice(index, 1)[0];
    if (removed && thumbnailUrls.has(removed)) {
      URL.revokeObjectURL(thumbnailUrls.get(removed)!);
      thumbnailUrls.delete(removed);
    }
    updateStore({ files: next });
  }

  function moveUp(index: number) {
    if (index <= 0) return;
    const next = [...state.files];
    const temp = next[index];
    next[index] = next[index - 1];
    next[index - 1] = temp;
    updateStore({ files: next });
  }

  function moveDown(index: number) {
    if (index >= state.files.length - 1) return;
    const next = [...state.files];
    const temp = next[index];
    next[index] = next[index + 1];
    next[index + 1] = temp;
    updateStore({ files: next });
  }

  function sortNatural() {
    const sorted = [...state.files].sort((a, b) => naturalCompare(a.name, b.name));
    updateStore({ files: sorted });
    toast("Sorted images numerically", "success");
  }

  function reverseOrder() {
    updateStore({ files: [...state.files].reverse() });
    toast("Reversed image order", "success");
  }

  function handleDragStart(index: number, e: DragEvent) {
    draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(targetIndex: number, e: DragEvent) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    const next = [...state.files];
    const [moved] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, moved);
    draggedIndex = null;
    updateStore({ files: next });
  }

  function handleDragEnd() {
    draggedIndex = null;
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
    for (const url of thumbnailUrls.values()) {
      URL.revokeObjectURL(url);
    }
    thumbnailUrls.clear();
    updateStore({ files: [] });
    convertedBlob = null;
  }
</script>

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">Images to PDF</h1>
    <p class="cz-tool-desc">
      Convert photo sequences into a single clean PDF document with configurable page layout. Drag cards or use arrow buttons to preview and reorder pages.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div id="itp-sizes" class="cz-setting-item">
      <span class="cz-setting-label">Page Size</span>
      <div class="cz-btn-group" role="radiogroup" aria-label="Page size selection">
        <button
          type="button"
          role="radio"
          class="cz-btn cz-btn-sm pdf-preset {state.pageSize === 'auto' ? 'is-active' : ''}"
          aria-checked={state.pageSize === 'auto' ? 'true' : 'false'}
          onclick={() => updateStore({ pageSize: 'auto' })}
        >
          Auto
        </button>
        <button
          type="button"
          role="radio"
          class="cz-btn cz-btn-sm pdf-preset {state.pageSize === 'a4' ? 'is-active' : ''}"
          aria-checked={state.pageSize === 'a4' ? 'true' : 'false'}
          onclick={() => updateStore({ pageSize: 'a4' })}
        >
          A4
        </button>
        <button
          type="button"
          role="radio"
          class="cz-btn cz-btn-sm pdf-preset {state.pageSize === 'letter' ? 'is-active' : ''}"
          aria-checked={state.pageSize === 'letter' ? 'true' : 'false'}
          onclick={() => updateStore({ pageSize: 'letter' })}
        >
          Letter
        </button>
      </div>
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

  <div id="itp-rec">
    {#if activeRec}
      <div class="cz-recommendation cz-recommendation--primary">
        <div class="cz-recommendation__row">
          <div class="cz-recommendation__body">
            <div class="cz-recommendation__title">{activeRec.title}</div>
            <div class="cz-recommendation__reason">{activeRec.reason}</div>
          </div>
          <div class="cz-recommendation__actions">
            <button
              type="button"
              class="cz-btn cz-btn-primary cz-btn-sm"
              onclick={() => applyRecommendation(activeRec)}
            >
              {activeRec.actionLabel}
            </button>
            <button
              type="button"
              class="cz-btn cz-btn-ghost cz-btn-sm"
              onclick={() => dismiss(activeRec)}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    {/if}
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
        <div class="cz-merge-count-wrap">
          <span class="cz-merge-count">{state.files.length} images queued for PDF pages</span>
        </div>
        <div class="cz-merge-actions">
          <button
            type="button"
            class="cz-btn cz-btn-secondary cz-btn-sm"
            onclick={sortNatural}
            title="Sort images numerically by filename"
          >
            Sort 1-9
          </button>
          <button
            type="button"
            class="cz-btn cz-btn-secondary cz-btn-sm"
            onclick={reverseOrder}
            title="Reverse sequence order"
          >
            Reverse
          </button>
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
              class="cz-btn cz-btn-success cz-btn-sm"
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

      <div id="itp-list" class="cz-merge-grid">
        {#each state.files as file, idx (file)}
          <div
            class="cz-reorder-card file-card {draggedIndex === idx ? 'is-dragging' : ''}"
            draggable="true"
            ondragstart={(e) => handleDragStart(idx, e)}
            ondragover={handleDragOver}
            ondrop={(e) => handleDrop(idx, e)}
            ondragend={handleDragEnd}
            animate:flip={{ duration: 250 }}
            role="listitem"
          >
            <div class="cz-reorder-thumb-wrap">
              <img
                src={getThumbnail(file)}
                alt={file.name}
                class="cz-reorder-thumb"
                loading="lazy"
              />
              <span class="cz-reorder-badge">p.{idx + 1}</span>
            </div>

            <div class="cz-reorder-details">
              <span class="cz-reorder-name fc-name" title={file.name}>{file.name}</span>
              <span class="cz-reorder-size">{formatBytes(file.size)}</span>
            </div>

            <div class="cz-reorder-controls">
              <button
                type="button"
                class="cz-icon-btn"
                disabled={idx === 0 || isConverting}
                onclick={() => moveUp(idx)}
                aria-label="Move earlier"
                title="Move earlier"
              >
                ▲
              </button>
              <button
                type="button"
                class="cz-icon-btn"
                disabled={idx === state.files.length - 1 || isConverting}
                onclick={() => moveDown(idx)}
                aria-label="Move later"
                title="Move later"
              >
                ▼
              </button>
              <button
                type="button"
                class="cz-icon-btn cz-icon-btn--remove"
                disabled={isConverting}
                onclick={() => handleRemove(idx)}
                aria-label="Remove image"
                title="Remove"
              >
                ✕
              </button>
            </div>
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
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-btn-group {
    display: inline-flex;
    background: var(--bg2);
    padding: 2px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    gap: 2px;
  }
  .cz-btn-group .cz-btn {
    padding: 0.3rem 0.75rem;
    font-size: 0.8rem;
    border-radius: calc(var(--r-sm) - 2px);
    background: transparent;
    color: var(--text-3);
  }
  .cz-btn-group .cz-btn.is-active {
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
  .cz-range {
    accent-color: var(--accent);
  }
  .cz-merge-queue {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cz-merge-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .cz-merge-count {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-merge-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .cz-merge-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.85rem;
  }
  .cz-reorder-card {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 0.65rem 0.85rem;
    transition: transform var(--t), box-shadow var(--t), border-color var(--t);
    cursor: grab;
    user-select: none;
  }
  .cz-reorder-card:active {
    cursor: grabbing;
  }
  .cz-reorder-card:hover {
    border-color: var(--border-mid);
    box-shadow: var(--shadow-sm);
  }
  .cz-reorder-card.is-dragging {
    opacity: 0.45;
    transform: scale(0.98);
  }
  .cz-reorder-thumb-wrap {
    position: relative;
    width: 62px;
    height: 62px;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg2);
    border: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cz-reorder-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cz-reorder-badge {
    position: absolute;
    bottom: 2px;
    right: 2px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-size: 0.68rem;
    font-family: var(--mono);
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 4px;
  }
  .cz-reorder-details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .cz-reorder-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cz-reorder-size {
    font-size: 0.78rem;
    font-family: var(--mono);
    color: var(--text-3);
  }
  .cz-reorder-controls {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .cz-icon-btn {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-xs);
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: 0.72rem;
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-icon-btn:hover:not(:disabled) {
    background: var(--bg3);
    color: var(--text);
  }
  .cz-icon-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .cz-icon-btn--remove:hover:not(:disabled) {
    background: rgba(244, 63, 94, 0.15);
    color: var(--rose);
    border-color: rgba(244, 63, 94, 0.3);
  }
  .cz-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-btn-primary {
    background: var(--accent);
    color: #fff;
    border: 1px solid transparent;
  }
  .cz-btn-primary:hover:not(:disabled) {
    background: var(--accent-2);
  }
  .cz-btn-secondary {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
  }
  .cz-btn-secondary:hover {
    background: var(--bg2);
  }
  .cz-btn-success {
    background: var(--green);
    color: #fff;
    border: 1px solid transparent;
  }
  .cz-btn-ghost {
    background: transparent;
    color: var(--text-3);
    border: 1px solid var(--border);
  }
  .cz-btn-ghost:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface2);
  }
  .cz-recommendation {
    border-radius: var(--r);
    padding: 0.85rem 1.15rem;
    background: var(--accent-soft);
    border: 1px solid var(--accent-glow);
    margin-bottom: 0.75rem;
  }
  .cz-recommendation__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .cz-recommendation__title {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--accent);
  }
  .cz-recommendation__reason {
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .cz-recommendation__actions {
    display: flex;
    gap: 0.5rem;
  }
</style>
