<script lang="ts">
  import type { PageSpec } from "../lib/pdfTools/organizePdf";

  interface Props {
    pages: PageSpec[];
    thumbnails?: Record<number, string>; // page index -> image data URL
    onUpdate: (updated: PageSpec[]) => void;
  }

  let { pages, thumbnails = {}, onUpdate }: Props = $props();

  let draggedIndex = $state<number | null>(null);
  let dragOverIndex = $state<number | null>(null);

  function handleRotate(index: number) {
    const updated = pages.map((p, i) => {
      if (i === index) {
        return { ...p, rotation: (p.rotation + 90) % 360 };
      }
      return p;
    });
    onUpdate(updated);
  }

  function handleDeleteToggle(index: number) {
    const updated = pages.map((p, i) => {
      if (i === index) {
        return { ...p, deleted: !p.deleted };
      }
      return p;
    });
    onUpdate(updated);
  }

  function handleDuplicate(index: number) {
    const target = pages[index];
    const newPage: PageSpec = {
      ...target,
      id: `${target.id}-copy-${Date.now()}`,
      duplicateCount: 1,
    };
    const next = [...pages];
    next.splice(index + 1, 0, newPage);
    onUpdate(next);
  }

  function handleMove(from: number, to: number) {
    if (from === to || to < 0 || to >= pages.length) return;
    const next = [...pages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onUpdate(next);
  }

  function handleDragStart(index: number, e: DragEvent) {
    draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  }

  function handleDragOver(index: number, e: DragEvent) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    dragOverIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  }

  function handleDrop(index: number, e: DragEvent) {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      handleMove(draggedIndex, index);
    }
    draggedIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggedIndex = null;
    dragOverIndex = null;
  }
</script>

<div class="cz-page-grid" role="list" aria-label="PDF pages grid">
  {#each pages as page, idx (page.id)}
    {@const thumb = thumbnails[page.originalIndex]}
    {@const isOver = dragOverIndex === idx}
    {@const isDragging = draggedIndex === idx}

    <div
      class="cz-page-card {page.deleted ? 'is-deleted' : ''} {isOver ? 'is-dragover' : ''} {isDragging ? 'is-dragging' : ''}"
      role="listitem"
      draggable="true"
      ondragstart={(e) => handleDragStart(idx, e)}
      ondragover={(e) => handleDragOver(idx, e)}
      ondrop={(e) => handleDrop(idx, e)}
      ondragend={handleDragEnd}
    >
      <div class="cz-page-header">
        <span class="cz-page-badge">
          Page {idx + 1}
          {#if page.originalIndex !== idx}
            <small class="cz-page-orig">(was {page.originalIndex + 1})</small>
          {/if}
        </span>

        <div class="cz-page-reorder-btns">
          <button
            type="button"
            class="cz-icon-btn"
            title="Move left"
            disabled={idx === 0}
            onclick={() => handleMove(idx, idx - 1)}
          >
            ◀
          </button>
          <button
            type="button"
            class="cz-icon-btn"
            title="Move right"
            disabled={idx === pages.length - 1}
            onclick={() => handleMove(idx, idx + 1)}
          >
            ▶
          </button>
        </div>
      </div>

      <div class="cz-page-preview-box">
        {#if thumb}
          <div
            class="cz-page-thumb-wrapper"
            style="transform: rotate({page.rotation}deg);"
          >
            <img src={thumb} alt="Page {idx + 1}" class="cz-page-thumb-img" />
          </div>
        {:else}
          <div
            class="cz-page-blank-thumb"
            style="transform: rotate({page.rotation}deg);"
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>{page.isBlank ? "Blank Page" : `Page ${page.originalIndex + 1}`}</span>
          </div>
        {/if}

        {#if page.rotation > 0}
          <span class="cz-page-rot-badge">+{page.rotation}°</span>
        {/if}

        {#if page.deleted}
          <div class="cz-page-deleted-overlay">
            <span>Deleted</span>
          </div>
        {/if}
      </div>

      <div class="cz-page-actions">
        <button
          type="button"
          class="cz-action-btn"
          title="Rotate 90° clockwise"
          onclick={() => handleRotate(idx)}
        >
          🔄 90°
        </button>

        <button
          type="button"
          class="cz-action-btn"
          title="Duplicate page"
          onclick={() => handleDuplicate(idx)}
        >
          📑 Copy
        </button>

        <button
          type="button"
          class="cz-action-btn {page.deleted ? 'cz-btn-restore' : 'cz-btn-danger'}"
          title={page.deleted ? "Restore page" : "Delete page"}
          onclick={() => handleDeleteToggle(idx)}
        >
          {page.deleted ? "↩ Restore" : "🗑 Delete"}
        </button>
      </div>
    </div>
  {/each}
</div>

<style>
  .cz-page-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1.15rem;
    padding: 1rem 0;
  }

  .cz-page-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    box-shadow: var(--shadow-sm);
    transition: transform var(--t), border-color var(--t), box-shadow var(--t), opacity var(--t);
    user-select: none;
    position: relative;
  }

  .cz-page-card:hover {
    border-color: var(--accent);
    box-shadow: var(--shadow-md);
  }

  .cz-page-card.is-dragover {
    border-color: var(--accent);
    transform: scale(1.03);
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .cz-page-card.is-dragging {
    opacity: 0.45;
  }

  .cz-page-card.is-deleted {
    opacity: 0.55;
    border-style: dashed;
    border-color: var(--border-2);
  }

  .cz-page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
  }

  .cz-page-badge {
    font-weight: 600;
    color: var(--text);
  }

  .cz-page-orig {
    color: var(--text-3);
    font-size: 0.72rem;
    margin-left: 0.25rem;
  }

  .cz-page-reorder-btns {
    display: flex;
    gap: 0.2rem;
  }

  .cz-icon-btn {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.15rem 0.35rem;
    font-size: 0.68rem;
    cursor: pointer;
    color: var(--text-2);
  }

  .cz-icon-btn:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent-glow);
  }

  .cz-icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .cz-page-preview-box {
    aspect-ratio: 1 / 1.414; /* A4 aspect ratio */
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .cz-page-thumb-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform var(--t);
  }

  .cz-page-thumb-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .cz-page-blank-thumb {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-3);
    font-size: 0.75rem;
    transition: transform var(--t);
  }

  .cz-page-rot-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    background: var(--accent);
    color: white;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  }

  .cz-page-deleted-overlay {
    position: absolute;
    inset: 0;
    background: rgba(239, 68, 68, 0.45);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 800;
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .cz-page-actions {
    display: flex;
    gap: 0.35rem;
  }

  .cz-action-btn {
    flex: 1;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.35rem 0.25rem;
    font-size: 0.74rem;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-2);
    text-align: center;
    transition: background var(--t), color var(--t);
  }

  .cz-action-btn:hover {
    background: var(--bg2);
    color: var(--text);
  }

  .cz-btn-danger:hover {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.3);
  }

  .cz-btn-restore {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.3);
  }
</style>
