<script lang="ts">
  import ActionPalette from "./ActionPalette.svelte";

  interface Props {
    compact?: boolean;
    label?: string;
  }

  let { compact = false, label = "Universal Upload" }: Props = $props();

  let fileInput: HTMLInputElement;
  let activeFile = $state<File | null>(null);
  let paletteOpen = $state(false);
  let isDraggingOver = $state(false);

  function triggerPicker() {
    fileInput?.click();
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      activeFile = input.files[0];
      paletteOpen = true;
      input.value = "";
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = true;
  }

  function handleDragLeave() {
    isDraggingOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      activeFile = e.dataTransfer.files[0];
      paletteOpen = true;
    }
  }
</script>

<input
  bind:this={fileInput}
  type="file"
  class="cz-hidden-input"
  onchange={handleFileChange}
  aria-hidden="true"
  tabindex="-1"
/>

<button
  type="button"
  class="cz-universal-upload-btn {compact ? 'is-compact' : ''} {isDraggingOver ? 'is-drag-over' : ''}"
  onclick={triggerPicker}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  title="Upload or drop any file to route to any tool"
  aria-label={label}
>
  <span class="cz-universal-icon" aria-hidden="true">⇪</span>
  <span class="cz-universal-label">{label}</span>
  {#if !compact}
    <span class="cz-universal-hint">Quick Route</span>
  {/if}
</button>

<ActionPalette
  file={activeFile}
  open={paletteOpen}
  onClose={() => {
    paletteOpen = false;
    activeFile = null;
  }}
/>

<style>
  .cz-hidden-input {
    display: none;
  }
  .cz-universal-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.38rem 0.75rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    color: var(--text);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--t-fast);
    outline: none;
    user-select: none;
    box-shadow: var(--shadow-sm);
  }
  .cz-universal-upload-btn:hover {
    background: var(--surface3, var(--surface2));
    border-color: var(--brand);
    color: var(--brand);
    box-shadow: 0 0 0 1px var(--brand-glow);
    transform: translateY(-1px);
  }
  .cz-universal-upload-btn.is-drag-over {
    border-color: var(--brand);
    background: var(--brand-glow);
    color: var(--brand);
    transform: scale(1.02);
  }
  .cz-universal-upload-btn.is-compact {
    padding: 0.32rem 0.6rem;
    font-size: 0.75rem;
  }
  .cz-universal-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1;
    color: var(--brand);
  }
  .cz-universal-label {
    white-space: nowrap;
  }
  .cz-universal-hint {
    font-size: 0.68rem;
    font-weight: 500;
    color: var(--text-3);
    padding-left: 0.25rem;
    border-left: 1px solid var(--border);
  }
</style>
