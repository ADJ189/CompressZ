<script lang="ts">
  import { onDestroy } from "svelte";
  import { openPdfDocument, getPdfLib, FONTKIT_ESM, NOTO_SANS_UNICODE_FONT } from "../lib/pdfLibs";
  import {
    type RedactionRegion,
    transformVisualPointToPdf,
    transformVisualRectToPdf,
    applyTrueRedaction,
  } from "../lib/pdfTools/redactPdf";
  import { sanitizeWinAnsi } from "../lib/pdfTools/watermarkPdf";
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
  let pendingTextAnnotation = $state<{ x: number; y: number; value: string } | null>(null);

  // Color & styling options
  let activeColor = $state<string>("#ef4444"); // Red for text
  let highlighterColor = $state<string>("rgba(254, 240, 138, 0.45)"); // Yellow highlighter

  let currentRenderTask: any = null;
  let renderSeq = 0;

  async function renderPage(pageNum: number) {
    if (!pdfDocInstance || !canvasEl || !overlayCanvasEl) return;
    if (currentRenderTask) {
      try {
        currentRenderTask.cancel();
      } catch {}
      currentRenderTask = null;
    }
    const mySeq = ++renderSeq;
    try {
      const page = await pdfDocInstance.getPage(pageNum);
      if (mySeq !== renderSeq) return;
      const viewport = page.getViewport({ scale: zoomLevel * 1.5 });

      canvasEl.width = Math.round(viewport.width);
      canvasEl.height = Math.round(viewport.height);
      overlayCanvasEl.width = Math.round(viewport.width);
      overlayCanvasEl.height = Math.round(viewport.height);

      const ctx = canvasEl.getContext("2d")!;
      const task = page.render({ canvasContext: ctx, viewport });
      currentRenderTask = task;
      await task.promise;

      if (mySeq === renderSeq) {
        redrawOverlay();
      }
    } catch (err: any) {
      if (err?.name === "RenderingCancelledException") return;
      console.error("PDF page render error:", err);
    } finally {
      if (mySeq === renderSeq) {
        currentRenderTask = null;
      }
    }
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

  function handleOverlayPointerDown(e: PointerEvent) {
    if (activeTool === "select") return;
    const rect = overlayCanvasEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoomLevel * 1.5);
    const y = (e.clientY - rect.top) / (zoomLevel * 1.5);

    if (activeTool === "text") {
      pendingTextAnnotation = { x, y, value: "Note" };
    } else if (activeTool === "ink" || activeTool === "highlighter") {
      isDrawing = true;
      try {
        overlayCanvasEl.setPointerCapture(e.pointerId);
      } catch {}
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

  function handleOverlayPointerMove(e: PointerEvent) {
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

  function handleOverlayPointerUp(e: PointerEvent) {
    if (!isDrawing) return;
    isDrawing = false;
    try {
      overlayCanvasEl.releasePointerCapture(e.pointerId);
    } catch {}
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

  function commitPendingText() {
    if (!pendingTextAnnotation) return;
    const trimmed = pendingTextAnnotation.value.trim();
    if (trimmed) {
      addAnnotation({
        id: `ann-${Date.now()}`,
        type: "text",
        x: pendingTextAnnotation.x,
        y: pendingTextAnnotation.y,
        width: 120,
        height: 30,
        text: trimmed,
        color: activeColor,
        fontSize: 16,
      });
    }
    pendingTextAnnotation = null;
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
    const { PDFDocument, rgb, degrees, StandardFonts } = await getPdfLib();
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    let font: any = null;
    let coverageFont: any = null;
    try {
      const fontkitMod = (await import(/* @vite-ignore */ FONTKIT_ESM)) as any;
      const fontkit = fontkitMod.default ?? fontkitMod;
      pdfDoc.registerFontkit(fontkit);
      const res = await fetch(NOTO_SANS_UNICODE_FONT, { cache: "force-cache" });
      if (res.ok) {
        const fontBytes = new Uint8Array(await res.arrayBuffer());
        font = await pdfDoc.embedFont(fontBytes, { subset: true });
        coverageFont = fontkit.create(fontBytes);
      }
    } catch {
      // Ignored: fallback to Helvetica
    }

    if (!font) {
      font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    }

    const sanitizeText = (str: string): string => {
      if (coverageFont) {
        let safe = "";
        for (const ch of str) {
          const cp = ch.codePointAt(0) ?? 0;
          let ok = false;
          try {
            ok = coverageFont.hasGlyphForCodePoint(cp) === true;
          } catch {
            ok = false;
          }
          safe += ok ? ch : "?";
        }
        return safe;
      }
      return sanitizeWinAnsi(str);
    };

    const trueRedactionRegions: RedactionRegion[] = [];

    for (let p = 1; p <= totalPages; p++) {
      const pageAnns = annotations[p] || [];
      if (pageAnns.length === 0) continue;

      const page = pdfDoc.getPage(p - 1);
      const { width, height } = page.getSize();
      const rotation = page.getRotation().angle;

      for (const ann of pageAnns) {
        if (ann.type === "text" && ann.text) {
          const pt = transformVisualPointToPdf(ann.x, ann.y + (ann.fontSize || 16), width, height, rotation);
          page.drawText(sanitizeText(ann.text), {
            x: pt.x,
            y: pt.y,
            size: ann.fontSize || 16,
            font,
            color: rgb(0.9, 0.1, 0.1),
            rotate: degrees(rotation),
          });
        } else if (ann.type === "redact") {
          const bbox = transformVisualRectToPdf(ann.x, ann.y, ann.width, ann.height, width, height, rotation);
          trueRedactionRegions.push({
            pageIndex: p - 1,
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
            reason: "[REDACTED]",
          });
        } else if (ann.type === "stamp" && ann.dataUrl) {
          const imgBytes = Uint8Array.from(atob(ann.dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
          const embedded = await pdfDoc.embedPng(imgBytes);
          const pt = transformVisualPointToPdf(ann.x, ann.y + ann.height, width, height, rotation);
          page.drawImage(embedded, {
            x: pt.x,
            y: pt.y,
            width: ann.width,
            height: ann.height,
            rotate: degrees(rotation),
          });
        } else if ((ann.type === "ink" || ann.type === "highlighter") && ann.points && ann.points.length > 1) {
          const isHighlighter = ann.type === "highlighter";
          const thickness = isHighlighter ? 16 : 2.5;
          const strokeColor = isHighlighter ? rgb(1, 0.95, 0.2) : rgb(0.9, 0.1, 0.1);
          const strokeOpacity = isHighlighter ? 0.35 : 1.0;

          for (let i = 1; i < ann.points.length; i++) {
            const pt1 = transformVisualPointToPdf(ann.points[i - 1].x, ann.points[i - 1].y, width, height, rotation);
            const pt2 = transformVisualPointToPdf(ann.points[i].x, ann.points[i].y, width, height, rotation);
            page.drawLine({
              start: { x: pt1.x, y: pt1.y },
              end: { x: pt2.x, y: pt2.y },
              thickness,
              color: strokeColor,
              opacity: strokeOpacity,
            });
          }
        }
      }
    }

    let modified = await pdfDoc.save();

    // If true redactions exist, apply irreversible raster burn-in to sanitize document
    if (trueRedactionRegions.length > 0) {
      modified = await applyTrueRedaction(modified, {
        regions: trueRedactionRegions,
      });
    }

    onExport(modified);
  }

  let activeDocSeq = 0;
  async function loadDocument(bytes: Uint8Array) {
    const mySeq = ++activeDocSeq;
    if (currentRenderTask) {
      try { currentRenderTask.cancel(); } catch {}
      currentRenderTask = null;
    }
    if (pdfDocInstance && typeof pdfDocInstance.destroy === "function") {
      await pdfDocInstance.destroy().catch(() => {});
    }
    annotations = {};
    pageThumbnails = {};
    currentPage = 1;

    try {
      const doc = await openPdfDocument(bytes);
      if (mySeq !== activeDocSeq) {
        await doc.destroy().catch(() => {});
        return;
      }
      pdfDocInstance = doc;
      totalPages = doc.numPages;
      await renderPage(1);

      for (let i = 1; i <= Math.min(totalPages, 20); i++) {
        if (mySeq !== activeDocSeq) break;
        const p = await doc.getPage(i);
        if (mySeq !== activeDocSeq) break;
        const vp = p.getViewport({ scale: 0.2 });
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = Math.round(vp.width);
        thumbCanvas.height = Math.round(vp.height);
        const tctx = thumbCanvas.getContext("2d")!;
        await p.render({ canvasContext: tctx, viewport: vp }).promise;
        if (mySeq !== activeDocSeq) break;
        pageThumbnails[i] = thumbCanvas.toDataURL("image/jpeg", 0.65);
      }
    } catch (err) {
      console.error("Studio document load error:", err);
    }
  }

  $effect(() => {
    if (pdfBytes) {
      loadDocument(pdfBytes);
    }
  });

  $effect(() => {
    if (currentPage && zoomLevel) {
      renderPage(currentPage);
    }
  });

  onDestroy(() => {
    // Bump the sequence so the thumbnail loop and any in-flight render stop
    // touching state, then release the pdf.js document (workers + buffers).
    activeDocSeq++;
    try {
      currentRenderTask?.cancel();
    } catch {}
    currentRenderTask = null;
    const doc = pdfDocInstance;
    pdfDocInstance = null;
    if (doc && typeof doc.destroy === "function") {
      void doc.destroy().catch(() => {});
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
          style="touch-action: none;"
          onpointerdown={handleOverlayPointerDown}
          onpointermove={handleOverlayPointerMove}
          onpointerup={handleOverlayPointerUp}
          onpointercancel={handleOverlayPointerUp}
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

        {#if pendingTextAnnotation}
          <div
            class="cz-inline-text-popover"
            style="left: {pendingTextAnnotation.x * zoomLevel * 1.5}px; top: {pendingTextAnnotation.y * zoomLevel * 1.5}px;"
          >
            <input
              type="text"
              class="cz-inline-text-input"
              aria-label="Text annotation"
              bind:value={pendingTextAnnotation.value}
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitPendingText();
                } else if (e.key === "Escape") {
                  pendingTextAnnotation = null;
                }
              }}
            />
            <button type="button" class="cz-btn cz-btn-primary cz-btn-sm" onclick={commitPendingText}>Add</button>
            <button type="button" class="cz-btn cz-btn-ghost cz-btn-sm" onclick={() => (pendingTextAnnotation = null)}>Cancel</button>
          </div>
        {/if}
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

  .cz-inline-text-popover {
    position: absolute;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-md);
  }

  .cz-inline-text-input {
    width: 150px;
    padding: 0.25rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: var(--r-xs);
    background: var(--bg);
    color: var(--text);
    font-size: 0.85rem;
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
