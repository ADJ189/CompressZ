<script lang="ts">
  import { onMount } from "svelte";
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { imageStore, type ImageState, consumeStagedUniversalFile, currentRoute } from "../store";
  import { compressImage } from "../lib/compressImage";
  import { imageOptions } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
import { entryError } from "../lib/engineError";
  import { uid, type FileEntry, type ImageFormat, formatBytes, outputFilename } from "../lib/types";
  import { downloadBatch } from "../lib/batchDownload";
  import { toast } from "../toast";
  import {
    recommendFor,
    dismissRecommendation,
    naturalOrder,
    type Recommendation,
  } from "../lib/recommendations";
  import {
    smartAnalyze,
    sortByPredictedLabel,
    getAiRuntimeInfo,
    type AiModelTier,
  } from "../lib/aiEngine";
  import { getPlatformInfo } from "../lib/platform";
  import { getSettings, resolvedConcurrency, updateSettings } from "../lib/settings";
  import MacIcon from "../components/MacIcon.svelte";
  import WarningBanner from "../components/WarningBanner.svelte";
  import type { EngineWarning } from "../lib/types";

  let imageState = $state<ImageState>(imageStore.get());
  let isBusy = $state(false);
  let isAiSorting = $state(false);
  let dismissTrigger = $state(0);
  let aiWarnings = $state<EngineWarning[]>([]);
  const queueWarnings = $derived([
    ...aiWarnings,
    ...imageState.files.flatMap((f) => f.warnings ?? []),
  ]);

  const platform = $derived(getPlatformInfo());
  let settings = $state(getSettings());

  $effect(() => {
    const unsub = imageStore.subscribe((val) => {
      imageState = val;
    });
    return unsub;
  });

  const recommendations = $derived.by(() => {
    void dismissTrigger;
    return recommendFor({
      scope: "images",
      files: imageState.files.map((f) => ({ name: f.name, size: f.originalSize })),
      imageFormat: imageState.format,
      imageQuality: imageState.quality,
    });
  });

  const activeRec = $derived(recommendations.length > 0 ? recommendations[0] : null);

  function applyRecommendation(rec: Recommendation) {
    if (rec.action.type === "reorder") {
      const prevFiles = [...imageState.files];
      const sorted = rec.action.order.map((i) => prevFiles[i]);
      updateStore({ files: sorted });
      toast("Sorted files by natural filename", "success", {
        label: "Undo",
        onClick: () => {
          updateStore({ files: prevFiles });
          dismissTrigger++;
        },
      });
    } else if (rec.action.type === "image-format") {
      const prevFormat = imageState.format;
      const prevQuality = imageState.quality;
      updateStore({ format: rec.action.format, quality: rec.action.quality });
      toast(`Switched format to ${rec.action.format}`, "success", {
        label: "Undo",
        onClick: () => {
          updateStore({ format: prevFormat, quality: prevQuality });
          dismissTrigger++;
        },
      });
    }
  }

  function dismiss(rec: Recommendation) {
    dismissRecommendation(rec);
    dismissTrigger++;
  }

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
    updateStore({ files: [...imageState.files, ...newEntries] });
  }

  function applyStagedFile() {
    const staged = consumeStagedUniversalFile("compress/images");
    if (staged?.file) {
      handleFilesAdded([staged.file]);
    }
  }

  onMount(() => {
    applyStagedFile();
  });

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      if (r === "compress/images") {
        applyStagedFile();
      }
    });
    return unsub;
  });

  /** Quick Natural Sort action */
  function handleNaturalSort() {
    if (imageState.files.length < 2) return;
    const names = imageState.files.map((f) => f.name);
    const indices = naturalOrder(names);
    const prev = [...imageState.files];
    const sorted = indices.map((i) => prev[i]);
    updateStore({ files: sorted });
    toast("Reordered files by numeric sequence", "success");
  }

  /** Quick AI Smart Sort action */
  async function handleAiSmartSort() {
    if (imageState.files.length < 2) return;
    isAiSorting = true;
    toast("Organizing files with on-device AI...");
    try {
      const rawFiles = imageState.files.map((f) => f.file);
      const tier: AiModelTier = (settings.ai?.modelTier as AiModelTier) ?? "efficient";
      const analyses = await smartAnalyze(rawFiles, tier);
      const aiWarn = getAiRuntimeInfo()?.lastFallbackWarning;
      aiWarnings = aiWarn ? [aiWarn] : [];
      const sortedFiles = sortByPredictedLabel(rawFiles, analyses);
      const fileMap = new Map(imageState.files.map((f) => [f.file, f]));
      const sortedEntries = sortedFiles.map((f) => fileMap.get(f)!).filter(Boolean);
      updateStore({ files: sortedEntries });
      toast(
        aiWarn
          ? "Organized files using CPU/WASM fallback (WebGPU unavailable)"
          : "Organized files by predicted content label",
        aiWarn ? "warn" : "success",
      );
    } catch (err) {
      console.warn("[aiSmartSort] fallback:", err);
      handleNaturalSort();
    } finally {
      isAiSorting = false;
    }
  }

  function handleAiTierChange(tier: "efficient" | "powerful") {
    updateSettings((s) => {
      s.ai.modelTier = tier;
    });
    settings = getSettings();
    toast(`AI model set to ${tier}`, "success");
  }

  async function compressSingle(entry: FileEntry, notify = true): Promise<boolean> {
    if (entry.status === "compressing") return false;

    imageStore.update((curr) => ({
      ...curr,
      files: curr.files.map((f) =>
        f.id === entry.id
          ? { ...f, status: "compressing", error: undefined, warnings: undefined }
          : f,
      ),
    }));

    try {
      const options = imageOptions(imageStore.get());
      const res = await runScheduled(
        { kind: "image", label: entry.name, bytes: entry.file.size },
        () => compressImage(entry.file, options),
      );

      imageStore.update((curr) => ({
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
          toast(`Compressed ${entry.name} with fallback/quality notices`, "warn");
        } else {
          toast(`Compressed ${entry.name}`, "success");
        }
      }
      return true;
    } catch (err) {
      console.error("[imageCompress] error:", err);
      const failure = entryError(err, "Compression failed");
      imageStore.update((curr) => ({
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
      const idleEntries = imageStore
        .get()
        .files.filter((f) => f.status === "idle" || f.status === "error");
      for (const entry of idleEntries) {
        if (await compressSingle(entry, false)) ok++;
        else fail++;
      }
      const hasWarnings = imageStore
        .get()
        .files.some((f) => f.warnings && f.warnings.length > 0);
      if (ok > 0 && fail === 0) {
        toast(
          hasWarnings
            ? `Compressed ${ok} ${ok === 1 ? "image" : "images"} with fallback/quality notices`
            : `Compressed ${ok} ${ok === 1 ? "image" : "images"}`,
          hasWarnings ? "warn" : "success",
        );
      } else if (ok > 0 && fail > 0) {
        toast(`Compressed ${ok} ${ok === 1 ? "image" : "images"} (${fail} failed)`, "warn");
      } else if (fail > 0) {
        toast(`${fail} ${fail === 1 ? "image" : "images"} failed to compress`, "error");
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
      fallbackExt: "webp",
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleDownloadAll() {
    const doneEntries = imageState.files.filter((f) => f.status === "done" && f.compressedBlob);
    const items = doneEntries.map((entry) => ({
      name: outputFilename(entry.name, entry.compressedBlob!, {
        suffix: "-compressed",
        fallbackExt: "webp",
      }),
      blob: entry.compressedBlob!,
    }));
    await downloadBatch(items, "images-compressed.zip");
  }

  function handleRemove(id: string) {
    updateStore({ files: imageState.files.filter((f) => f.id !== id) });
  }

  function handleClear() {
    aiWarnings = [];
    updateStore({ files: [] });
  }
</script>

<div class="tool-wrap cz-apple-workbench">
  <!-- Left Main Column: Conversion Workspace -->
  <main class="cz-card-main">
    <div class="cz-main-header">
      <div>
        <h1 class="cz-main-title">Image Compression & Conversion</h1>
        <p class="cz-main-sub">SSIM-guarded high-efficiency image encoding</p>
      </div>

      <!-- Quick Fast Organize Actions (Side Options, not a whole rectangular promo box) -->
      {#if imageState.files.length > 1}
        <div class="cz-organize-bar">
          <button
            type="button"
            class="cz-segmented-item"
            title="Sort naturally by number sequence"
            onclick={handleNaturalSort}
          >
            <MacIcon name="shuffle" size={13} />
            <span>Reorder</span>
          </button>
          <button
            type="button"
            class="cz-segmented-item"
            title="Fast auto-organize by predicted AI label"
            disabled={isAiSorting}
            onclick={handleAiSmartSort}
          >
            {#if isAiSorting}
              <span>⏳ Organizing…</span>
            {:else}
              <MacIcon name="zap" size={13} />
              <span>AI Smart Sort</span>
            {/if}
          </button>
        </div>
      {/if}
    </div>

    <!-- Compact Apple-Style Options Bar -->
    <div class="cz-options-pill-bar">
      <!-- Format Segmented Control -->
      <div class="cz-opt-group">
        <span class="cz-opt-label">Format</span>
        <div class="cz-segmented-track">
          <button
            type="button"
            class="cz-segmented-item {imageState.format === 'image/webp' ? 'is-active' : ''}"
            onclick={() => updateStore({ format: 'image/webp' })}
          >
            WebP
          </button>
          <button
            type="button"
            class="cz-segmented-item {imageState.format === 'image/avif' ? 'is-active' : ''}"
            onclick={() => updateStore({ format: 'image/avif' })}
          >
            AVIF
          </button>
          <button
            type="button"
            class="cz-segmented-item {imageState.format === 'image/jpeg' ? 'is-active' : ''}"
            onclick={() => updateStore({ format: 'image/jpeg' })}
          >
            JPEG
          </button>
          <button
            type="button"
            class="cz-segmented-item {imageState.format === 'image/png' ? 'is-active' : ''}"
            onclick={() => updateStore({ format: 'image/png' })}
          >
            PNG
          </button>
        </div>
        <select
          id="fmt-sel"
          class="cz-select-pill cz-select-pill-format"
          value={imageState.format}
          onchange={(e) => updateStore({ format: (e.target as HTMLSelectElement).value as any })}
          aria-label="Format selection"
        >
          <option value="image/webp">WebP</option>
          <option value="image/avif">AVIF</option>
          <option value="image/jpeg">JPEG</option>
          <option value="image/png">PNG</option>
        </select>
      </div>

      <div class="cz-opt-divider"></div>

      <!-- Quality Slider -->
      <div class="cz-opt-group">
        <span class="cz-opt-label">Quality</span>
        <span class="cz-quality-badge">{imageState.quality}%</span>
        <input
          id="img-q"
          type="range"
          min="20"
          max="100"
          value={imageState.quality}
          class="cz-range-slider"
          oninput={(e) => updateStore({ quality: Number((e.target as HTMLInputElement).value) })}
        />
      </div>

      <div class="cz-opt-divider"></div>

      <!-- Dimension ceiling -->
      <div class="cz-opt-group">
        <span class="cz-opt-label">Max Dim</span>
        <select
          id="img-dim"
          class="cz-select-pill"
          aria-label="Max dimension ceiling"
          value={String(imageState.maxDim)}
          onchange={(e) => updateStore({ maxDim: Number((e.target as HTMLSelectElement).value) })}
        >
          <option value="0">Uncapped</option>
          <option value="3840">Cap 4K (3840px)</option>
          <option value="1920">Cap Full HD (1920px)</option>
          <option value="1280">Cap HD (1280px)</option>
        </select>
      </div>
    </div>

    <!-- Contextual Recommendation Banner -->
    <div id="rec-mount">
      {#if activeRec}
        <div class="cz-recommendation cz-rec-card">
          <div class="cz-recommendation--primary">
            <div class="cz-recommendation__row cz-rec-text">
              <span class="cz-recommendation__title cz-rec-icon">{activeRec.title}</span>
              <span class="cz-recommendation__reason">{activeRec.reason}</span>
            </div>
            <div class="cz-recommendation__actions cz-rec-btns">
              <button
                type="button"
                class="cz-btn cz-btn-primary cz-btn-sm cz-btn-pill"
                onclick={() => applyRecommendation(activeRec)}
              >
                {activeRec.actionLabel}
              </button>
              <button
                type="button"
                class="cz-btn cz-btn-ghost cz-btn-sm"
                onclick={() => dismiss(activeRec)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Ingestion Dropzone -->
    <FileDropzone
      accept="image/*,.heic,.heif"
      icon="🖼️"
      title="Click or drag image files here"
      subtitle="Supports PNG, JPG, WebP, HEIC/HEIF, AVIF"
      hasFiles={imageState.files.length > 0}
      onFiles={handleFilesAdded}
    />

    <WarningBanner warnings={queueWarnings} />

    <!-- Inset File Queue Table -->
    {#if imageState.files.length > 0}
      <FileQueue
        files={imageState.files}
        {isBusy}
        onCompressAll={handleCompressAll}
        onDownloadAll={handleDownloadAll}
        onClear={handleClear}
        onCompressSingle={compressSingle}
        onDownloadSingle={handleDownloadSingle}
        onRemoveSingle={handleRemove}
      />
    {/if}
  </main>

  <!-- Right Sidebar: System Profile & History (Matching Image 2) -->
  <aside class="cz-card-side">
    <!-- Fast AI Settings Card (Side Option, not a huge promo box) -->
    <div class="cz-sidebar-card">
      <div class="cz-sidebar-header">
        <span class="cz-sidebar-title">AI Model & Engine</span>
        <span class="cz-tier-tag">{platform?.tier ?? "balanced"}</span>
      </div>
      <div class="cz-sidebar-body">
        <div class="cz-segmented-track w-full" role="group" aria-label="Model tier selection">
          <button
            type="button"
            class="cz-segmented-item flex-1 {settings.ai?.modelTier !== 'powerful' ? 'is-active' : ''}"
            aria-pressed={settings.ai?.modelTier !== 'powerful'}
            onclick={() => handleAiTierChange('efficient')}
          >
            <MacIcon name="zap" size={13} />
            <span>Efficient</span>
          </button>
          <button
            type="button"
            class="cz-segmented-item flex-1 {settings.ai?.modelTier === 'powerful' ? 'is-active' : ''}"
            aria-pressed={settings.ai?.modelTier === 'powerful'}
            onclick={() => handleAiTierChange('powerful')}
          >
            <MacIcon name="cpu" size={13} />
            <span>Powerful</span>
          </button>
        </div>
        <div class="cz-sidebar-meta">
          <span>WebGL2: {platform?.webgl2 ? "Enabled" : "Off"}</span>
          <span>·</span>
          <span>Workers: {resolvedConcurrency(settings)}</span>
        </div>
      </div>
    </div>

    <!-- History Card (Matching Image 2) -->
    <div class="cz-sidebar-card">
      <div class="cz-sidebar-header">
        <span class="cz-sidebar-title">Recent Files</span>
      </div>
      <div class="cz-history-list">
        {#if imageState.files.filter(f => f.status === 'done').length > 0}
          {#each imageState.files.filter(f => f.status === 'done').slice(0, 4) as f}
            <div class="cz-history-item">
              <span class="cz-history-badge">IMG</span>
              <div class="cz-history-meta">
                <span class="cz-history-name" title={f.name}>{f.name}</span>
                <span class="cz-history-size">{formatBytes(f.compressedSize || f.originalSize)}</span>
              </div>
            </div>
          {/each}
        {:else}
          <div class="cz-history-empty">
            No completed files yet
          </div>
        {/if}
      </div>
    </div>
  </aside>
</div>

<style>
  .cz-main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .cz-main-title {
    font-family: var(--display);
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-main-sub {
    font-size: 0.8rem;
    color: var(--text-3);
  }
  .cz-organize-bar {
    display: inline-flex;
    align-items: center;
    background: var(--bg2);
    border-radius: 9999px;
    padding: 2px;
    gap: 2px;
  }
  .cz-options-pill-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface2);
  }
  .cz-opt-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }
  .cz-opt-label {
    font-weight: 500;
    color: var(--text-3);
  }
  .cz-quality-badge {
    font-family: var(--mono);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--accent);
    background: var(--green-soft);
    padding: 0.15rem 0.45rem;
    border-radius: 9999px;
  }
  .cz-range-slider {
    width: 90px;
    accent-color: var(--accent);
    height: 4px;
  }
  .cz-select-pill {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: 9999px;
    padding: 0.25rem 0.65rem;
    font-size: 0.78rem;
    font-family: inherit;
    outline: none;
    cursor: pointer;
    transition: border-color var(--t);
  }
  .cz-select-pill:focus {
    border-color: var(--accent);
  }
  .cz-select-pill-format {
    display: inline-block;
  }
  .cz-opt-divider {
    width: 1px;
    height: 16px;
    background: var(--border);
  }
  .cz-rec-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1rem;
    border-radius: var(--r);
    background: var(--accent-soft);
    border: 1px solid var(--green-border);
    font-size: 0.8rem;
  }
  .cz-rec-text {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--accent);
    font-weight: 500;
  }
  .cz-rec-btns {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .cz-btn-pill {
    border-radius: 9999px;
  }
  .cz-sidebar-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .cz-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cz-sidebar-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-tier-tag {
    font-size: 0.68rem;
    text-transform: uppercase;
    font-weight: 700;
    font-family: var(--mono);
    padding: 0.1rem 0.4rem;
    border-radius: 9999px;
    background: var(--green-soft);
    color: var(--accent);
  }
  .cz-sidebar-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cz-sidebar-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: var(--text-3);
    font-family: var(--mono);
  }
  .cz-history-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cz-history-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border);
  }
  .cz-history-item:last-child {
    border-bottom: none;
  }
  .cz-history-badge {
    width: 26px;
    height: 26px;
    border-radius: var(--r-xs);
    background: var(--accent-soft);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.64rem;
    font-weight: 700;
    font-family: var(--mono);
  }
  .cz-history-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cz-history-name {
    font-size: 0.76rem;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cz-history-size {
    font-size: 0.7rem;
    color: var(--text-3);
    font-family: var(--mono);
  }
  .cz-history-empty {
    font-size: 0.78rem;
    color: var(--text-3);
    padding: 0.5rem 0;
  }
  .cz-apple-workbench {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 310px;
    gap: 1.5rem;
    align-items: start;
  }
  .cz-card-main {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }
  .cz-card-side {
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
    min-width: 0;
  }
  .cz-segmented-track {
    display: inline-flex;
    align-items: center;
    background: var(--bg2);
    padding: 3px;
    border-radius: 100px;
    border: 1px solid var(--border);
    gap: 2px;
  }
  .cz-segmented-item {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    border-radius: 100px;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-2);
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background var(--t), color var(--t);
    white-space: nowrap;
  }
  .cz-segmented-item:hover {
    color: var(--text);
  }
  .cz-segmented-item.is-active {
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
  @media (max-width: 960px) {
    .cz-apple-workbench {
      grid-template-columns: 1fr;
      padding: 1rem 0.85rem 2.5rem;
    }
  }

  @media (max-width: 640px) {
    .cz-main-title {
      font-size: 1.2rem;
    }
    .cz-options-pill-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
      padding: 0.75rem;
    }
    .cz-opt-group {
      width: 100%;
      flex-wrap: wrap;
    }
    .cz-opt-divider {
      display: none;
    }
    .cz-segmented-track {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      border-radius: var(--r-sm);
    }
    .cz-segmented-item {
      flex: 1 1 60px;
      min-height: 36px;
      justify-content: center;
      text-align: center;
      padding: 0.32rem 0.45rem;
    }
    .cz-range-slider {
      flex: 1;
      min-width: 0;
    }
    .cz-select-pill {
      flex: 1;
      min-width: 0;
      min-height: 36px;
      font-size: 0.85rem;
    }
  }
</style>
