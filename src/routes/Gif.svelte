<script lang="ts">
  import { onMount } from "svelte";
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { gifStore, type GifState, consumeStagedUniversalFile, currentRoute } from "../store";
  import { compressGif } from "../lib/compressGif";
  import { gifOptions } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
import { entryError } from "../lib/engineError";
  import { uid, type FileEntry, outputFilename } from "../lib/types";
  import { downloadBatch } from "../lib/batchDownload";
  import { toast } from "../toast";

  let gifState = $state<GifState>(gifStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = gifStore.subscribe((val) => {
      gifState = val;
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
    updateStore({ files: [...gifState.files, ...newEntries] });
  }

  function applyStagedFile() {
    const staged = consumeStagedUniversalFile("compress/gif");
    if (staged?.file) {
      handleFilesAdded([staged.file]);
    }
  }

  onMount(() => {
    applyStagedFile();
  });

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      if (r === "compress/gif") {
        applyStagedFile();
      }
    });
    return unsub;
  });

  async function compressSingle(entry: FileEntry) {
    if (entry.status === "compressing") return;

    gifStore.update((curr) => ({
      ...curr,
      files: curr.files.map((f) =>
        f.id === entry.id ? { ...f, status: "compressing", error: undefined } : f,
      ),
    }));

    try {
      const options = gifOptions(gifStore.get());
      const res = await runScheduled(
        { kind: "gif", label: entry.name, bytes: entry.file.size },
        () => compressGif(entry.file, options),
      );

      gifStore.update((curr) => ({
        ...curr,
        files: curr.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "done",
                compressedBlob: res.blob,
                compressedSize: res.blob.size,
                result: res,
              }
            : f,
        ),
      }));
      toast(`Compressed ${entry.name}`, "success");
    } catch (err) {
      console.error("[gifCompress] error:", err);
      const failure = entryError(err, "GIF compression failed");
      gifStore.update((curr) => ({
        ...curr,
        files: curr.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "error",
                error: failure.error,
                errorLog: failure.errorLog,
              }
            : f,
        ),
      }));
      toast(`${entry.name}: ${failure.error}`, "error", undefined, {
        log: failure.errorLog,
      });
    }
  }

  async function handleCompressAll() {
    isBusy = true;
    try {
      const idleEntries = gifStore
        .get()
        .files.filter((f) => f.status === "idle" || f.status === "error");
      for (const entry of idleEntries) {
        await compressSingle(entry);
      }
    } finally {
      isBusy = false;
    }
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

  async function handleDownloadAll() {
    const doneEntries = gifState.files.filter((f) => f.status === "done" && f.compressedBlob);
    const items = doneEntries.map((entry) => ({
      name: outputFilename(entry.name, entry.compressedBlob!, {
        suffix: "-compressed",
        fallbackExt: "gif",
      }),
      blob: entry.compressedBlob!,
    }));
    await downloadBatch(items, "gif-compressed.zip");
  }

  function handleRemove(id: string) {
    updateStore({ files: gifState.files.filter((f) => f.id !== id) });
  }

  function handleClear() {
    updateStore({ files: [] });
  }
</script>

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">GIF Optimizer</h1>
    <p class="cz-tool-desc">
      Compress animated GIFs using FFmpeg two-pass palettegen/paletteuse optimization or convert to WebM video.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="gif-q">Quality ({gifState.quality}%)</label>
      <input
        id="gif-q"
        type="range"
        min="10"
        max="100"
        value={gifState.quality}
        class="cz-range"
        oninput={(e) => updateStore({ quality: Number((e.target as HTMLInputElement).value) })}
      />
    </div>

    <div class="cz-setting-item">
      <span class="cz-setting-label">Output</span>
      <div class="seg" role="group" aria-label="Output format">
        <button
          type="button"
          class={!gifState.gifToVideo ? "on" : ""}
          aria-pressed={!gifState.gifToVideo}
          id="out-gif"
          onclick={() => updateStore({ gifToVideo: false })}
        >
          Optimised GIF
        </button>
        <button
          type="button"
          class={gifState.gifToVideo ? "on" : ""}
          aria-pressed={gifState.gifToVideo}
          id="out-webm"
          onclick={() => updateStore({ gifToVideo: true })}
        >
          Convert to WebM
        </button>
      </div>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="gif-w">Max Width</label>
      <select
        id="gif-w"
        class="cz-select"
        value={gifState.maxWidth}
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
    hasFiles={gifState.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if gifState.files.length > 0}
    <FileQueue
      files={gifState.files}
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
  .cz-select {
    padding: 0.42rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface2);
    color: var(--text);
    font-size: 0.84rem;
    max-width: 100%;
  }
  @media (max-width: 640px) {
    .cz-tool-view {
      padding: 1rem 0.85rem 2.5rem;
      gap: 1.1rem;
    }
    .cz-tool-title {
      font-size: 1.45rem;
    }
    .cz-tool-desc {
      font-size: 0.86rem;
    }
    .cz-tool-settings-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 0.85rem;
      padding: 0.85rem;
    }
    .cz-setting-item {
      flex-direction: column;
      align-items: stretch;
      gap: 0.35rem;
      width: 100%;
    }
    .cz-range,
    .cz-select {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    .cz-select {
      min-height: 40px;
      font-size: 16px;
    }
    .seg {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      border-radius: var(--r-sm);
    }
    .seg button {
      flex: 1 1 110px;
      min-height: 36px;
    }
  }
</style>
