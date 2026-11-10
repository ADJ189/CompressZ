/**
 * fileRouter.ts — Fast, client-side format detection & universal action routing.
 *
 * Inspects binary magic numbers and MIME types to determine true file type
 * and exposes the full suite of possible actions for that document or media.
 * 100% offline, zero network requests, zero telemetry.
 */

export interface FileAction {
  id: string;
  name: string;
  icon: string;
  desc: string;
  route: string;
  hub: "pdf" | "convert" | "compress" | "ai";
}

export type DetectedCategory =
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "image"
  | "video"
  | "audio"
  | "svg"
  | "html"
  | "corrupt"
  | "unknown";

export interface DetectionResult {
  category: DetectedCategory;
  label: string;
  mime: string;
  actions: FileAction[];
}

/**
 * Inspect magic bytes from a header buffer to identify file signatures.
 */
export function identifyHeader(bytes: Uint8Array): DetectedCategory {
  if (!bytes || bytes.length < 4) return "unknown";

  // PDF: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "pdf";
  }

  // PNG: \x89PNG\r\n\x1a\n
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47
  ) {
    return "image";
  }

  // JPEG: \xFF\xD8\xFF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image";
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image";
  }

  // WebP or WAV: starts with RIFF
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes.length >= 12
  ) {
    // bytes 8..11: WEBP or WAVE
    const tag = String.fromCharCode(
      bytes[8],
      bytes[9],
      bytes[10],
      bytes[11],
    );
    if (tag === "WEBP") return "image";
    if (tag === "WAVE") return "audio";
  }

  // MP3: ID3 tag or 0xFF\xFB / 0xFF\xF3 sync frame
  if (
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    return "audio";
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio";
  }

  // FLAC: fLaC (0x66, 0x4C, 0x61, 0x43)
  if (
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  ) {
    return "audio";
  }

  // OggS (0x4F, 0x67, 0x67, 0x53)
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return "audio";
  }

  // MP4 / MOV / AVIF: ftyp box at offset 4..7
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    if (bytes.length >= 12) {
      const brand = String.fromCharCode(
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
      );
      if (brand.startsWith("avif") || brand.startsWith("avis")) return "image";
    }
    return "video";
  }

  // Matroska / WebM: EBML ID 0x1A 0x45 0xDF 0xA3
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video";
  }

  // ZIP-based packages: PK\x03\x04 (Office DOCX, PPTX, XLSX)
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    // Will be refined with extension/MIME in detectFileTypeAndActions
    return "docx";
  }

  return "unknown";
}

/**
 * Build actions palette for PDF documents.
 */
function getPdfActions(): FileAction[] {
  return [
    {
      id: "edit-sign",
      name: "Edit & Sign",
      icon: "✏️",
      desc: "Freehand ink, text callouts, stamps, and signatures",
      route: "pdf-suite/edit",
      hub: "pdf",
    },
    {
      id: "fill-forms",
      name: "Fill Forms",
      icon: "📝",
      desc: "Fill interactive AcroForm fields & optional flattening",
      route: "pdf-suite/forms",
      hub: "pdf",
    },
    {
      id: "compress-pdf",
      name: "Compress PDF",
      icon: "📉",
      desc: "Structural resampling & target size compression",
      route: "compress/pdf",
      hub: "compress",
    },
    {
      id: "pdf-to-word",
      name: "PDF to Word (.docx)",
      icon: "📄",
      desc: "Export to editable Word document with headings & tables",
      route: "convert?from=pdf&to=docx",
      hub: "convert",
    },
    {
      id: "pdf-to-excel",
      name: "PDF to Excel (.xlsx)",
      icon: "📊",
      desc: "Extract structured tables into Excel spreadsheet",
      route: "convert?from=pdf&to=xlsx",
      hub: "convert",
    },
    {
      id: "pdf-to-ppt",
      name: "PDF to PowerPoint",
      icon: "📑",
      desc: "Convert pages into PowerPoint presentation slides",
      route: "convert?from=pdf&to=pptx",
      hub: "convert",
    },
    {
      id: "pdf-to-images",
      name: "Extract Images",
      icon: "🖼️",
      desc: "Extract all pages as high-res PNG/JPEG ZIP",
      route: "convert?from=pdf&to=images",
      hub: "convert",
    },
    {
      id: "split-pdf",
      name: "Split PDF",
      icon: "✂️",
      desc: "Extract page ranges, chunk by N pages, or burst to ZIP",
      route: "pdf-suite/split",
      hub: "pdf",
    },
    {
      id: "organize-pdf",
      name: "Organize & Rotate",
      icon: "🗂️",
      desc: "Visual drag-and-drop grid, reorder, rotate & delete pages",
      route: "pdf-suite/organize",
      hub: "pdf",
    },
    {
      id: "watermark-pdf",
      name: "Add Watermark",
      icon: "🏷️",
      desc: "Add diagonal or repeating text & image watermark",
      route: "pdf-suite/watermark",
      hub: "pdf",
    },
    {
      id: "crop-pdf",
      name: "Crop PDF",
      icon: "📐",
      desc: "Trim margins and adjust visual CropBox boundary",
      route: "pdf-suite/crop",
      hub: "pdf",
    },
    {
      id: "redact-pdf",
      name: "Redact Content",
      icon: "⬛",
      desc: "Permanently purge sensitive text & image regions",
      route: "pdf-suite/redact",
      hub: "pdf",
    },
    {
      id: "protect-pdf",
      name: "Protect with Password",
      icon: "🛡️",
      desc: "AES-256 encryption with user and owner passwords",
      route: "pdf-suite/protect",
      hub: "pdf",
    },
    {
      id: "ocr-pdf",
      name: "PDF OCR",
      icon: "🔍",
      desc: "Make scanned PDF searchable with Tesseract or PaddleOCR",
      route: "compress/ocr",
      hub: "ai",
    },
    {
      id: "pdf-markdown",
      name: "PDF to Markdown",
      icon: "📝",
      desc: "Structured layout parser to Markdown and assets ZIP",
      route: "convert/pdf-markdown",
      hub: "ai",
    },
    {
      id: "repair-pdf",
      name: "Repair Corrupt PDF",
      icon: "🩹",
      desc: "Rebuild broken XREF tables and trailer dictionaries",
      route: "pdf-suite/repair",
      hub: "pdf",
    },
  ];
}

