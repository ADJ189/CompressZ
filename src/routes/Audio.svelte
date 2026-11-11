<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { audioStore, type AudioState } from "../store";
  import { compressAudio } from "../lib/compressAudio";
  import { audioOptions } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
  import { uid, type FileEntry, type AudioFormat, outputFilename } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<AudioState>(audioStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = audioStore.subscribe((val) => {
      state = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<AudioState>) {
    audioStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(files: File[]) {
    const newEntries: FileEntry[] = files.map((file) => ({
      id: uid(),
      file,
      name: file.name,
      originalSize: file.size,
      status: "idle",
      type: "audio",
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
        { kind: "audio", label: entry.name, bytes: entry.file.size },
        () => compressAudio(entry.file, audioOptions(state)),
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
      console.error("[audioCompress] error:", err);
      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "error",
                error: (err as Error).message || "Audio compression failed",
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
      fallbackExt: state.fmt,
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
    <h1 class="cz-tool-title">Audio Compressor</h1>
    <p class="cz-tool-desc">
      Optimize voice recordings, music tracks, and podcasts in your browser using FFmpeg.wasm.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="aud-fmt">Format</label>
      <select
        id="aud-fmt"
        class="cz-select"
        value={state.fmt}
        onchange={(e) => updateStore({ fmt: (e.target as HTMLSelectElement).value as AudioFormat })}
      >
        <option value="mp3">MP3 (Universal)</option>
        <option value="aac">AAC (.m4a)</option>
        <option value="ogg">OGG Vorbis</option>
        <option value="opus">Opus (High efficiency)</option>
        <option value="flac">FLAC (Lossless)</option>
        <option value="wav">WAV (Uncompressed)</option>
      </select>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="aud-bitrate">Bitrate</label>
      <select
        id="aud-bitrate"
        class="cz-select"
        value={state.bitrate}
        onchange={(e) => updateStore({ bitrate: Number((e.target as HTMLSelectElement).value) })}
      >
        <option value="64">64 kbps (Voice / Low)</option>
        <option value="96">96 kbps (Speech)</option>
        <option value="128">128 kbps (Standard)</option>
        <option value="192">192 kbps (Recommended)</option>
        <option value="256">256 kbps (High quality)</option>
        <option value="320">320 kbps (Maximum)</option>
      </select>
    </div>

    <label class="cz-checkbox-label">
      <input
        type="checkbox"
        checked={state.stripMeta}
        onchange={(e) => updateStore({ stripMeta: (e.target as HTMLInputElement).checked })}
      />
      <span>Strip ID3 tags</span>
    </label>
  </div>

  <FileDropzone
    accept="audio/*"
    icon="🎵"
    title="Drop audio files here"
    subtitle="MP3, AAC, OGG, Opus, FLAC, WAV, M4A"
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
  .cz-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.86rem;
    color: var(--text-2);
    cursor: pointer;
  }
</style>
