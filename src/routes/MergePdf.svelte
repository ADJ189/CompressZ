<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import { mergeStore, type MergeState } from "../store";
  import { mergePdf } from "../lib/mergePdf";
  import { runScheduled } from "../lib/resourceManager";
  import { formatBytes } from "../lib/types";
  import { toast } from "../toast";
  import { flip } from "svelte/animate";
  import { naturalCompare } from "../lib/recommendations";

  let state = $state<MergeState>(mergeStore.get());
  let isMerging = $state(false);
  let mergedBlob = $state<Blob | null>(null);
  let draggedIndex = $state<number | null>(null);

  $effect(() => {
    const unsub = mergeStore.subscribe((val) => {
      state = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<MergeState>) {
    mergeStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(newFiles: File[]) {
    updateStore({ files: [...state.files, ...newFiles] });
  }

  function handleRemove(index: number) {
    const next = [...state.files];
    next.splice(index, 1);
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
    toast("Sorted documents numerically", "success");
  }

  function reverseOrder() {
    updateStore({ files: [...state.files].reverse() });
    toast("Reversed document order", "success");
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

  async function handleMerge() {
    if (state.files.length < 2) {
      toast("Please add at least 2 PDF files to merge", "error");
      return;
    }

    isMerging = true;
    try {
      const bytes = state.files.reduce((sum, f) => sum + f.size, 0);
      const result = await runScheduled(
        { kind: "pdf", label: `Merge PDF (${state.files.length} files)`, bytes },
        () => mergePdf(state.files),
      );
      // mergePdf() resolves with { blob, pageCount, totalInputSize } — the
      // route used to assign the whole result object to `mergedBlob`, so
      // URL.createObjectURL() threw "Overload resolution failed" and the
      // downloaded merged PDF never existed.
      mergedBlob = result.blob;
      toast(`Merged ${result.pageCount} pages into one PDF`, "success");
    } catch (err) {
      console.error("[mergePdf] error:", err);
      toast(`Merge failed: ${(err as Error).message}`, "error");
    } finally {
      isMerging = false;
    }
  }

  function handleDownload() {
    if (!mergedBlob) return;
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged-document.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handleClear() {
    updateStore({ files: [] });
    mergedBlob = null;
  }
</script>

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">Merge PDF</h1>
    <p class="cz-tool-desc">
      Combine multiple PDF documents into a single file in the exact order you specify. Drag cards or use arrow buttons to preview and reorder files before stitching.
    </p>
  </div>

  <FileDropzone
    accept="application/pdf,.pdf"
    icon="🧷"
    title="Drop PDF documents to merge"
    subtitle="Select two or more PDF files"
    hasFiles={state.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if state.files.length > 0}
    <div class="cz-merge-queue">
      <div class="cz-merge-toolbar">
        <span class="cz-merge-count">{state.files.length} documents in merge sequence</span>
        <div class="cz-merge-actions">
          <button
            type="button"
            class="cz-btn cz-btn-secondary cz-btn-sm"
            onclick={sortNatural}
            title="Sort documents numerically by name"
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
            disabled={isMerging || state.files.length < 2}
            onclick={handleMerge}
          >
            {isMerging ? "Merging..." : "Merge documents"}
          </button>
          {#if mergedBlob}
            <button
              type="button"
              class="cz-btn cz-btn-success cz-btn-sm"
              onclick={handleDownload}
            >
              Download merged PDF
            </button>
          {/if}
          <button
            type="button"
            class="cz-btn cz-btn-ghost cz-btn-sm"
            onclick={handleClear}
            disabled={isMerging}
          >
            Clear
          </button>
        </div>
      </div>

      <div class="cz-merge-grid">
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
            <div class="cz-reorder-doc-cover">
              <span class="cz-doc-icon" aria-hidden="true">📄</span>
              <span class="cz-reorder-badge">#{idx + 1}</span>
            </div>

            <div class="cz-reorder-details">
              <span class="cz-reorder-name fc-name" title={file.name}>{file.name}</span>
              <span class="cz-reorder-size">{formatBytes(file.size)}</span>
            </div>

            <div class="cz-reorder-controls">
              <button
                type="button"
                class="cz-icon-btn"
                disabled={idx === 0 || isMerging}
                onclick={() => moveUp(idx)}
                aria-label="Move earlier"
                title="Move earlier"
              >
                ▲
              </button>
              <button
                type="button"
                class="cz-icon-btn"
                disabled={idx === state.files.length - 1 || isMerging}
                onclick={() => moveDown(idx)}
                aria-label="Move later"
                title="Move later"
              >
                ▼
              </button>
              <button
                type="button"
                class="cz-icon-btn cz-icon-btn--remove"
                disabled={isMerging}
                onclick={() => handleRemove(idx)}
                aria-label="Remove document"
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
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
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
  .cz-reorder-doc-cover {
    position: relative;
    width: 58px;
    height: 58px;
    border-radius: var(--r-sm);
    background: var(--surface2);
    border: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cz-doc-icon {
    font-size: 1.5rem;
  }
  .cz-reorder-badge {
    position: absolute;
    bottom: 2px;
    right: 2px;
    background: var(--accent);
    color: #fff;
    font-size: 0.68rem;
    font-family: var(--mono);
    font-weight: 700;
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
</style>