/**
 * Build actions palette for Microsoft Office documents.
 */
function getOfficeActions(ext: "docx" | "pptx" | "xlsx"): FileAction[] {
  if (ext === "docx") {
    return [
      {
        id: "docx-to-pdf",
        name: "Word to PDF",
        icon: "📄",
        desc: "Convert DOCX to high-fidelity PDF with styles & tables",
        route: "convert?from=docx&to=pdf",
        hub: "convert",
      },
      {
        id: "docx-to-txt",
        name: "Extract Text",
        icon: "📝",
        desc: "Extract raw document text without formatting",
        route: "convert?from=docx&to=txt",
        hub: "convert",
      },
    ];
  }

  if (ext === "pptx") {
    return [
      {
        id: "pptx-to-pdf",
        name: "PowerPoint to PDF",
        icon: "📊",
        desc: "Convert slides into multi-page landscape PDF",
        route: "convert?from=pptx&to=pdf",
        hub: "convert",
      },
      {
        id: "pptx-to-txt",
        name: "Extract Slide Text",
        icon: "📝",
        desc: "Extract text content from every slide in order",
        route: "convert?from=pptx&to=txt",
        hub: "convert",
      },
    ];
  }

  return [
    {
      id: "xlsx-to-pdf",
      name: "Excel to PDF",
      icon: "📈",
      desc: "Convert spreadsheet sheets into formatted PDF tables",
      route: "convert?from=xlsx&to=pdf",
      hub: "convert",
    },
    {
      id: "xlsx-to-csv",
      name: "Convert to CSV",
      icon: "📑",
      desc: "Export active sheet to comma-separated values",
      route: "convert?from=xlsx&to=csv",
      hub: "convert",
    },
  ];
}

/**
 * Build actions palette for Images.
 */
function getImageActions(): FileAction[] {
  return [
    {
      id: "compress-image",
      name: "Compress Image",
      icon: "🖼️",
      desc: "Reduce file size with SSIM quality guard",
      route: "compress/images",
      hub: "compress",
    },
    {
      id: "images-to-pdf",
      name: "Images to PDF",
      icon: "🧩",
      desc: "Compile one or more images into a multi-page PDF",
      route: "compress/images-to-pdf",
      hub: "compress",
    },
    {
      id: "convert-image",
      name: "Convert Format",
      icon: "🔁",
      desc: "Convert between WebP, AVIF, PNG, JPEG",
      route: "convert?cat=image",
      hub: "convert",
    },
    {
      id: "watermark-image",
      name: "Add Watermark",
      icon: "🏷️",
      desc: "Stamp logo or text watermark onto image",
      route: "pdf-suite/watermark?type=image",
      hub: "pdf",
    },
    {
      id: "ocr-image",
      name: "Extract Text (OCR)",
      icon: "🔍",
      desc: "Extract printed text or handwriting to searchable text",
      route: "compress/ocr",
      hub: "ai",
    },
  ];
}

