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
  <!-- Top Quick Actions / Reorder Bar -->
  <div class="cz-queue-toolbar">
    <div class="cz-queue-summary">
      <span class="cz-queue-count">{files.length} {files.length === 1 ? "file" : "files"}</span>
      <span class="cz-queue-size">({formatBytes(totalOriginalBytes)})</span>
      {#if doneCount > 0}
        <span class="cz-queue-done">{doneCount} ready</span>
      {/if}
    </div>

    <div class="cz-queue-actions">
      {#if pendingCount > 0}
        <button
          type="button"
          class="cz-btn cz-btn-primary cz-btn-sm cz-btn-pill"
          disabled={isBusy}
          onclick={onCompressAll}
        >
          Compress all
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

  <!-- Inset File List -->
  <div id="file-list" class="cz-inset-table">
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

  <!-- Bottom Summary & Download Bar (Matching Image 2) -->
  {#if files.length > 0}
    <div class="cz-summary-bar">
      <span>Total {files.length} {files.length === 1 ? "file" : "files"}</span>

      {#if doneCount > 0}
        <button
          type="button"
          class="cz-btn-download-all"
          onclick={onDownloadAll}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Download All</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cz-queue {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }
  .cz-queue-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
  }
  .cz-queue-summary {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 500;
  }
  .cz-queue-count {
    color: var(--text);
  }
  .cz-queue-size {
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 0.78rem;
  }
  .cz-queue-done {
    padding: 0.1rem 0.4rem;
    border-radius: 9999px;
    background: var(--green-soft);
    color: var(--accent);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .cz-queue-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-btn-pill {
    border-radius: 9999px;
    padding: 0.35rem 0.9rem;
  }
</style>
