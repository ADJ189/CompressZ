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
  class="cz-card {entry.status === 'done' ? 'is-done' : ''} {entry.status === 'error' ? 'is-error' : ''} {entry.status === 'compressing' ? 'is-compressing' : ''}"
  id="card-{entry.id}"
>
  <div class="cz-card-left">
    {#if entry.thumbUrl}
      <img src={entry.thumbUrl} alt="" class="cz-card-thumb" />
    {:else}
      <div class="cz-card-thumb cz-card-thumb-placeholder">
        {entry.type === "image" ? "🖼️" : entry.type === "pdf" ? "📄" : entry.type === "video" ? "🎬" : "📁"}
      </div>
    {/if}

    <div class="cz-card-meta">
      <span class="cz-card-name" title={entry.name}>{entry.name}</span>
      <div class="cz-card-sizes">
        <span class="cz-card-orig">{formatBytes(entry.originalSize)}</span>
        {#if entry.status === "done" && entry.compressedSize}
          <span class="cz-card-arrow" aria-hidden="true">→</span>
          <span class="cz-card-comp">{formatBytes(entry.compressedSize)}</span>
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

  <div class="cz-card-actions">
    {#if entry.status === "idle"}
      {#if onEdit}
        <button
          type="button"
          class="cz-btn cz-btn-secondary cz-btn-sm"
          onclick={() => onEdit(entry)}
        >
          Options
        </button>
      {/if}
      <button
        type="button"
        class="cz-btn cz-btn-primary cz-btn-sm"
        onclick={() => onCompress(entry)}
      >
        Compress
      </button>
      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        aria-label="Remove file"
        onclick={() => onRemove(entry.id)}
      >
        ✕
      </button>
    {:else if entry.status === "compressing"}
      <div class="cz-card-spinner" aria-label="Processing file"></div>
    {:else if entry.status === "done"}
      <button
        type="button"
        class="cz-btn cz-btn-primary cz-btn-sm"
        onclick={() => onDownload(entry)}
      >
        Download
      </button>
      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        aria-label="Remove file"
        onclick={() => onRemove(entry.id)}
      >
        ✕
      </button>
    {:else if entry.status === "error"}
      <button
        type="button"
        class="cz-btn cz-btn-secondary cz-btn-sm"
        onclick={() => onCompress(entry)}
      >
        Retry
      </button>
      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        aria-label="Remove file"
        onclick={() => onRemove(entry.id)}
      >
        ✕
      </button>
    {/if}
  </div>
</div>

<style>
  .cz-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    gap: 1rem;
    transition: transform var(--t), box-shadow var(--t), border-color var(--t);
  }
  .cz-card:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-sm);
    border-color: var(--border-mid);
  }
  .cz-card.is-done {
    border-color: var(--green-border);
  }
  .cz-card.is-error {
    border-color: var(--rose);
  }
  .cz-card-left {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
    flex: 1;
  }
  .cz-card-thumb {
    width: 42px;
    height: 42px;
    border-radius: var(--r-xs);
    object-fit: cover;
    background: var(--bg2);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .cz-card-thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
  }
  .cz-card-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .cz-card-name {
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cz-card-sizes {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.82rem;
    font-family: var(--mono);
    color: var(--text-3);
  }
  .cz-card-comp {
    color: var(--text);
    font-weight: 500;
  }
  .cz-card-badge {
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    font-size: 0.76rem;
    font-weight: 600;
    background: var(--green-soft);
    color: var(--green);
    border: 1px solid var(--green-border);
  }
  .cz-card-error-msg {
    font-size: 0.8rem;
    color: var(--rose);
    margin-top: 0.2rem;
  }
  .cz-card-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }
  .cz-card-spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: cz-spin 0.7s linear infinite;
  }
  @keyframes cz-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
