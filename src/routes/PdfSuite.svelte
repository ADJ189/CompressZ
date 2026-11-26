<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import HubHeader from "../components/HubHeader.svelte";
  import PageGrid from "../components/PageGrid.svelte";
  import PdfCanvasEditor from "../components/PdfCanvasEditor.svelte";
  import SignaturePad from "../components/SignaturePad.svelte";
  import { splitPdf, type SplitResult } from "../lib/pdfTools/splitPdf";
  import {
    removePagesFromPdf,
    parseRemovalRange,
    formatRemovalRange,
    getEvenPageIndices,
    getOddPageIndices,
  } from "../lib/pdfTools/removePagesPdf";
  import {
    applyPdfPageNumbers,
    parseTargetPages,
    MAX_PAGE_NUMBER_START,
    MAX_BATES_DIGITS,
    type PageNumberPosition,
    type PageNumberFormat,
  } from "../lib/pdfTools/pageNumbersPdf";
  import {
    createNupPdf,
    type NupPagesPerSheet,
  } from "../lib/pdfTools/nupPdf";
  import {
    readPdfMetadata,
    updatePdfMetadata,
    parseMetadataKeywords,
    type PdfMetadataInfo,
  } from "../lib/pdfTools/metadataPdf";
  import { reorganizePdf, type PageSpec } from "../lib/pdfTools/organizePdf";
  import { applyPdfCrop } from "../lib/pdfTools/cropPdf";
  import { applyPdfWatermark } from "../lib/pdfTools/watermarkPdf";
  import { inspectPdfForm, fillPdfForm, type FormFieldInfo } from "../lib/pdfTools/formPdf";
  import { applyTrueRedaction, type RedactionRegion } from "../lib/pdfTools/redactPdf";
  import { protectPdf, unlockPdf, type PdfEncryptionStandard } from "../lib/pdfTools/securityPdf";
  import { repairCorruptPdf, inspectAndRepairMp4Moov } from "../lib/pdfTools/repairPdf";
  import { openPdfDocument, getPdfLib } from "../lib/pdfLibs";
  import { runScheduled } from "../lib/resourceManager";
  import { consumeStagedUniversalFile, currentRoute } from "../store";
  import { formatBytes } from "../lib/types";
