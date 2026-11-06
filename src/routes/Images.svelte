<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { imageStore, type ImageState } from "../store";
  import { compressImage } from "../lib/compressImage";
  import { uid, type FileEntry, type ImageFormat } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<ImageState>(imageStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = imageStore.subscribe((val) => {
      state = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<ImageState>) {
    imageStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(files: File[]) {
    const newEntries: FileEntry[] = files.map((file) => ({
      id: uid(),
      file,
      name: file.name,
      originalSize: file.size,
      status: "idle",
      type: "image",
    }));
    updateStore({ files: [...state.files, ...newEntries] });
  }

  async function compressSingle(entry: FileEntry) {
    if (entry.status === "compressing") return;

    // Update status
    updateStore({
      files: state.files.map((f) =>
        f.id === entry.id ? { ...f, status: "compressing", error: undefined } : f,
      ),
    });

    try {
      const res = await compressImage(entry.file, {
        quality: state.quality,
        format: state.format,
        maxDim: state.maxDim,
        targetSizeKB: state.mode === "targetSize" ? state.targetSizeKB : undefined,
      });

      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "done",
                compressedBlob: res.blob,
                compressedSize: res.blob.size,
              }
            : f,
        ),
      });
      toast(`Compressed ${entry.name}`, "success");
    } catch (err) {
      console.error("[imageCompress] error:", err);
      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "error",
                error: (err as Error).message || "Compression failed",
              }
            : f,
        ),
      });
      toast(`Failed to compress ${entry.name}`, "error");
    }
  }

  async function handleCompressAll() {
    isBusy = true;
    const idleEntries = state.files.filter((f) => f.status === "idle" || f.status === "error");
    for (const entry of idleEntries) {
      await compressSingle(entry);
    }
    isBusy = false;
  }

  function handleDownloadSingle(entry: FileEntry) {
    if (!entry.compressedBlob) return;
    const url = URL.createObjectURL(entry.compressedBlob);
    const a = document.createElement("a");
    const ext = state.format === "image/webp" ? "webp" : state.format === "image/avif" ? "avif" : state.format === "image/jpeg" ? "jpg" : "png";
    const base = entry.name.replace(/\.[^/.]+$/, "");
    a.href = url;
    a.download = `${base}-compressed.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handleDownloadAll() {
    const doneEntries = state.files.filter((f) => f.status === "done");
    for (const entry of doneEntries) {
      handleDownloadSingle(entry);
    }
  }

  function handleRemove(id: string) {
    updateStore({ files: state.files.filter((f) => f.id !== id) });
  }

  function handleClear() {
    updateStore({ files: [] });
  }
</script>

<div class="cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">Image Compressor</h1>
    <p class="cz-tool-desc">
      Compress JPEG, PNG, WebP, and AVIF in-browser. Measured SSIM quality guard prevents
      unsightly compression artifacts.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="img-mode">Mode</label>
      <select
        id="img-mode"
        class="cz-select"
        value={state.mode}
        onchange={(e) => updateStore({ mode: (e.target as HTMLSelectElement).value as any })}
      >
        <option value="quality">Quality</option>
        <option value="targetSize">Target Size</option>
      </select>
    </div>

    {#if state.mode === "quality"}
      <div class="cz-setting-item">
        <label class="cz-setting-label" for="img-q">Quality ({state.quality}%)</label>
        <input
          id="img-q"
          type="range"
          min="1"
          max="100"
          value={state.quality}
          class="cz-range"
          oninput={(e) => updateStore({ quality: Number((e.target as HTMLInputElement).value) })}
        />
      </div>
    {:else}
      <div class="cz-setting-item">
        <label class="cz-setting-label" for="img-target">Target (KB)</label>
        <input
          id="img-target"
          type="number"
          min="10"
          value={state.targetSizeKB}
          class="cz-input cz-input-sm"
          onchange={(e) => updateStore({ targetSizeKB: Number((e.target as HTMLInputElement).value) })}
        />
      </div>
    {/if}

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="img-fmt">Format</label>
      <select
        id="img-fmt"
        class="cz-select"
        value={state.format}
        onchange={(e) => updateStore({ format: (e.target as HTMLSelectElement).value as ImageFormat })}
      >
        <option value="image/webp">WebP (Recommended)</option>
        <option value="image/jpeg">JPEG</option>
        <option value="image/png">PNG</option>
        <option value="image/avif">AVIF</option>
      </select>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="img-dim">Max Dimension</label>
      <select
        id="img-dim"
        class="cz-select"
        value={state.maxDim}
        onchange={(e) => updateStore({ maxDim: Number((e.target as HTMLSelectElement).value) })}
      >
        <option value="0">Original (Uncapped)</option>
        <option value="3840">4K (3840px)</option>
        <option value="2560">2K (2560px)</option>
        <option value="1920">Full HD (1920px)</option>
        <option value="1280">HD (1280px)</option>
      </select>
    </div>
  </div>

  <FileDropzone
    accept="image/*,.heic,.heif"
    icon="🖼️"
    title="Drop image files here"
    subtitle="JPEG, PNG, WebP, AVIF, HEIC/HEIF"
    hasFiles={state.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if state.files.length > 0}
    <FileQueue
      files={state.files}
      {isBusy}
      onCompressAll={handleCompressAll}
      onDownloadAll={handleDownloadAll}
      onClear={handleClear}
      onCompressSingle={compressSingle}
      onDownloadSingle={handleDownloadSingle}
      onRemoveSingle={handleRemove}
    />
  {/if}
</div>

<style>
  .cz-tool-view {
    max-width: 1060px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .cz-tool-header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .cz-tool-title {
    font-family: var(--display);
    font-size: 1.85rem;
    font-weight: 800;
    color: var(--text);
  }
  .cz-tool-desc {
    font-size: 0.95rem;
    color: var(--text-3);
    max-width: 65ch;
  }
  .cz-tool-settings-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.25rem;
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface);
  }
  .cz-setting-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .cz-setting-label {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-range {
    width: 120px;
  }
</style>
