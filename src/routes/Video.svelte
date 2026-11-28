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
  import WarningBanner from "../components/WarningBanner.svelte";

  let videoState = $state<VideoState>(videoStore.get());
  let isBusy = $state(false);
  const queueWarnings = $derived(videoState.files.flatMap((f) => f.warnings ?? []));

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

  async function compressSingle(entry: FileEntry, notify = true): Promise<boolean> {
    if (entry.status === "compressing") return false;

    videoStore.update((curr) => ({
      ...curr,
      files: curr.files.map((f) =>
        f.id === entry.id
          ? { ...f, status: "compressing", error: undefined, warnings: undefined }
          : f,
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
                warnings: res.warnings,
              }
            : f,
        ),
      }));
      if (notify) {
        if (res.warnings && res.warnings.length > 0) {
          toast(`Compressed ${entry.name} with engine fallback notices`, "warn");
        } else {
          toast(`Compressed ${entry.name}`, "success");
        }
      }
      return true;
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
      const idleEntries = videoStore
        .get()
        .files.filter((f) => f.status === "idle" || f.status === "error");
      for (const entry of idleEntries) {
        if (await compressSingle(entry, false)) ok++;
        else fail++;
      }
      const hasWarnings = videoStore
        .get()
        .files.some((f) => f.warnings && f.warnings.length > 0);
      if (ok > 0 && fail === 0) {
        toast(
          hasWarnings
            ? `Compressed ${ok} ${ok === 1 ? "video" : "videos"} with engine fallback notices`
            : `Compressed ${ok} ${ok === 1 ? "video" : "videos"}`,
          hasWarnings ? "warn" : "success",
        );
      } else if (ok > 0 && fail > 0) {
        toast(`Compressed ${ok} ${ok === 1 ? "video" : "videos"} (${fail} failed)`, "warn");
      } else if (fail > 0) {
        toast(`${fail} ${fail === 1 ? "video" : "videos"} failed to compress`, "error");
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

  <WarningBanner warnings={queueWarnings} />

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
    .cz-select,
    .cz-range {
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }
    .cz-select {
      min-height: 40px;
      font-size: 16px;
    }
  }
</style>
