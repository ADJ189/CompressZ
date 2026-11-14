<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import ProgressStatus from "../components/ProgressStatus.svelte";
  import MacIcon from "../components/MacIcon.svelte";
  import {
    convertPdfToMarkdown,
    type PdfMarkdownBundle,
    type PdfMarkdownProfile,
    type ExportMode,
    type FormulaFormat,
    type TableFormat,
    type PageDelimiter,
  } from "../lib/pdfToMarkdown";
  import type { OcrLanguage } from "../lib/ocrEngines";
  import { toast } from "../toast";
  import { formatBytes } from "../lib/types";

  let selectedFile = $state<File | null>(null);
  let profile = $state<PdfMarkdownProfile>("auto");
  let language = $state<OcrLanguage>("eng");
  let exportMode = $state<ExportMode>("standalone-md"); // Default: standalone .md!
  let formulaFormat = $state<FormulaFormat>("latex");
  let tableFormat = $state<TableFormat>("gfm");
  let stripHeadersFooters = $state<boolean>(true);
  let pageDelimiters = $state<PageDelimiter>("rule");
  let includeFrontmatter = $state<boolean>(true);
  let includeVisuals = $state(true);
  let includeOriginalPdf = $state(true);
  let showAdvanced = $state(false);

  let isProcessing = $state(false);
  let progress = $state(0);
  let statusMessage = $state("");
  let abortController: AbortController | null = null;

  let bundleResult = $state<PdfMarkdownBundle | null>(null);
  let activePageIndex = $state(0);
  let editableMarkdown = $state("");
  let viewMode = $state<"editor" | "rendered">("editor");

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
        exportMode,
        formulaFormat,
        tableFormat,
        stripHeadersFooters,
        pageDelimiters,
        includeFrontmatter,
        includeVisuals: exportMode === "bundle-zip" ? includeVisuals : false,
        includeOriginalPdf: exportMode === "bundle-zip" ? includeOriginalPdf : false,
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

  function handleDownloadMarkdown() {
    if (!editableMarkdown || !selectedFile) return;
    const blob = new Blob([editableMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = selectedFile.name.replace(/\.pdf$/i, "");
    a.href = url;
    a.download = `${baseName}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Downloaded pure Markdown (.md)", "success");
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
    toast("Downloaded complete bundle archive (.zip)", "success");
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

<div class="tool-wrap cz-tool-view">
  <div class="cz-tool-header">
    <div class="cz-tool-header-row">
      <MacIcon name="markdown" variant="squircle" squircleSize={44} />
      <div>
        <h1 class="cz-tool-title">PDF to Markdown</h1>
        <p class="cz-tool-desc">
          High-fidelity document reconstruction. Extract clean, structured Markdown with LaTeX math formulas,
          reconstructed tables, and zero server uploads. Download a standalone .md file directly by default.
        </p>
      </div>
    </div>
  </div>

  {#if !bundleResult}
    {#if !selectedFile}
      <FileDropzone
        accept="application/pdf,.pdf"
        icon="markdown"
        title="Drop a PDF document here"
        subtitle="Digitally generated, scanned, academic papers, or handwritten notes up to 200MB"
        multiple={false}
        onFiles={handleFileSelected}
      />
    {:else}
      <div class="cz-config-card">
        <!-- Selected File Banner -->
        <div class="cz-file-selected-row">
          <div class="cz-file-meta-badge">
            <MacIcon name="pdf" variant="squircle" squircleSize={38} />
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

        <!-- Export Mode Selector (Default: Standalone .md) -->
        <div class="cz-export-mode-section">
          <label class="cz-option-label" for="export-mode-group">Primary Export Target</label>
          <div id="export-mode-group" class="cz-mode-selector-grid">
            <button
              type="button"
              class="cz-mode-card {exportMode === 'standalone-md' ? 'is-selected' : ''}"
              onclick={() => (exportMode = "standalone-md")}
              disabled={isProcessing}
            >
              <div class="cz-mode-card-head">
                <MacIcon name="markdown" size={18} color="var(--accent)" />
                <span class="cz-mode-card-title">Standalone Markdown (.md)</span>
                <span class="cz-mode-badge-rec">Default</span>
              </div>
              <p class="cz-mode-card-desc">
                Single clean .md file with all text, tables, and LaTeX math blocks ($$). Zero zip archive, zero image dependencies.
              </p>
            </button>

            <button
              type="button"
              class="cz-mode-card {exportMode === 'bundle-zip' ? 'is-selected' : ''}"
              onclick={() => (exportMode = "bundle-zip")}
              disabled={isProcessing}
            >
              <div class="cz-mode-card-head">
                <MacIcon name="download" size={18} color="var(--text-2)" />
                <span class="cz-mode-card-title">Complete Archive (.zip)</span>
              </div>
              <p class="cz-mode-card-desc">
                Full bundle including document.md, original pristine PDF, extraction JSON metadata, and lossless page PNG crops.
              </p>
            </button>
          </div>
        </div>

        <!-- Core Options Grid -->
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
                ? "English line recognition. Math formulas and diagrams are preserved cleanly."
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
            <span class="cz-option-hint">Active language model when optical OCR is needed.</span>
          </div>
        </div>

        <!-- Advanced Customization Accordion -->
        <div class="cz-advanced-accordion">
          <button
            type="button"
            class="cz-advanced-toggle"
            onclick={() => (showAdvanced = !showAdvanced)}
            aria-expanded={showAdvanced}
          >
            <MacIcon name={showAdvanced ? "chevron-down" : "chevron-right"} size={14} />
            <span>Advanced Customization & Engine Options</span>
          </button>

          {#if showAdvanced}
            <div class="cz-advanced-panel">
              <div class="cz-options-grid">
                <div class="cz-option-field">
                  <label class="cz-option-label" for="formula-format">Formula & Math Style</label>
                  <select
                    id="formula-format"
                    class="cz-select"
                    bind:value={formulaFormat}
                    disabled={isProcessing}
                  >
                    <option value="latex">Standard LaTeX Math ($$ display, $ inline)</option>
                    <option value="ascii">Plain Code Block (```math)</option>
                    <option value="html">HTML Math tag fallback</option>
                  </select>
                  <span class="cz-option-hint">Formats equations for seamless rendering in Obsidian, GitHub, and KaTeX.</span>
                </div>

                <div class="cz-option-field">
                  <label class="cz-option-label" for="table-format">Table Reconstruction</label>
                  <select
                    id="table-format"
                    class="cz-select"
                    bind:value={tableFormat}
                    disabled={isProcessing}
                  >
                    <option value="gfm">GitHub Flavored Markdown (Pipe Tables)</option>
                    <option value="html">HTML Table (&lt;table&gt;)</option>
                    <option value="text">Indented text columns</option>
                  </select>
                  <span class="cz-option-hint">Converts detected tabular coordinate clusters into structured tables.</span>
                </div>

                <div class="cz-option-field">
                  <label class="cz-option-label" for="page-delim">Page Delimiter</label>
                  <select
                    id="page-delim"
                    class="cz-select"
                    bind:value={pageDelimiters}
                    disabled={isProcessing}
                  >
                    <option value="rule">Horizontal Rule (---)</option>
                    <option value="pagebreak">HTML Pagebreak (&lt;!-- pagebreak --&gt;)</option>
                    <option value="none">Continuous text flow</option>
                  </select>
                </div>
              </div>

              <div class="cz-toggles-row">
                <label class="cz-checkbox-label">
                  <input
                    type="checkbox"
                    bind:checked={stripHeadersFooters}
                    disabled={isProcessing}
                  />
                  <span>Strip repetitive running headers and page numbers</span>
                </label>
                <label class="cz-checkbox-label">
                  <input
                    type="checkbox"
                    bind:checked={includeFrontmatter}
                    disabled={isProcessing}
                  />
                  <span>Include YAML frontmatter metadata (title, SHA-256, page count)</span>
                </label>
                {#if exportMode === "bundle-zip"}
                  <label class="cz-checkbox-label">
                    <input
                      type="checkbox"
                      bind:checked={includeVisuals}
                      disabled={isProcessing}
                    />
                    <span>Preserve page PNG crops in ZIP archive</span>
                  </label>
                  <label class="cz-checkbox-label">
                    <input
                      type="checkbox"
                      bind:checked={includeOriginalPdf}
                      disabled={isProcessing}
                    />
                    <span>Include original bit-for-bit PDF in ZIP</span>
                  </label>
                {/if}
              </div>
            </div>
          {/if}
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
              <span>Extract Markdown</span>
              <MacIcon name="arrow-up-right" size={16} />
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
            title="Copy markdown text to clipboard"
          >
            <MacIcon name="copy" size={14} />
            <span>Copy Markdown</span>
          </button>

          <!-- Primary Default Action: Download pure .md file directly -->
          <button
            type="button"
            class="cz-btn cz-btn-primary cz-btn-sm"
            onclick={handleDownloadMarkdown}
            title="Download pure standalone Markdown file (.md)"
          >
            <MacIcon name="download" size={14} />
            <span>Download .md (Default)</span>
          </button>

          <!-- Secondary Action: Download complete ZIP bundle -->
          <button
            type="button"
            class="cz-btn cz-btn-secondary cz-btn-sm"
            onclick={handleDownloadBundle}
            title="Download complete archive (.zip) with assets and manifest"
          >
            <MacIcon name="download" size={14} />
            <span>Download Bundle (.zip)</span>
          </button>

          <button
            type="button"
            class="cz-btn cz-btn-ghost cz-btn-sm"
            onclick={handleClear}
            title="Clear and process another PDF"
          >
            <span>New document</span>
          </button>
        </div>
      </div>

      <div class="cz-review-split">
        <!-- Page rail -->
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

        <!-- Visual Preview / Inspector -->
        <div class="cz-review-preview-col">
          <div class="cz-pane-header">
            <span>Visual Reference (Page {activePageIndex + 1})</span>
          </div>
          <div class="cz-preview-container">
            {#if activePageAsset}
              <img src={activePageAsset} alt="Page {activePageIndex + 1}" class="cz-page-preview-img" />
            {:else}
              <div class="cz-preview-empty">
                <MacIcon name="pdf" size={32} color="var(--text-4)" />
                <p>Pure text extraction active. No raster preview generated.</p>
              </div>
            {/if}
          </div>
        </div>

        <!-- Markdown Editor / Viewer -->
        <div class="cz-review-editor-col">
          <div class="cz-pane-header">
            <span>Extracted Markdown</span>
            <div class="cz-pane-actions">
              <button
                type="button"
                class="cz-view-toggle {viewMode === 'editor' ? 'is-active' : ''}"
                onclick={() => (viewMode = "editor")}
              >Editor</button>
              <button
                type="button"
                class="cz-view-toggle {viewMode === 'rendered' ? 'is-active' : ''}"
                onclick={() => (viewMode = "rendered")}
              >Preview</button>
            </div>
          </div>

          {#if viewMode === "editor"}
            <textarea
              bind:value={editableMarkdown}
              class="cz-markdown-editor"
              placeholder="Extracted Markdown will appear here..."
            ></textarea>
          {:else}
            <div class="cz-markdown-rendered">
              <pre>{editableMarkdown}</pre>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .cz-tool-view {
    max-width: 1120px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .cz-tool-header-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .cz-tool-title {
    font-family: var(--display);
    font-size: 1.85rem;
    font-weight: 800;
    color: var(--text);
    letter-spacing: -0.02em;
  }
  .cz-tool-desc {
    font-size: 0.95rem;
    color: var(--text-3);
    max-width: 70ch;
    line-height: 1.45;
  }
  .cz-config-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
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
    gap: 0.85rem;
  }
  .cz-file-badge-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .cz-file-badge-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-file-badge-size {
    font-size: 0.82rem;
    font-family: var(--mono);
    color: var(--text-3);
  }

  /* Export Mode Segmented Cards */
  .cz-export-mode-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cz-mode-selector-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0.85rem;
  }
  .cz-mode-card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 1rem 1.15rem;
    background: var(--surface2);
    border: 2px solid var(--border);
    border-radius: 14px;
    text-align: left;
    cursor: pointer;
    transition: border-color var(--t), background var(--t), box-shadow var(--t), transform var(--t);
  }
  .cz-mode-card:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }
  .cz-mode-card.is-selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent-glow);
  }
  .cz-mode-card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-mode-card-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-mode-badge-rec {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    background: var(--accent);
    color: #ffffff;
    text-transform: uppercase;
  }
  .cz-mode-card-desc {
    font-size: 0.8rem;
    color: var(--text-3);
    line-height: 1.4;
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
  .cz-select {
    padding: 0.55rem 0.85rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 0.9rem;
    outline: none;
    transition: border-color var(--t), box-shadow var(--t);
  }
  .cz-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  /* Advanced Accordion */
  .cz-advanced-accordion {
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }
  .cz-advanced-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    background: var(--surface2);
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-2);
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-advanced-toggle:hover {
    background: var(--bg2);
    color: var(--text);
  }
  .cz-advanced-panel {
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }

  .cz-toggles-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
  }
  .cz-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-2);
    cursor: pointer;
  }
  .cz-action-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.5rem;
  }

  /* Review Workspace */
  .cz-review-workspace {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .cz-review-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.85rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  .cz-review-metrics {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-metric-tag {
    font-size: 0.78rem;
    font-weight: 600;
    background: var(--bg2);
    color: var(--text-2);
    padding: 0.2rem 0.55rem;
    border-radius: 6px;
  }
  .cz-metric-hash {
    font-family: var(--mono);
  }
  .cz-review-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  /* Review Split Layout */
  .cz-review-split {
    display: grid;
    grid-template-columns: 140px 1fr 1fr;
    gap: 1rem;
    min-height: 600px;
  }
  .cz-review-pages-rail {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 600px;
    overflow-y: auto;
  }
  .cz-rail-title {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-3);
    padding-bottom: 0.35rem;
    border-bottom: 1px solid var(--border);
  }
  .cz-rail-page-btn {
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    font-size: 0.82rem;
    text-align: left;
    color: var(--text-2);
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-rail-page-btn:hover {
    background: var(--bg2);
    color: var(--text);
  }
  .cz-rail-page-btn.is-active {
    background: var(--accent);
    color: #ffffff;
    font-weight: 600;
  }

  .cz-review-preview-col,
  .cz-review-editor-col {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cz-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1rem;
    background: var(--surface2);
    border-bottom: 1px solid var(--border);
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-pane-actions {
    display: flex;
    gap: 0.25rem;
  }
  .cz-view-toggle {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    color: var(--text-3);
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-view-toggle.is-active {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }

  .cz-preview-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: var(--bg);
    overflow: auto;
  }
  .cz-page-preview-img {
    max-width: 100%;
    max-height: 520px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    border-radius: 4px;
  }
  .cz-preview-empty {
    text-align: center;
    color: var(--text-3);
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }

  .cz-markdown-editor {
    flex: 1;
    padding: 1rem;
    border: none;
    outline: none;
    background: transparent;
    font-family: var(--mono);
    font-size: 0.86rem;
    line-height: 1.6;
    color: var(--text);
    resize: none;
    min-height: 480px;
  }
  .cz-markdown-rendered {
    flex: 1;
    padding: 1rem;
    overflow-y: auto;
    font-family: var(--sans);
    font-size: 0.9rem;
    line-height: 1.6;
  }
  .cz-markdown-rendered pre {
    white-space: pre-wrap;
    font-family: var(--mono);
    font-size: 0.85rem;
  }

  @media (max-width: 900px) {
    .cz-review-split {
      grid-template-columns: 1fr;
    }
    .cz-review-pages-rail {
      flex-direction: row;
      max-height: auto;
      overflow-x: auto;
    }
  }
</style>
