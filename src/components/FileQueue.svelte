<script lang="ts">
  import type { FileEntry } from "../lib/types";
  import { formatBytes } from "../lib/types";
  import FileCard from "./FileCard.svelte";

  interface Props {
    files: FileEntry[];
    isBusy?: boolean;
    onCompressAll: () => void;
    onDownloadAll: () => void;
    onClear: () => void;
    onCompressSingle: (entry: FileEntry) => void;
    onDownloadSingle: (entry: FileEntry) => void;
    onRemoveSingle: (id: string) => void;
    onEditSingle?: (entry: FileEntry) => void;
  }

  let {
    files,
    isBusy = false,
    onCompressAll,
    onDownloadAll,
    onClear,
    onCompressSingle,
    onDownloadSingle,
    onRemoveSingle,
    onEditSingle,
  }: Props = $props();

  const totalOriginalBytes = $derived(
    files.reduce((acc, f) => acc + f.originalSize, 0),
  );

  const doneCount = $derived(files.filter((f) => f.status === "done").length);
  const pendingCount = $derived(files.filter((f) => f.status === "idle").length);
</script>

<div class="cz-queue">
  <div class="cz-queue-toolbar">
    <div class="cz-queue-summary">
      <span class="cz-queue-count">{files.length} {files.length === 1 ? "file" : "files"}</span>
      <span class="cz-queue-size">({formatBytes(totalOriginalBytes)})</span>
      {#if doneCount > 0}
        <span class="cz-queue-done">{doneCount} completed</span>
      {/if}
    </div>

    <div class="cz-queue-actions">
      {#if pendingCount > 0}
        <button
          type="button"
          class="cz-btn cz-btn-primary cz-btn-sm"
          disabled={isBusy}
          onclick={onCompressAll}
        >
          Compress all
        </button>
      {/if}

      {#if doneCount > 0}
        <button
          type="button"
          class="cz-btn cz-btn-secondary cz-btn-sm"
          onclick={onDownloadAll}
        >
          Download all
        </button>
      {/if}

      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        disabled={isBusy}
        onclick={onClear}
      >
        Clear
      </button>
    </div>
  </div>

  <div class="cz-queue-list">
    {#each files as entry (entry.id)}
      <FileCard
        {entry}
        onCompress={onCompressSingle}
        onDownload={onDownloadSingle}
        onRemove={onRemoveSingle}
        onEdit={onEditSingle}
      />
    {/each}
  </div>
</div>

<style>
  .cz-queue {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cz-queue-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .cz-queue-summary {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 0.92rem;
  }
  .cz-queue-count {
    font-weight: 600;
    color: var(--text);
  }
  .cz-queue-size {
    font-family: var(--mono);
    color: var(--text-3);
    font-size: 0.82rem;
  }
  .cz-queue-done {
    margin-left: 0.4rem;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    background: var(--green-soft);
    color: var(--green);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .cz-queue-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-queue-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>
