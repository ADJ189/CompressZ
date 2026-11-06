<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { pdfStore, type PdfState } from "../store";
  import { compressPdf } from "../lib/compressPdf";
  import { uid, type FileEntry, type PdfLevel } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<PdfState>(pdfStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = pdfStore.subscribe((val) => {
      state = val;
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
      const res = await compressPdf(entry.file, {
        level: state.level,
        stripMeta: state.stripMeta === "on",
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
      console.error("[pdfCompress] error:", err);
      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "error",
                error: (err as Error).message || "PDF compression failed",
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
    const base = entry.name.replace(/\.[^/.]+$/, "");
    a.href = url;
    a.download = `${base}-compressed.pdf`;
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
    <h1 class="cz-tool-title">PDF Compressor</h1>
    <p class="cz-tool-desc">
      Shrink PDF file sizes locally. Structural XObject image compression leaves text and vector
      drawings untouched.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="pdf-level">Compression Level</label>
      <select
        id="pdf-level"
        class="cz-select"
        value={state.level}
        onchange={(e) => updateStore({ level: (e.target as HTMLSelectElement).value as PdfLevel })}
      >
        <option value="low">Low (220 DPI, High quality)</option>
        <option value="recommended">Recommended (150 DPI, Balanced)</option>
        <option value="extreme">Extreme (96 DPI, Maximum compression)</option>
      </select>
    </div>

    <div class="cz-setting-item">
      <label class="cz-setting-label" for="pdf-meta">Metadata</label>
      <select
        id="pdf-meta"
        class="cz-select"
        value={state.stripMeta}
        onchange={(e) => updateStore({ stripMeta: (e.target as HTMLSelectElement).value as any })}
      >
        <option value="auto">Auto</option>
        <option value="on">Strip metadata</option>
        <option value="off">Keep metadata</option>
      </select>
    </div>
  </div>

  <FileDropzone
    accept="application/pdf,.pdf"
    icon="📄"
    title="Drop PDF documents here"
    subtitle="Single or multi-page documents"
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
</style>