/**
 * Build actions palette for Video and Audio.
 */
function getMediaActions(kind: "video" | "audio"): FileAction[] {
  if (kind === "video") {
    return [
      {
        id: "compress-video",
        name: "Compress Video",
        icon: "🎬",
        desc: "WebCodecs hardware acceleration and FFmpeg transcoding",
        route: "compress/video",
        hub: "compress",
      },
      {
        id: "convert-video",
        name: "Convert Video Format",
        icon: "🔁",
        desc: "Transcode to MP4, WebM, MOV, MKV with custom bitrate",
        route: "convert?cat=video",
        hub: "convert",
      },
      {
        id: "video-to-gif",
        name: "Convert to Animated GIF",
        icon: "🎞️",
        desc: "Two-pass palettegen Bayer dithering GIF conversion",
        route: "compress/gif",
        hub: "compress",
      },
      {
        id: "repair-video",
        name: "Repair Corrupt Video",
        icon: "🩹",
        desc: "Recover missing/truncated MOOV atom in MP4/MOV recordings",
        route: "pdf-suite/repair?type=video",
        hub: "pdf",
      },
    ];
  }

  return [
    {
      id: "compress-audio",
      name: "Compress Audio",
      icon: "🎵",
      desc: "Optimize bitrate, sample rate, and volume normalization",
      route: "compress/audio",
      hub: "compress",
    },
    {
      id: "convert-audio",
      name: "Convert Audio Format",
      icon: "🔁",
      desc: "Transcode between MP3, AAC, OGG, Opus, FLAC, and WAV",
      route: "convert?cat=audio",
      hub: "convert",
    },
  ];
}

/**
 * Universal detector: takes a File and optional pre-read header bytes,
 * returns identified category and all context-specific actions.
 */
export function detectFileTypeAndActions(
  file: File,
  headerBytes?: Uint8Array,
): DetectionResult {
  const name = file.name.toLowerCase();
  const ext = name.split(".").pop() ?? "";
  const headerCategory = headerBytes ? identifyHeader(headerBytes) : "unknown";

  // Check PDF
  if (
    headerCategory === "pdf" ||
    file.type === "application/pdf" ||
    ext === "pdf"
  ) {
    return {
      category: "pdf",
      label: "PDF Document",
      mime: "application/pdf",
      actions: getPdfActions(),
    };
  }

  // Check Office formats
  if (
    ext === "docx" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return {
      category: "docx",
      label: "Microsoft Word Document",
      mime:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      actions: getOfficeActions("docx"),
    };
  }

  if (
    ext === "pptx" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return {
      category: "pptx",
      label: "PowerPoint Presentation",
      mime:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      actions: getOfficeActions("pptx"),
    };
  }

  if (
    ext === "xlsx" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return {
      category: "xlsx",
      label: "Excel Spreadsheet",
      mime:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      actions: getOfficeActions("xlsx"),
    };
  }

  // Check Images
  if (
    headerCategory === "image" ||
    file.type.startsWith("image/") ||
    ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "bmp"].includes(
      ext,
    )
  ) {
    return {
      category: "image",
      label: "Image File",
      mime: file.type || "image/jpeg",
      actions: getImageActions(),
    };
  }

  // Check Videos
  if (
    headerCategory === "video" ||
    file.type.startsWith("video/") ||
    ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)
  ) {
    return {
      category: "video",
      label: "Video File",
      mime: file.type || "video/mp4",
      actions: getMediaActions("video"),
    };
  }

  // Check Audio
  if (
    headerCategory === "audio" ||
    file.type.startsWith("audio/") ||
    ["mp3", "m4a", "aac", "ogg", "opus", "flac", "wav"].includes(ext)
  ) {
    return {
      category: "audio",
      label: "Audio File",
      mime: file.type || "audio/mpeg",
      actions: getMediaActions("audio"),
    };
  }

  // Default unknown file: offer repair & general convert
  return {
    category: "unknown",
    label: "Generic File",
    mime: file.type || "application/octet-stream",
    actions: [
      {
        id: "repair-general",
        name: "Attempt File Repair",
        icon: "🩹",
        desc: "Scan for salvageable streams and reconstructed headers",
        route: "pdf-suite/repair",
        hub: "pdf",
      },
      {
        id: "convert-general",
        name: "Convert Format",
        icon: "🔁",
        desc: "Convert media or document container",
        route: "convert",
        hub: "convert",
      },
    ],
  };
}

/**
 * Read the first 64 bytes of a file asynchronously for magic byte analysis.
 */
export async function readFileHeaderBytes(file: File): Promise<Uint8Array> {
  const slice = file.slice(0, 64);
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}
