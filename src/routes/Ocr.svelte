<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { ocrStore, type OcrState } from "../store";
  import {
    runPrintedOcr,
    type OcrLanguage,
    type OcrEngine,
    type OcrProfile,
  } from "../lib/ocrEngines";
  import { runHandwritingOcr } from "../lib/ocrHandwriting";
  import { openPdfDocument, PDFLIB_ESM } from "../lib/pdfLibs";
  import { runScheduled } from "../lib/resourceManager";
  import { uid, type FileEntry } from "../lib/types";
  import { toast } from "../toast";

  let state = $state<OcrState>(ocrStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = ocrStore.subscribe((val) => {
      state = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<OcrState>) {
    ocrStore.update((curr) => ({ ...curr, ...patch }));
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

  async function processOcrSingle(entry: FileEntry) {
    if (entry.status === "compressing") return;

    updateStore({
      files: state.files.map((f) =>
        f.id === entry.id ? { ...f, status: "compressing", error: undefined } : f,
      ),
    });

    try {
      const outBlob = await runScheduled(
        { kind: "ocr", label: entry.name, bytes: entry.file.size },
        async () => {
          const pdfBytes = new Uint8Array(await entry.file.arrayBuffer());
          const pdfDoc = await openPdfDocument(pdfBytes);
          const numPages = pdfDoc.numPages;

          let combinedText = "";

          // Sequential single-page processing
          for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: state.renderDpi / 72 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d");

            if (ctx) {
              await page.render({ canvasContext: ctx, viewport }).promise;
            }

            if (state.profile === "handwriting") {
              const res = await runHandwritingOcr(canvas);
              combinedText += `\n--- Page ${pageNum} ---\n` + res.text;
            } else {
              const res = await runPrintedOcr(canvas, {
                language: state.language,
                symbolMode: state.symbolMode,
              });
              combinedText += `\n--- Page ${pageNum} ---\n` + res.text;
            }

            canvas.width = 0;
            canvas.height = 0;
          }

          await pdfDoc.destroy();
          return new Blob([combinedText.trim()], {
            type: "text/plain;charset=utf-8",
          });
        },
      );

      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "done",
                compressedBlob: outBlob,
                compressedSize: outBlob.size,
              }
            : f,
        ),
      });
      toast(`OCR completed for ${entry.name}`, "success");
    } catch (err) {
      console.error("[ocrProcess] error:", err);
      updateStore({
        files: state.files.map((f) =>
          f.id === entry.id
            ? {
                ...f,
                status: "error",
                error: (err as Error).message || "OCR recognition failed",
              }
            : f,
        ),
      });
      toast(`OCR failed for ${entry.name}`, "error");
    }
  }

  async function handleProcessAll() {
    isBusy = true;
    const idleEntries = state.files.filter((f) => f.status === "idle" || f.status === "error");
    for (const entry of idleEntries) {
      await processOcrSingle(entry);
    }
    isBusy = false;
  }

  function handleDownloadSingle(entry: FileEntry) {
    if (!entry.compressedBlob) return;
    const url = URL.createObjectURL(entry.compressedBlob);
    const a = document.createElement("a");
    const base = entry.name.replace(/\.[^/.]+$/, "");
    a.href = url;
    a.download = `${base}-ocr.txt`;
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
    <h1 class="cz-tool-title">PDF OCR</h1>
    <p class="cz-tool-desc">
      Extract text from scanned PDF documents and images on-device. Choose between printed text
      recognition or dedicated English handwriting recognition.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="ocr-prof">Profile</label>
      <select
        id="ocr-prof"
        class="cz-select"
        value={state.profile}
        onchange={(e) => updateStore({ profile: (e.target as HTMLSelectElement).value as OcrProfile })}
      >
        <option value="printed">Printed Text (Tesseract.js)</option>
        <option value="handwriting">Handwriting (English, TrOCR)</option>
      </select>
    </div>

    {#if state.profile === "printed"}
      <div class="cz-setting-item">
        <label class="cz-setting-label" for="ocr-lang">Language</label>
        <select
          id="ocr-lang"
          class="cz-select"
          value={state.language}
          onchange={(e) => updateStore({ language: (e.target as HTMLSelectElement).value as OcrLanguage })}
        >
          <option value="auto">Auto / English</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="spa">Spanish</option>
          <option value="ita">Italian</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="jpn">Japanese</option>
          <option value="kor">Korean</option>
          <option value="hin">Hindi</option>
        </select>
      </div>

      <label class="cz-checkbox-label">
        <input
          type="checkbox"
          checked={state.symbolMode}
          onchange={(e) => updateStore({ symbolMode: (e.target as HTMLInputElement).checked })}
        />
        <span>Math & Greek symbols (θ, π, Σ)</span>
      </label>
    {:else}
      <span class="cz-profile-note">
        English line recognition. Formulas and diagrams preserved visually.
      </span>
    {/if}
  </div>

  <FileDropzone
    accept="application/pdf,.pdf"
    icon="🔍"
    title="Drop PDF documents for OCR here"
    subtitle="Scanned or photographed documents"
    hasFiles={state.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if state.files.length > 0}
    <FileQueue
      files={state.files}
      {isBusy}
      onCompressAll={handleProcessAll}
      onDownloadAll={handleDownloadAll}
      onClear={handleClear}
      onCompressSingle={processOcrSingle}
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
  .cz-profile-note {
    font-size: 0.82rem;
    color: var(--text-3);
  }
</style>
