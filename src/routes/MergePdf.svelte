<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import { mergeStore, type MergeState } from "../store";
  import { mergePdf } from "../lib/mergePdf";
  import { formatBytes } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<MergeState>(mergeStore.get());
  let isMerging = $state(false);
  let mergedBlob = $state<Blob | null>(null);

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

  async function handleMerge() {
    if (state.files.length < 2) {
      toast("Please add at least 2 PDF files to merge", "error");
      return;
    }

    isMerging = true;
    try {
      const blob = await mergePdf(state.files);
      mergedBlob = blob;
      toast("PDFs successfully merged", "success");
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

<div class="cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">Merge PDF</h1>
    <p class="cz-tool-desc">
      Combine multiple PDF documents into a single file in the exact order you specify. Text remains
      selectable without rasterisation.
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
        <span class="cz-merge-count">{state.files.length} documents in merge order</span>
        <div class="cz-merge-actions">
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
              class="cz-btn cz-btn-secondary cz-btn-sm"
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

      <div class="cz-merge-list">
        {#each state.files as file, idx (file.name + idx)}
          <div class="cz-merge-item">
            <div class="cz-merge-item-info">
              <span class="cz-merge-index">{idx + 1}</span>
              <span class="cz-merge-name" title={file.name}>{file.name}</span>
              <span class="cz-merge-size">{formatBytes(file.size)}</span>
            </div>
            <div class="cz-merge-item-controls">
              <button
                type="button"
                class="cz-btn cz-btn-ghost cz-btn-sm"
                disabled={idx === 0 || isMerging}
                onclick={() => moveUp(idx)}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                class="cz-btn cz-btn-ghost cz-btn-sm"
                disabled={idx === state.files.length - 1 || isMerging}
                onclick={() => moveDown(idx)}
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                class="cz-btn cz-btn-ghost cz-btn-sm"
                disabled={isMerging}
                onclick={() => handleRemove(idx)}
                aria-label="Remove"
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
  .cz-merge-item-controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
</style>
