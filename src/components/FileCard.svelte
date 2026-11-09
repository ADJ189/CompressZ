<script lang="ts">
  import type { FileEntry } from "../lib/types";
  import { formatBytes } from "../lib/types";

  interface Props {
    entry: FileEntry;
    onCompress: (entry: FileEntry) => void;
    onDownload: (entry: FileEntry) => void;
    onRemove: (id: string) => void;
    onEdit?: (entry: FileEntry) => void;
  }

  let { entry, onCompress, onDownload, onRemove, onEdit }: Props = $props();

  const fileExt = $derived.by(() => {
    const parts = entry.name.split(".");
    return parts.length > 1 ? parts.pop()!.toUpperCase().slice(0, 4) : "FILE";
  });

  const savingsPercent = $derived.by(() => {
    if (entry.status !== "done" || !entry.compressedSize || !entry.originalSize) {
      return null;
    }
    const diff = entry.originalSize - entry.compressedSize;
    if (diff <= 0) return 0;
    return Math.round((diff / entry.originalSize) * 100);
  });
</script>

<div
  class="cz-inset-row file-card {entry.status === 'done' ? 'is-done' : ''} {entry.status === 'error' ? 'is-error' : ''} {entry.status === 'compressing' ? 'is-compressing' : ''}"
  id="card-{entry.id}"
>
  <div class="cz-inset-row-left">
    {#if entry.thumbUrl}
      <img src={entry.thumbUrl} alt="" class="cz-card-thumb" />
    {:else}
      <div class="cz-file-badge">
        {fileExt}
      </div>
    {/if}

    <div class="cz-card-meta">
      <span class="cz-inset-row-name fc-name" title={entry.name}>{entry.name}</span>
      <div class="cz-inset-row-meta">
        <span>{formatBytes(entry.originalSize)}</span>
        {#if entry.status === "done" && entry.compressedSize}
          <span class="cz-card-arrow" aria-hidden="true">→</span>
          <span class="cz-comp-bold font-semibold text-emerald-600">{formatBytes(entry.compressedSize)}</span>
          {#if savingsPercent !== null && savingsPercent > 0}
            <span class="cz-card-badge">-{savingsPercent}%</span>
          {/if}
        {/if}
      </div>

      {#if entry.status === "error" && entry.error}
        <div class="cz-card-error-msg">{entry.error}</div>
      {/if}
    </div>
  </div>

  <div class="cz-inset-row-right">
    {#if entry.status === "idle"}
      {#if onEdit}
        <button
          type="button"
          class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
          onclick={() => onEdit(entry)}
        >
          Options
        </button>
      {/if}
      <button
        type="button"
        class="cz-btn cz-btn-primary cz-btn-sm cz-btn-pill"
        onclick={() => onCompress(entry)}
      >
        Compress
      </button>
      <button
        type="button"
        class="cz-icon-btn"
        aria-label="Remove file"
        title="Remove"
        onclick={() => onRemove(entry.id)}
      >
        ✕
      </button>
    {:else if entry.status === "compressing"}
      <div class="cz-status-pill is-busy">
        <span class="cz-spin-dot" aria-hidden="true"></span>
        <span>Converting...</span>
      </div>
    {:else if entry.status === "done"}
      <div class="cz-status-pill is-done">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Converted</span>
      </div>
      <button
        type="button"
        class="cz-icon-btn-download"
        title="Download converted file"
        aria-label="Download"
        onclick={() => onDownload(entry)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
      <button
        type="button"
        class="cz-icon-btn"
        aria-label="Remove file"
        title="Remove"
        onclick={() => onRemove(entry.id)}
      >
        ✕
      </button>
    {:else if entry.status === "error"}
      <div class="cz-status-pill is-err">Failed</div>
      <button
        type="button"
        class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
        onclick={() => onCompress(entry)}
      >
        Retry
      </button>
      <button
        type="button"
        class="cz-icon-btn"
        aria-label="Remove file"
        onclick={() => onRemove(entry.id)}
      >
        ✕
      </button>
    {/if}
  </div>
</div>

<style>
  .cz-card-thumb {
    width: 32px;
    height: 32px;
    border-radius: var(--r-sm);
    object-fit: cover;
  }
  .cz-card-meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .cz-card-badge {
    display: inline-block;
    padding: 0.1rem 0.35rem;
    border-radius: 9999px;
    background: var(--green-soft);
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 700;
    margin-left: 0.25rem;
  }
  .cz-card-error-msg {
    color: var(--rose);
    font-size: 0.72rem;
  }
  .cz-btn-pill {
    border-radius: 9999px;
    padding: 0.25rem 0.75rem;
  }
  .cz-icon-btn {
    border: none;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
    padding: 0.25rem 0.4rem;
    border-radius: 9999px;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--t), background var(--t);
  }
  .cz-icon-btn:hover {
    color: var(--text);
    background: var(--bg2);
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
  .cz-spin-dot {
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: currentColor;
    animation: cz-pulse 1s infinite alternate;
  }
  @keyframes cz-pulse {
    from { opacity: 0.3; }
    to { opacity: 1; }
  }
</style>
