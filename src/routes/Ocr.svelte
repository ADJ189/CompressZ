<script lang="ts">
  import { onMount } from "svelte";
  import FileDropzone from "../components/FileDropzone.svelte";
  import FileQueue from "../components/FileQueue.svelte";
  import { ocrStore, type OcrState, consumeStagedUniversalFile, currentRoute } from "../store";
  import {
    runPrintedOcr,
    type OcrLanguage,
    type OcrEngine,
    type OcrProfile,
    type OcrWordBox,
  } from "../lib/ocrEngines";
  import { runHandwritingOcr } from "../lib/ocrHandwriting";
  import { openPdfDocument } from "../lib/pdfLibs";
  import {
    createSearchablePdfBuilder,
    describeTextLayerGap,
  } from "../lib/searchablePdf";
  import { runScheduled } from "../lib/resourceManager";
import { entryError } from "../lib/engineError";
  import { uid, type FileEntry } from "../lib/types";
  import { downloadBatch } from "../lib/batchDownload";
  import { toast } from "../toast";

  let ocrState = $state<OcrState>(ocrStore.get());
  let isBusy = $state(false);

  $effect(() => {
    const unsub = ocrStore.subscribe((val) => {
      ocrState = val;
    });
    return unsub;
  });

  function updateStore(patch: Partial<OcrState>) {
    ocrStore.update((curr) => ({ ...curr, ...patch }));
  }

  function patchEntry(id: string, patch: Partial<FileEntry>) {
    updateStore({
      files: ocrState.files.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  }

  function isImageFile(file: File): boolean {
    return (
      file.type.startsWith("image/") ||
      /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name)
    );
  }

  function handleFilesAdded(files: File[]) {
    const newEntries: FileEntry[] = files.map((file) => ({
      id: uid(),
      file,
      name: file.name,
      originalSize: file.size,
      status: "idle",
      type: isImageFile(file) ? "image" : "pdf",
    }));
    updateStore({ files: [...ocrState.files, ...newEntries] });
  }

  function applyStagedFile() {
    const staged = consumeStagedUniversalFile("compress/ocr");
    if (staged?.file) {
      handleFilesAdded([staged.file]);
    }
  }

  let lastSearch: string | null = null;
  function applyQueryParams(force = false) {
    if (typeof window === "undefined") return;
    if (!force && window.location.search === lastSearch) return;
    lastSearch = window.location.search;

    const params = new URLSearchParams(window.location.search);
    const prof = params.get("profile") || params.get("engine");
    const current = ocrStore.get();
    if (prof === "handwriting" || prof === "trocr") {
      if (current.profile !== "handwriting") {
        updateStore({ profile: "handwriting" });
      }
    } else if (prof === "printed" || prof === "tesseract") {
      if (current.profile !== "printed") {
        updateStore({ profile: "printed" });
      }
    } else {
      // Bare compress/ocr route (e.g. from Searchable PDF OCR shortcut):
      // select printed profile. If previous profile was handwriting, restore PDF output.
      if (current.profile !== "printed") {
        updateStore({
          profile: "printed",
          outputKind: "pdf",
        });
      }
    }
  }

  onMount(() => {
    applyQueryParams();
    applyStagedFile();

    const unsub = currentRoute.subscribe((r) => {
      if (r === "compress/ocr") {
        applyQueryParams(true);
        applyStagedFile();
      }
    });
    return unsub;
  });

  function toBlob(
    canvas: HTMLCanvasElement,
    type: string,
    quality?: number,
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Canvas encoding failed")),
        type,
        quality,
      );
    });
  }

  /** Draw an image file at its natural size (never upscaled). */
  async function rasteriseImage(file: File): Promise<HTMLCanvasElement> {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      bitmap.close();
      throw new Error("Could not create a 2D canvas for the image");
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  async function processOcrSingle(entry: FileEntry) {
    if (entry.status === "compressing") return;

    patchEntry(entry.id, { status: "compressing", progress: 0, error: undefined });

    try {
      const handwriting = ocrState.profile === "handwriting";
      const wantsPdf = ocrState.outputKind !== "txt" && !handwriting;
      if (handwriting && ocrState.outputKind !== "txt") {
        toast(
          "Handwriting recognition produces plain text only — the searchable PDF text layer needs printed-text OCR.",
          "info",
        );
      }

      const result = await runScheduled(
        { kind: "ocr", label: entry.name, bytes: entry.file.size },
        async () => {
          const builder = wantsPdf
            ? await createSearchablePdfBuilder({ title: entry.name })
            : null;
          let skipped = 0;
          const unsupported = new Set<number>();
          const textPages: string[] = [];

          let pdfDoc: any = null;
          try {
            const image = isImageFile(entry.file);

            const runRecognition = async (
              canvas: HTMLCanvasElement,
              pageNumber: number,
              pageCount: number,
            ): Promise<{ text: string; words: OcrWordBox[] }> => {
              if (handwriting) {
                const res = await runHandwritingOcr(canvas);
                return { text: res.text, words: [] };
              }
              const res = await runPrintedOcr(canvas, {
                language: ocrState.language,
                symbolMode: ocrState.symbolMode,
                onProgress: (pct, status) => {
                  patchEntry(entry.id, {
                    progress: Math.min(90, Math.round((pageNumber - 1) / pageCount * 90 + (pct / 100) * (90 / pageCount))),
                  });
                  void status;
                },
              });
              const words: OcrWordBox[] = [];
              for (const line of res.lines) words.push(...line.words);
              return { text: res.text, words };
            };

            if (image) {
              const canvas = await rasteriseImage(entry.file);
              const { text, words } = await runRecognition(canvas, 1, 1);
              textPages.push(`--- Page 1 ---\n${text}`);
              if (builder) {
                // PNG keeps a screenshot/photograph crisp; it is already on disk,
                // so recompressing to JPEG would only add artefacts.
                const widthPx = canvas.width;
                const heightPx = canvas.height;
                const blob = await toBlob(canvas, "image/png");
                canvas.width = 0;
                canvas.height = 0;
                const imageBytes = new Uint8Array(await blob.arrayBuffer());
                const stats = await builder.addPage({
                  imageBytes,
                  imageType: "image/png",
                  widthPx,
                  heightPx,
                  dpi: 96,
                  words,
                });
                skipped += stats.skippedWords;
                for (const cp of stats.unsupportedCodePoints) unsupported.add(cp);
                patchEntry(entry.id, { progress: 99 });
              } else {
                canvas.width = 0;
                canvas.height = 0;
              }
            } else {
              const pdfBytes = new Uint8Array(await entry.file.arrayBuffer());
              pdfDoc = await openPdfDocument(pdfBytes);
              const numPages: number = pdfDoc.numPages;

              for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({
                  scale: ocrState.renderDpi / 72,
                });
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(viewport.width));
                canvas.height = Math.max(1, Math.round(viewport.height));
                const ctx = canvas.getContext("2d", { alpha: false });
                if (ctx) {
                  ctx.fillStyle = "#fff";
                  ctx.fillRect(0, 0, canvas.width, canvas.height);
                  await page.render({ canvasContext: ctx, viewport }).promise;
                }

                const { text, words } = await runRecognition(
                  canvas,
                  pageNum,
                  numPages,
                );
                textPages.push(`--- Page ${pageNum} ---\n${text}`);

                if (builder) {
                  const widthPx = canvas.width;
                  const heightPx = canvas.height;
                  const blob = await toBlob(canvas, "image/jpeg", 0.92);
                  canvas.width = 0;
                  canvas.height = 0;
                  const imageBytes = new Uint8Array(await blob.arrayBuffer());
                  const stats = await builder.addPage({
                    imageBytes,
                    imageType: "image/jpeg",
                    widthPx,
                    heightPx,
                    dpi: ocrState.renderDpi,
                    words,
                  });
                  skipped += stats.skippedWords;
                  for (const cp of stats.unsupportedCodePoints) unsupported.add(cp);
                  patchEntry(entry.id, {
                    progress: 90 + Math.round((pageNum / numPages) * 9),
                  });
                } else {
                  canvas.width = 0;
                  canvas.height = 0;
                }

                page.cleanup();
              }
            }

            const text = textPages.join("\n\n").trim();
            const base = entry.name.replace(/\.[^/.]+$/, "");

            if (builder) {
              const bytes = await builder.finish();
              const pdfBlob = new Blob([new Uint8Array(bytes)], {
                type: "application/pdf",
              });
              const txtBlob =
                ocrState.outputKind === "both"
                  ? new Blob([text], { type: "text/plain;charset=utf-8" })
                  : undefined;
              return {
                blob: pdfBlob,
                name: `${base}-searchable.pdf`,
                extraBlob: txtBlob,
                extraName: txtBlob ? `${base}-ocr.txt` : undefined,
                note: describeTextLayerGap([...unsupported]) ?? undefined,
                skipped,
              };
            }

            return {
              blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
              name: `${base}-ocr.txt`,
              extraBlob: undefined,
              extraName: undefined,
              note: undefined,
              skipped: 0,
            };
          } finally {
            // A thrown page must not leak the pdf.js document.
            if (pdfDoc) await pdfDoc.destroy().catch(() => {});
          }
        },
      );

      patchEntry(entry.id, {
        status: "done",
        progress: 100,
        compressedBlob: result.blob,
        compressedSize: result.blob.size,
        extraBlob: result.extraBlob,
        extraName: result.extraName,
        error: undefined,
      });

      if (result.note) toast(result.note, "info");
      toast(`OCR completed for ${entry.name}`, "success");
    } catch (err) {
      console.error("[ocrProcess] error:", err);
      const failure = entryError(err, "OCR recognition failed");
      patchEntry(entry.id, {
        status: "error",
        progress: 0,
        error: failure.error,
        errorLog: failure.errorLog,
      });
      toast(`${entry.name}: ${failure.error}`, "error", undefined, {
        log: failure.errorLog,
      });
    }
  }

  async function handleProcessAll() {
    isBusy = true;
    try {
      const idleEntries = ocrState.files.filter(
        (f) => f.status === "idle" || f.status === "error",
      );
      // Sequential by design: one OCR worker and one page raster in memory.
      for (const entry of idleEntries) {
        await processOcrSingle(entry);
      }
    } finally {
      isBusy = false;
    }
  }

  function startDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handleDownloadSingle(entry: FileEntry) {
    if (!entry.compressedBlob) return;
    const base = entry.name.replace(/\.[^/.]+$/, "");
    const isPdf = entry.compressedBlob.type === "application/pdf";
    startDownload(
      entry.compressedBlob,
      isPdf ? `${base}-searchable.pdf` : `${base}-ocr.txt`,
    );
  }

  function handleDownloadExtra(entry: FileEntry) {
    if (!entry.extraBlob) return;
    const base = entry.name.replace(/\.[^/.]+$/, "");
    startDownload(entry.extraBlob, entry.extraName ?? `${base}-ocr.txt`);
  }

  async function handleDownloadAll() {
    const doneEntries = ocrState.files.filter((f) => f.status === "done");
    const items: { name: string; blob: Blob }[] = [];
    for (const entry of doneEntries) {
      const base = entry.name.replace(/\.[^/.]+$/, "");
      if (entry.compressedBlob) {
        const isPdf = entry.compressedBlob.type === "application/pdf";
        items.push({
          name: isPdf ? `${base}-searchable.pdf` : `${base}-ocr.txt`,
          blob: entry.compressedBlob,
        });
      }
      if (entry.extraBlob) {
        items.push({
          name: entry.extraName ?? `${base}-ocr.txt`,
          blob: entry.extraBlob,
        });
      }
    }
    await downloadBatch(items, "ocr-results.zip");
  }

  function handleRemove(id: string) {
    updateStore({ files: ocrState.files.filter((f) => f.id !== id) });
  }

  function handleClear() {
    updateStore({ files: [] });
  }

  /** Entries whose run produced at least one downloadable artefact. */
  const doneEntries = $derived(ocrState.files.filter((f) => f.status === "done"));

  function primaryLabel(entry: FileEntry): string {
    return entry.compressedBlob?.type === "application/pdf"
      ? "Download PDF"
      : "Download .txt";
  }
