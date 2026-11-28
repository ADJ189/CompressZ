<script lang="ts">
  import { onMount } from "svelte";
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { audioStore, type AudioState, consumeStagedUniversalFile, currentRoute } from "../store";
  import { compressAudio } from "../lib/compressAudio";
  import { audioOptions } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
import { entryError } from "../lib/engineError";
  import { uid, type FileEntry, type AudioFormat, outputFilename } from "../lib/types";
  import { downloadBatch } from "../lib/batchDownload";
  import { toast } from "../toast";

  let audioState = $state<AudioState>(audioStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = audioStore.subscribe((val) => {
      audioState = val;
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
    updateStore({ files: [...audioState.files, ...newEntries] });
  }

  function applyStagedFile() {
    const staged = consumeStagedUniversalFile("compress/audio");
    if (staged?.file) {
      handleFilesAdded([staged.file]);
    }
  }

  onMount(() => {
    applyStagedFile();
  });

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      if (r === "compress/audio") {
        applyStagedFile();
      }
    });
    return unsub;
  });

  async function compressSingle(entry: FileEntry, notify = true): Promise<boolean> {
    if (entry.status === "compressing") return false;

    audioStore.update((curr) => ({
      ...curr,
      files: curr.files.map((f) =>
        f.id === entry.id ? { ...f, status: "compressing", error: undefined } : f,
      ),
    }));

    try {
      const options = audioOptions(audioStore.get());
      const res = await runScheduled(
        { kind: "audio", label: entry.name, bytes: entry.file.size },
        () => compressAudio(entry.file, options),
      );

      audioStore.update((curr) => ({
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
      if (notify) toast(`Compressed ${entry.name}`, "success");
      return true;
    } catch (err) {
      console.error("[audioCompress] error:", err);
      const failure = entryError(err, "Audio compression failed");
      audioStore.update((curr) => ({
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
      if (notify) {
        toast(`${entry.name}: ${failure.error}`, "error", undefined, {
          log: failure.errorLog,
        });
      }
      return false;
    }
  }

  async function handleCompressAll() {
    isBusy = true;
    let ok = 0;
    let fail = 0;
    try {
      const idleEntries = audioStore
        .get()
        .files.filter((f) => f.status === "idle" || f.status === "error");
      for (const entry of idleEntries) {
        if (await compressSingle(entry, false)) ok++;
        else fail++;
      }
      if (ok > 0 && fail === 0) {
        toast(`Compressed ${ok} audio ${ok === 1 ? "file" : "files"}`, "success");
      } else if (ok > 0 && fail > 0) {
        toast(`Compressed ${ok} audio ${ok === 1 ? "file" : "files"} (${fail} failed)`, "warn");
      } else if (fail > 0) {
        toast(`${fail} audio ${fail === 1 ? "file" : "files"} failed to compress`, "error");
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
      fallbackExt: audioState.fmt,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleDownloadAll() {
    const doneEntries = audioState.files.filter((f) => f.status === "done" && f.compressedBlob);
    const items = doneEntries.map((entry) => ({
      name: outputFilename(entry.name, entry.compressedBlob!, {
        suffix: "-compressed",
        fallbackExt: audioState.fmt,
      }),
      blob: entry.compressedBlob!,
    }));
    await downloadBatch(items, "audio-compressed.zip");
  }

  function handleRemove(id: string) {
    updateStore({ files: audioState.files.filter((f) => f.id !== id) });
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
        value={audioState.fmt}
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
        value={audioState.bitrate}
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
        checked={audioState.stripMeta}
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
    hasFiles={audioState.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if audioState.files.length > 0}
    <FileQueue
      files={audioState.files}
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
    .cz-select {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      min-height: 40px;
      font-size: 16px;
    }
  }
</style>
