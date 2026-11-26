<script lang="ts">
  import { onMount } from "svelte";
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { videoStore, type VideoState, consumeStagedUniversalFile, currentRoute } from "../store";
  import { compressVideo } from "../lib/compressVideo";
  import { videoOptions, videoQualityFromCrf, videoCrfFromQuality } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
import { entryError } from "../lib/engineError";
  import { uid, type FileEntry, type VideoCodec, outputFilename } from "../lib/types";
  import { downloadBatch, exceedsZipLimit } from "../lib/batchDownload";
  import { toast } from "../toast";

  let videoState = $state<VideoState>(videoStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = videoStore.subscribe((val) => {
      videoState = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<VideoState>) {
    videoStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(files: File[]) {
    const newEntries: FileEntry[] = files.map((file) => ({
      id: uid(),
      file,
      name: file.name,
      originalSize: file.size,
      status: "idle",
      type: "video",
    }));
    updateStore({ files: [...videoState.files, ...newEntries] });
  }

  function applyStagedFile() {
    const staged = consumeStagedUniversalFile("compress/video");
    if (staged?.file) {
      handleFilesAdded([staged.file]);
    }
  }

  onMount(() => {
    applyStagedFile();
  });

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      if (r === "compress/video") {
        applyStagedFile();
      }
    });
    return unsub;
  });

  async function compressSingle(entry: FileEntry) {
    if (entry.status === "compressing") return;

    videoStore.update((curr) => ({
      ...curr,
      files: curr.files.map((f) =>
        f.id === entry.id ? { ...f, status: "compressing", error: undefined } : f,
      ),
    }));

    try {
      const options = videoOptions(videoStore.get());
      const res = await runScheduled(
        { kind: "video", label: entry.name, bytes: entry.file.size },
        () => compressVideo(entry.file, options),
      );

      videoStore.update((curr) => ({
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
      console.error("[videoCompress] error:", err);
      const failure = entryError(err, "Video compression failed");
      videoStore.update((curr) => ({
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
      const idleEntries = videoStore
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
      fallbackExt: videoState.codec.includes("vp") ? "webm" : "mp4",
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleDownloadAll() {
    const doneEntries = videoState.files.filter((f) => f.status === "done" && f.compressedBlob);
    const items = doneEntries.map((entry) => ({
      name: outputFilename(entry.name, entry.compressedBlob!, {
        suffix: "-compressed",
        fallbackExt: videoState.codec.includes("vp") ? "webm" : "mp4",
      }),
      blob: entry.compressedBlob!,
    }));
    if (exceedsZipLimit(items.map((it) => ({ name: it.name, size: it.blob.size })))) {
      toast("Batch exceeds 4 GiB ZIP limit; downloading files individually", "info");
    }
    await downloadBatch(items, "video-compressed.zip");
  }

  function handleRemove(id: string) {
    updateStore({ files: videoState.files.filter((f) => f.id !== id) });
  }

  function handleClear() {
    updateStore({ files: [] });
  }
</script>

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">Video Compressor</h1>
    <p class="cz-tool-desc">
      Browser-native video compression via WebCodecs + Mediabunny with seamless FFmpeg.wasm fallback.
      Processes entirely within this browser tab.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="vid-codec">Codec</label>
      <select
        id="vid-codec"
        class="cz-select"
        value={videoState.codec}
        onchange={(e) => updateStore({ codec: (e.target as HTMLSelectElement).value as VideoCodec })}
      >
        <option value="h264">H.264 (MP4, Universal)</option>
        <option value="h265">H.265 / HEVC (MP4, High efficiency)</option>
        <option value="vp9">VP9 (WebM)</option>
        <option value="av1">AV1 (MP4, Next-gen)</option>
      </select>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="vid-crf">CRF ({videoCrfFromQuality(videoState.crfQuality)})</label>
      <input
        id="vid-crf"
        type="range"
        min="16"
        max="38"
        value={videoCrfFromQuality(videoState.crfQuality)}
        class="cz-range"
        oninput={(e) => updateStore({ crfQuality: videoQualityFromCrf(Number((e.target as HTMLInputElement).value)) })}
      />
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="vid-preset">Speed</label>
      <select
        id="vid-preset"
        class="cz-select"
        value={videoState.preset}
        onchange={(e) => updateStore({ preset: (e.target as HTMLSelectElement).value as any })}
      >
        <option value="ultrafast">Ultrafast</option>
        <option value="fast">Fast (Recommended)</option>
        <option value="medium">Medium</option>
        <option value="slow">Slow</option>
      </select>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="vid-res">Resolution</label>
      <select
        id="vid-res"
        class="cz-select"
        value={videoState.maxWidth}
        onchange={(e) => updateStore({ maxWidth: Number((e.target as HTMLSelectElement).value) })}
      >
        <option value="0">Original (No downscale)</option>
        <option value="1920">1080p (Max 1920px)</option>
        <option value="1280">720p (Max 1280px)</option>
        <option value="854">480p (Max 854px)</option>
      </select>
    </div>
  </div>

  <FileDropzone
    accept="video/*"
    icon="🎬"
    title="Drop video files here"
    subtitle="MP4, WebM, MOV, MKV, AVI"
    hasFiles={videoState.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if videoState.files.length > 0}
    <FileQueue
      files={videoState.files}
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
</style>
