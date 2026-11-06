<script lang="ts">
  interface Props {
    accept: string;
    icon?: string;
    title: string;
    subtitle: string;
    multiple?: boolean;
    hasFiles?: boolean;
    onFiles: (files: File[]) => void;
  }

  let {
    accept,
    icon = "📄",
    title,
    subtitle,
    multiple = true,
    hasFiles = false,
    onFiles,
  }: Props = $props();

  let isDragActive = $state(false);
  let fileInput: HTMLInputElement;

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((f) => f.size > 0);
    if (files.length > 0) {
      onFiles(files);
    }
    input.value = "";
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragActive = true;
  }

  function handleDragLeave() {
    isDragActive = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragActive = false;
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.size > 0);
    if (files.length > 0) {
      onFiles(files);
    }
  }

  function triggerBrowse() {
    fileInput?.click();
  }
</script>

<div
  class="cz-dropzone {isDragActive ? 'is-drag-active' : ''} {hasFiles ? 'is-compact' : ''}"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  role="region"
  aria-label="File upload area"
>
  <input
    bind:this={fileInput}
    type="file"
    {accept}
    {multiple}
    onchange={handleFileSelect}
    style="display: none"
  />

  {#if !hasFiles}
    <div class="cz-dz-content">
      <div class="cz-dz-icon" aria-hidden="true">{icon}</div>
      <div class="cz-dz-headings">
        <h3 class="cz-dz-title">{title}</h3>
        <p class="cz-dz-sub">{subtitle}</p>
      </div>
      <button
        type="button"
        class="cz-btn cz-btn-primary"
        onclick={triggerBrowse}
      >
        Select files
      </button>
    </div>
  {:else}
    <div class="cz-dz-compact">
      <span class="cz-dz-compact-icon" aria-hidden="true">{icon}</span>
      <span class="cz-dz-compact-text">Add more files</span>
      <button
        type="button"
        class="cz-btn cz-btn-secondary cz-btn-sm"
        onclick={triggerBrowse}
      >
        Browse
      </button>
    </div>
  {/if}
</div>

<style>
  .cz-dropzone {
    border: 1.5px dashed var(--border-mid);
    border-radius: var(--r);
    background: var(--surface);
    padding: 2.25rem 1.5rem;
    text-align: center;
    transition: border-color var(--t), background-color var(--t);
  }
  .cz-dropzone.is-drag-active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .cz-dropzone.is-compact {
    padding: 0.85rem 1.25rem;
  }
  .cz-dz-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.85rem;
    max-width: 480px;
    margin: 0 auto;
  }
  .cz-dz-icon {
    font-size: 2.2rem;
    line-height: 1;
  }
  .cz-dz-title {
    font-family: var(--display);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-dz-sub {
    font-size: 0.86rem;
    color: var(--text-3);
    margin-top: 0.2rem;
  }
  .cz-dz-compact {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
  }
  .cz-dz-compact-icon {
    font-size: 1.25rem;
  }
  .cz-dz-compact-text {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-2);
  }
</style>
