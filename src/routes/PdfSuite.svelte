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
  import { repairCorruptPdf, inspectAndRepairMp4Moov } from "../lib/pdfTools/repairPdf";
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
  let redactX = $state<number>(50);
  let redactY = $state<number>(50);
  let redactWidth = $state<number>(200);
  let redactHeight = $state<number>(30);
  let redactionList = $state<RedactionRegion[]>([]);

  function addRedactionRegion() {
    if (redactPage < 1 || redactPage > (totalPages || 1)) {
      toast(`Page must be between 1 and ${totalPages || 1}`, "error");
      return;
    }
    redactionList = [
      ...redactionList,
      {
        pageIndex: redactPage - 1,
        x: Number(redactX) || 0,
        y: Number(redactY) || 0,
        width: Math.max(10, Number(redactWidth) || 50),
        height: Math.max(10, Number(redactHeight) || 20),
        overlayText: redactReason || undefined,
      },
    ];
    toast(`Added redaction region on page ${redactPage}`, "info");
  }

  function removeRedactionRegion(index: number) {
    redactionList = redactionList.filter((_, i) => i !== index);
  }

  function clearAllRedactions() {
    redactionList = [];
  }

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
        if (!selectedFile?.name.toLowerCase().endsWith(".pdf") && selectedFile?.type !== "application/pdf") {
          toast("Watermarking is only supported for PDF documents.", "error");
          return;
        }
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
        const isVideo =
          selectedFile?.type.startsWith("video/") ||
          /\.(mp4|mov|m4v)$/i.test(selectedFile?.name || "");
        if (isVideo) {
          const rep = inspectAndRepairMp4Moov(bytes);
          downloadBlob(
            new Blob([rep.repairedBytes], { type: selectedFile?.type || "video/mp4" }),
            `repaired-${selectedFile?.name || "video.mp4"}`,
          );
          toast(rep.message, rep.fixed ? "success" : "info");
        } else {
          const rep = await repairCorruptPdf(bytes, (p) => (progressPct = p));
          downloadBlob(
            new Blob([rep.repairedBytes], { type: "application/pdf" }),
            `repaired-${selectedFile?.name || "document.pdf"}`,
          );
          toast(rep.message, "success");
        }
      } else if (activeTool === "redact") {
        if (redactionList.length === 0) {
          toast("Please add at least one redaction region before exporting.", "error");
          return;
        }
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
    if (typeof window !== "undefined") {
      const parts = window.location.pathname.split("/").filter(Boolean);
      const sub = parts[parts.length - 1];
      if (sub === "split") activeTool = "split";
      else if (sub === "organize") activeTool = "organize";
      else if (sub === "crop") activeTool = "crop";
      else if (sub === "forms") activeTool = "forms";
      else if (sub === "watermark") activeTool = "watermark";
      else if (sub === "redact") activeTool = "redact";
      else if (sub === "protect" || sub === "security") activeTool = "security";
      else if (sub === "repair") activeTool = "repair";
      else if (sub === "edit" || sub === "studio" || sub === "sign") activeTool = "studio";
    }

    const staged = consumeStagedUniversalFile();
    if (staged?.file) {
      loadFile(staged.file);
      if (staged.actionId === "split-pdf") activeTool = "split";
      else if (staged.actionId === "organize-pdf") activeTool = "organize";
      else if (staged.actionId === "watermark-pdf") activeTool = "watermark";
      else if (staged.actionId === "crop-pdf") activeTool = "crop";
      else if (staged.actionId === "fill-forms") activeTool = "forms";
      else if (staged.actionId === "redact-pdf") activeTool = "redact";
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
      { id: "split", name: "Split", icon: "split" },
      { id: "organize", name: "Organize", icon: "organize" },
      { id: "studio", name: "Studio", icon: "studio" },
      { id: "watermark", name: "Watermark", icon: "watermark" },
      { id: "crop", name: "Crop", icon: "crop" },
      { id: "forms", name: "Forms", icon: "forms" },
      { id: "redact", name: "Redact", icon: "redact" },
      { id: "security", name: "Protect", icon: "security" },
      { id: "repair", name: "Repair", icon: "repair" },
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
          {:else if activeTool === "redact"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>True Irreversible Redaction</h3>
                <p>
                  Permanently destroys vector text and image streams in the marked regions via 300-DPI raster burn-in. Content cannot be recovered or selected.
                </p>
              </div>

              <div class="cz-redact-workspace">
                <div class="cz-redact-controls">
                  <div class="cz-field-group">
                    <span class="cz-label">Page Number (1 to {totalPages || 1})</span>
                    <input
                      type="number"
                      min="1"
                      max={totalPages || 1}
                      bind:value={redactPage}
                      class="cz-input"
                    />
                  </div>

                  <div class="cz-field-group">
                    <span class="cz-label">Redaction Reason / Label</span>
                    <input
                      type="text"
                      placeholder="e.g. [REDACTED], PII, CONFIDENTIAL"
                      bind:value={redactReason}
                      class="cz-input"
                    />
                  </div>

                  <div class="cz-form-grid-2">
                    <div class="cz-field-group">
                      <span class="cz-label">X Offset (pt)</span>
                      <input type="number" min="0" bind:value={redactX} class="cz-input" />
                    </div>
                    <div class="cz-field-group">
                      <span class="cz-label">Y Offset (pt)</span>
                      <input type="number" min="0" bind:value={redactY} class="cz-input" />
                    </div>
                    <div class="cz-field-group">
                      <span class="cz-label">Width (pt)</span>
                      <input type="number" min="5" bind:value={redactWidth} class="cz-input" />
                    </div>
                    <div class="cz-field-group">
                      <span class="cz-label">Height (pt)</span>
                      <input type="number" min="5" bind:value={redactHeight} class="cz-input" />
                    </div>
                  </div>

                  <div class="cz-redact-btn-row">
                    <button
                      type="button"
                      class="cz-btn cz-btn-secondary"
                      onclick={addRedactionRegion}
                    >
                      + Add Redaction Region
                    </button>
                    <button
                      type="button"
                      class="cz-btn cz-btn-outline"
                      onclick={() => (showStudio = true)}
                    >
                      Draw in Studio
                    </button>
                  </div>
                </div>

                <div class="cz-redact-list-pane">
                  <div class="cz-redact-list-header">
                    <strong>Staged Regions ({redactionList.length})</strong>
                    {#if redactionList.length > 0}
                      <button
                        type="button"
                        class="cz-btn cz-btn-subtle cz-btn-sm"
                        onclick={clearAllRedactions}
                      >
                        Clear All
                      </button>
                    {/if}
                  </div>

                  {#if redactionList.length === 0}
                    <div class="cz-empty-redact-note">
                      <p>No redaction regions defined yet.</p>
                      <small>Enter coordinates above or use Draw in Studio to mark areas.</small>
                    </div>
                  {:else}
                    <div class="cz-redactions-table">
                      {#each redactionList as reg, idx}
                        <div class="cz-redact-item">
                          <span class="cz-redact-chip">Page {reg.pageIndex + 1}</span>
                          <span class="cz-redact-coords">({reg.x}, {reg.y}) {reg.width}×{reg.height}pt</span>
                          {#if reg.overlayText}
                            <span class="cz-redact-tag">{reg.overlayText}</span>
                          {/if}
                          <button
                            type="button"
                            class="cz-redact-del-btn"
                            aria-label="Remove region"
                            onclick={() => removeRedactionRegion(idx)}
                          >
                            ×
                          </button>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || redactionList.length === 0}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Burning in Redactions…" : "Apply True Redaction & Export"}
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

  .cz-redact-workspace {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }
  @media (max-width: 768px) {
    .cz-redact-workspace {
      grid-template-columns: 1fr;
    }
  }
  .cz-redact-controls {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cz-redact-btn-row {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }
  .cz-redact-list-pane {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 380px;
    overflow-y: auto;
  }
  .cz-redact-list-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.88rem;
    color: var(--text);
  }
  .cz-empty-redact-note {
    text-align: center;
    padding: 2rem 1rem;
    color: var(--text-3);
  }
  .cz-redactions-table {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cz-redact-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
  }
  .cz-redact-chip {
    font-weight: 700;
    color: var(--text);
  }
  .cz-redact-coords {
    color: var(--text-3);
    font-family: var(--mono);
    font-size: 0.75rem;
  }
  .cz-redact-tag {
    background: var(--rose-soft, #fee2e2);
    color: var(--rose, #dc2626);
    padding: 0.15rem 0.4rem;
    border-radius: var(--r-xs);
    font-size: 0.72rem;
    font-weight: 600;
  }
  .cz-redact-del-btn {
    background: transparent;
    border: none;
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-3);
    padding: 0.2rem 0.4rem;
  }
  .cz-redact-del-btn:hover {
    color: var(--rose, #dc2626);
  }
</style>
