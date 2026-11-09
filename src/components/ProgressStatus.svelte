<script lang="ts">
  interface Props {
    progress: number; // 0 to 1
    statusMessage: string;
    onCancel?: () => void;
  }

  let { progress, statusMessage, onCancel }: Props = $props();

  const pct = $derived(Math.max(0, Math.min(100, Math.round(progress * 100))));
</script>

<div class="cz-progress-wrap" role="status" aria-live="polite">
  <div class="cz-progress-bar-track">
    <div
      class="cz-progress-bar-fill"
      style="width: {pct}%"
      aria-valuenow={pct}
      aria-valuemin="0"
      aria-valuemax="100"
    ></div>
  </div>

  <div class="cz-progress-info">
    <span class="cz-progress-status">{statusMessage || "Processing..."}</span>
    <span class="cz-progress-pct">{pct}%</span>
  </div>

  {#if onCancel}
    <div class="cz-progress-cancel-row">
      <button
        type="button"
        class="cz-btn cz-btn-ghost cz-btn-sm"
        onclick={onCancel}
      >
        Cancel
      </button>
    </div>
  {/if}
</div>

<style>
  .cz-progress-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .cz-progress-bar-track {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--bg2);
    overflow: hidden;
  }
  .cz-progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 240ms cubic-bezier(0.2, 0, 0, 1);
  }
  .cz-progress-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--text-2);
  }
  .cz-progress-status {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 80%;
  }
  .cz-progress-pct {
    font-family: var(--mono);
    font-weight: 600;
    color: var(--text);
  }
  .cz-progress-cancel-row {
    display: flex;
    justify-content: flex-end;
  }
</style>