import { entryError } from "../lib/engineError";
  import { toast } from "../toast";
  import { onMount, onDestroy } from "svelte";
  import { navigate } from "../router";
  import MacIcon from "../components/MacIcon.svelte";
  import ToolCard from "../components/ToolCard.svelte";
  import ToolGrid, { type ToolItem } from "../components/ToolGrid.svelte";

  type SubTool =
    | "split"
    | "remove"
    | "page-numbers"
    | "nup"
    | "metadata"
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
  let isFileLoading = $state<boolean>(false);
  let isProcessing = $state<boolean>(false);
  let progressPct = $state<number>(0);

  // Split tool state
  let splitMode = $state<"ranges" | "chunk" | "burst">("ranges");
  let splitRanges = $state<string>("1-2, 3");
  let splitChunkSize = $state<number>(2);

  // Remove Pages tool state
  let removePagesInput = $state<string>("");
  let pagesToRemoveSet = $state<Set<number>>(new Set<number>());
  let removeRangeError = $state<string | null>(null);

  function handleRemoveInputChange(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    removePagesInput = val;
    removeRangeError = null;
    if (!totalPages || !val.trim()) {
      pagesToRemoveSet = new Set();
      return;
    }
    try {
      const indices = parseRemovalRange(val, totalPages);
      pagesToRemoveSet = new Set(indices);
    } catch (err: any) {
      removeRangeError = err?.message || "Invalid page specification";
      pagesToRemoveSet = new Set();
    }
  }

  function togglePageRemoval(index0Based: number) {
    if (!totalPages) return;
    removeRangeError = null;
    const next = new Set(pagesToRemoveSet);
    if (next.has(index0Based)) {
      next.delete(index0Based);
    } else {
      next.add(index0Based);
    }
    pagesToRemoveSet = next;
    removePagesInput = formatRemovalRange(Array.from(next));
  }

  function selectAllEvenPages() {
    if (isFileLoading || !totalPages) return;
    removeRangeError = null;
    const evens = getEvenPageIndices(totalPages);
    const next = new Set(pagesToRemoveSet);
    for (const idx of evens) next.add(idx);
    pagesToRemoveSet = next;
    removePagesInput = formatRemovalRange(Array.from(next));
  }

  function selectAllOddPages() {
    if (isFileLoading || !totalPages) return;
    removeRangeError = null;
    const odds = getOddPageIndices(totalPages);
    const next = new Set(pagesToRemoveSet);
    for (const idx of odds) next.add(idx);
    pagesToRemoveSet = next;
    removePagesInput = formatRemovalRange(Array.from(next));
  }

  function selectFirstPage() {
    if (isFileLoading || !totalPages) return;
    removeRangeError = null;
    const next = new Set(pagesToRemoveSet);
    next.add(0);
    pagesToRemoveSet = next;
    removePagesInput = formatRemovalRange(Array.from(next));
  }

  function selectLastPage() {
    if (isFileLoading || !totalPages) return;
    removeRangeError = null;
    const next = new Set(pagesToRemoveSet);
    next.add(totalPages - 1);
    pagesToRemoveSet = next;
    removePagesInput = formatRemovalRange(Array.from(next));
  }

  function clearPageRemoval() {
    removeRangeError = null;
    pagesToRemoveSet = new Set();
    removePagesInput = "";
  }

  function invertPageRemoval() {
    if (isFileLoading || !totalPages) return;
    removeRangeError = null;
    const next = new Set<number>();
    for (let i = 0; i < totalPages; i++) {
      if (!pagesToRemoveSet.has(i)) {
        next.add(i);
      }
    }
    pagesToRemoveSet = next;
    removePagesInput = formatRemovalRange(Array.from(next));
  }

  // Page Numbers tool state
  let pageNumFormat = $state<PageNumberFormat>("page-n-of-total");
  let pageNumCustomPattern = $state<string>("Page {n} of {total}");
  let pageNumPosition = $state<PageNumberPosition>("bottom-center");
  let pageNumStart = $state<number>(1);
  let pageNumRange = $state<string>("all");
  let pageNumFont = $state<"Helvetica" | "TimesRoman" | "Courier">("Helvetica");
  let pageNumSize = $state<number>(10);
  let pageNumColor = $state<string>("#333333");
  let pageNumOpacity = $state<number>(1.0);
  let pageNumMarginX = $state<number>(36);
  let pageNumMarginY = $state<number>(36);
  let batesPrefix = $state<string>("BATES-");
  let batesDigits = $state<number>(6);
  let batesSuffix = $state<string>("");

  // N-Up Multi-Page tool state
  let nupPagesPerSheet = $state<NupPagesPerSheet>(2);
  let nupSheetSize = $state<"a4" | "letter" | "source">("a4");
  let nupOrientation = $state<"portrait" | "landscape" | "auto">("auto");
  let nupMargin = $state<number>(24);
  let nupSpacing = $state<number>(16);
  let nupDrawBorder = $state<boolean>(false);

  // Metadata tool state
  let metaTitle = $state<string>("");
  let metaAuthor = $state<string>("");
  let metaSubject = $state<string>("");
  let metaKeywords = $state<string>("");
  let metaCreator = $state<string>("");
  let metaProducer = $state<string>("");
  let metaCreationDate = $state<string>("");
  let metaModificationDate = $state<string>("");
  let metaStripAll = $state<boolean>(false);
  let dirtyMetaFields = new Set<string>();

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
  let encryptionStandard = $state<PdfEncryptionStandard>("aes-256-r6");
  let renderDpi = $state<number>(300);
  let advancedDrawerOpen = $state<boolean>(false);

  function loadSavedProfile() {
    try {
      const saved = localStorage.getItem("cz-pdfsuite-profile");
      if (saved) {
        const p = JSON.parse(saved);
        const standards = new Set<PdfEncryptionStandard>([
          "aes-256-r6",
          "aes-256-r5",
          "aes-128",
        ]);
        if (standards.has(p.encryptionStandard)) {
          encryptionStandard = p.encryptionStandard;
        }
        const dpi = Number(p.renderDpi);
        if (dpi === 150 || dpi === 300 || dpi === 600) renderDpi = dpi;
        if (typeof p.allowPrinting === "boolean") allowPrinting = p.allowPrinting;
        if (typeof p.allowCopying === "boolean") allowCopying = p.allowCopying;
      }
    } catch {
      // Ignored
    }
  }

  function saveProfile() {
    try {
      localStorage.setItem(
        "cz-pdfsuite-profile",
        JSON.stringify({
          encryptionStandard,
          renderDpi,
          allowPrinting,
          allowCopying,
        }),
      );
    } catch {
      // Ignored
    }
  }

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
        reason: redactReason || undefined,
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

  const TOOLS: ToolItem[] = [
    {
      id: "split",
      name: "Split PDF",
      description: "Extract page ranges, split into equal chunks, or burst all pages into individual files.",
      icon: "split",
      badge: "Fast",
    },
    {
      id: "remove",
      name: "Remove Pages",
      description: "Delete specific pages, ranges, or even/odd pages with live visual preview.",
      icon: "remove-pages",
      badge: "Fast",
    },
    {
      id: "page-numbers",
      name: "Page Numbers",
      description: "Insert customizable page numbers, header/footers, or Bates legal stamping.",
      icon: "page-numbers",
      badge: "Bates",
    },
    {
      id: "nup",
      name: "Multi-Page (N-Up)",
      description: "Combine 2, 4, or 9 pages per sheet for compact printing and handouts.",
      icon: "nup",
      badge: "Layout",
    },
    {
      id: "metadata",
      name: "Edit Metadata",
      description: "Inspect, update, or strip document metadata and timestamps for privacy.",
      icon: "metadata",
      badge: "Privacy",
    },
    {
      id: "organize",
      name: "Organize Pages",
      description: "Reorder pages visually with drag & drop, rotate 90°, duplicate, or delete unwanted pages.",
      icon: "organize",
    },
    {
      id: "studio",
      name: "Edit & Annotate",
      description: "Annotate directly, draw freehand, add text notes, and stamp digital signatures.",
      icon: "studio",
      badge: "Studio",
    },
    {
      id: "watermark",
      name: "Add Watermark",
      description: "Stamp customized text or repeating confidential grid patterns across all pages.",
      icon: "watermark",
    },
    {
      id: "crop",
      name: "Crop Pages",
      description: "Trim unwanted page margins or whitespace permanently from all boxes.",
      icon: "crop",
    },
    {
      id: "forms",
      name: "Fill & Sign",
      description: "Complete interactive PDF form fields and flatten them into permanent vectors.",
      icon: "forms",
    },
    {
      id: "security",
      name: "Password Protect",
      description: "Encrypt documents with ISO 32000-2 AES-256 security or decrypt protected files.",
      icon: "security",
      badge: "AES-256",
    },
    {
      id: "repair",
      name: "Repair File",
      description: "Salvage damaged PDF catalogs, rebuild xref tables, or fix missing MP4 headers.",
      icon: "repair",
    },
    {
      id: "redact",
      name: "Redact Content",
      description: "Permanently burn out confidential text & graphics via true 300 DPI raster purge.",
      icon: "redact",
      badge: "True Purge",
    },
    {
      id: "merge",
      name: "Merge PDFs",
      description: "Combine multiple PDF documents into a single unified file in any custom order.",
      icon: "merge",
      route: "compress/merge-pdf",
    },
    {
      id: "markdown",
      name: "Extract to Markdown",
      description: "Convert PDF documents into clean Markdown with preserved tables and LaTeX math.",
      icon: "markdown",
      badge: "New",
      route: "convert/pdf-markdown",
    },
  ];

  const currentToolMeta = $derived(
    TOOLS.find((t) => t.id === activeTool) || TOOLS[0]
  );

  interface PdfJsPageHandle {
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (opts: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }) => { promise: Promise<void> };
    cleanup?: () => void;
  }

  interface PdfJsDocHandle {
    numPages: number;
    getPage: (pageNumber: number) => Promise<PdfJsPageHandle>;
    destroy?: () => Promise<void>;
  }

  let loadSeq = 0;
  let thumbPdfDoc: PdfJsDocHandle | null = null;
  let thumbQueue: number[] = [];
  const requestedThumbPages = new Set<number>();
  let isDrainingThumbs = false;

  async function releaseThumbDoc() {
    thumbQueue = [];
    requestedThumbPages.clear();
    const doc = thumbPdfDoc;
    thumbPdfDoc = null;
    if (doc && typeof doc.destroy === "function") {
      await doc.destroy().catch(() => {});
    }
  }

  async function renderThumbnailForPage(
    doc: PdfJsDocHandle,
    pageIndex0: number,
    mySeq: number,
  ) {
    if (mySeq !== loadSeq || pageThumbnails[pageIndex0]) return;
    let p: PdfJsPageHandle | null = null;
    let canvas: HTMLCanvasElement | null = null;
    try {
      p = await doc.getPage(pageIndex0 + 1);
      if (mySeq !== loadSeq) return;
      const vp = p.getViewport({ scale: 0.25 });
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
      if (mySeq !== loadSeq) return;
      pageThumbnails[pageIndex0] = canvas.toDataURL("image/jpeg", 0.7);
    } catch (thumbErr) {
      console.warn(`[PdfSuite] Thumbnail render error on page ${pageIndex0 + 1}:`, thumbErr);
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (p && typeof p.cleanup === "function") {
        try {
          p.cleanup();
        } catch {
          // Ignored
        }
      }
    }
  }

  async function drainThumbnailQueue() {
    if (isDrainingThumbs) return;
    isDrainingThumbs = true;
    try {
      while (thumbQueue.length > 0) {
        const mySeq = loadSeq;
        if (!thumbPdfDoc && isFileLoading) break;
        const idx = thumbQueue.shift()!;
        if (pageThumbnails[idx] || idx < 0 || idx >= totalPages) continue;
        if (!thumbPdfDoc && pdfBytes) {
          const opened = (await openPdfDocument(pdfBytes)) as PdfJsDocHandle;
          if (mySeq !== loadSeq) {
            if (typeof opened.destroy === "function") {
              await opened.destroy().catch(() => {});
            }
            break;
          }
          thumbPdfDoc = opened;
        }
        if (!thumbPdfDoc || mySeq !== loadSeq) break;
        await renderThumbnailForPage(thumbPdfDoc, idx, mySeq);
      }
    } catch (err) {
      console.warn("[PdfSuite] Lazy thumbnail queue error:", err);
    } finally {
      isDrainingThumbs = false;
      if (thumbQueue.length > 0 && thumbPdfDoc) {
        void drainThumbnailQueue();
      }
    }
  }

  function requestPageThumbnail(pageIndex0: number) {
    if (pageIndex0 < 0 || pageIndex0 >= totalPages) return;
    if (pageThumbnails[pageIndex0] || requestedThumbPages.has(pageIndex0)) return;
    requestedThumbPages.add(pageIndex0);
    thumbQueue.push(pageIndex0);
    void drainThumbnailQueue();
  }

  function observeThumbVisibility(node: HTMLElement, pageIndex0: number) {
    if (pageIndex0 < 24 || pageThumbnails[pageIndex0]) return {};
    if (typeof IntersectionObserver === "undefined") {
      requestPageThumbnail(pageIndex0);
      return {};
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            requestPageThumbnail(pageIndex0);
            observer.unobserve(node);
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      },
    };
  }

  async function loadFile(file: File) {
    const mySeq = ++loadSeq;
    await releaseThumbDoc();
    if (mySeq !== loadSeq) return;
    selectedFile = file;
    isFileLoading = true;
    totalPages = 0;
    pdfBytes = null;
    removeRangeError = null;

    // Reset per-file state immediately (including metadata so stale fields never survive inspection failures)
    redactionList = [];
    formValues = {};
    formFields = [];
    pageThumbnails = {};
    pageSpecs = [];
    removePagesInput = "";
    pagesToRemoveSet = new Set();
    metaTitle = "";
    metaAuthor = "";
    metaSubject = "";
    metaKeywords = "";
    metaCreator = "";
    metaProducer = "";
    metaCreationDate = "";
    metaModificationDate = "";
    metaStripAll = false;
    dirtyMetaFields.clear();

    let pdfJs: PdfJsDocHandle | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (mySeq !== loadSeq) return;
      // Preserve raw bytes immediately so repair & unlock can run even if preview/inspection fails
      pdfBytes = bytes;

      pdfJs = (await openPdfDocument(bytes)) as PdfJsDocHandle;
      if (mySeq !== loadSeq) return;
      totalPages = pdfJs.numPages;

      // Initialize page specs for organize tool
      pageSpecs = Array.from({ length: totalPages }, (_, i) => ({
        id: `p-${i}-${Date.now()}`,
        originalIndex: i,
        rotation: 0,
      }));

      // Generate thumbnails eagerly for the first 24 pages; pages 25+ render lazily via IntersectionObserver
      const eagerCount = Math.min(totalPages, 24);
      for (let i = 0; i < eagerCount; i++) {
        if (mySeq !== loadSeq) return;
        requestedThumbPages.add(i);
        await renderThumbnailForPage(pdfJs, i, mySeq);
      }

      // Check form fields (may fail on owner-encrypted PDFs; keep preview/unlock usable)
      try {
        const formInfo = await inspectPdfForm(bytes);
        if (mySeq !== loadSeq) return;
        formFields = formInfo.fields;
        for (const f of formInfo.fields) {
          formValues[f.name] = f.value;
        }
      } catch (fErr) {
        console.warn("[PdfSuite] Form inspection error:", fErr);
      }

      // Inspect metadata for Metadata tool without overwriting user edits for this file
      try {
        const meta = await readPdfMetadata(bytes);
        if (mySeq === loadSeq) {
          if (!dirtyMetaFields.has("title")) metaTitle = meta.title || "";
          if (!dirtyMetaFields.has("author")) metaAuthor = meta.author || "";
          if (!dirtyMetaFields.has("subject")) metaSubject = meta.subject || "";
          if (!dirtyMetaFields.has("keywords")) metaKeywords = (meta.keywords || []).join(", ");
          if (!dirtyMetaFields.has("creator")) metaCreator = meta.creator || "";
          if (!dirtyMetaFields.has("producer")) metaProducer = meta.producer || "";
          metaCreationDate = meta.creationDate || "";
          metaModificationDate = meta.modificationDate || "";
        }
      } catch (mErr) {
        console.warn("[PdfSuite] Metadata inspection error:", mErr);
      }

      if (mySeq === loadSeq && totalPages > 24 && pdfJs) {
        thumbPdfDoc = pdfJs;
        pdfJs = null;
        if (thumbQueue.length > 0) {
          void drainThumbnailQueue();
        }
      }
    } catch (err) {
      if (mySeq === loadSeq) {
        console.warn("[PdfSuite] Inspection error (file might need repair or unlock):", err);
        totalPages = 0;
      }
    } finally {
      if (mySeq === loadSeq) {
        isFileLoading = false;
      }
      if (pdfJs && typeof pdfJs.destroy === "function") {
        await pdfJs.destroy().catch(() => {});
      }
    }
  }

  /**
   * Wrap engine output in a Blob. The bytes are copied into a fresh
   * ArrayBuffer because pdf-lib/pdf.js return `Uint8Array<ArrayBufferLike>`
   * (possibly over a SharedArrayBuffer), which is not a valid `BlobPart`.
   */
  function bytesBlob(bytes: Uint8Array, type: string): Blob {
    return new Blob([new Uint8Array(bytes)], { type });
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
    if (isProcessing || isFileLoading) return;
    const canRunWithoutPages =
      activeTool === "repair" ||
      (activeTool === "security" && securityMode === "unlock");
    if ((!pdfBytes && activeTool !== "repair") || (totalPages === 0 && !canRunWithoutPages)) {
      return;
    }

    // Snapshot tool, file, bytes, and all active options before scheduling
    const snapTool = activeTool;
    const snapBytes = pdfBytes;
    const snapFile = selectedFile;
    const snapFileName = snapFile?.name || "document.pdf";
    const snapBaseName = snapFileName.replace(/\.pdf$/i, "");
    const snapFileType = snapFile?.type || "";
    const snapTotalPages = totalPages;

    const snapSplit = {
      mode: splitMode,
      ranges: splitRanges,
      chunkSize: splitChunkSize,
      baseFilename: snapFile?.name || "document",
    };
    const snapRemove = {
      rangeError: removeRangeError,
      pagesToRemove: new Set(pagesToRemoveSet),
    };
    const snapPageNumbers = {
      format: pageNumFormat,
      customPattern: pageNumCustomPattern,
      position: pageNumPosition,
      startNumber: pageNumStart,
      pageRange: pageNumRange,
      fontFamily: pageNumFont,
      fontSize: pageNumSize,
      colorHex: pageNumColor,
      opacity: pageNumOpacity,
      marginX: pageNumMarginX,
      marginY: pageNumMarginY,
      batesPrefix,
      batesDigits,
      batesSuffix,
    };
    const snapNup = {
      pagesPerSheet: nupPagesPerSheet,
      sheetSize: nupSheetSize,
      orientation: nupOrientation,
      margin: nupMargin,
      spacing: nupSpacing,
      drawBorder: nupDrawBorder,
    };
    const snapMetaStripAll = metaStripAll;
    metaStripAll = false;
    const snapMeta = {
      title: metaTitle,
      author: metaAuthor,
      subject: metaSubject,
      keywords: parseMetadataKeywords(metaKeywords),
      creator: metaCreator,
      producer: metaProducer,
    };
    const snapOrganizeSpecs = pageSpecs.map((s) => ({ ...s }));
    const snapWatermark = {
      text: watermarkText,
      opacity: watermarkOpacity,
      rotationDeg: watermarkRotation,
      tiled: watermarkTiled,
      colorHex: watermarkColor,
    };
    const snapCrop = {
      mode: "margins" as const,
      margins: {
        top: cropMarginTop,
        bottom: cropMarginBottom,
        left: cropMarginLeft,
        right: cropMarginRight,
      },
    };
    const snapFormUpdates = Object.entries(formValues).map(([name, value]) => ({ name, value }));
    const snapFlattenForm = flattenForm;
    const snapSecurity = {
      mode: securityMode,
      userPassword,
      ownerPassword,
      standard: encryptionStandard,
      allowPrinting,
      allowCopying,
    };
    const snapRedactRegions = redactionList.map((r) => ({ ...r }));
    const snapRenderDpi = renderDpi;

    // Pre-validate selections before queueing
    if (snapTool === "remove") {
      if (snapRemove.rangeError) {
        toast(snapRemove.rangeError, "error");
        return;
      }
      if (snapRemove.pagesToRemove.size === 0) {
        toast("Please select at least 1 page to remove.", "error");
        return;
      }
      if (snapRemove.pagesToRemove.size >= snapTotalPages) {
        toast(`Cannot remove all ${snapTotalPages} pages. At least 1 page must remain.`, "error");
        return;
      }
    } else if (snapTool === "page-numbers") {
      if (
        typeof snapPageNumbers.startNumber !== "number" ||
        !Number.isInteger(snapPageNumbers.startNumber) ||
        snapPageNumbers.startNumber < 1 ||
        snapPageNumbers.startNumber > MAX_PAGE_NUMBER_START
      ) {
        toast(
          `Start number must be a whole number between 1 and ${MAX_PAGE_NUMBER_START.toLocaleString()}.`,
          "error",
        );
        return;
      }
      if (snapPageNumbers.format === "bates") {
        const digits = snapPageNumbers.batesDigits ?? 6;
        if (
          typeof digits !== "number" ||
          !Number.isInteger(digits) ||
          digits < 1 ||
          digits > MAX_BATES_DIGITS
        ) {
          toast(
            `Bates digits must be a whole number between 1 and ${MAX_BATES_DIGITS}.`,
            "error",
          );
          return;
        }
      }
      try {
        const targets = parseTargetPages(snapPageNumbers.pageRange, snapTotalPages);
        if (targets.length === 0) {
          toast("No valid pages matched the specified page range.", "error");
          return;
        }
      } catch (err: any) {
        toast(err?.message || "Invalid page range for numbering.", "error");
        return;
      }
    } else if (snapTool === "watermark") {
      if (!snapFileName.toLowerCase().endsWith(".pdf") && snapFileType !== "application/pdf") {
        toast("Watermarking is only supported for PDF documents.", "error");
        return;
      }
    } else if (snapTool === "redact") {
      if (snapRedactRegions.length === 0) {
        toast("Please add at least one redaction region before exporting.", "error");
        return;
      }
    }

    isProcessing = true;
    progressPct = 10;

    try {
      const jobBytes = snapBytes?.byteLength ?? snapFile?.size ?? 0;
      const toolLabel = TOOLS.find((t) => t.id === snapTool)?.name ?? snapTool;
      const jobLabel = `${toolLabel}: ${snapFile?.name ?? "document"}`;
      await runScheduled({ kind: "pdf", label: jobLabel, bytes: jobBytes }, async () => {
        if (snapTool === "split") {
          const result = await splitPdf(
            snapBytes!,
            snapSplit,
            (p) => (progressPct = p),
          );

          if (result.zipBlob) {
            downloadBlob(result.zipBlob, `${snapBaseName}-split.zip`);
            toast(`Split into ${result.files.length} PDFs (packaged in ZIP)`, "success");
          } else if (result.files.length === 1) {
            downloadBlob(
              bytesBlob(result.files[0].bytes, "application/pdf"),
              result.files[0].name,
            );
            toast("PDF split completed", "success");
          }
        } else if (snapTool === "remove") {
          const result = await removePagesFromPdf(
            snapBytes!,
            {
              pagesToRemove: snapRemove.pagesToRemove,
              zeroBased: true,
              onProgress: (p: number) => (progressPct = p),
            },
          );
          downloadBlob(
            bytesBlob(result.bytes, "application/pdf"),
            `${snapBaseName}-pages-removed.pdf`,
          );
          toast(`Removed ${result.removedCount} page${result.removedCount === 1 ? "" : "s"} successfully`, "success");
        } else if (snapTool === "page-numbers") {
          const out = await applyPdfPageNumbers(
            snapBytes!,
            {
              ...snapPageNumbers,
              onProgress: (p: number) => (progressPct = p),
            },
          );
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-numbered.pdf`,
          );
          toast("Page numbers applied successfully", "success");
        } else if (snapTool === "nup") {
          const out = await createNupPdf(
            snapBytes!,
            {
              ...snapNup,
              onProgress: (p: number) => (progressPct = p),
            },
          );
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-${snapNup.pagesPerSheet}up.pdf`,
          );
          toast(`Generated ${snapNup.pagesPerSheet}-Up multi-page PDF`, "success");
        } else if (snapTool === "metadata") {
          const out = await updatePdfMetadata(
            snapBytes!,
            snapMeta,
            snapMetaStripAll,
          );
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-${snapMetaStripAll ? "sanitized" : "metadata"}.pdf`,
          );
          toast(
            snapMetaStripAll
              ? "Document metadata, dates, and XMP streams stripped"
              : "PDF metadata updated successfully",
            "success",
          );
        } else if (snapTool === "organize") {
          const out = await reorganizePdf(snapBytes!, snapOrganizeSpecs, (p) => (progressPct = p));
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-organized.pdf`,
          );
          toast("Pages reorganized successfully", "success");
        } else if (snapTool === "watermark") {
          const out = await applyPdfWatermark(
            snapBytes!,
            {
              type: "text",
              ...snapWatermark,
            },
            (p) => (progressPct = p),
          );
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-watermarked.pdf`,
          );
          toast("Watermark applied successfully", "success");
        } else if (snapTool === "crop") {
          const out = await applyPdfCrop(
            snapBytes!,
            snapCrop,
            (p) => (progressPct = p),
          );
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-cropped.pdf`,
          );
          toast("PDF cropped successfully", "success");
        } else if (snapTool === "forms") {
          const { bytes: out, failed } = await fillPdfForm(
            snapBytes!,
            snapFormUpdates,
            snapFlattenForm,
            (p) => (progressPct = p),
          );
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-filled.pdf`,
          );
          if (failed.length > 0) {
            const names = failed.map((f) => `"${f.name}"`).join(", ");
            toast(
              `Form saved, but ${failed.length} field${failed.length === 1 ? "" : "s"} could not be filled: ${names}. ${failed[0].message}`,
              "warn",
            );
          } else {
            toast("Form filled and saved successfully", "success");
          }
        } else if (snapTool === "security") {
          if (snapSecurity.mode === "protect") {
            const out = await protectPdf(snapBytes!, {
              userPassword: snapSecurity.userPassword,
              ownerPassword: snapSecurity.ownerPassword,
              standard: snapSecurity.standard,
              allowPrinting: snapSecurity.allowPrinting,
              allowCopying: snapSecurity.allowCopying,
              onProgress: (p) => (progressPct = p),
            });
            downloadBlob(
              bytesBlob(out, "application/pdf"),
              `${snapBaseName}-protected.pdf`,
            );
            const cipherLabel =
              snapSecurity.standard === "aes-128"
                ? "AES-128"
                : snapSecurity.standard === "aes-256-r5"
                  ? "AES-256-CBC"
                  : "AES-256";
            toast(`PDF encrypted with ${cipherLabel} password`, "success");
          } else {
            const out = await unlockPdf(snapBytes!, {
              password: snapSecurity.userPassword,
              onProgress: (p) => (progressPct = p),
            });
            downloadBlob(
              bytesBlob(out, "application/pdf"),
              `${snapBaseName}-unlocked.pdf`,
            );
            toast("PDF decrypted successfully", "success");
          }
        } else if (snapTool === "repair") {
          const bytes = snapBytes || new Uint8Array(await snapFile!.arrayBuffer());
          const isVideo =
            snapFileType.startsWith("video/") ||
            /\.(mp4|mov|m4v)$/i.test(snapFileName);
          if (isVideo) {
            const rep = inspectAndRepairMp4Moov(bytes);
            if (!rep.ok) {
              toast(rep.reason, rep.alreadyValid ? "info" : "error");
              return;
            }
            downloadBlob(
              bytesBlob(rep.repairedBytes, snapFileType || "video/mp4"),
              `repaired-${snapFileName || "video.mp4"}`,
            );
            toast(rep.message, "success");
          } else {
            const rep = await repairCorruptPdf(bytes, (p) => (progressPct = p));
            downloadBlob(
              bytesBlob(rep.repairedBytes, "application/pdf"),
              `repaired-${snapFileName || "document.pdf"}`,
            );
            toast(rep.message, "success");
          }
        } else if (snapTool === "redact") {
          const out = await applyTrueRedaction(snapBytes!, {
            regions: snapRedactRegions,
            renderDpi: snapRenderDpi,
            onProgress: (p) => (progressPct = p),
          });
          downloadBlob(
            bytesBlob(out, "application/pdf"),
            `${snapBaseName}-redacted.pdf`,
          );
          toast("True redaction applied and sanitized", "success");
        }
      });
    } catch (err) {
      console.error("[PdfSuite] error:", err);
      const failure = entryError(err, "the tool did not complete");
      toast(`Action failed: ${failure.error}`, "error", undefined, {
        log: failure.errorLog,
      });
    } finally {
      isProcessing = false;
      progressPct = 0;
    }
  }

  function applyRouteSubpath(path: string) {
    const parts = path.split("/").filter(Boolean);
    const sub = parts[parts.length - 1];
    if (sub === "split") activeTool = "split";
    else if (sub === "remove" || sub === "remove-pages" || sub === "delete-pages") activeTool = "remove";
    else if (sub === "page-numbers" || sub === "number-pages" || sub === "bates") activeTool = "page-numbers";
    else if (sub === "nup" || sub === "multi-page" || sub === "2-up" || sub === "4-up") {
      activeTool = "nup";
      if (sub === "2-up") nupPagesPerSheet = 2;
      else if (sub === "4-up") nupPagesPerSheet = 4;
    }
    else if (sub === "metadata" || sub === "edit-metadata" || sub === "strip-metadata") activeTool = "metadata";
    else if (sub === "organize") activeTool = "organize";
    else if (sub === "crop") activeTool = "crop";
    else if (sub === "forms") activeTool = "forms";
    else if (sub === "watermark") activeTool = "watermark";
    else if (sub === "redact") activeTool = "redact";
    else if (sub === "protect" || sub === "security") activeTool = "security";
    else if (sub === "repair") activeTool = "repair";
    else if (sub === "edit" || sub === "studio" || sub === "sign") activeTool = "studio";
  }

  function applyStagedFile() {
    const staged = consumeStagedUniversalFile("pdf");
    if (staged?.file) {
      loadFile(staged.file);
      if (staged.actionId === "split-pdf") activeTool = "split";
      else if (staged.actionId === "remove-pages" || staged.actionId === "delete-pages") activeTool = "remove";
      else if (staged.actionId === "page-numbers") activeTool = "page-numbers";
      else if (staged.actionId === "nup-pdf") activeTool = "nup";
      else if (staged.actionId === "metadata-pdf") activeTool = "metadata";
      else if (staged.actionId === "organize-pdf") activeTool = "organize";
      else if (staged.actionId === "watermark-pdf") activeTool = "watermark";
      else if (staged.actionId === "crop-pdf") activeTool = "crop";
      else if (staged.actionId === "fill-forms") activeTool = "forms";
      else if (staged.actionId === "redact-pdf") activeTool = "redact";
      else if (staged.actionId === "repair-pdf") activeTool = "repair";
      else if (staged.actionId === "protect-pdf") activeTool = "security";
      else if (staged.actionId === "edit-sign") activeTool = "studio";
    }
  }

  onMount(() => {
    loadSavedProfile();
    if (typeof window !== "undefined") {
      applyRouteSubpath(window.location.pathname);
    }
    applyStagedFile();
  });

  onDestroy(() => {
    loadSeq++;
    void releaseThumbDoc();
  });

  $effect(() => {
    // Keep mounted page reactive to route navigation & staged files
    const unsub = currentRoute.subscribe((r) => {
      const isPdfRoute = r === "pdf" || r?.startsWith("pdf/") || r?.startsWith("pdf-suite/") || r === "pdf-suite";
      if (isPdfRoute) {
        if (r) applyRouteSubpath(r);
        applyStagedFile();
      }
    });
    return unsub;
  });
</script>

<div class="cz-pdf-suite-page">
  <HubHeader
    title="PDF Suite & Studio"
    description="Browser-native workstation for organizing, splitting, editing, signing, watermarking, filling, and securing PDF documents."
    icon="pdf"
    activeToolId={activeTool}
    tools={TOOLS}
    onSelectTool={(id) => {
      if (id === "merge") {
        navigate("compress/merge-pdf");
      } else if (id === "markdown") {
        navigate("convert/pdf-markdown");
      } else {
        activeTool = id as SubTool;
      }
    }}
  />

  <div class="cz-pdf-suite-content">
    {#if !selectedFile}
      <div class="cz-suite-landing">
        <!-- Interactive Tool Grid Hero -->
        <div class="cz-suite-landing-header">
          <div class="cz-suite-badge-pill">
            <MacIcon name="pdf" size={13} />
            <span>Client-Side PDF Workstation</span>
          </div>
          <h2 class="cz-suite-landing-title">Select Any PDF Tool</h2>
          <p class="cz-suite-landing-sub">
            Pick a tool to get started immediately, or drag your document into the upload area below. Every action runs 100% locally in your browser.
          </p>
        </div>

        <!-- The Tool Grid -->
        <ToolGrid
          tools={TOOLS}
          activeToolId={activeTool}
          onSelectTool={(id, tool) => {
            if (tool.route) {
              navigate(tool.route);
            } else {
              activeTool = id as SubTool;
              const el = document.getElementById("suite-active-dropzone");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }}
        />

        <!-- Scoped Upload Target Box for the selected tool -->
        <div id="suite-active-dropzone" class="cz-suite-active-dropzone-box">
          <div class="cz-suite-target-banner">
            <div class="cz-suite-target-info">
              <MacIcon name={currentToolMeta.icon} variant="squircle" squircleSize={38} strokeWidth={2.2} />
              <div class="cz-suite-target-text">
                <span class="cz-suite-target-label">Selected: <strong>{currentToolMeta.name}</strong></span>
                <span class="cz-suite-target-desc">{currentToolMeta.description}</span>
              </div>
            </div>
            {#if currentToolMeta.badge}
              <span class="cz-suite-target-badge">{currentToolMeta.badge}</span>
            {/if}
          </div>

          <FileDropzone
            accept={activeTool === "repair" ? "application/pdf,.pdf,video/mp4,.mp4" : "application/pdf,.pdf"}
            multiple={false}
            title={activeTool === "repair" ? "Drop a PDF or MP4 to Repair File" : `Drop a PDF to ${currentToolMeta.name}`}
            subtitle="or click to browse · Processed locally with zero uploads"
            onFiles={(files) => files[0] && loadFile(files[0])}
          />
        </div>
      </div>
    {:else}
      <div class="cz-suite-active-layout">
        <!-- Top File Summary Bar -->
        <div class="cz-suite-file-bar">
          <div class="cz-file-meta-pill">
            <span class="cz-file-icon"><MacIcon name="pdf" size={16} /></span>
            <span class="cz-file-name">{selectedFile.name}</span>
            <span class="cz-file-size">{formatBytes(selectedFile.size)}</span>
            {#if isFileLoading}
              <span class="cz-file-pages">Loading document…</span>
            {:else if totalPages > 0}
              <span class="cz-file-pages">{totalPages} pages</span>
            {/if}
          </div>

          <div class="cz-file-bar-actions">
            <button
              type="button"
              class="cz-btn cz-btn-ghost cz-btn-sm"
              disabled={isProcessing}
              onclick={() => {
                loadSeq++;
                void releaseThumbDoc();
                selectedFile = null;
                pdfBytes = null;
                totalPages = 0;
                isFileLoading = false;
                pagesToRemoveSet = new Set();
                removePagesInput = "";
                removeRangeError = null;
                metaTitle = "";
                metaAuthor = "";
                metaSubject = "";
                metaKeywords = "";
                metaCreator = "";
                metaProducer = "";
                metaCreationDate = "";
                metaModificationDate = "";
                metaStripAll = false;
                dirtyMetaFields.clear();
              }}
            >
              Change File
            </button>
          </div>
        </div>

        <!-- Rectangular Collapsible Advanced Options Drawer -->
        <div class="cz-advanced-drawer {advancedDrawerOpen ? 'is-open' : ''}">
          <button
            type="button"
            class="cz-advanced-drawer-toggle"
            onclick={() => (advancedDrawerOpen = !advancedDrawerOpen)}
            aria-expanded={advancedDrawerOpen}
          >
            <span class="cz-drawer-title">
              <MacIcon name="settings" size={14} />
              <span>Engine & Profile Configuration</span>
            </span>
            <span class="cz-drawer-summary">
              {encryptionStandard === "aes-256-r6" ? "AES-256 (Default)" : encryptionStandard === "aes-256-r5" ? "AES-256-CBC" : "AES-128"} · {renderDpi} DPI · {allowPrinting ? "Print: Yes" : "Print: No"}
            </span>
            <span class="cz-drawer-chevron" class:is-rotated={advancedDrawerOpen}>
              <MacIcon name="chevron-down" size={12} />
            </span>
          </button>

          {#if advancedDrawerOpen}
            <div class="cz-advanced-drawer-body">
              <div class="cz-drawer-grid">
                <div class="cz-drawer-field">
                  <label for="pdf-enc-standard">Encryption Mode</label>
                  <select
                    id="pdf-enc-standard"
                    class="cz-select cz-select-sm"
                    bind:value={encryptionStandard}
                    onchange={saveProfile}
                  >
                    <option value="aes-256-r6">★ PDF 2.0 (V=5, R=6) — AES-256 (Default)</option>
                    <option value="aes-256-r5">PDF 1.7 (V=5, R=5) — AES-256-CBC</option>
                    <option value="aes-128">PDF 1.6 — AES-128 (Legacy Compatible)</option>
                  </select>
                </div>

                <div class="cz-drawer-field">
                  <label for="pdf-render-dpi">Archival Render DPI</label>
                  <select
                    id="pdf-render-dpi"
                    class="cz-select cz-select-sm"
                    bind:value={renderDpi}
                    onchange={saveProfile}
                  >
                    <option value={150}>150 DPI (Fast / Draft)</option>
                    <option value={300}>300 DPI (Standard Archival)</option>
                    <option value={600}>600 DPI (Ultra Fidelity)</option>
                  </select>
                </div>

                <div class="cz-drawer-field cz-drawer-field-checks">
                  <label class="cz-check-label">
                    <input type="checkbox" bind:checked={allowPrinting} onchange={saveProfile} />
                    <span>Permit Printing</span>
                  </label>
                  <label class="cz-check-label">
                    <input type="checkbox" bind:checked={allowCopying} onchange={saveProfile} />
                    <span>Permit Copying</span>
                  </label>
                </div>
              </div>
              <div class="cz-drawer-footer">
                <small>Preferences automatically saved to local profile & cached.</small>
              </div>
            </div>
          {/if}
        </div>

        <!-- Tool Workspace -->
        <div class="cz-tool-workspace-panel">
          {#if activeTool === "studio"}
            {#if pdfBytes}
              {#key selectedFile ? `${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}` : "studio-editor"}
                <PdfCanvasEditor
                  pdfBytes={pdfBytes}
                  onExport={(mod) => downloadBlob(bytesBlob(mod, "application/pdf"), `${selectedFile?.name.replace(/\.pdf$/i, "")}-annotated.pdf`)}
                />
              {/key}
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
                onNeedThumbnail={(idx) => requestPageThumbnail(idx)}
              />
              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || isFileLoading || totalPages === 0}
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
                  disabled={isProcessing || isFileLoading || totalPages === 0}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Splitting…" : "Execute PDF Split"}
                </button>
              </div>
            </div>
          {:else if activeTool === "remove"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Remove Pages from PDF</h3>
                <p>Click page thumbnails below or type page ranges to delete unwanted pages. Vector crispness and text are 100% preserved.</p>
              </div>

              <!-- Quick Range / Filter Input -->
              <div class="cz-settings-row">
                <label for="remove-pages-input">Pages or Ranges to Remove (e.g. 1, 3-5, 8)</label>
                <div class="cz-remove-input-wrap">
                  <input
                    id="remove-pages-input"
                    type="text"
                    class="cz-input"
                    class:is-invalid={!!removeRangeError}
                    placeholder="e.g. 1, 3-5, 8"
                    value={removePagesInput}
                    oninput={handleRemoveInputChange}
                    disabled={isFileLoading || totalPages === 0}
                  />
                  {#if removePagesInput}
                    <button
                      type="button"
                      class="cz-btn cz-btn-ghost cz-btn-sm"
                      onclick={clearPageRemoval}
                    >
                      Clear
                    </button>
                  {/if}
                </div>
                {#if removeRangeError}
                  <div class="cz-field-error-text" role="alert">{removeRangeError}</div>
                {/if}
              </div>

              <!-- Quick Selection Chips -->
              <div class="cz-settings-row">
                <span class="cz-label">Quick Selection</span>
                <div class="cz-chips-row">
                  <button
                    type="button"
                    class="cz-chip-btn"
                    disabled={isFileLoading || totalPages === 0}
                    onclick={selectAllEvenPages}
                  >
                    Even Pages
                  </button>
                  <button
                    type="button"
                    class="cz-chip-btn"
                    disabled={isFileLoading || totalPages === 0}
                    onclick={selectAllOddPages}
                  >
                    Odd Pages
                  </button>
                  <button
                    type="button"
                    class="cz-chip-btn"
                    disabled={isFileLoading || totalPages === 0}
                    onclick={selectFirstPage}
                  >
                    First Page
                  </button>
                  {#if totalPages > 1}
                    <button
                      type="button"
                      class="cz-chip-btn"
                      disabled={isFileLoading || totalPages === 0}
                      onclick={selectLastPage}
                    >
                      Last Page
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="cz-chip-btn"
                    disabled={isFileLoading || totalPages === 0}
                    onclick={invertPageRemoval}
                  >
                    Invert Selection
                  </button>
                </div>
              </div>

              <!-- Live Status Banner -->
              <div class="cz-remove-summary-banner" class:is-invalid={pagesToRemoveSet.size >= totalPages || !!removeRangeError}>
                <div class="cz-summary-info">
                  {#if isFileLoading}
                    <span>Loading PDF pages and layout…</span>
                  {:else if removeRangeError}
                    <strong class="cz-warn-text">{removeRangeError}</strong>
                  {:else if pagesToRemoveSet.size === 0}
                    <span>No pages selected for removal. Click page thumbnails below to mark them for deletion.</span>
                  {:else if pagesToRemoveSet.size >= totalPages}
                    <strong class="cz-warn-text">Cannot remove all {totalPages} pages! At least 1 page must remain.</strong>
                  {:else}
                    <span>
                      Marked for removal: <strong>{pagesToRemoveSet.size} page{pagesToRemoveSet.size === 1 ? '' : 's'}</strong>
                      ({formatRemovalRange(Array.from(pagesToRemoveSet))}) ·
                      <strong>{totalPages - pagesToRemoveSet.size} page{totalPages - pagesToRemoveSet.size === 1 ? '' : 's'}</strong> remaining
                    </span>
                  {/if}
                </div>
              </div>

              <!-- Visual Page Grid -->
              <div class="cz-remove-page-grid" role="list" aria-label="PDF pages to remove">
                {#each Array.from({ length: totalPages }, (_, i) => i) as idx (idx)}
                  {@const isRemoved = pagesToRemoveSet.has(idx)}
                  {@const thumb = pageThumbnails[idx]}

                  <div
                    class="cz-remove-card"
                    class:is-removed={isRemoved}
                    role="button"
                    tabindex="0"
                    aria-pressed={isRemoved}
                    aria-label="Page {idx + 1}, {isRemoved ? 'marked for removal' : 'kept'}"
                    use:observeThumbVisibility={idx}
                    onclick={() => togglePageRemoval(idx)}
                    onkeydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        togglePageRemoval(idx);
                      }
                    }}
                  >
                    <div class="cz-remove-card-thumb">
                      {#if thumb}
                        <img src={thumb} alt="Page {idx + 1}" class="cz-remove-thumb-img" />
                      {:else}
                        <div class="cz-remove-placeholder">
                          <MacIcon name="pdf" size={28} />
                          <span>Page {idx + 1}</span>
                        </div>
                      {/if}

                      <div class="cz-remove-badge" class:is-removed-badge={isRemoved}>
                        {#if isRemoved}
                          <MacIcon name="remove-pages" size={12} />
                          <span>REMOVE</span>
                        {:else}
                          <span>KEEP</span>
                        {/if}
                      </div>
                    </div>

                    <div class="cz-remove-card-footer">
                      <span class="cz-page-num">Page {idx + 1}</span>
                    </div>
                  </div>
                {/each}
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || isFileLoading || totalPages === 0 || pagesToRemoveSet.size === 0 || pagesToRemoveSet.size >= totalPages || !!removeRangeError}
                  onclick={handleExecuteTool}
                >
                  {isProcessing
                    ? "Removing Pages…"
                    : pagesToRemoveSet.size === 0
                      ? "Select Pages to Remove"
                      : `Remove ${pagesToRemoveSet.size} Page${pagesToRemoveSet.size === 1 ? "" : "s"} & Download PDF`}
                </button>
              </div>
            </div>
          {:else if activeTool === "page-numbers"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Page Numbering & Bates Stamping</h3>
                <p>Insert vector-crisp page counters, custom labels, header/footers, or legal Bates numbering.</p>
              </div>

              <!-- Format Selector -->
              <div class="cz-settings-row">
                <span class="cz-label">Numbering Format</span>
                <div class="cz-segmented-control cz-segmented-wrap">
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={pageNumFormat === "page-n-of-total"}
                    onclick={() => (pageNumFormat = "page-n-of-total")}
                  >
                    Page 1 of {totalPages || 10}
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={pageNumFormat === "n-of-total"}
                    onclick={() => (pageNumFormat = "n-of-total")}
                  >
                    1 of {totalPages || 10}
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={pageNumFormat === "page-n"}
                    onclick={() => (pageNumFormat = "page-n")}
                  >
                    Page 1
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={pageNumFormat === "n"}
                    onclick={() => (pageNumFormat = "n")}
                  >
                    1, 2, 3…
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={pageNumFormat === "roman-lower"}
                    onclick={() => (pageNumFormat = "roman-lower")}
                  >
                    i, ii, iii…
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={pageNumFormat === "bates"}
                    onclick={() => (pageNumFormat = "bates")}
                  >
                    Bates Stamp
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={pageNumFormat === "custom"}
                    onclick={() => (pageNumFormat = "custom")}
                  >
                    Custom Pattern
                  </button>
                </div>
              </div>

              <!-- Bates Stamping Specific Settings -->
              {#if pageNumFormat === "bates"}
                <div class="cz-settings-grid">
                  <div class="cz-settings-row">
                    <label for="bates-prefix">Bates Prefix</label>
                    <input
                      id="bates-prefix"
                      type="text"
                      class="cz-input"
                      placeholder="e.g. BATES- or CASE-01-"
                      bind:value={batesPrefix}
                    />
                  </div>
                  <div class="cz-settings-row">
                    <label for="bates-digits">Padded Digits</label>
                    <input
                      id="bates-digits"
                      type="number"
                      min="1"
                      max={MAX_BATES_DIGITS}
                      class="cz-input"
                      bind:value={batesDigits}
                    />
                  </div>
                  <div class="cz-settings-row">
                    <label for="bates-suffix">Bates Suffix (Optional)</label>
                    <input
                      id="bates-suffix"
                      type="text"
                      class="cz-input"
                      placeholder="e.g. -CONFIDENTIAL"
                      bind:value={batesSuffix}
                    />
                  </div>
                </div>
              {/if}

              <!-- Custom Pattern Input -->
              {#if pageNumFormat === "custom"}
                <div class="cz-settings-row">
                  <label for="pn-custom">Custom Pattern (tokens: <code>&#123;n&#125;</code>, <code>&#123;total&#125;</code>, <code>&#123;roman&#125;</code>, <code>&#123;ROMAN&#125;</code>)</label>
                  <input
                    id="pn-custom"
                    type="text"
                    class="cz-input"
                    placeholder={"e.g. Doc #{n} of {total}"}
                    bind:value={pageNumCustomPattern}
                  />
                </div>
              {/if}

              <!-- Anchor Position 3x2 Grid -->
              <div class="cz-settings-row">
                <span class="cz-label">Position on Page</span>
                <div class="cz-pos-grid">
                  <button
                    type="button"
                    class="cz-pos-btn"
                    class:active={pageNumPosition === "top-left"}
                    onclick={() => (pageNumPosition = "top-left")}
                  >
                    Top Left
                  </button>
                  <button
                    type="button"
                    class="cz-pos-btn"
                    class:active={pageNumPosition === "top-center"}
                    onclick={() => (pageNumPosition = "top-center")}
                  >
                    Top Center
                  </button>
                  <button
                    type="button"
                    class="cz-pos-btn"
                    class:active={pageNumPosition === "top-right"}
                    onclick={() => (pageNumPosition = "top-right")}
                  >
                    Top Right
                  </button>
                  <button
                    type="button"
                    class="cz-pos-btn"
                    class:active={pageNumPosition === "bottom-left"}
                    onclick={() => (pageNumPosition = "bottom-left")}
                  >
                    Bottom Left
                  </button>
                  <button
                    type="button"
                    class="cz-pos-btn"
                    class:active={pageNumPosition === "bottom-center"}
                    onclick={() => (pageNumPosition = "bottom-center")}
                  >
                    Bottom Center
                  </button>
                  <button
                    type="button"
                    class="cz-pos-btn"
                    class:active={pageNumPosition === "bottom-right"}
                    onclick={() => (pageNumPosition = "bottom-right")}
                  >
                    Bottom Right
                  </button>
                </div>
              </div>

              <!-- Page Range & Starting Counter -->
              <div class="cz-settings-grid">
                <div class="cz-settings-row">
                  <label for="pn-start">Starting Number</label>
                  <input
                    id="pn-start"
                    type="number"
                    min="1"
                    max={MAX_PAGE_NUMBER_START}
                    class="cz-input"
                    bind:value={pageNumStart}
                  />
                </div>
                <div class="cz-settings-row">
                  <label for="pn-range">Pages to Number</label>
                  <input
                    id="pn-range"
                    type="text"
                    class="cz-input"
                    placeholder="all, 2-, 2-10, odd, even"
                    bind:value={pageNumRange}
                  />
                </div>
              </div>

              <!-- Typography & Color Settings -->
              <div class="cz-settings-grid">
                <div class="cz-settings-row">
                  <label for="pn-font">Font</label>
                  <select id="pn-font" class="cz-select" bind:value={pageNumFont}>
                    <option value="Helvetica">Helvetica (Clean Sans-Serif)</option>
                    <option value="TimesRoman">Times Roman (Serif)</option>
                    <option value="Courier">Courier (Monospace)</option>
                  </select>
                </div>
                <div class="cz-settings-row">
                  <label for="pn-size">Font Size ({pageNumSize} pt)</label>
                  <input
                    id="pn-size"
                    type="range"
                    min="8"
                    max="24"
                    step="1"
                    bind:value={pageNumSize}
                  />
                </div>
                <div class="cz-settings-row">
                  <label for="pn-color">Text Color</label>
                  <input
                    id="pn-color"
                    type="color"
                    class="cz-input-color"
                    bind:value={pageNumColor}
                  />
                </div>
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || isFileLoading || totalPages === 0}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Adding Numbers…" : "Add Page Numbers & Download"}
                </button>
              </div>
            </div>
          {:else if activeTool === "nup"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>Multi-Page per Sheet (N-Up Layout)</h3>
                <p>Tile 2, 4, or 9 pages onto single sheets. Ideal for handouts, pocket booklets, and saving paper while keeping crisp vector text.</p>
              </div>

              <!-- Pages per Sheet Selector -->
              <div class="cz-settings-row">
                <span class="cz-label">Pages per Sheet</span>
                <div class="cz-segmented-control">
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={nupPagesPerSheet === 2}
                    onclick={() => (nupPagesPerSheet = 2)}
                  >
                    2-Up (Side by Side)
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={nupPagesPerSheet === 4}
                    onclick={() => (nupPagesPerSheet = 4)}
                  >
                    4-Up (2×2 Grid)
                  </button>
                  <button
                    type="button"
                    class="cz-segment-btn"
                    class:active={nupPagesPerSheet === 9}
                    onclick={() => (nupPagesPerSheet = 9)}
                  >
                    9-Up (3×3 Grid)
                  </button>
                </div>
              </div>

              <!-- Sheet Size & Orientation -->
              <div class="cz-settings-grid">
                <div class="cz-settings-row">
                  <label for="nup-sheet-size">Target Sheet Size</label>
                  <select id="nup-sheet-size" class="cz-select" bind:value={nupSheetSize}>
                    <option value="a4">ISO A4 (210 × 297 mm)</option>
                    <option value="letter">US Letter (8.5 × 11 in)</option>
                    <option value="source">Match Original Dimensions</option>
                  </select>
                </div>
                <div class="cz-settings-row">
                  <label for="nup-orient">Sheet Orientation</label>
                  <select id="nup-orient" class="cz-select" bind:value={nupOrientation}>
                    <option value="auto">Auto (Best Aspect Ratio Fit)</option>
                    <option value="portrait">Force Portrait</option>
                    <option value="landscape">Force Landscape</option>
                  </select>
                </div>
              </div>

              <!-- Margin, Spacing & Border Option -->
              <div class="cz-settings-grid">
                <div class="cz-settings-row">
                  <label for="nup-margin">Outer Margin ({nupMargin} pt)</label>
                  <input
                    id="nup-margin"
                    type="range"
                    min="10"
                    max="60"
                    step="2"
                    bind:value={nupMargin}
                  />
                </div>
                <div class="cz-settings-row">
                  <label for="nup-spacing">Grid Spacing ({nupSpacing} pt)</label>
                  <input
                    id="nup-spacing"
                    type="range"
                    min="4"
                    max="40"
                    step="2"
                    bind:value={nupSpacing}
                  />
                </div>
                <div class="cz-settings-row cz-checkbox-row">
                  <label class="cz-checkbox-label">
                    <input
                      type="checkbox"
                      bind:checked={nupDrawBorder}
                    />
                    <span>Draw subtle border around each page</span>
                  </label>
                </div>
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || isFileLoading || totalPages === 0}
                  onclick={handleExecuteTool}
                >
                  {isProcessing ? "Assembling Layout…" : `Generate ${nupPagesPerSheet}-Up PDF & Download`}
                </button>
              </div>
            </div>
          {:else if activeTool === "metadata"}
            <div class="cz-panel-section">
              <div class="cz-section-header">
                <h3>PDF Metadata Inspector & Privacy Stripper</h3>
                <p>View, modify, or strip PDF Info fields (Author, Title, timestamps) and catalog/page XMP metadata before sharing. Metadata inside embedded images is left untouched.</p>
              </div>

              <div class="cz-settings-grid">
                <div class="cz-settings-row">
                  <label for="meta-title">Document Title</label>
                  <input
                    id="meta-title"
                    type="text"
                    class="cz-input"
                    placeholder="Document Title"
                    bind:value={metaTitle}
                    oninput={() => dirtyMetaFields.add("title")}
                  />
                </div>
                <div class="cz-settings-row">
                  <label for="meta-author">Author / Owner</label>
                  <input
                    id="meta-author"
                    type="text"
                    class="cz-input"
                    placeholder="Author Name"
                    bind:value={metaAuthor}
                    oninput={() => dirtyMetaFields.add("author")}
                  />
                </div>
              </div>

              <div class="cz-settings-grid">
                <div class="cz-settings-row">
                  <label for="meta-subject">Subject</label>
                  <input
                    id="meta-subject"
                    type="text"
                    class="cz-input"
                    placeholder="Document Subject or Description"
                    bind:value={metaSubject}
                    oninput={() => dirtyMetaFields.add("subject")}
                  />
                </div>
                <div class="cz-settings-row">
                  <label for="meta-keywords">Keywords (comma-separated)</label>
                  <input
                    id="meta-keywords"
                    type="text"
                    class="cz-input"
                    placeholder="invoice, contract, report"
                    bind:value={metaKeywords}
                    oninput={() => dirtyMetaFields.add("keywords")}
                  />
                </div>
              </div>

              <div class="cz-settings-grid">
                <div class="cz-settings-row">
                  <label for="meta-creator">Creating Software / Application</label>
                  <input
                    id="meta-creator"
                    type="text"
                    class="cz-input"
                    placeholder="e.g. Microsoft Word, LaTeX"
                    bind:value={metaCreator}
                    oninput={() => dirtyMetaFields.add("creator")}
                  />
                </div>
                <div class="cz-settings-row">
                  <label for="meta-producer">PDF Producer / Converter</label>
                  <input
                    id="meta-producer"
                    type="text"
                    class="cz-input"
                    placeholder="e.g. Quartz PDFContext, Distiller"
                    bind:value={metaProducer}
                    oninput={() => dirtyMetaFields.add("producer")}
                  />
                </div>
              </div>

              {#if metaCreationDate || metaModificationDate}
                <div class="cz-metadata-timestamps">
                  {#if metaCreationDate}
                    <div class="cz-timestamp-item">
                      <span class="cz-timestamp-label">Created:</span>
                      <span class="cz-timestamp-val">{new Date(metaCreationDate).toLocaleString()}</span>
                    </div>
                  {/if}
                  {#if metaModificationDate}
                    <div class="cz-timestamp-item">
                      <span class="cz-timestamp-label">Modified:</span>
                      <span class="cz-timestamp-val">{new Date(metaModificationDate).toLocaleString()}</span>
                    </div>
                  {/if}
                </div>
              {/if}

              <div class="cz-action-footer cz-action-dual">
                <button
                  type="button"
                  class="cz-btn cz-btn-secondary cz-btn-danger"
                  disabled={isProcessing || isFileLoading || totalPages === 0}
                  onclick={() => {
                    metaStripAll = true;
                    handleExecuteTool();
                  }}
                >
                  {isProcessing ? "Sanitizing…" : "Strip Document Metadata & Dates (Privacy Mode)"}
                </button>
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || isFileLoading || totalPages === 0}
                  onclick={() => {
                    metaStripAll = false;
                    handleExecuteTool();
                  }}
                >
                  {isProcessing ? "Saving…" : "Save Updated Metadata"}
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
                  disabled={isProcessing || isFileLoading || totalPages === 0}
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
                  disabled={isProcessing || isFileLoading || totalPages === 0}
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
                          checked={formValues[field.name] === true}
                          onchange={(e) =>
                            (formValues[field.name] = e.currentTarget.checked)}
                        />
                      {:else if field.type === "dropdown" && field.options}
                        <select id={`field-${field.name}`} class="cz-input" bind:value={formValues[field.name]}>
                          {#each field.options as opt}
                            <option value={opt}>{opt}</option>
                          {/each}
                        </select>
                      {:else if field.type === "radio" && field.options && field.options.length > 0}
                        <div class="cz-radio-group" role="radiogroup" aria-label={field.name}>
                          {#each field.options as opt}
                            <label class="cz-radio-pill {formValues[field.name] === opt ? 'is-selected' : ''}">
                              <input
                                type="radio"
                                name={field.name}
                                value={opt}
                                checked={formValues[field.name] === opt}
                                onchange={() => (formValues[field.name] = opt)}
                              />
                              <span>{opt}</span>
                            </label>
                          {/each}
                        </div>
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
                  disabled={isProcessing || isFileLoading || totalPages === 0 || formFields.length === 0}
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
                  disabled={isProcessing || isFileLoading || !userPassword || (securityMode === "protect" && totalPages === 0)}
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
                <p>Rebuilds damaged PDF xref tables and trailers, and inspects MP4 containers for a missing index.</p>
              </div>

              <div class="cz-repair-status-box">
                <div class="cz-repair-icon"><MacIcon name="repair" size={32} /></div>
                <div class="cz-repair-info">
                  <strong>Deep Document Repair Engine</strong>
                  <p>Analyzes byte streams, discovers orphan PDF objects, and reconstructs cross-reference indexes. MP4 recovery restores a missing header box; a recording with no index (MOOV) cannot be rebuilt and is reported instead.</p>
                </div>
              </div>

              <div class="cz-action-footer">
                <button
                  type="button"
                  class="cz-btn cz-btn-primary"
                  disabled={isProcessing || isFileLoading}
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
                      class="cz-btn cz-btn-secondary"
                      onclick={() => (activeTool = "studio")}
                    >
                      ✏️ Draw in Studio Editor
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
                          {#if reg.reason || reg.overlayText}
                            <span class="cz-redact-tag">{reg.reason || reg.overlayText}</span>
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
                  disabled={isProcessing || isFileLoading || totalPages === 0 || redactionList.length === 0}
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

  .cz-suite-landing {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    width: 100%;
  }

  .cz-suite-landing-header {
    text-align: center;
    max-width: 680px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }

  .cz-suite-badge-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.25rem 0.75rem;
    border-radius: 100px;
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-2);
  }

  .cz-suite-landing-title {
    margin: 0;
    font-family: var(--display, var(--sans));
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--text);
    letter-spacing: -0.025em;
    line-height: 1.2;
  }

  .cz-suite-landing-sub {
    margin: 0;
    font-size: 0.92rem;
    color: var(--text-3);
    line-height: 1.5;
  }

  .cz-suite-active-dropzone-box {
    max-width: 740px;
    width: 100%;
    margin: 0.5rem auto 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-xl, 24px);
    padding: 1.25rem;
    box-shadow: var(--shadow-sm);
  }

  .cz-suite-target-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r, 16px);
  }

  .cz-suite-target-info {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
  }

  .cz-suite-target-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .cz-suite-target-label {
    font-size: 0.88rem;
    color: var(--text);
  }

  .cz-suite-target-label strong {
    color: var(--accent);
    font-weight: 700;
  }

  .cz-suite-target-desc {
    font-size: 0.78rem;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cz-suite-target-badge {
    padding: 0.2rem 0.55rem;
    font-size: 0.72rem;
    font-weight: 700;
    border-radius: 100px;
    background: var(--accent-soft, rgba(16, 185, 129, 0.1));
    color: var(--accent);
    border: 1px solid var(--green-border, rgba(16, 185, 129, 0.24));
    flex-shrink: 0;
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
    gap: 0.45rem;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.52rem 1.15rem;
    border-radius: var(--r-md, 8px);
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    outline: none;
    user-select: none;
    -webkit-user-select: none;
    transition:
      background-color 0.16s ease,
      border-color 0.16s ease,
      box-shadow 0.16s ease,
      transform 0.16s ease;
  }

  .cz-btn-primary {
    background: linear-gradient(180deg, var(--accent) 0%, var(--accent-2, var(--accent)) 100%);
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .cz-btn-primary:hover:not(:disabled) {
    box-shadow: 0 0 10px var(--accent-glow), 0 3px 8px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  .cz-btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  /* Rectangular Collapsible Advanced Options Drawer */
  .cz-advanced-drawer {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-md, 8px);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    transition: border-color var(--t), box-shadow var(--t);
  }
  .cz-advanced-drawer.is-open {
    border-color: var(--brand);
    box-shadow: 0 0 0 1px var(--brand-glow), var(--shadow-sm);
  }
  .cz-advanced-drawer-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 1rem;
    background: var(--surface2);
    border: none;
    cursor: pointer;
    color: var(--text);
    font-size: 0.82rem;
    text-align: left;
    transition: background-color var(--t);
  }
  .cz-advanced-drawer-toggle:hover {
    background: var(--surface3, var(--surface2));
  }
  .cz-drawer-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-drawer-summary {
    font-size: 0.75rem;
    color: var(--text-3);
    font-weight: 500;
  }
  .cz-drawer-chevron {
    display: flex;
    align-items: center;
    transition: transform var(--t);
    color: var(--text-3);
  }
  .cz-drawer-chevron.is-rotated {
    transform: rotate(180deg);
  }
  .cz-advanced-drawer-body {
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  .cz-drawer-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    align-items: end;
  }
  .cz-drawer-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .cz-drawer-field label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-select-sm {
    padding: 0.45rem 0.65rem;
    font-size: 0.8rem;
    border-radius: var(--r-sm);
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    outline: none;
  }
  .cz-drawer-field-checks {
    flex-direction: row;
    gap: 1rem;
    padding-bottom: 0.4rem;
  }
  .cz-check-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--text-2);
    cursor: pointer;
  }
  .cz-drawer-footer {
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
    color: var(--text-3);
    font-size: 0.72rem;
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

  /* Remove Pages Tool Styles */
  .cz-remove-input-wrap {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    width: 100%;
  }
  .cz-chips-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .cz-chip-btn {
    padding: 0.35rem 0.75rem;
    font-size: 0.78rem;
    font-weight: 500;
    border-radius: var(--r-full, 9999px);
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-2);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .cz-chip-btn:hover {
    background: var(--surface3, var(--surface));
    border-color: var(--accent);
    color: var(--text);
  }
  .cz-chip-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .cz-remove-summary-banner {
    padding: 0.75rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 0.84rem;
    color: var(--text-2);
    margin: 1rem 0;
  }
  .cz-remove-summary-banner.is-invalid {
    background: var(--rose-soft, #fee2e2);
    border-color: var(--rose, #dc2626);
    color: var(--rose, #dc2626);
  }
  .cz-warn-text {
    color: var(--rose, #dc2626);
  }
  .cz-remove-page-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 1rem;
    margin: 1.25rem 0;
    max-height: 480px;
    overflow-y: auto;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface2);
  }
  .cz-remove-card {
    display: flex;
    flex-direction: column;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 2px solid var(--border);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    user-select: none;
  }
  .cz-remove-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-hover, var(--text-3));
  }
  .cz-remove-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .cz-remove-card.is-removed {
    border-color: var(--rose, #dc2626);
    background: var(--rose-soft, #fff1f2);
  }
  .cz-remove-card-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1.414;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    overflow: hidden;
  }
  .cz-remove-thumb-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .cz-remove-card.is-removed .cz-remove-thumb-img {
    opacity: 0.45;
    filter: grayscale(80%);
  }
  .cz-remove-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-3);
    font-size: 0.75rem;
  }
  .cz-remove-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 0.2rem 0.45rem;
    font-size: 0.68rem;
    font-weight: 700;
    border-radius: var(--r-xs, 4px);
    background: rgba(0, 0, 0, 0.65);
    color: #ffffff;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    letter-spacing: 0.03em;
  }
  .cz-remove-badge.is-removed-badge {
    background: var(--rose, #dc2626);
    box-shadow: 0 1px 4px rgba(220, 38, 38, 0.4);
  }
  .cz-remove-card-footer {
    padding: 0.4rem 0.5rem;
    text-align: center;
    border-top: 1px solid var(--border);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-remove-card.is-removed .cz-remove-card-footer {
    color: var(--rose, #dc2626);
  }
  .cz-field-error-text {
    font-size: 0.78rem;
    color: var(--rose, #dc2626);
    margin-top: 0.35rem;
    font-weight: 500;
  }
  .cz-segmented-wrap {
    flex-wrap: wrap;
    height: auto;
    padding: 3px;
  }
  .cz-pos-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }
  .cz-pos-btn {
    padding: 0.55rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-2);
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  .cz-pos-btn:hover {
    border-color: var(--border-hover, var(--text-3));
    color: var(--text);
  }
  .cz-pos-btn.active {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
    font-weight: 600;
  }
  .cz-input-color {
    height: 38px;
    padding: 2px 4px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    cursor: pointer;
    width: 100%;
    max-width: 120px;
  }
  .cz-checkbox-row {
    display: flex;
    align-items: center;
    margin-top: 1.5rem;
  }
  .cz-checkbox-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-2);
    cursor: pointer;
    user-select: none;
  }
  .cz-metadata-timestamps {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    padding: 0.75rem 1rem;
    border-radius: var(--r-sm);
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 0.8rem;
    margin-top: 0.5rem;
  }
  .cz-timestamp-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .cz-timestamp-label {
    font-weight: 600;
    color: var(--text-3);
  }
  .cz-timestamp-val {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .cz-action-dual {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: flex-end;
  }
  .cz-btn-danger {
    color: var(--rose, #dc2626) !important;
    border-color: rgba(220, 38, 38, 0.3) !important;
  }
  .cz-btn-danger:hover {
    background: rgba(220, 38, 38, 0.1) !important;
    border-color: var(--rose, #dc2626) !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .cz-remove-card, .cz-chip-btn {
      transition: none !important;
      transform: none !important;
    }
  }
</style>
