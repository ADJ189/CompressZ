<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import ProgressStatus from "../components/ProgressStatus.svelte";
  import {
    convertPdfToMarkdown,
    type PdfMarkdownBundle,
    type PdfMarkdownProfile,
  } from "../lib/pdfToMarkdown";
  import type { OcrLanguage } from "../lib/ocrEngines";
  import { toast } from "../toast";
  import { formatBytes } from "../lib/types";

  let selectedFile = $state<File | null>(null);
  let profile = $state<PdfMarkdownProfile>("auto");
  let language = $state<OcrLanguage>("eng");
  let includeVisuals = $state(true);
  let includeOriginalPdf = $state(true);

  let isProcessing = $state(false);
  let progress = $state(0);
  let statusMessage = $state("");
  let abortController: AbortController | null = null;

  let bundleResult = $state<PdfMarkdownBundle | null>(null);
  let activePageIndex = $state(0);
  let editableMarkdown = $state("");

  function handleFileSelected(files: File[]) {
    if (files.length > 0) {
      selectedFile = files[0];
      bundleResult = null;
      editableMarkdown = "";
      activePageIndex = 0;
    }
  }

  function handleClear() {
    selectedFile = null;
    bundleResult = null;
    editableMarkdown = "";
    activePageIndex = 0;
  }

  async function handleStartExtraction() {
    if (!selectedFile) return;

    isProcessing = true;
    progress = 0;
    statusMessage = "Starting PDF analysis...";
    abortController = new AbortController();

    try {
      const bytes = new Uint8Array(await selectedFile.arrayBuffer());
      const res = await convertPdfToMarkdown(bytes, selectedFile.name, {
        profile,
        language,
        includeVisuals,
        includeOriginalPdf,
        onProgress: (p, msg) => {
          progress = p;
          statusMessage = msg;
        },
        signal: abortController.signal,
      });

      bundleResult = res;
      editableMarkdown = res.markdown;
      activePageIndex = 0;
      toast("PDF successfully extracted to Markdown", "success");
    } catch (err) {
      console.error("[pdfMarkdown] error:", err);
      toast(`Extraction failed: ${(err as Error).message}`, "error");
    } finally {
      isProcessing = false;
      abortController = null;
    }
  }

  function handleCancel() {
    if (abortController) {
      abortController.abort();
      statusMessage = "Cancelled by user";
      toast("Extraction cancelled", "");
    }
  }

  function handleDownloadBundle() {
    if (!bundleResult || !selectedFile) return;
    const blob = new Blob([bundleResult.zipBytes as any], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = selectedFile.name.replace(/\.pdf$/i, "");
    a.href = url;
    a.download = `${baseName}-markdown.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Downloaded complete bundle", "success");
  }

  async function handleCopyMarkdown() {
    if (!editableMarkdown) return;
    try {
      await navigator.clipboard.writeText(editableMarkdown);
      toast("Markdown copied to clipboard", "success");
    } catch {
      toast("Failed to copy to clipboard", "error");
    }
  }

  const activePageAsset = $derived.by(() => {
    if (!bundleResult || !bundleResult.assets.length) return null;
    const pageNumStr = String(activePageIndex + 1).padStart(4, "0");
    const match = bundleResult.assets.find((a) => a.path.includes(`page-${pageNumStr}`));
    if (!match) return null;
    const blob = new Blob([match.bytes as any], { type: "image/png" });
    return URL.createObjectURL(blob);
  });
</script>

<div class="cz-tool-view">
  <div class="cz-tool-header">
    <h1 class="cz-tool-title">PDF to Markdown</h1>
    <p class="cz-tool-desc">
      Convert PDFs to editable, structured Markdown with visual preservation for formulas,
      diagrams, and tables. Includes original PDF byte-for-byte in the output archive.
    </p>
  </div>

  {#if !bundleResult}
    {#if !selectedFile}
      <FileDropzone
        accept="application/pdf,.pdf"
        icon="📝"
        title="Drop a PDF document here"
        subtitle="Digitally generated, scanned, or mixed documents up to 200MB"
        multiple={false}
        onFiles={handleFileSelected}
      />
    {:else}
      <div class="cz-config-card">
        <div class="cz-file-selected-row">
          <div class="cz-file-meta-badge">
            <span class="cz-file-badge-icon" aria-hidden="true">📄</span>
            <div class="cz-file-badge-text">
              <span class="cz-file-badge-name">{selectedFile.name}</span>
              <span class="cz-file-badge-size">{formatBytes(selectedFile.size)}</span>
            </div>
          </div>
          <button
            type="button"
            class="cz-btn cz-btn-ghost cz-btn-sm"
            onclick={handleClear}
            disabled={isProcessing}
          >
            Change file
          </button>
        </div>

        <div class="cz-options-grid">
          <div class="cz-option-field">
            <label class="cz-option-label" for="profile-select">Content Profile</label>
            <select
              id="profile-select"
              class="cz-select"
              bind:value={profile}
              disabled={isProcessing}
            >
              <option value="auto">Auto (Native text first, OCR fallback)</option>
              <option value="printed">Printed text only (Tesseract.js)</option>
              <option value="handwriting">Handwriting (English, TrOCR)</option>
              <option value="mixed">Mixed content</option>
            </select>
            <span class="cz-option-hint">
              {profile === "handwriting"
                ? "English line recognition. Formulas and diagrams are preserved visually."
                : "Fast native extraction for digital text; runs OCR only for scanned pages."}
            </span>
          </div>

          <div class="cz-option-field">
            <label class="cz-option-label" for="lang-select">OCR Language</label>
            <select
              id="lang-select"
              class="cz-select"
              bind:value={language}
              disabled={isProcessing || profile === "handwriting"}
            >
              <option value="eng">English</option>
              <option value="fra">French</option>
              <option value="deu">German</option>
              <option value="spa">Spanish</option>
              <option value="ita">Italian</option>
              <option value="por">Portuguese</option>
              <option value="chi_sim">Chinese (Simplified)</option>
              <option value="jpn">Japanese</option>
              <option value="kor">Korean</option>
              <option value="hin">Hindi</option>
              <option value="ben">Bengali</option>
            </select>
          </div>
        </div>

        <div class="cz-toggles-row">
          <label class="cz-checkbox-label">
            <input
              type="checkbox"
              bind:checked={includeVisuals}
              disabled={isProcessing}
            />
            <span>Preserve lossless page visuals & figure crops</span>
          </label>
          <label class="cz-checkbox-label">
            <input
              type="checkbox"
              bind:checked={includeOriginalPdf}
              disabled={isProcessing}
            />
            <span>Include original PDF in bundle</span>
          </label>
        </div>

        {#if isProcessing}
          <div class="cz-process-status-box">
            <ProgressStatus
              {progress}
              {statusMessage}
              onCancel={handleCancel}
            />
          </div>
        {:else}
          <div class="cz-action-footer">
            <button
              type="button"
              class="cz-btn cz-btn-primary cz-btn-lg"
              onclick={handleStartExtraction}
            >
              Extract Markdown
            </button>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <!-- Full-featured Review Workspace -->
    <div class="cz-review-workspace">
      <div class="cz-review-toolbar">
        <div class="cz-review-metrics">
          <span class="cz-metric-tag">{bundleResult.pageCount} pages</span>
          <span class="cz-metric-tag cz-metric-hash" title="SHA-256">
            SHA: {bundleResult.sha256.slice(0, 10)}...
          </span>
          {#if bundleResult.assets.length > 0}
            <span class="cz-metric-tag">{bundleResult.assets.length} visual assets</span>
          {/if}
        </div>

        <div class="cz-review-actions">
          <button
            type="button"
            class="cz-btn cz-btn-secondary cz-btn-sm"
            onclick={handleCopyMarkdown}
          >
            Copy Markdown
          </button>
          <button
            type="button"
            class="cz-btn cz-btn-primary cz-btn-sm"
            onclick={handleDownloadBundle}
          >
            Download complete bundle (.zip)
          </button>
          <button
            type="button"
            class="cz-btn cz-btn-ghost cz-btn-sm"
            onclick={handleClear}
          >
            New document
          </button>
        </div>
      </div>

      <div class="cz-review-split">
        <!-- Page thumbnails list -->
        <div class="cz-review-pages-rail">
          <div class="cz-rail-title">Pages</div>
          {#each Array.from({ length: bundleResult.pageCount }, (_, i) => i) as idx}
            <button
              type="button"
              class="cz-rail-page-btn {activePageIndex === idx ? 'is-active' : ''}"
              onclick={() => (activePageIndex = idx)}
            >
              <span>Page {idx + 1}</span>
            </button>
          {/each}
        </div>

        <!-- Visual Preview -->
        <div class="cz-review-preview-col">
          <div class="cz-pane-header">
            <span>Visual Reference (Page {activePageIndex + 1})</span>
          </div>
          <div class="cz-preview-container">
            {#if activePageAsset}
              <img src={activePageAsset} alt="Page {activePageIndex + 1}" class="cz-page-preview-img" />
            {:else}
              <div class="cz-preview-empty">No visual render available</div>
            {/if}
          </div>
        </div>

        <!-- Markdown Editor / Viewer -->
        <div class="cz-review-editor-col">
          <div class="cz-pane-header">
            <span>Extracted Markdown</span>
          </div>
          <textarea
            bind:value={editableMarkdown}
            class="cz-markdown-editor"
            placeholder="Extracted Markdown will appear here..."
          ></textarea>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .cz-tool-view {
    max-width: 1100px;
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
  .cz-config-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .cz-file-selected-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }
  .cz-file-meta-badge {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cz-file-badge-icon {
    font-size: 1.6rem;
  }
  .cz-file-badge-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    display: block;
  }
  .cz-file-badge-size {
    font-size: 0.82rem;
    font-family: var(--mono);
    color: var(--text-3);
  }
  .cz-options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.25rem;
  }
  .cz-option-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .cz-option-label {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-option-hint {
    font-size: 0.78rem;
    color: var(--text-3);
    line-height: 1.35;
  }
  .cz-toggles-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .cz-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
    color: var(--text-2);
    cursor: pointer;
  }
  .cz-action-footer {
    display: flex;
    justify-content: flex-end;
  }
  .cz-process-status-box {
    margin-top: 0.5rem;
  }

  /* Review Workspace */
  .cz-review-workspace {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 1.25rem;
  }
  .cz-review-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 1rem;
  }
  .cz-review-metrics {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .cz-metric-tag {
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 0.78rem;
    font-family: var(--mono);
    color: var(--text-2);
  }
  .cz-review-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-review-split {
    display: grid;
    grid-template-columns: 140px 1fr 1fr;
    gap: 1rem;
    height: 650px;
  }
  @media (max-width: 900px) {
    .cz-review-split {
      grid-template-columns: 1fr;
      height: auto;
    }
  }
  .cz-review-pages-rail {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    border-right: 1px solid var(--border);
    padding-right: 0.75rem;
    overflow-y: auto;
  }
  .cz-rail-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-3);
    margin-bottom: 0.25rem;
  }
  .cz-rail-page-btn {
    text-align: left;
    padding: 0.45rem 0.65rem;
    border-radius: var(--r-xs);
    font-size: 0.84rem;
    color: var(--text-2);
    transition: background var(--t), color var(--t);
  }
  .cz-rail-page-btn:hover {
    background: var(--bg2);
    color: var(--text);
  }
  .cz-rail-page-btn.is-active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .cz-review-preview-col,
  .cz-review-editor-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .cz-pane-header {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-3);
    padding-bottom: 0.45rem;
  }
  .cz-preview-container {
    flex: 1;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: auto;
    padding: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cz-page-preview-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    box-shadow: var(--shadow-sm);
    background: #fff;
  }
  .cz-preview-empty {
    font-size: 0.85rem;
    color: var(--text-3);
  }
  .cz-markdown-editor {
    flex: 1;
    width: 100%;
    padding: 0.85rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    font-family: var(--mono);
    font-size: 0.88rem;
    line-height: 1.5;
    resize: none;
  }
  .cz-markdown-editor:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
</style>
