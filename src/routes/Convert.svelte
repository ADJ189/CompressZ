<script lang="ts">
  import FileDropzone from "../components/FileDropzone.svelte";
  import HubHeader from "../components/HubHeader.svelte";
  import { navigate } from "../router";
  import { convertVideo, type VideoContainer } from "../lib/convertMedia";
  import { compressAudio } from "../lib/compressAudio";
  import { compressImage } from "../lib/compressImage";
  import { pdfToImages } from "../lib/convertPdf";
  import { docxToPdf, docxToText, pptxToPdf, pptxToText, htmlToPdf } from "../lib/convertOffice";
  import { convertPdfToWord } from "../lib/conversions/pdfToWord";
  import { convertPdfToExcel } from "../lib/conversions/pdfToExcel";
  import { convertPdfToPpt } from "../lib/conversions/pdfToPpt";
  import { convertExcelToPdf } from "../lib/conversions/excelToPdf";
  import { convertWithLibreOfficeWasm } from "../lib/conversions/libreOfficeWasm";
  import { consumeStagedUniversalFile } from "../store";
  import { imagesToPdf } from "../lib/imagesToPdf";
  import { docxToPdf, docxToText, docxToHtml, pptxToPdf, pptxToText } from "../lib/convertOffice";
  import { audioOptions, imageOptions } from "../lib/options";
  import { runScheduled } from "../lib/resourceManager";
  import { naturalOrder } from "../lib/recommendations";
  import { formatBytes, outputFilename } from "../lib/types";
  import type { AudioFormat, ImageFormat } from "../lib/types";
  import { toast } from "../toast";
  import { getPlatformInfo } from "../lib/platform";
  import { onMount } from "svelte";

  type Category = "video" | "audio" | "image" | "pdf2office" | "pdf2img" | "docx" | "xlsx" | "pptx" | "html";
  type Category = "video" | "audio" | "image" | "pdf2img" | "img2pdf" | "docx" | "pptx";

  let activeCat = $state<Category>("video");
  let selectedFiles = $state<File[]>([]);
  let targetFormat = $state<string>("mp4");
  let isConverting = $state(false);
  let convertedResults = $state<Array<{ name: string; blob: Blob }>>([]);
  let selectedEngine = $state<"web-native" | "libreoffice">("web-native");

  // macOS Inspector Advanced State
  let videoCrf = $state<number>(18);
  let videoResolution = $state<"original" | "1080p" | "720p" | "480p">("original");
  let videoFps = $state<number>(0);
  let audioBitrate = $state<string>("192k");
  let muteAudio = $state<boolean>(false);
  let fastStart = $state<boolean>(true);
  let stripMetadata = $state<boolean>(false);

  const platform = $derived(getPlatformInfo());

  function applyQueryParams() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const qFrom = params.get("from");
    const qTo = params.get("to");
    const qType = params.get("type");
    const qCat = params.get("cat");

    if (qCat && qCat in CATS) {
      activeCat = qCat as Category;
    } else if (qType === "pdf-word" || (qFrom === "pdf" && qTo === "docx")) {
      activeCat = "pdf2office";
      targetFormat = "docx";
    } else if (qType === "pdf-excel" || (qFrom === "pdf" && qTo === "xlsx")) {
      activeCat = "pdf2office";
      targetFormat = "xlsx";
    } else if (qType === "pdf-ppt" || (qFrom === "pdf" && qTo === "pptx")) {
      activeCat = "pdf2office";
      targetFormat = "pptx";
    } else if (qType === "office-pdf" || (qFrom === "docx" && qTo === "pdf")) {
      activeCat = "docx";
      targetFormat = "pdf";
    } else if (qFrom === "xlsx" && qTo === "pdf") {
      activeCat = "xlsx";
      targetFormat = "pdf";
    } else if (qFrom === "pptx" && qTo === "pdf") {
      activeCat = "pptx";
      targetFormat = "pdf";
    } else if (qFrom === "pdf" && qTo === "images") {
      activeCat = "pdf2img";
      targetFormat = "png";
    } else if (qFrom === "html" || qTo === "html") {
      activeCat = "html";
      if (qTo) targetFormat = qTo;
    }
  }

  onMount(() => {
    applyQueryParams();

    const staged = consumeStagedUniversalFile();
    if (staged?.file) {
      selectedFiles = [staged.file];
      if (staged.actionId === "pdf-to-word") {
        activeCat = "pdf2office";
        targetFormat = "docx";
      } else if (staged.actionId === "pdf-to-excel") {
        activeCat = "pdf2office";
        targetFormat = "xlsx";
      } else if (staged.actionId === "pdf-to-ppt") {
        activeCat = "pdf2office";
        targetFormat = "pptx";
      } else if (staged.actionId === "pdf-to-images") {
        activeCat = "pdf2img";
        targetFormat = "png";
      } else if (staged.actionId === "docx-to-pdf") {
        activeCat = "docx";
        targetFormat = "pdf";
      } else if (staged.actionId === "xlsx-to-pdf") {
        activeCat = "xlsx";
        targetFormat = "pdf";
      }
    }
  });

  const CATS: Record<
    Category,
    {
      label: string;
      icon: string;
      accept: string;
      targets: { value: string; label: string }[];
    }
  > = {
    video: {
      label: "Video",
      icon: "🎬",
      accept: "video/*",
      targets: [
        { value: "mp4", label: "MP4 (H.264/AAC)" },
        { value: "webm", label: "WebM (VP9/Opus)" },
        { value: "mov", label: "MOV" },
        { value: "mkv", label: "MKV" },
        { value: "gif", label: "GIF" },
      ],
    },
    audio: {
      label: "Audio",
      icon: "🎵",
      accept: "audio/*",
      targets: [
        { value: "mp3", label: "MP3" },
        { value: "aac", label: "AAC (.m4a)" },
        { value: "ogg", label: "OGG Vorbis" },
        { value: "opus", label: "Opus" },
        { value: "flac", label: "FLAC" },
        { value: "wav", label: "WAV" },
      ],
    },
    image: {
      label: "Image",
      icon: "🖼️",
      accept: "image/*,.heic,.heif",
      targets: [
        { value: "webp", label: "WebP" },
        { value: "jpeg", label: "JPEG" },
        { value: "png", label: "PNG" },
        { value: "avif", label: "AVIF" },
      ],
    },
    pdf2office: {
      label: "PDF to Office",
      icon: "📑",
      accept: "application/pdf,.pdf",
      targets: [
        { value: "docx", label: "Word (.docx)" },
        { value: "xlsx", label: "Excel (.xlsx)" },
        { value: "pptx", label: "PowerPoint (.pptx)" },
      ],
    },
    pdf2img: {
      label: "PDF to Images",
      icon: "📄",
      accept: "application/pdf,.pdf",
      targets: [
        { value: "png", label: "PNG images" },
        { value: "jpeg", label: "JPEG images" },
        { value: "webp", label: "WebP images" },
      ],
    },
    img2pdf: {
      label: "Images to PDF",
      icon: "🧩",
      accept: "image/*",
      targets: [{ value: "pdf", label: "PDF document" }],
    },
    docx: {
      label: "DOCX",
      icon: "📘",
      accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      targets: [
        { value: "pdf", label: "PDF Document" },
        { value: "txt", label: "Plain Text" },
        { value: "html", label: "HTML" },
      ],
    },
    xlsx: {
      label: "Excel",
      icon: "📗",
      accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      targets: [
        { value: "pdf", label: "PDF Document" },
      ],
    },
    pptx: {
      label: "PPTX",
      icon: "📙",
      accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
      targets: [
        { value: "pdf", label: "PDF Document" },
        { value: "txt", label: "Plain Text" },
      ],
    },
    html: {
      label: "HTML",
      icon: "🌐",
      accept: ".html,.htm,text/html",
      targets: [
        { value: "pdf", label: "PDF Document" },
      ],
    },
  };

  function handleCatChange(cat: Category) {
    activeCat = cat;
    selectedFiles = [];
    convertedResults = [];
    targetFormat = CATS[cat].targets[0].value;
  }

  function handleFilesAdded(files: File[]) {
    selectedFiles = [...selectedFiles, ...files];
  }

  function handleReorder() {
    if (selectedFiles.length < 2) return;
    const names = selectedFiles.map((f) => f.name);
    const indices = naturalOrder(names);
    const prev = [...selectedFiles];
    selectedFiles = indices.map((i) => prev[i]);
    toast("Reordered files numerically", "success");
  }

  async function handleConvertAll() {
    if (!selectedFiles.length) return;
    isConverting = true;
    convertedResults = [];

    // Images → PDF produces one ordered document, not one output per file.
    if (activeCat === "img2pdf") {
      const files = [...selectedFiles];
      try {
        const bytes = files.reduce((sum, f) => sum + f.size, 0);
        const blob = await runScheduled(
          {
            kind: "pdf",
            label: `Images to PDF (${files.length} images)`,
            bytes,
          },
          () => imagesToPdf(files, { quality: 0.9 }),
        );
        convertedResults = [
          {
            name: outputFilename(files[0].name, blob, {
              suffix: `-combined-${files.length}`,
              fallbackExt: "pdf",
            }),
            blob,
          },
        ];
      } catch (err) {
        console.error("[convert] img2pdf error:", err);
        toast(
          `Failed to combine images: ${(err as Error).message}`,
          "error",
        );
      } finally {
        isConverting = false;
      }
      if (convertedResults.length > 0) toast("Conversion completed", "success");
      return;
    }

    for (const file of selectedFiles) {
      try {
        let blob: Blob | null = null;
        let suffix = "";

        if (activeCat === "video") {
          const res = await runScheduled(
            { kind: "video", label: file.name, bytes: file.size },
            () =>
              convertVideo(file, targetFormat as VideoContainer, {
                crf: videoCrf,
                resolution: videoResolution,
                fps: videoFps,
                muteAudio,
                fastStart,
                stripMetadata,
                audioBitrate,
              }),
          );
          blob = res.blob;
        } else if (activeCat === "audio") {
          const kbps = Number(audioBitrate.replace(/k$/i, ""));
          const res = await runScheduled(
            { kind: "audio", label: file.name, bytes: file.size },
            () =>
              compressAudio(
                file,
                audioOptions({
                  fmt: targetFormat as AudioFormat,
                  bitrate: Number.isFinite(kbps) ? kbps : 192,
                }),
              ),
          );
          blob = res.blob;
        } else if (activeCat === "image") {
          const mime: ImageFormat =
            targetFormat === "jpeg"
              ? "image/jpeg"
              : targetFormat === "png"
                ? "image/png"
                : targetFormat === "avif"
                  ? "image/avif"
                  : "image/webp";
          const res = await runScheduled(
            { kind: "image", label: file.name, bytes: file.size },
            () =>
              compressImage(file, imageOptions({ quality: 95, format: mime })),
          );
          blob = res.blob;
        } else if (activeCat === "pdf2office") {
          if (selectedEngine === "libreoffice") {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const outBytes = await convertWithLibreOfficeWasm(bytes, "pdf", targetFormat);
            blob = new Blob([new Uint8Array(outBytes)]);
          } else {
            if (targetFormat === "docx") blob = await convertPdfToWord(file);
            else if (targetFormat === "xlsx") blob = await convertPdfToExcel(file);
            else if (targetFormat === "pptx") blob = await convertPdfToPpt(file);
          }
        } else if (activeCat === "pdf2img") {
          const res = await runScheduled(
            { kind: "pdf", label: file.name, bytes: file.size },
            () =>
              pdfToImages(
                file,
                targetFormat as "png" | "jpeg" | "webp",
                150,
              ),
          );
          blob = res.blob;
          suffix = "-images";
        } else if (activeCat === "docx") {
          if (targetFormat === "pdf") {
            if (selectedEngine === "libreoffice") {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const outBytes = await convertWithLibreOfficeWasm(bytes, "docx", "pdf");
              blob = new Blob([new Uint8Array(outBytes)], { type: "application/pdf" });
            } else {
              blob = await docxToPdf(file);
            }
          } else {
            blob = new Blob([await docxToText(file)], { type: "text/plain" });
          }
        } else if (activeCat === "xlsx") {
          if (selectedEngine === "libreoffice") {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const outBytes = await convertWithLibreOfficeWasm(bytes, "xlsx", "pdf");
            blob = new Blob([new Uint8Array(outBytes)], { type: "application/pdf" });
          } else {
            blob = await convertExcelToPdf(file);
          }
        } else if (activeCat === "pptx") {
          if (targetFormat === "pdf") {
            if (selectedEngine === "libreoffice") {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const outBytes = await convertWithLibreOfficeWasm(bytes, "pptx", "pdf");
              blob = new Blob([new Uint8Array(outBytes)], { type: "application/pdf" });
            } else {
              blob = await pptxToPdf(file);
            }
          } else {
            blob = new Blob([await pptxToText(file)], { type: "text/plain" });
          }
        } else if (activeCat === "html") {
          const htmlText = await file.text();
          blob = await htmlToPdf(htmlText);
            blob = await runScheduled(
              { kind: "document", label: file.name, bytes: file.size },
              () => docxToPdf(file),
            );
          } else if (targetFormat === "html") {
            blob = await runScheduled(
              { kind: "document", label: file.name, bytes: file.size },
              async () => new Blob([await docxToHtml(file)], { type: "text/html" }),
            );
          } else {
            blob = await runScheduled(
              { kind: "document", label: file.name, bytes: file.size },
              async () => new Blob([await docxToText(file)], { type: "text/plain" }),
            );
          }
        } else if (activeCat === "pptx") {
          if (targetFormat === "pdf") {
            blob = await runScheduled(
              { kind: "document", label: file.name, bytes: file.size },
              () => pptxToPdf(file),
            );
          } else {
            blob = await runScheduled(
              { kind: "document", label: file.name, bytes: file.size },
              async () => new Blob([await pptxToText(file)], { type: "text/plain" }),
            );
          }
        }

        if (blob) {
          convertedResults = [
            ...convertedResults,
            {
              name: outputFilename(file.name, blob, {
                suffix,
                fallbackExt: targetFormat === "jpeg" ? "jpg" : targetFormat,
              }),
              blob,
            },
          ];
        }
      } catch (err) {
        console.error("[convert] error:", err);
        toast(
          `Failed to convert ${file.name}: ${(err as Error).message}`,
          "error",
        );
      }
    }

    isConverting = false;
    if (convertedResults.length > 0) {
      toast("Conversion completed", "success");
    }
  }

  function downloadItem(item: { name: string; blob: Blob }) {
    const url = URL.createObjectURL(item.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function handleClear() {
    selectedFiles = [];
    convertedResults = [];
  }
</script>

<div class="tool-wrap cz-apple-workbench">
  <!-- Left Main Column: Converter Workspace -->
  <main class="cz-card-main">
    <div class="cz-main-header">
      <div>
        <h1 class="cz-main-title">Multi-Format Converter</h1>
        <p class="cz-main-sub">Convert video, audio, office files, and images in browser memory</p>
      </div>

      <!-- Quick Fast Organize Reorder Action -->
      {#if selectedFiles.length > 1}
        <button
          type="button"
          class="cz-segmented-item"
          onclick={handleReorder}
        >
          🔀 Reorder Files
        </button>
      {/if}
    </div>

    <!-- Category Selector (Apple Segmented Bar) -->
    <div class="cz-segmented-track cz-cat-segmented">
      {#each Object.entries(CATS) as [catKey, meta]}
        <button
          type="button"
          class="cz-segmented-item {activeCat === catKey ? 'is-active' : ''}"
          onclick={() => handleCatChange(catKey as Category)}
        >
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
        </button>
      {/each}
    </div>

    <!-- Compact Options Bar -->
    <div class="cz-options-pill-bar">
      <div class="cz-opt-group">
        <span class="cz-opt-label">Target Format</span>
        <div class="cz-segmented-track">
          {#each CATS[activeCat].targets as t}
            <button
              type="button"
              class="cz-segmented-item {targetFormat === t.value ? 'is-active' : ''}"
              onclick={() => (targetFormat = t.value)}
            >
              {t.label}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- Ingestion Dropzone -->
    <FileDropzone
      accept={CATS[activeCat].accept}
      icon={CATS[activeCat].icon}
      title="Click or drag {CATS[activeCat].label} files here"
      subtitle="Convert directly inside browser memory"
      hasFiles={selectedFiles.length > 0}
      onFiles={handleFilesAdded}
    />

    <!-- Conversion Queue -->
    {#if selectedFiles.length > 0}
      <div class="cz-queue">
        <div class="cz-queue-toolbar">
          <span class="cz-queue-count">{selectedFiles.length} files selected</span>
          <div class="cz-queue-actions">
            <button
              type="button"
              class="cz-btn cz-btn-primary cz-btn-sm cz-btn-pill"
              disabled={isConverting}
              onclick={handleConvertAll}
            >
              {isConverting ? "Converting…" : "Convert All"}
            </button>
            <button
              type="button"
              class="cz-btn cz-btn-ghost cz-btn-sm"
              disabled={isConverting}
              onclick={handleClear}
            >
              Clear
            </button>
          </div>
        </div>

        <div class="cz-inset-table">
          {#each selectedFiles as file, idx}
            {@const res = convertedResults.find((r) => r.name.startsWith(file.name.replace(/\.[^/.]+$/, "")))}
            <div class="cz-inset-row">
              <div class="cz-inset-row-left">
                <div class="cz-file-badge">{activeCat.toUpperCase().slice(0, 4)}</div>
                <div class="cz-card-meta">
                  <span class="cz-inset-row-name" title={file.name}>{file.name}</span>
                  <span class="cz-inset-row-meta">{formatBytes(file.size)}</span>
                </div>
              </div>

              <div class="cz-inset-row-right">
                {#if isConverting}
                  <div class="cz-status-pill is-busy">Converting...</div>
                {:else if res}
                  <div class="cz-status-pill is-done">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>{formatBytes(res.blob.size)}</span>
                  </div>
                  <button
                    type="button"
                    class="cz-icon-btn-download"
                    title="Download converted file"
                    onclick={() => downloadItem(res)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        {#if convertedResults.length > 0}
          <div class="cz-summary-bar">
            <span>{convertedResults.length} of {selectedFiles.length} converted</span>
            <button
              type="button"
              class="cz-btn-download-all"
              onclick={() => {
                for (const r of convertedResults) downloadItem(r);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Download All</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </main>

  <!-- Right Sidebar: macOS Inspector & Tools -->
  <aside class="cz-card-side">
    <!-- macOS Sonoma / Sequoia Advanced Conversion Inspector -->
    <div class="cz-sidebar-card cz-mac-inspector">
      <div class="cz-sidebar-header">
        <div class="cz-mac-header-title">
          <span class="cz-mac-apple-icon">⚙️</span>
          <span class="cz-sidebar-title">Inspector</span>
        </div>
        <span class="cz-tier-tag">macOS Pro</span>
      </div>

      {#if activeCat === "video"}
        <div class="cz-mac-inspector-group">
          <div class="cz-mac-prop-row">
            <span class="cz-mac-prop-label">
              <span class="cz-sf-icon">🎚️</span> Quality (CRF)
            </span>
            <div class="cz-segmented-track cz-segmented-mini">
              <button
                type="button"
                class="cz-segmented-item {videoCrf === 18 ? 'is-active' : ''}"
                onclick={() => (videoCrf = 18)}
              >
                HQ (18)
              </button>
              <button
                type="button"
                class="cz-segmented-item {videoCrf === 23 ? 'is-active' : ''}"
                onclick={() => (videoCrf = 23)}
              >
                Balanced
              </button>
              <button
                type="button"
                class="cz-segmented-item {videoCrf === 28 ? 'is-active' : ''}"
                onclick={() => (videoCrf = 28)}
              >
                Small
              </button>
            </div>
          </div>

          <div class="cz-mac-prop-row">
            <span class="cz-mac-prop-label">
              <span class="cz-sf-icon">📺</span> Resolution
            </span>
            <select class="cz-select-pill" bind:value={videoResolution}>
              <option value="original">Native (Source)</option>
              <option value="1080p">1080p FHD</option>
              <option value="720p">720p HD</option>
              <option value="480p">480p SD</option>
            </select>
          </div>

          <div class="cz-mac-prop-row">
            <span class="cz-mac-prop-label">
              <span class="cz-sf-icon">⏱️</span> Frame Cap
            </span>
            <div class="cz-segmented-track cz-segmented-mini">
              <button
                type="button"
                class="cz-segmented-item {videoFps === 0 ? 'is-active' : ''}"
                onclick={() => (videoFps = 0)}
              >
                Native
              </button>
              <button
                type="button"
                class="cz-segmented-item {videoFps === 60 ? 'is-active' : ''}"
                onclick={() => (videoFps = 60)}
              >
                60 fps
              </button>
              <button
                type="button"
                class="cz-segmented-item {videoFps === 30 ? 'is-active' : ''}"
                onclick={() => (videoFps = 30)}
              >
                30 fps
              </button>
            </div>
          </div>

          <div class="cz-mac-prop-row">
            <span class="cz-mac-prop-label">
              <span class="cz-sf-icon">🎧</span> Audio Bitrate
            </span>
            <select class="cz-select-pill" bind:value={audioBitrate}>
              <option value="320k">320 kbps (HQ)</option>
              <option value="192k">192 kbps (Standard)</option>
              <option value="128k">128 kbps (Voice)</option>
              <option value="96k">96 kbps (Compact)</option>
            </select>
          </div>

          <div class="cz-mac-toggle-row">
            <label class="cz-mac-toggle-label" for="toggle-mute">
              <span class="cz-sf-icon">🔇</span>
              <span>Mute Audio Track</span>
            </label>
            <input
              id="toggle-mute"
              type="checkbox"
              class="cz-mac-switch"
              bind:checked={muteAudio}
            />
          </div>

          <div class="cz-mac-toggle-row">
            <label class="cz-mac-toggle-label" for="toggle-faststart">
              <span class="cz-sf-icon">⚡</span>
              <span>FastStart Web Stream</span>
            </label>
            <input
              id="toggle-faststart"
              type="checkbox"
              class="cz-mac-switch"
              bind:checked={fastStart}
            />
          </div>

          <div class="cz-mac-toggle-row">
            <label class="cz-mac-toggle-label" for="toggle-meta">
              <span class="cz-sf-icon">🛡️</span>
              <span>Strip Metadata / Privacy</span>
            </label>
            <input
              id="toggle-meta"
              type="checkbox"
              class="cz-mac-switch"
              bind:checked={stripMetadata}
            />
          </div>
        </div>
      {:else if activeCat === "audio"}
        <div class="cz-mac-inspector-group">
          <div class="cz-mac-prop-row">
            <span class="cz-mac-prop-label">
              <span class="cz-sf-icon">🎧</span> Audio Bitrate
            </span>
            <select class="cz-select-pill" bind:value={audioBitrate}>
              <option value="320k">320 kbps (HQ)</option>
              <option value="192k">192 kbps (Standard)</option>
              <option value="128k">128 kbps (Voice)</option>
              <option value="96k">96 kbps (Compact)</option>
            </select>
          </div>
        </div>
      {:else if activeCat === "pdf2office" || activeCat === "docx" || activeCat === "xlsx" || activeCat === "pptx"}
        <div class="cz-mac-inspector-group">
          <div class="cz-mac-prop-row">
            <span class="cz-mac-prop-label">
              <span class="cz-sf-icon">⚙️</span> Document Engine
            </span>
          </div>
          <div class="cz-dual-engine-box">
            <button
              type="button"
              class="cz-engine-toggle {selectedEngine === 'web-native' ? 'is-selected' : ''}"
              onclick={() => (selectedEngine = 'web-native')}
            >
              <div class="cz-engine-head">
                <span class="cz-engine-icon">⚡</span>
                <span class="cz-engine-name">Fast Web-Native</span>
                <span class="cz-engine-chip">Default ⭐</span>
              </div>
              <div class="cz-engine-desc">Instant startup &bull; Low RAM (~50MB) &bull; Zero Download</div>
            </button>

            <button
              type="button"
              class="cz-engine-toggle {selectedEngine === 'libreoffice' ? 'is-selected' : ''}"
              onclick={() => (selectedEngine = 'libreoffice')}
            >
              <div class="cz-engine-head">
                <span class="cz-engine-icon">🏛️</span>
                <span class="cz-engine-name">LibreOffice WASM</span>
                <span class="cz-engine-chip is-heavy">~85MB</span>
              </div>
              <div class="cz-engine-desc">Desktop Fidelity &bull; Complex Equations &bull; On-Demand</div>
            </button>
          </div>

          {#if selectedEngine === 'libreoffice'}
            <div class="cz-engine-warning">
              ⚠️ Downloads ~85 MB WebAssembly runtime on first execution. 100% browser-local processing.
            </div>
          {/if}
        </div>
      {:else}
        <div class="cz-mac-prop-info">
          Optimal preset automatically tuned for {CATS[activeCat].label} output.
        </div>
      {/if}
    </div>

    <!-- Quick PDF to Markdown shortcut -->
    <div class="cz-sidebar-card">
      <div class="cz-sidebar-header">
        <span class="cz-sidebar-title">PDF to Markdown</span>
      </div>
      <p class="cz-sidebar-meta">
        Extract column-aware text, tables, formulas, and visual figures into a clean Markdown ZIP bundle.
      </p>
      <button
        type="button"
        class="cz-btn cz-btn-secondary cz-btn-sm cz-btn-pill"
        onclick={() => navigate("convert/pdf-markdown")}
      >
        Open PDF to Markdown →
      </button>
    </div>

    <!-- Engine Diagnostics -->
    <div class="cz-sidebar-card">
      <div class="cz-sidebar-header">
        <span class="cz-sidebar-title">Active Engines</span>
        <span class="cz-tier-tag">{platform?.tier ?? "balanced"}</span>
      </div>
      <div class="cz-sidebar-meta">
        <div>Video: {platform?.webCodecs ? "WebCodecs + Mediabunny" : "FFmpeg.wasm"}</div>
        <div>Images: {platform?.webgl2 ? "WebGL2 + Canvas2D" : "Canvas2D"}</div>
      </div>
    </div>
  </aside>
</div>

<style>
  .cz-apple-workbench {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 1.5rem;
    align-items: start;
  }
  .cz-card-main {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }
  .cz-card-side {
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
    min-width: 0;
  }
  .cz-main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .cz-main-title {
    font-family: var(--display);
    font-size: 1.45rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-main-sub {
    font-size: 0.82rem;
    color: var(--text-3);
  }
  .cz-segmented-track {
    display: inline-flex;
    align-items: center;
    background: var(--bg2);
    padding: 3px;
    border-radius: 100px;
    border: 1px solid var(--border);
    gap: 2px;
  }
  .cz-segmented-item {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.75rem;
    border-radius: 100px;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-2);
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background var(--t), color var(--t);
    white-space: nowrap;
  }
  .cz-segmented-item:hover {
    color: var(--text);
  }
  .cz-segmented-item.is-active {
    background: var(--surface);
    color: var(--accent);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
  .cz-segmented-mini .cz-segmented-item {
    padding: 0.22rem 0.55rem;
    font-size: 0.74rem;
  }
  .cz-cat-segmented {
    flex-wrap: wrap;
    align-self: flex-start;
  }
  .cz-options-pill-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--r);
    background: var(--surface);
  }
  .cz-opt-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    flex-wrap: wrap;
  }
  .cz-opt-label {
    font-weight: 600;
    color: var(--text-2);
  }
  .cz-queue {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .cz-queue-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.85rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .cz-queue-count {
    font-weight: 600;
    color: var(--text);
  }
  .cz-queue-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .cz-inset-table {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cz-inset-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.65rem 0.9rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r);
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .cz-inset-row-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    flex: 1 1 200px;
  }
  .cz-file-badge {
    padding: 0.2rem 0.45rem;
    border-radius: var(--r-xs);
    background: var(--surface2);
    border: 1px solid var(--border);
    font-size: 0.7rem;
    font-family: var(--mono);
    font-weight: 700;
    color: var(--text-2);
  }
  .cz-card-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cz-inset-row-name {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cz-inset-row-meta {
    font-size: 0.76rem;
    font-family: var(--mono);
    color: var(--text-3);
  }
  .cz-inset-row-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .cz-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border-radius: 100px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .cz-status-pill.is-busy {
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid var(--accent-glow);
  }
  .cz-status-pill.is-done {
    background: var(--green-soft);
    color: var(--green);
    border: 1px solid var(--green-border);
  }
  .cz-summary-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1rem;
    border-radius: var(--r);
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 0.85rem;
    color: var(--text-2);
  }
  .cz-btn-download-all {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--accent);
    color: #fff;
    padding: 0.4rem 0.9rem;
    border-radius: 100px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: background var(--t);
  }
  .cz-btn-download-all:hover {
    background: var(--accent-2);
  }
  .cz-btn-pill {
    border-radius: 9999px;
  }
  .cz-icon-btn-download {
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--accent);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--t), border-color var(--t), transform var(--t);
  }
  .cz-icon-btn-download:hover {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
    transform: scale(1.05);
  }
  .cz-sidebar-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    padding: 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .cz-mac-inspector {
    border: 1px solid var(--border-mid);
    box-shadow: var(--shadow-sm);
  }
  .cz-mac-header-title {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .cz-mac-apple-icon {
    font-size: 1rem;
  }
  .cz-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .cz-sidebar-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text);
  }
  .cz-tier-tag {
    font-size: 0.68rem;
    text-transform: uppercase;
    font-weight: 700;
    font-family: var(--mono);
    padding: 0.15rem 0.45rem;
    border-radius: 9999px;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid var(--accent-glow);
  }
  .cz-mac-inspector-group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .cz-mac-prop-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .cz-mac-prop-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-2);
  }
  .cz-sf-icon {
    font-size: 0.85rem;
  }
  .cz-select-pill {
    border: 1px solid var(--border);
    background: var(--surface2);
    color: var(--text);
    border-radius: 100px;
    padding: 0.25rem 0.65rem;
    font-size: 0.76rem;
    outline: none;
  }
  .cz-mac-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0;
  }
  .cz-mac-toggle-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-2);
    cursor: pointer;
  }
  .cz-mac-switch {
    appearance: none;
    -webkit-appearance: none;
    width: 36px;
    height: 20px;
    background: var(--bg3);
    border-radius: 20px;
    position: relative;
    cursor: pointer;
    outline: none;
    border: 1px solid var(--border);
    transition: background 0.2s var(--ease), border-color 0.2s var(--ease);
  }
  .cz-mac-switch::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s var(--spring);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  .cz-mac-switch:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .cz-mac-switch:checked::before {
    transform: translateX(16px);
  }
  .cz-mac-prop-info {
    font-size: 0.8rem;
    color: var(--text-3);
    line-height: 1.4;
  }
  .cz-sidebar-meta {
    font-size: 0.78rem;
    color: var(--text-3);
    line-height: 1.5;
  }
  .cz-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.4rem 0.85rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--t), color var(--t);
  }
  .cz-btn-primary {
    background: var(--accent);
    color: #fff;
    border: 1px solid transparent;
  }
  .cz-btn-primary:hover:not(:disabled) {
    background: var(--accent-2);
  }
  .cz-btn-secondary {
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
  }
  .cz-btn-secondary:hover {
    background: var(--bg2);
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

  .cz-dual-engine-box {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .cz-engine-toggle {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.6rem 0.75rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
    text-align: left;
    transition: border-color var(--t), background var(--t), box-shadow var(--t);
  }
  .cz-engine-toggle:hover {
    border-color: var(--accent);
    background: var(--bg2);
  }
  .cz-engine-toggle.is-selected {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .cz-engine-head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .cz-engine-icon {
    font-size: 0.95rem;
  }
  .cz-engine-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
  }
  .cz-engine-chip {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    background: var(--accent);
    color: white;
    margin-left: auto;
  }
  .cz-engine-chip.is-heavy {
    background: #eab308;
    color: #1a1a1a;
  }
  .cz-engine-desc {
    font-size: 0.7rem;
    color: var(--text-3);
    line-height: 1.3;
  }
  .cz-engine-warning {
    font-size: 0.72rem;
    color: #eab308;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.25);
    padding: 0.5rem 0.65rem;
    border-radius: var(--r-sm);
    line-height: 1.4;
  }

  @media (max-width: 960px) {
    .cz-apple-workbench {
      grid-template-columns: 1fr;
      padding: 1.25rem 1rem 3.5rem;
    }
  }
</style>
