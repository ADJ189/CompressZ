<script lang="ts">
  import { onMount } from "svelte";
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { pdfStore, type PdfState, consumeStagedUniversalFile, currentRoute } from "../store";
  import { compressPdf } from "../lib/compressPdf";
  import { pdfOptions } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
import { entryError } from "../lib/engineError";
  import { uid, type FileEntry, type PdfLevel, outputFilename } from "../lib/types";
  import { downloadBatch } from "../lib/batchDownload";
  import { toast } from "../toast";
  import WarningBanner from "../components/WarningBanner.svelte";

  let pdfState = $state<PdfState>(pdfStore.get());
  let isBusy = $state(false);
  const queueWarnings = $derived(pdfState.files.flatMap((f) => f.warnings ?? []));

  $effect(() => {
    const unsub = pdfStore.subscribe((val) => {
      pdfState = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<PdfState>) {
    pdfStore.update((curr) => ({ ...curr, ...patch }));
  }

  function handleFilesAdded(files: File[]) {
    const newEntries: FileEntry[] = files.map((file) => ({
      id: uid(),
      file,
      name: file.name,
      originalSize: file.size,
      status: "idle",
      type: "pdf",
    }));
    updateStore({ files: [...pdfState.files, ...newEntries] });
  }

  function applyStagedFile() {
    const staged = consumeStagedUniversalFile("compress/pdf");
    if (staged?.file) {
      handleFilesAdded([staged.file]);
    }
  }

  onMount(() => {
    applyStagedFile();
  });

  $effect(() => {
    const unsub = currentRoute.subscribe((r) => {
      if (r === "compress/pdf") {
        applyStagedFile();
      }
    });
    return unsub;
  });

  async function compressSingle(entry: FileEntry, notify = true): Promise<boolean> {
    if (entry.status === "compressing") return false;

    pdfStore.update((curr) => ({
      ...curr,
      files: curr.files.map((f) =>
        f.id === entry.id
          ? { ...f, status: "compressing", error: undefined, warnings: undefined }
          : f,
      ),
    }));

    try {
      const options = pdfOptions(pdfStore.get());
      const res = await runScheduled(
        { kind: "pdf", label: entry.name, bytes: entry.file.size },
        () => compressPdf(entry.file, options),
      );

      pdfStore.update((curr) => ({
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
          toast(`Compressed ${entry.name} with fallback notices`, "warn");
        } else {
          toast(`Compressed ${entry.name}`, "success");
        }
      }
      return true;
    } catch (err) {
      console.error("[pdfCompress] error:", err);
      const failure = entryError(err, "PDF compression failed");
      pdfStore.update((curr) => ({
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
      const idleEntries = pdfStore
        .get()
        .files.filter((f) => f.status === "idle" || f.status === "error");
      for (const entry of idleEntries) {
        if (await compressSingle(entry, false)) ok++;
        else fail++;
      }
      const hasWarnings = pdfStore
        .get()
        .files.some((f) => f.warnings && f.warnings.length > 0);
      if (ok > 0 && fail === 0) {
        toast(
          hasWarnings
            ? `Compressed ${ok} ${ok === 1 ? "PDF" : "PDFs"} with fallback notices`
            : `Compressed ${ok} ${ok === 1 ? "PDF" : "PDFs"}`,
          hasWarnings ? "warn" : "success",
        );
      } else if (ok > 0 && fail > 0) {
        toast(`Compressed ${ok} ${ok === 1 ? "PDF" : "PDFs"} (${fail} failed)`, "warn");
      } else if (fail > 0) {
        toast(`${fail} ${fail === 1 ? "PDF" : "PDFs"} failed to compress`, "error");
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
      fallbackExt: "pdf",
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleDownloadAll() {
    const doneEntries = pdfState.files.filter((f) => f.status === "done" && f.compressedBlob);
    const items = doneEntries.map((entry) => ({
      name: outputFilename(entry.name, entry.compressedBlob!, {
        suffix: "-compressed",
        fallbackExt: "pdf",
      }),
      blob: entry.compressedBlob!,
    }));
    await downloadBatch(items, "pdf-compressed.zip");
  }

  function handleRemove(id: string) {
    updateStore({ files: pdfState.files.filter((f) => f.id !== id) });
  }

  function handleClear() {
    updateStore({ files: [] });
  }
</script>

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">PDF Compressor</h1>
    <p class="cz-tool-desc">
      Shrink PDF file sizes locally. Structural XObject image compression leaves text and vector
      drawings untouched.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <span class="cz-setting-label">Compression Level</span>
      <div class="cz-segmented-track" role="radiogroup" aria-label="PDF Compression Level">
        <button
          type="button"
          class="cz-segmented-item {pdfState.level === 'low' ? 'is-active' : ''}"
          onclick={() => updateStore({ level: 'low' })}
        >
          Low (220 DPI)
        </button>
        <button
          type="button"
          class="cz-segmented-item {pdfState.level === 'recommended' ? 'is-active' : ''}"
          onclick={() => updateStore({ level: 'recommended' })}
        >
          Balanced (150 DPI)
        </button>
        <button
          type="button"
          class="cz-segmented-item {pdfState.level === 'extreme' ? 'is-active' : ''}"
          onclick={() => updateStore({ level: 'extreme' })}
        >
          Extreme (96 DPI)
        </button>
      </div>
    </div>

    <div class="cz-setting-item">
      <span class="cz-setting-label">Metadata</span>
      <div class="cz-segmented-track" role="radiogroup" aria-label="PDF Metadata">
        <button
          type="button"
          class="cz-segmented-item {pdfState.stripMeta === 'auto' ? 'is-active' : ''}"
          onclick={() => updateStore({ stripMeta: 'auto' })}
        >
          Auto
        </button>
        <button
          type="button"
          class="cz-segmented-item {pdfState.stripMeta === 'on' ? 'is-active' : ''}"
          onclick={() => updateStore({ stripMeta: 'on' })}
        >
          Strip Privacy Tags
        </button>
        <button
          type="button"
          class="cz-segmented-item {pdfState.stripMeta === 'off' ? 'is-active' : ''}"
          onclick={() => updateStore({ stripMeta: 'off' })}
        >
          Preserve
        </button>
      </div>
    </div>
  </div>

  <FileDropzone
    accept="application/pdf,.pdf"
    icon="📄"
    title="Drop PDF documents here"
    subtitle="Single or multi-page documents"
    hasFiles={pdfState.files.length > 0}
    onFiles={handleFilesAdded}
  />

  <WarningBanner warnings={queueWarnings} />

  {#if pdfState.files.length > 0}
    <FileQueue
      files={pdfState.files}
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
    padding: 0.32rem 0.75rem;
    border-radius: 100px;
    font-size: 0.78rem;
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
      gap: 0.9rem;
      padding: 0.85rem;
    }
    .cz-setting-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
      width: 100%;
    }
    .cz-segmented-track {
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      border-radius: var(--r-sm);
    }
    .cz-segmented-item {
      flex: 1 1 84px;
      min-height: 36px;
      justify-content: center;
      text-align: center;
      white-space: normal;
      line-height: 1.2;
      padding: 0.35rem 0.45rem;
      font-size: 0.74rem;
    }
  }
</style>