</script>

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">PDF OCR</h1>
    <p class="cz-tool-desc">
      Turn scanned PDFs and images into a searchable PDF with a real, selectable text layer, or
      export the recognised text on its own. Printed text runs on Tesseract.js; English handwriting
      uses TrOCR. Everything runs on-device.
    </p>
  </div>

  <div class="cz-tool-settings-bar">
    <div class="cz-setting-item">
      <label class="cz-setting-label" for="ocr-prof">Profile</label>
      <select
        id="ocr-prof"
        class="cz-select"
        value={ocrState.profile}
        onchange={(e) => updateStore({ profile: (e.target as HTMLSelectElement).value as OcrProfile })}
      >
        <option value="printed">Printed Text (Tesseract.js)</option>
        <option value="handwriting">Handwriting (English, TrOCR)</option>
      </select>
    </div>

    {#if ocrState.profile === "printed"}
      <div class="cz-setting-item">
        <label class="cz-setting-label" for="ocr-output">Output</label>
        <select
          id="ocr-output"
          class="cz-select"
          value={ocrState.outputKind}
          onchange={(e) =>
            updateStore({
              outputKind: (e.target as HTMLSelectElement).value as OcrState["outputKind"],
            })}
        >
          <option value="pdf">Searchable PDF</option>
          <option value="txt">Plain text (.txt)</option>
          <option value="both">Searchable PDF + .txt</option>
        </select>
      </div>
    {/if}

    {#if ocrState.profile === "printed"}
      <div class="cz-setting-item">
        <label class="cz-setting-label" for="ocr-lang">Language</label>
        <select
          id="ocr-lang"
          class="cz-select"
          value={ocrState.language}
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
          checked={ocrState.symbolMode}
          onchange={(e) => updateStore({ symbolMode: (e.target as HTMLInputElement).checked })}
        />
        <span>Math & Greek symbols (θ, π, Σ)</span>
      </label>
    {:else}
      <span class="cz-profile-note">
        English line recognition. Formulas and diagrams preserved visually. Handwriting output is
        plain text only, because a searchable text layer needs printed-text OCR.
      </span>
    {/if}
  </div>

  <p class="cz-ocr-notice">
    <strong>Text-layer coverage.</strong> The invisible layer is written with a
    Latin / Cyrillic / Greek / Vietnamese font. Arabic, Indic and CJK characters are skipped
    rather than written incorrectly, so those pages keep the scanned image and lose searchability
    for that script; choose Plain text to read them. Pages not rendered by the PDF are never
    added to the output.
  </p>

  <FileDropzone
    accept="application/pdf,.pdf,image/*"
    icon="🔍"
    title="Drop PDFs or images for OCR"
    subtitle="Scanned documents, screenshots and photographs · PDF, PNG, JPEG, WebP"
    hasFiles={ocrState.files.length > 0}
    onFiles={handleFilesAdded}
  />

  {#if ocrState.files.length > 0}
    <FileQueue
      files={ocrState.files}
      {isBusy}
      onCompressAll={handleProcessAll}
      onDownloadAll={handleDownloadAll}
      onClear={handleClear}
      onCompressSingle={processOcrSingle}
      onDownloadSingle={handleDownloadSingle}
      onRemoveSingle={handleRemove}
      actionLabel="Recognise"
      busyLabel="Recognising..."
      doneLabel="OCR ready"
    />
  {/if}

  {#if doneEntries.length > 0}
    <section class="cz-ocr-outputs" aria-label="OCR outputs">
      <h2 class="cz-ocr-outputs-title">Recognised files</h2>
      <ul class="cz-ocr-outputs-list">
        {#each doneEntries as entry (entry.id)}
          <li class="cz-ocr-output-row">
            <span class="cz-ocr-output-name" title={entry.name}>{entry.name}</span>
            <span class="cz-ocr-output-kind">
              {entry.compressedBlob?.type === "application/pdf" ? "searchable PDF" : "text"}
            </span>
            <span class="cz-ocr-output-actions">
              <button
                type="button"
                class="cz-btn cz-btn-secondary cz-btn-sm"
                onclick={() => handleDownloadSingle(entry)}
              >
                {primaryLabel(entry)}
              </button>
              {#if entry.extraBlob}
                <button
                  type="button"
                  class="cz-btn cz-btn-ghost cz-btn-sm"
                  onclick={() => handleDownloadExtra(entry)}
                >
                  Download .txt
                </button>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>
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
  .cz-ocr-notice {
    margin: 0;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: var(--r);
    background: var(--surface);
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--text-2);
  }
  .cz-ocr-outputs {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cz-ocr-outputs-title {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-ocr-outputs-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .cz-ocr-output-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface);
  }
  .cz-ocr-output-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
    color: var(--text);
  }
  .cz-ocr-output-kind {
    flex: 0 0 auto;
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--text-3);
  }
  .cz-ocr-output-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 0 0 auto;
  }
  @media (max-width: 640px) {
    .cz-ocr-output-row {
      flex-wrap: wrap;
    }
    .cz-ocr-output-name {
      flex-basis: 100%;
    }
  }
</style>
