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
  id="dz-mount"
  class="cz-dropzone {isDragActive ? 'is-drag-active' : ''} {hasFiles ? 'is-compact' : ''}"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  onclick={triggerBrowse}
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
      <div class="cz-dz-cloud-badge" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
          <path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>
        </svg>
      </div>
      <div class="cz-dz-headings">
        <h3 class="cz-dz-title">{title}</h3>
        <p class="cz-dz-sub">{subtitle}</p>
      </div>
      <button
        type="button"
        class="cz-btn cz-btn-primary cz-btn-pill"
        onclick={(e) => { e.stopPropagation(); triggerBrowse(); }}
      >
        Select files
      </button>
    </div>
  {:else}
    <div class="cz-dz-compact">
      <span class="cz-dz-compact-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14m-7-7h14"/>
        </svg>
      </span>
      <span class="cz-dz-compact-text">Add more files</span>
      <button
        type="button"
        class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
        onclick={(e) => { e.stopPropagation(); triggerBrowse(); }}
      >
        Browse
      </button>
    </div>
  {/if}
</div>

<style>
  .cz-dropzone {
    border: 1.5px dashed var(--border-mid);
    border-radius: var(--r-xl);
    background: var(--surface2);
    padding: 2.25rem 1.5rem;
    text-align: center;
    cursor: pointer;
    transition: border-color var(--t), background var(--t);
  }
  .cz-dropzone:hover {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .cz-dropzone.is-drag-active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .cz-dropzone.is-compact {
    padding: 0.85rem 1.25rem;
    border-radius: var(--r);
  }
  .cz-dz-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    max-width: 480px;
    margin: 0 auto;
  }
  .cz-dz-cloud-badge {
    width: 48px;
    height: 48px;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--green-border);
    margin-bottom: 0.25rem;
  }
  .cz-dz-title {
    font-family: var(--display);
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-dz-sub {
    font-size: 0.82rem;
    color: var(--text-3);
    margin-top: 0.2rem;
  }
  .cz-btn-pill {
    border-radius: 9999px;
    padding: 0.45rem 1.25rem;
  }
  .cz-dz-compact {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
  }
  .cz-dz-compact-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }
  .cz-dz-compact-text {
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--text-2);
  }
</style>
