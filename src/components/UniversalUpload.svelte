<script lang="ts">
  import ActionPalette from "./ActionPalette.svelte";
  import MacIcon from "./MacIcon.svelte";

  interface Props {
    compact?: boolean;
    label?: string;
    onActionSelected?: () => void;
  }

  let {
    compact = false,
    label = "Universal Upload",
    onActionSelected,
  }: Props = $props();

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

  function handlePaletteClose() {
    paletteOpen = false;
    activeFile = null;
    onActionSelected?.();
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
  title="Upload or drop any file to route to any tool (⌘U / Ctrl+U)"
  aria-label={label}
>
  <span class="cz-universal-icon" aria-hidden="true">
    <MacIcon name="upload" size={compact ? 13 : 15} strokeWidth={2.4} />
  </span>
  <span class="cz-universal-label">{label}</span>
  {#if !compact}
    <span class="cz-universal-hint">Quick Route</span>
  {/if}
</button>

<ActionPalette
  file={activeFile}
  open={paletteOpen}
  onClose={handlePaletteClose}
  onActionSelected={() => {
    paletteOpen = false;
    activeFile = null;
    onActionSelected?.();
  }}
/>

<style>
  .cz-hidden-input {
    display: none;
  }

  .cz-universal-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.42rem 0.85rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-md, 8px);
    color: var(--text);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transform: translateZ(0);
    transition:
      background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      color 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cz-universal-upload-btn.is-compact {
    padding: 0.32rem 0.65rem;
    font-size: 0.75rem;
    gap: 0.38rem;
  }

  /* Mouse / Fine pointer hover */
  @media (hover: hover) and (pointer: fine) {
    .cz-universal-upload-btn:hover {
      background: var(--surface3, var(--surface2));
      border-color: var(--brand);
      color: var(--brand);
      box-shadow: 0 0 0 1px var(--brand-glow), 0 3px 10px rgba(0, 0, 0, 0.08);
      transform: translateY(-1px);
    }
  }

  /* Tactile active press */
  .cz-universal-upload-btn:active {
    transform: scale(0.97);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  /* Drag over breathing elevation */
  .cz-universal-upload-btn.is-drag-over {
    border-color: var(--brand);
    background: var(--brand-glow);
    color: var(--brand);
    box-shadow: 0 0 14px var(--brand-glow), 0 0 0 2px var(--brand);
    transform: scale(1.02);
  }

  /* Keyboard accessibility */
  .cz-universal-upload-btn:focus-visible {
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--brand);
    border-color: var(--brand);
  }

  /* Touch device optimization (WCAG & Apple HIG >= 44px) */
  @media (hover: none) and (pointer: coarse) {
    .cz-universal-upload-btn {
      min-height: 44px;
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
    }
    .cz-universal-upload-btn.is-compact {
      min-height: 38px;
      padding: 0.4rem 0.75rem;
    }
    .cz-universal-upload-btn:hover {
      transform: none;
    }
  }

  /* Retina / HiDPI crisp hairline border */
  @media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
    .cz-universal-upload-btn {
      border-width: 0.5px;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .cz-universal-upload-btn {
      transition: none;
      transform: none !important;
    }
  }

  .cz-universal-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--brand);
    flex-shrink: 0;
  }

  .cz-universal-label {
    white-space: nowrap;
    letter-spacing: -0.01em;
  }

  .cz-universal-hint {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--text-3);
    padding-left: 0.45rem;
    border-left: 1px solid var(--border);
    letter-spacing: 0.01em;
  }
</style>
