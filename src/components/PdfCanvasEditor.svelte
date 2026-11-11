<script lang="ts">
  import { onMount } from "svelte";
  import { openPdfDocument, getPdfLib } from "../lib/pdfLibs";
  import type { RedactionRegion } from "../lib/pdfTools/redactPdf";
  import SignaturePad from "./SignaturePad.svelte";

  interface Props {
    pdfBytes: Uint8Array;
    onExport: (modifiedBytes: Uint8Array) => void;
  }

  let { pdfBytes, onExport }: Props = $props();

  type Tool = "select" | "text" | "ink" | "highlighter" | "stamp" | "redact";

  let activeTool = $state<Tool>("select");
  let currentPage = $state<number>(1);
  let totalPages = $state<number>(1);
  let zoomLevel = $state<number>(1.0);
  let isSigModalOpen = $state<boolean>(false);
  let activeStampUrl = $state<string | null>(null);

  // Annotations stored per page: pageNumber -> array of annotations
  interface Annotation {
    id: string;
    type: Tool;
    x: number; // in points
    y: number; // in points
    width: number;
    height: number;
    text?: string;
    color?: string;
    fontSize?: number;
    points?: { x: number; y: number }[];
    dataUrl?: string; // for stamps/signatures
  }

  let annotations = $state<Record<number, Annotation[]>>({});
  let canvasEl: HTMLCanvasElement;
  let overlayCanvasEl: HTMLCanvasElement;
  let pdfDocInstance: any = null;
  let pageThumbnails = $state<Record<number, string>>({});
  let isDrawing = false;
  let currentStrokePoints: { x: number; y: number }[] = [];

  // Color & styling options
  let activeColor = $state<string>("#ef4444"); // Red for text
  let highlighterColor = $state<string>("rgba(254, 240, 138, 0.45)"); // Yellow highlighter

  async function renderPage(pageNum: number) {
    if (!pdfDocInstance || !canvasEl || !overlayCanvasEl) return;
    const page = await pdfDocInstance.getPage(pageNum);
    const viewport = page.getViewport({ scale: zoomLevel * 1.5 });

    canvasEl.width = Math.round(viewport.width);
    canvasEl.height = Math.round(viewport.height);
    overlayCanvasEl.width = Math.round(viewport.width);
    overlayCanvasEl.height = Math.round(viewport.height);

    const ctx = canvasEl.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    redrawOverlay();
  }

  function redrawOverlay() {
    if (!overlayCanvasEl) return;
    const ctx = overlayCanvasEl.getContext("2d")!;
    ctx.clearRect(0, 0, overlayCanvasEl.width, overlayCanvasEl.height);

    const pageAnns = annotations[currentPage] || [];
    for (const ann of pageAnns) {
      if (ann.type === "ink" && ann.points && ann.points.length > 1) {
        ctx.save();
        ctx.strokeStyle = ann.color || "#000000";
        ctx.lineWidth = 3 * zoomLevel;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * zoomLevel * 1.5, ann.points[0].y * zoomLevel * 1.5);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * zoomLevel * 1.5, ann.points[i].y * zoomLevel * 1.5);
        }
        ctx.stroke();
        ctx.restore();
      } else if (ann.type === "highlighter" && ann.points && ann.points.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.strokeStyle = ann.color || "rgba(254, 240, 138, 0.45)";
        ctx.lineWidth = 18 * zoomLevel;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * zoomLevel * 1.5, ann.points[0].y * zoomLevel * 1.5);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * zoomLevel * 1.5, ann.points[i].y * zoomLevel * 1.5);
        }
        ctx.stroke();
        ctx.restore();
      } else if (ann.type === "redact") {
        ctx.save();
        ctx.fillStyle = "#000000";
        ctx.fillRect(
          ann.x * zoomLevel * 1.5,
          ann.y * zoomLevel * 1.5,
          ann.width * zoomLevel * 1.5,
          ann.height * zoomLevel * 1.5,
        );
        ctx.restore();
      }
    }
  }

  function handleOverlayMouseDown(e: MouseEvent) {
    if (activeTool === "select") return;
    const rect = overlayCanvasEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoomLevel * 1.5);
    const y = (e.clientY - rect.top) / (zoomLevel * 1.5);

    if (activeTool === "text") {
      const text = prompt("Enter text annotation:", "Note");
      if (text) {
        const ann: Annotation = {
          id: `ann-${Date.now()}`,
          type: "text",
          x,
          y,
          width: 120,
          height: 30,
          text,
          color: activeColor,
          fontSize: 16,
        };
        addAnnotation(ann);
      }
    } else if (activeTool === "ink" || activeTool === "highlighter") {
      isDrawing = true;
      currentStrokePoints = [{ x, y }];
    } else if (activeTool === "stamp" && activeStampUrl) {
      const ann: Annotation = {
        id: `ann-${Date.now()}`,
        type: "stamp",
        x: x - 80,
        y: y - 30,
        width: 160,
        height: 60,
        dataUrl: activeStampUrl,
      };
      addAnnotation(ann);
    } else if (activeTool === "redact") {
      const ann: Annotation = {
        id: `ann-${Date.now()}`,
        type: "redact",
        x: x - 60,
        y: y - 12,
        width: 120,
        height: 24,
      };
      addAnnotation(ann);
    }
  }

  function handleOverlayMouseMove(e: MouseEvent) {
    if (!isDrawing) return;
    const rect = overlayCanvasEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoomLevel * 1.5);
    const y = (e.clientY - rect.top) / (zoomLevel * 1.5);
    currentStrokePoints.push({ x, y });

    // Live overlay draw
    const ctx = overlayCanvasEl.getContext("2d")!;
    ctx.save();
    if (activeTool === "highlighter") {
      ctx.globalCompositeOperation = "multiply";
      ctx.strokeStyle = highlighterColor;
      ctx.lineWidth = 18 * zoomLevel;
    } else {
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 3 * zoomLevel;
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const len = currentStrokePoints.length;
    if (len > 1) {
      ctx.moveTo(currentStrokePoints[len - 2].x * zoomLevel * 1.5, currentStrokePoints[len - 2].y * zoomLevel * 1.5);
      ctx.lineTo(currentStrokePoints[len - 1].x * zoomLevel * 1.5, currentStrokePoints[len - 1].y * zoomLevel * 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function handleOverlayMouseUp() {
    if (!isDrawing) return;
    isDrawing = false;
    if (currentStrokePoints.length > 1) {
      const ann: Annotation = {
        id: `ann-${Date.now()}`,
        type: activeTool,
        x: currentStrokePoints[0].x,
        y: currentStrokePoints[0].y,
        width: 0,
        height: 0,
        color: activeTool === "highlighter" ? highlighterColor : activeColor,
        points: [...currentStrokePoints],
      };
      addAnnotation(ann);
    }
    currentStrokePoints = [];
  }

  function addAnnotation(ann: Annotation) {
    const next = { ...annotations };
    const list = next[currentPage] ? [...next[currentPage]] : [];
    list.push(ann);
    next[currentPage] = list;
    annotations = next;
    redrawOverlay();
  }

  function handleSignatureSaved(dataUrl: string) {
    activeStampUrl = dataUrl;
    isSigModalOpen = false;
    activeTool = "stamp";
  }

  async function handleExportPdf() {
    const { PDFDocument, rgb, StandardFonts } = await getPdfLib();
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const trueRedactionRegions: RedactionRegion[] = [];

    for (let p = 1; p <= totalPages; p++) {
      const pageAnns = annotations[p] || [];
      if (pageAnns.length === 0) continue;

      const page = pdfDoc.getPage(p - 1);
      const { height } = page.getSize();

      for (const ann of pageAnns) {
        if (ann.type === "text" && ann.text) {
          page.drawText(ann.text, {
            x: ann.x,
            y: height - ann.y - (ann.fontSize || 16),
            size: ann.fontSize || 16,
            font,
            color: rgb(0.9, 0.1, 0.1),
          });
        } else if (ann.type === "redact") {
          // Collect as true redaction region to permanently purge underlying vectors & text
          trueRedactionRegions.push({
            pageIndex: p - 1,
            x: ann.x,
            y: height - ann.y - ann.height,
            width: ann.width,
            height: ann.height,
            overlayText: "[REDACTED]",
          });
        } else if (ann.type === "stamp" && ann.dataUrl) {
          const imgBytes = Uint8Array.from(atob(ann.dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
          const embedded = await pdfDoc.embedPng(imgBytes);
          page.drawImage(embedded, {
            x: ann.x,
            y: height - ann.y - ann.height,
            width: ann.width,
            height: ann.height,
          });
        }
      }
    }

    let modified = await pdfDoc.save();

    // If true redactions exist, apply irreversible raster burn-in to sanitize document
    if (trueRedactionRegions.length > 0) {
      const { applyTrueRedaction } = await import("../lib/pdfTools/redactPdf");
      modified = await applyTrueRedaction(modified, {
        regions: trueRedactionRegions,
      });
    }

    onExport(modified);
  }

  onMount(async () => {
    pdfDocInstance = await openPdfDocument(pdfBytes);
    totalPages = pdfDocInstance.numPages;
    await renderPage(1);

    // Generate thumbnails for pages
    for (let i = 1; i <= Math.min(totalPages, 20); i++) {
      const p = await pdfDocInstance.getPage(i);
      const vp = p.getViewport({ scale: 0.2 });
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = Math.round(vp.width);
      thumbCanvas.height = Math.round(vp.height);
      const tctx = thumbCanvas.getContext("2d")!;
      await p.render({ canvasContext: tctx, viewport: vp }).promise;
      pageThumbnails[i] = thumbCanvas.toDataURL("image/jpeg", 0.65);
    }
  });

  $effect(() => {
    if (currentPage && zoomLevel) {
      renderPage(currentPage);
    }
  });
</script>

<div class="cz-pdf-studio">
  <!-- Top Zen Toolbar -->
  <div class="cz-studio-toolbar">
    <div class="cz-studio-tool-group">
      <button
        type="button"
        class="cz-studio-btn {activeTool === 'select' ? 'is-active' : ''}"
        title="Select & Move"
        onclick={() => (activeTool = 'select')}
      >
        👆 Select
      </button>

      <button
        type="button"
        class="cz-studio-btn {activeTool === 'text' ? 'is-active' : ''}"
        title="Add FreeText annotation"
        onclick={() => (activeTool = 'text')}
      >
        🔤 Text
      </button>

      <button
        type="button"
        class="cz-studio-btn {activeTool === 'ink' ? 'is-active' : ''}"
        title="Ink freehand pen"
        onclick={() => (activeTool = 'ink')}
      >
        ✏️ Ink Pen
      </button>

      <button
        type="button"
        class="cz-studio-btn {activeTool === 'highlighter' ? 'is-active' : ''}"
        title="Highlighter tool"
        onclick={() => (activeTool = 'highlighter')}
      >
        🖍️ Highlight
      </button>

      <button
        type="button"
        class="cz-studio-btn {activeTool === 'stamp' ? 'is-active' : ''}"
        title="Sign or Stamp"
        onclick={() => (isSigModalOpen = true)}
      >
        🖋️ Signature / Stamp
      </button>

      <button
        type="button"
        class="cz-studio-btn {activeTool === 'redact' ? 'is-active' : ''}"
        title="Redaction block"
        onclick={() => (activeTool = 'redact')}
      >
        ⬛ Redact
      </button>
    </div>

    <div class="cz-studio-zoom-group">
      <button
        type="button"
        class="cz-zoom-btn"
        disabled={zoomLevel <= 0.6}
        onclick={() => (zoomLevel = Math.max(0.5, zoomLevel - 0.2))}
      >
        −
      </button>
      <span class="cz-zoom-label">{Math.round(zoomLevel * 100)}%</span>
      <button
        type="button"
        class="cz-zoom-btn"
        disabled={zoomLevel >= 2.0}
        onclick={() => (zoomLevel = Math.min(2.0, zoomLevel + 0.2))}
      >
        +
      </button>
    </div>

    <button
      type="button"
      class="cz-btn cz-btn-primary cz-btn-sm"
      onclick={handleExportPdf}
    >
      💾 Save & Export PDF
    </button>
  </div>

  <div class="cz-studio-workspace">
    <!-- Left Zen Vertical Thumbnail Bar -->
    <aside class="cz-studio-thumbnails" aria-label="Page thumbnails">
      {#each Array.from({ length: totalPages }, (_, i) => i + 1) as pageNum}
        <button
          type="button"
          class="cz-studio-thumb-card {currentPage === pageNum ? 'is-active' : ''}"
          onclick={() => (currentPage = pageNum)}
        >
          {#if pageThumbnails[pageNum]}
            <img src={pageThumbnails[pageNum]} alt="Thumb {pageNum}" class="cz-thumb-img" />
          {:else}
            <div class="cz-thumb-placeholder">{pageNum}</div>
          {/if}
          <span class="cz-thumb-num">{pageNum}</span>
        </button>
      {/each}
    </aside>

    <!-- Canvas Viewport -->
    <main class="cz-studio-canvas-wrap">
      <div class="cz-canvas-layer-stack">
        <canvas bind:this={canvasEl} class="cz-base-pdf-canvas"></canvas>
        <canvas
          bind:this={overlayCanvasEl}
          class="cz-overlay-ann-canvas {activeTool !== 'select' ? 'is-interactive' : ''}"
          onmousedown={handleOverlayMouseDown}
          onmousemove={handleOverlayMouseMove}
          onmouseup={handleOverlayMouseUp}
        ></canvas>

        <!-- HTML-based Floating Text Annotations on current page -->
        {#each annotations[currentPage] || [] as ann (ann.id)}
          {#if ann.type === "text"}
            <div
              class="cz-floating-text-ann"
              style="left: {ann.x * zoomLevel * 1.5}px; top: {ann.y * zoomLevel * 1.5}px; font-size: {(ann.fontSize || 16) * zoomLevel * 1.5}px; color: {ann.color || '#ef4444'};"
            >
              {ann.text}
            </div>
          {:else if ann.type === "stamp" && ann.dataUrl}
            <img
              src={ann.dataUrl}
              alt="Stamp"
              class="cz-floating-stamp"
              style="left: {ann.x * zoomLevel * 1.5}px; top: {ann.y * zoomLevel * 1.5}px; width: {ann.width * zoomLevel * 1.5}px; height: {ann.height * zoomLevel * 1.5}px;"
            />
          {/if}
        {/each}
      </div>
    </main>
  </div>

  {#if isSigModalOpen}
    <div class="cz-sig-modal-backdrop">
      <SignaturePad
        onSave={handleSignatureSaved}
        onCancel={() => (isSigModalOpen = false)}
      />
    </div>
  {/if}
</div>

<style>
  .cz-pdf-studio {
    display: flex;
    flex-direction: column;
    height: 82vh;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r);
    overflow: hidden;
    box-shadow: var(--shadow-lg);
  }

  .cz-studio-toolbar {
    height: 52px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    gap: 0.75rem;
    z-index: 10;
  }

  .cz-studio-tool-group {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .cz-studio-btn {
    padding: 0.35rem 0.65rem;
    border-radius: 100px;
    font-size: 0.8rem;
    font-weight: 500;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-2);
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }

  .cz-studio-btn:hover {
    background: var(--bg2);
    color: var(--text);
  }

  .cz-studio-btn.is-active {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent-glow);
    font-weight: 600;
  }

  .cz-studio-zoom-group {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--surface2);
    padding: 0.15rem 0.5rem;
    border-radius: 100px;
    border: 1px solid var(--border);
  }

  .cz-zoom-btn {
    background: none;
    border: none;
    font-size: 1rem;
    cursor: pointer;
    color: var(--text);
    padding: 0 0.35rem;
  }

  .cz-zoom-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text);
    min-width: 40px;
    text-align: center;
  }

  .cz-studio-workspace {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .cz-studio-thumbnails {
    width: 120px;
    background: var(--surface2);
    border-right: 1px solid var(--border);
    padding: 0.75rem 0.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .cz-studio-thumb-card {
    background: var(--surface);
    border: 2px solid transparent;
    border-radius: var(--r-sm);
    padding: 0.25rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    transition: border-color var(--t);
  }

  .cz-studio-thumb-card.is-active {
    border-color: var(--accent);
    box-shadow: 0 0 8px var(--accent-glow);
  }

  .cz-thumb-img {
    width: 100%;
    aspect-ratio: 1 / 1.414;
    object-fit: contain;
    border-radius: 2px;
  }

  .cz-thumb-placeholder {
    width: 100%;
    aspect-ratio: 1 / 1.414;
    background: var(--surface2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    color: var(--text-3);
  }

  .cz-thumb-num {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-3);
  }

  .cz-studio-canvas-wrap {
    flex: 1;
    overflow: auto;
    background: var(--bg2);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 2rem;
  }

  .cz-canvas-layer-stack {
    position: relative;
    box-shadow: var(--shadow-xl);
    border-radius: 4px;
    overflow: hidden;
    background: #ffffff;
  }

  .cz-base-pdf-canvas {
    display: block;
  }

  .cz-overlay-ann-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .cz-overlay-ann-canvas.is-interactive {
    cursor: crosshair;
  }

  .cz-floating-text-ann {
    position: absolute;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-weight: 700;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
  }

  .cz-floating-stamp {
    position: absolute;
    pointer-events: none;
    object-fit: contain;
  }

  .cz-sig-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
</style>
