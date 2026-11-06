<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { videoStore, type VideoState } from "../store";
  import { compressVideo } from "../lib/compressVideo";
  import { uid, type FileEntry, type VideoCodec } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<VideoState>(videoStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = videoStore.subscribe((val) => {
      state = val;
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
      const res = await compressVideo(entry.file, {
        codec: state.codec,
        preset: state.preset,
        crf: state.crfQuality,
        bitrate: state.mode === "bitrate" ? state.bitrate : undefined,
        maxWidth: state.maxWidth > 0 ? state.maxWidth : undefined,
        fps: state.fps > 0 ? state.fps : undefined,
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
      console.error("[videoCompress] error:", err);
      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "error",
                error: (err as Error).message || "Video compression failed",
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
    const ext = state.codec.includes("vp") ? "webm" : "mp4";
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
    <h1 class="cz-tool-title">Video Compressor</h1>
    <p class="cz-tool-desc">
      Hardware accelerated video compression via WebCodecs with seamless FFmpeg.wasm fallback.
      Processes entirely within this browser tab.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="vid-codec">Codec</label>
      <select
        id="vid-codec"
        class="cz-select"
        value={state.codec}
        onchange={(e) => updateStore({ codec: (e.target as HTMLSelectElement).value as VideoCodec })}
      >
        <option value="h264">H.264 (MP4, Universal)</option>
        <option value="hevc">H.265 / HEVC (MP4, High efficiency)</option>
        <option value="vp9">VP9 (WebM)</option>
        <option value="av1">AV1 (MP4, Next-gen)</option>
      </select>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="vid-crf">CRF ({state.crfQuality})</label>
      <input
        id="vid-crf"
        type="range"
        min="16"
        max="38"
        value={state.crfQuality}
        class="cz-range"
        oninput={(e) => updateStore({ crfQuality: Number((e.target as HTMLInputElement).value) })}
      />
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="vid-preset">Speed</label>
      <select
        id="vid-preset"
        class="cz-select"
        value={state.preset}
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
        value={state.maxWidth}
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
</style>
