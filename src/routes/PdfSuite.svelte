<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import HubHeader from "../components/HubHeader.svelte";
  import PageGrid from "../components/PageGrid.svelte";
  import PdfCanvasEditor from "../components/PdfCanvasEditor.svelte";
  import SignaturePad from "../components/SignaturePad.svelte";
  import { splitPdf, type SplitResult } from "../lib/pdfTools/splitPdf";
  import { reorganizePdf, type PageSpec } from "../lib/pdfTools/organizePdf";
  import { applyPdfCrop } from "../lib/pdfTools/cropPdf";
  import { applyPdfWatermark } from "../lib/pdfTools/watermarkPdf";
  import { inspectPdfForm, fillPdfForm, type FormFieldInfo } from "../lib/pdfTools/formPdf";
  import { applyTrueRedaction, type RedactionRegion } from "../lib/pdfTools/redactPdf";
  import { protectPdf, unlockPdf } from "../lib/pdfTools/securityPdf";
  import { repairCorruptPdf } from "../lib/pdfTools/repairPdf";
  import { openPdfDocument, getPdfLib } from "../lib/pdfLibs";
  import { consumeStagedUniversalFile } from "../store";
  import { formatBytes } from "../lib/types";
  import { toast } from "../toast";
  import { onMount } from "svelte";
  import { navigate } from "../router";

  type SubTool =
    | "split"
    | "organize"
    | "crop"
    | "watermark"
    | "studio"
    | "sign"
    | "forms"
    | "redact"
    | "security"
    | "repair";

  let activeTool = $state<SubTool>("split");
  let selectedFile = $state<File | null>(null);
  let pdfBytes = $state<Uint8Array | null>(null);
  let totalPages = $state<number>(0);
  let isProcessing = $state<boolean>(false);
  let progressPct = $state<number>(0);

  // Split tool state
  let splitMode = $state<"ranges" | "chunk" | "burst">("ranges");
  let splitRanges = $state<string>("1-2, 3");
  let splitChunkSize = $state<number>(2);

  // Organize tool state
  let pageSpecs = $state<PageSpec[]>([]);
  let pageThumbnails = $state<Record<number, string>>({});

  // Watermark state
  let watermarkText = $state<string>("CONFIDENTIAL");
  let watermarkOpacity = $state<number>(0.3);
  let watermarkRotation = $state<number>(-45);
  let watermarkTiled = $state<boolean>(false);
  let watermarkColor = $state<string>("#666666");

  // Crop state
  let cropMarginTop = $state<number>(36);
  let cropMarginBottom = $state<number>(36);
  let cropMarginLeft = $state<number>(36);
  let cropMarginRight = $state<number>(36);

  // Forms state
  let formFields = $state<FormFieldInfo[]>([]);
  let formValues = $state<Record<string, string | boolean>>({});
  let flattenForm = $state<boolean>(false);

  // Security state
  let userPassword = $state<string>("");
  let ownerPassword = $state<string>("");
  let allowPrinting = $state<boolean>(true);
  let allowCopying = $state<boolean>(false);
  let securityMode = $state<"protect" | "unlock">("protect");

  // Redaction state
  let redactPage = $state<number>(1);
  let redactReason = $state<string>("PII");
  let redactionList = $state<RedactionRegion[]>([]);

  // Studio state
  let showStudio = $state<boolean>(false);

  const TOOLS = [
    { id: "split", name: "Split PDF", icon: "✂️" },
    { id: "organize", name: "Organize & Rotate", icon: "📑" },
    { id: "studio", name: "PDF Studio", icon: "✏️" },
    { id: "watermark", name: "Watermark", icon: "💧" },
    { id: "crop", name: "Crop Margins", icon: "📐" },
    { id: "forms", name: "Fill Forms", icon: "📋" },
    { id: "security", name: "Protect & Unlock", icon: "🔐" },
    { id: "repair", name: "Repair File", icon: "🩹" },
    { id: "redact", name: "Redaction", icon: "⬛" },
  ];

  async function loadFile(file: File) {
    selectedFile = file;
    const bytes = new Uint8Array(await file.arrayBuffer());
    pdfBytes = bytes;

    try {
      const pdfJs = await openPdfDocument(bytes);
      totalPages = pdfJs.numPages;

      // Initialize page specs for organize tool
      pageSpecs = Array.from({ length: totalPages }, (_, i) => ({
        id: `p-${i}-${Date.now()}`,
        originalIndex: i,
        rotation: 0,
      }));

      // Generate thumbnails for the first 12 pages
      for (let i = 1; i <= Math.min(totalPages, 12); i++) {
        const p = await pdfJs.getPage(i);
        const vp = p.getViewport({ scale: 0.25 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext("2d")!;
        await p.render({ canvasContext: ctx, viewport: vp }).promise;
        pageThumbnails[i - 1] = canvas.toDataURL("image/jpeg", 0.7);
      }

      // Check form fields
      const formInfo = await inspectPdfForm(bytes);
      formFields = formInfo.fields;
      for (const f of formInfo.fields) {
        formValues[f.name] = f.value;
      }
    } catch (err) {
      console.warn("[PdfSuite] Inspection error (file might need repair):", err);
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleExecuteTool() {
    if (!pdfBytes && activeTool !== "repair") return;
    isProcessing = true;
    progressPct = 10;

    try {
      if (activeTool === "split") {
        const result = await splitPdf(
          pdfBytes!,
          {
            mode: splitMode,
            ranges: splitRanges,
            chunkSize: splitChunkSize,
            baseFilename: selectedFile?.name || "document",
          },
          (p) => (progressPct = p),
        );

        if (result.zipBlob) {
          downloadBlob(result.zipBlob, `${selectedFile?.name.replace(/\.pdf$/i, "")}-split.zip`);
          toast(`Split into ${result.files.length} PDFs (packaged in ZIP)`, "success");
        } else if (result.files.length === 1) {
          downloadBlob(
            new Blob([result.files[0].bytes], { type: "application/pdf" }),
            result.files[0].name,
          );
          toast("PDF split completed", "success");
        }
      } else if (activeTool === "organize") {
        const out = await reorganizePdf(pdfBytes!, pageSpecs, (p) => (progressPct = p));
        downloadBlob(
          new Blob([out], { type: "application/pdf" }),
          `${selectedFile?.name.replace(/\.pdf$/i, "")}-organized.pdf`,
        );
        toast("Pages reorganized successfully", "success");
      } else if (activeTool === "watermark") {
        const out = await applyPdfWatermark(
          pdfBytes!,
          {
            type: "text",
            text: watermarkText,
            opacity: watermarkOpacity,
            rotationDeg: watermarkRotation,
            tiled: watermarkTiled,
            colorHex: watermarkColor,
          },
          (p) => (progressPct = p),
        );
        downloadBlob(
          new Blob([out], { type: "application/pdf" }),
          `${selectedFile?.name.replace(/\.pdf$/i, "")}-watermarked.pdf`,
        );
        toast("Watermark applied successfully", "success");
      } else if (activeTool === "crop") {
        const out = await applyPdfCrop(
          pdfBytes!,
          {
            mode: "margins",
            margins: {
              top: cropMarginTop,
              bottom: cropMarginBottom,
              left: cropMarginLeft,
              right: cropMarginRight,
            },
          },
          (p) => (progressPct = p),
        );
        downloadBlob(
          new Blob([out], { type: "application/pdf" }),
          `${selectedFile?.name.replace(/\.pdf$/i, "")}-cropped.pdf`,
        );
        toast("PDF cropped successfully", "success");
      } else if (activeTool === "forms") {
        const updates = Object.entries(formValues).map(([name, value]) => ({ name, value }));
        const out = await fillPdfForm(pdfBytes!, updates, flattenForm, (p) => (progressPct = p));
        downloadBlob(
          new Blob([out], { type: "application/pdf" }),
          `${selectedFile?.name.replace(/\.pdf$/i, "")}-filled.pdf`,
        );
        toast("Form filled and saved successfully", "success");
      } else if (activeTool === "security") {
        if (securityMode === "protect") {
          const out = await protectPdf(pdfBytes!, {
            userPassword,
            ownerPassword,
            allowPrinting,
            allowCopying,
            onProgress: (p) => (progressPct = p),
          });
          downloadBlob(
            new Blob([out], { type: "application/pdf" }),
            `${selectedFile?.name.replace(/\.pdf$/i, "")}-protected.pdf`,
          );
          toast("PDF encrypted with AES-256 password", "success");
        } else {
          const out = await unlockPdf(pdfBytes!, {
            password: userPassword,
            onProgress: (p) => (progressPct = p),
          });
          downloadBlob(
            new Blob([out], { type: "application/pdf" }),
            `${selectedFile?.name.replace(/\.pdf$/i, "")}-unlocked.pdf`,
          );
          toast("PDF decrypted successfully", "success");
        }
      } else if (activeTool === "repair") {
        const bytes = pdfBytes || new Uint8Array(await selectedFile!.arrayBuffer());
        const rep = await repairCorruptPdf(bytes, (p) => (progressPct = p));
        downloadBlob(
          new Blob([rep.repairedBytes], { type: "application/pdf" }),
          `repaired-${selectedFile?.name || "document.pdf"}`,
        );
        toast(rep.message, "success");
      } else if (activeTool === "redact") {
        const out = await applyTrueRedaction(pdfBytes!, {
          regions: redactionList,
          onProgress: (p) => (progressPct = p),
        });
        downloadBlob(
          new Blob([out], { type: "application/pdf" }),
          `${selectedFile?.name.replace(/\.pdf$/i, "")}-redacted.pdf`,
        );
        toast("True redaction applied and sanitized", "success");
      }
    } catch (err: any) {
      console.error("[PdfSuite] error:", err);
      toast(`Action failed: ${err.message}`, "error");
    } finally {
      isProcessing = false;
      progressPct = 0;
    }
  }

  onMount(() => {
    const staged = consumeStagedUniversalFile();
    if (staged?.file) {
      loadFile(staged.file);
      if (staged.actionId === "split-pdf") activeTool = "split";
      else if (staged.actionId === "organize-pdf") activeTool = "organize";
      else if (staged.actionId === "watermark-pdf") activeTool = "watermark";
      else if (staged.actionId === "repair-pdf") activeTool = "repair";
      else if (staged.actionId === "protect-pdf") activeTool = "security";
      else if (staged.actionId === "edit-sign") activeTool = "studio";
    }
  });
</script>

<div class="cz-pdf-suite-page">
  <HubHeader
    title="PDF Suite & Studio"
    description="Browser-native workstation for organizing, splitting, editing, signing, watermarking, filling, and securing PDF documents."
    activeToolId={activeTool}
    tools={[
      { id: "split", label: "Split", icon: "✂️" },
      { id: "organize", label: "Organize", icon: "📑" },
      { id: "studio", label: "Studio", icon: "✏️" },
      { id: "watermark", label: "Watermark", icon: "💧" },
      { id: "crop", label: "Crop", icon: "📐" },
      { id: "forms", label: "Forms", icon: "📋" },
      { id: "security", label: "Protect", icon: "🔐" },
      { id: "repair", label: "Repair", icon: "🩹" },
    ]}
    onSelectTool={(id) => (activeTool = id as SubTool)}
    onFilesSelected={(files) => files[0] && loadFile(files[0])}
  />

  <div class="cz-pdf-suite-content">
    {#if !selectedFile}
      <div class="cz-suite-upload-box">
        <FileDropzone
          accept="application/pdf,.pdf"
          multiple={false}
          onFiles={(files) => files[0] && loadFile(files[0])}
        />
        <div class="cz-suite-quick-links">
          <span>Looking to merge multiple documents?</span>
          <button
            type="button"
            class="cz-link-btn"
            onclick={() => navigate("compress/merge-pdf")}
          >
            Open Merge PDF →
          </button>
        </div>
      </div>
    {:else}
      <div class="cz-suite-active-layout">
        <!-- Top File Summary Bar -->
        <div class="cz-suite-file-bar">
          <div class="cz-file-meta-pill">
            <span class="cz-file-icon">📄</span>
            <span class="cz-file-name">{selectedFile.name}</span>
            <span class="cz-file-size">{formatBytes(selectedFile.size)}</span>
            {#if totalPages > 0}
              <span class="cz-file-pages">{totalPages} pages</span>
            {/if}
          </div>

          <div class="cz-file-bar-actions">
            <button
              type="button"
              class="cz-btn cz-btn-ghost cz-btn-sm"
              onclick={() => { selectedFile = null; pdfBytes = null; }}
            >
              Change File
            </button>
          </div>
        </div>

        <!-- Tool Workspace -->
        <div class="cz-tool-workspace-panel">
          {#if activeTool === "studio"}
            {#if pdfBytes}
              <PdfCanvasEditor
                pdfBytes={pdfBytes}
                onExport={(mod) => downloadBlob(new Blob([mod], { type: "application/pdf" }), `${selectedFile?.name.replace(/\.pdf$/i, "")}-annotated.pdf`)}
              />
            {/if}
          {:else if activeTool === "organize"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Visual Page Organizer</h3>
                <p>Drag or use arrows to reorder pages, rotate 90°, duplicate, or delete.</p>
              </div>
              <PageGrid
                pages={pageSpecs}
                thumbnails={pageThumbnails}
                onUpdate={(up) => (pageSpecs = up)}
              />
              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Reorganizing…" : "Save Reorganized PDF"}
                </button>
              </div>
            </div>
          {:else if activeTool === "split"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Split Document</h3>
                <p>Extract specific page ranges, split into N-page chunks, or burst all pages.</p>
              </div>

              <div class="cz-settings-row">
                <span class="cz-label">Split Mode</span>
                <div class="cz-segmented-track">
                  <button
                    type="button"
                    class="cz-segmented-item {splitMode === 'ranges' ? 'is-active' : ''}"
                    onclick={() => (splitMode = 'ranges')}
                  >
                    Custom Ranges
                  </button>
                  <button
                    type="button"
                    class="cz-segmented-item {splitMode === 'chunk' ? 'is-active' : ''}"
                    onclick={() => (splitMode = 'chunk')}
                  >
                    Every N Pages
                  </button>
                  <button
                    type="button"
                    class="cz-segmented-item {splitMode === 'burst' ? 'is-active' : ''}"
                    onclick={() => (splitMode = 'burst')}
                  >
                    Burst (All)
                  </button>
                </div>
              </div>

              {#if splitMode === "ranges"}
                <div class="cz-settings-row">
                  <label for="split-ranges">Page Ranges (e.g. 1-3, 5, 8-10)</label>
                  <input
                    id="split-ranges"
                    type="text"
                    class="cz-input"
                    bind:value={splitRanges}
                  />
                </div>
              {:else if splitMode === "chunk"}
                <div class="cz-settings-row">
                  <label for="split-chunk">Pages per file</label>
                  <input
                    id="split-chunk"
                    type="number"
                    min="1"
                    max={totalPages || 100}
                    class="cz-input"
                    bind:value={splitChunkSize}
                  />
                </div>
              {/if}

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Splitting…" : "Execute PDF Split"}
                </button>
              </div>
            </div>
          {:else if activeTool === "watermark"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Watermark Settings</h3>
                <p>Stamp dynamic text, adjustable opacity, custom angle, or tiled repeat grid.</p>
              </div>

              <div class="cz-settings-row">
                <label for="wm-text">Watermark Text</label>
                <input
                  id="wm-text"
                  type="text"
                  class="cz-input"
                  bind:value={watermarkText}
                />
              </div>

              <div class="cz-settings-row">
                <label for="wm-opacity">Opacity ({Math.round(watermarkOpacity * 100)}%)</label>
                <input
                  id="wm-opacity"
                  type="range"
                  min="0.05"
                  max="1.0"
                  step="0.05"
                  bind:value={watermarkOpacity}
                />
              </div>

              <div class="cz-settings-row">
                <label for="wm-rotation">Rotation Angle ({watermarkRotation}°)</label>
                <input
                  id="wm-rotation"
                  type="range"
                  min="-90"
                  max="90"
                  step="5"
                  bind:value={watermarkRotation}
                />
              </div>

              <div class="cz-settings-row">
                <span class="cz-label">Pattern</span>
                <div class="cz-segmented-track">
                  <button
                    type="button"
                    class="cz-segmented-item {!watermarkTiled ? 'is-active' : ''}"
                    onclick={() => (watermarkTiled = false)}
                  >
                    Centered Stamp
                  </button>
                  <button
                    type="button"
                    class="cz-segmented-item {watermarkTiled ? 'is-active' : ''}"
                    onclick={() => (watermarkTiled = true)}
                  >
                    Tiled Repeating Grid
                  </button>
                </div>
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Applying…" : "Apply Watermark"}
                </button>
              </div>
            </div>
          {:else if activeTool === "crop"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Permanent Crop Box</h3>
                <p>Trim outer margins permanently from MediaBox, CropBox, and BleedBox.</p>
              </div>

              <div class="cz-crop-inputs-grid">
                <div class="cz-crop-input-card">
                  <label for="crop-top">Top (points)</label>
                  <input id="crop-top" type="number" min="0" bind:value={cropMarginTop} class="cz-input" />
                </div>
                <div class="cz-crop-input-card">
                  <label for="crop-bottom">Bottom (points)</label>
                  <input id="crop-bottom" type="number" min="0" bind:value={cropMarginBottom} class="cz-input" />
                </div>
                <div class="cz-crop-input-card">
                  <label for="crop-left">Left (points)</label>
                  <input id="crop-left" type="number" min="0" bind:value={cropMarginLeft} class="cz-input" />
                </div>
                <div class="cz-crop-input-card">
                  <label for="crop-right">Right (points)</label>
                  <input id="crop-right" type="number" min="0" bind:value={cropMarginRight} class="cz-input" />
                </div>
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Cropping…" : "Apply Permanent Crop"}
                </button>
              </div>
            </div>
          {:else if activeTool === "forms"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Interactive AcroForms</h3>
                <p>Edit form field values and optionally flatten them into immutable static vectors.</p>
              </div>

              {#if formFields.length === 0}
                <div class="cz-empty-form-notice">
                  ℹ️ This PDF does not contain interactive form fields.
                </div>
              {:else}
                <div class="cz-forms-list">
                  {#each formFields as field}
                    <div class="cz-form-field-card">
                      <label for={`field-${field.name}`}>{field.name}</label>
                      {#if field.type === "checkbox"}
                        <input
                          id={`field-${field.name}`}
                          type="checkbox"
                          bind:checked={formValues[field.name]}
                        />
                      {:else if field.type === "dropdown" && field.options}
                        <select id={`field-${field.name}`} class="cz-input" bind:value={formValues[field.name]}>
                          {#each field.options as opt}
                            <option value={opt}>{opt}</option>
                          {/each}
                        </select>
                      {:else}
                        <input
                          id={`field-${field.name}`}
                          type="text"
                          class="cz-input"
                          bind:value={formValues[field.name]}
                        />
                      {/if}
                    </div>
                  {/each}
                </div>

                <div class="cz-settings-row">
                  <label for="flatten-check">
                    <input id="flatten-check" type="checkbox" bind:checked={flattenForm} />
                    <span>Flatten form fields (makes them permanent and non-editable)</span>
                  </label>
                </div>
              {/if}

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || formFields.length === 0}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Saving…" : "Save Form"}
                </button>
              </div>
            </div>
          {:else if activeTool === "security"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Security & Password Control</h3>
                <p>Enforce AES-256 encryption with dual user/owner passwords or unlock protected documents.</p>
              </div>

              <div class="cz-segmented-track" style="margin-bottom: 1rem;">
                <button
                  type="button"
                  class="cz-segmented-item {securityMode === 'protect' ? 'is-active' : ''}"
                  onclick={() => (securityMode = 'protect')}
                >
                  Encrypt & Protect
                </button>
                <button
                  type="button"
                  class="cz-segmented-item {securityMode === 'unlock' ? 'is-active' : ''}"
                  onclick={() => (securityMode = 'unlock')}
                >
                  Decrypt & Unlock
                </button>
              </div>

              <div class="cz-settings-row">
                <label for="user-pass">{securityMode === "protect" ? "User Password (to open document)" : "Document Password"}</label>
                <input
                  id="user-pass"
                  type="password"
                  class="cz-input"
                  placeholder="Enter password..."
                  bind:value={userPassword}
                />
              </div>

              {#if securityMode === "protect"}
                <div class="cz-settings-row">
                  <label for="owner-pass">Owner / Master Password (permissions control)</label>
                  <input
                    id="owner-pass"
                    type="password"
                    class="cz-input"
                    placeholder="Optional master password..."
                    bind:value={ownerPassword}
                  />
                </div>

                <div class="cz-permissions-box">
                  <label>
                    <input type="checkbox" bind:checked={allowPrinting} />
                    <span>Allow Printing</span>
                  </label>
                  <label>
                    <input type="checkbox" bind:checked={allowCopying} />
                    <span>Allow Text & Graphics Copying</span>
                  </label>
                </div>
              {/if}

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || !userPassword}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Processing…" : securityMode === "protect" ? "Encrypt Document" : "Decrypt & Unlock"}
                </button>
              </div>
            </div>
          {:else if activeTool === "repair"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>File Recovery & Repair</h3>
                <p>Rebuilds damaged xref tables, repairs broken trailers, and restores unfinalized MP4 videos.</p>
              </div>

              <div class="cz-repair-status-box">
                <div class="cz-repair-icon">🩹</div>
                <div class="cz-repair-info">
                  <strong>Deep Document Repair Engine</strong>
                  <p>Analyzes byte streams, discovers orphan PDF objects, reconstructs cross-reference indexes, and fixes truncated container atoms.</p>
                </div>
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Repairing…" : "Execute Deep Repair"}
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .cz-pdf-suite-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .cz-suite-upload-box {
    max-width: 680px;
    margin: 2rem auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .cz-suite-quick-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-3);
  }

  .cz-link-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .cz-suite-active-layout {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .cz-suite-file-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 0.75rem 1.25rem;
    box-shadow: var(--shadow-sm);
  }

  .cz-file-meta-pill {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    font-size: 0.88rem;
  }

  .cz-file-name {
    font-weight: 600;
    color: var(--text);
  }

  .cz-file-size, .cz-file-pages {
    color: var(--text-3);
    font-size: 0.78rem;
    background: var(--surface2);
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
  }

  .cz-tool-workspace-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 1.5rem;
    box-shadow: var(--shadow-sm);
  }

  .cz-section-header {
    margin-bottom: 1.25rem;
  }

  .cz-section-header h3 {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
    margin: 0 0 0.25rem;
  }

  .cz-section-header p {
    font-size: 0.84rem;
    color: var(--text-3);
    margin: 0;
  }

  .cz-settings-row {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-bottom: 1.15rem;
  }

  .cz-settings-row label, .cz-settings-row .cz-label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-2);
  }

  .cz-input {
    padding: 0.6rem 0.85rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    font-size: 0.9rem;
    outline: none;
    max-width: 480px;
  }

  .cz-input:focus {
    border-color: var(--accent);
  }

  .cz-crop-inputs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .cz-crop-input-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .cz-crop-input-card label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-3);
  }

  .cz-forms-list {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    margin-bottom: 1.25rem;
  }

  .cz-form-field-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .cz-form-field-card label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-2);
  }

  .cz-permissions-box {
    display: flex;
    gap: 1.25rem;
    font-size: 0.84rem;
    color: var(--text-2);
    margin-top: 0.5rem;
  }

  .cz-permissions-box label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
  }

  .cz-repair-status-box {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    margin-bottom: 1.5rem;
  }

  .cz-repair-icon {
    font-size: 2rem;
  }

  .cz-repair-info strong {
    font-size: 0.95rem;
    color: var(--text);
    display: block;
    margin-bottom: 0.25rem;
  }

  .cz-repair-info p {
    font-size: 0.82rem;
    color: var(--text-3);
    margin: 0;
    line-height: 1.4;
  }

  .cz-action-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .cz-segmented-track {
    display: inline-flex;
    background: var(--surface2);
    border-radius: 100px;
    padding: 0.2rem;
    border: 1px solid var(--border);
  }

  .cz-segmented-item {
    padding: 0.35rem 0.85rem;
    font-size: 0.8rem;
    font-weight: 500;
    border-radius: 100px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-2);
    transition: background var(--t), color var(--t);
  }

  .cz-segmented-item.is-active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    box-shadow: var(--shadow-sm);
  }

  .cz-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--t);
  }

  .cz-btn-primary {
    background: var(--accent);
    color: #ffffff;
    border: 1px solid transparent;
  }

  .cz-btn-primary:hover:not(:disabled) {
    background: var(--accent-2);
  }

  .cz-btn-ghost {
    background: transparent;
    color: var(--text-3);
    border: 1px solid var(--border);
  }

  .cz-btn-ghost:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface2);
  }
</style>
