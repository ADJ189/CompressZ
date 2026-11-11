<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { gifStore, type GifState } from "../store";
  import { compressGif } from "../lib/compressGif";
  import { gifOptions } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
  import { uid, type FileEntry, outputFilename } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<GifState>(gifStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = gifStore.subscribe((val) => {
      state = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<GifState>) {
    gifStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(files: File[]) {
    const newEntries: FileEntry[] = files.map((file) => ({
      id: uid(),
      file,
      name: file.name,
      originalSize: file.size,
      status: "idle",
      type: "gif",
    }));
    updateStore({ files: [...state.files, ...newEntries] });
  }

  async function compressSingle(entry: FileEntry) {
    if (entry.status === "compressing") return;

    updateStore({
      files: state.files.map((f) =>
        f.id === entry.id ? { ...f, status: "compressing", error: undefined } : f,
      ),
    });

    try {
      const res = await runScheduled(
        { kind: "gif", label: entry.name, bytes: entry.file.size },
        () => compressGif(entry.file, gifOptions(state)),
      );

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
      console.error("[gifCompress] error:", err);
      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "error",
                error: (err as Error).message || "GIF compression failed",
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
    a.href = url;
    a.download = outputFilename(entry.name, entry.compressedBlob, {
      suffix: "-compressed",
      fallbackExt: "gif",
    });
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

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">GIF Optimizer</h1>
    <p class="cz-tool-desc">
      Compress animated GIFs using lossy LZW table optimization or convert to efficient WebM video.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="gif-q">Quality ({state.quality}%)</label>
      <input
        id="gif-q"
        type="range"
        min="10"
        max="100"
        value={state.quality}
        class="cz-range"
        oninput={(e) => updateStore({ quality: Number((e.target as HTMLInputElement).value) })}
      />
    </div>

    <label class="cz-checkbox-label">
      <input
        type="checkbox"
        checked={state.gifToVideo}
        onchange={(e) => updateStore({ gifToVideo: (e.target as HTMLInputElement).checked })}
      />
      <span>Convert to WebM (Up to 90% smaller)</span>
    </label>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="gif-w">Max Width</label>
      <select
        id="gif-w"
        class="cz-select"
        value={state.maxWidth}
        onchange={(e) => updateStore({ maxWidth: Number((e.target as HTMLSelectElement).value) })}
      >
        <option value="0">Original</option>
        <option value="720">720px</option>
        <option value="480">480px</option>
      </select>
    </div>
  </div>

  <FileDropzone
    accept="image/gif,.gif"
    icon="🎞️"
    title="Drop animated GIF files here"
    subtitle="Standard animated GIF files"
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
    width: 110px;
  }
  .cz-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.86rem;
    color: var(--text-2);
    cursor: pointer;
  }
</style>
