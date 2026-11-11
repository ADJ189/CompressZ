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

type ActionTuple = [
  id: string,
  name: string,
  icon: string,
  desc: string,
  route: string,
  hub: FileAction["hub"],
];

function buildActions(defs: ActionTuple[]): FileAction[] {
  return defs.map(([id, name, icon, desc, route, hub]) => ({
    id,
    name,
    icon,
    desc,
    route,
    hub,
  }));
}

/**
 * Inspect magic bytes from a header buffer to identify file signatures.
 */
export function identifyHeader(bytes: Uint8Array): DetectedCategory {
  if (!bytes || bytes.length < 4) return "unknown";

  // PDF: %PDF- (0x25, 0x50, 0x44, 0x46)
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
    bytes[2] === 0x4e &&
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
    const tag = String.fromCharCode(
      bytes[8],
      bytes[9],
      bytes[10],
      bytes[11],
    );
    if (tag === "WEBP") return "image";
    if (tag === "WAVE") return "audio";
  }

  // MP3: ID3 or MPEG sync
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return "audio";
  }

  // FLAC: fLaC
  if (
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  ) {
    return "audio";
  }

  // OggS
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
    return "docx";
  }

  return "unknown";
}

const PDF_ACTION_DEFS: ActionTuple[] = [
  ["edit-sign", "Edit & Sign", "✏️", "Freehand ink, text callouts, stamps, and signatures", "pdf/edit", "pdf"],
  ["fill-forms", "Fill Forms", "📝", "Fill interactive AcroForm fields & optional flattening", "pdf/forms", "pdf"],
  ["compress-pdf", "Compress PDF", "📉", "Structural resampling & target size compression", "compress/pdf", "compress"],
  ["pdf-to-word", "PDF to Word (.docx)", "📄", "Export to editable Word document with headings & tables", "convert?from=pdf&to=docx", "convert"],
  ["pdf-to-excel", "PDF to Excel (.xlsx)", "📊", "Extract structured tables into Excel spreadsheet", "convert?from=pdf&to=xlsx", "convert"],
  ["pdf-to-ppt", "PDF to PowerPoint", "📑", "Convert pages into PowerPoint presentation slides", "convert?from=pdf&to=pptx", "convert"],
  ["pdf-to-images", "Extract Images", "🖼️", "Extract all pages as high-res PNG/JPEG ZIP", "convert?from=pdf&to=images", "convert"],
  ["split-pdf", "Split PDF", "✂️", "Extract page ranges, chunk by N pages, or burst to ZIP", "pdf/split", "pdf"],
  ["organize-pdf", "Organize & Rotate", "🗂️", "Visual drag-and-drop grid, reorder, rotate & delete pages", "pdf/organize", "pdf"],
  ["watermark-pdf", "Add Watermark", "🏷️", "Add diagonal or repeating text & image watermark", "pdf/watermark", "pdf"],
  ["crop-pdf", "Crop PDF", "📐", "Trim margins and adjust visual CropBox boundary", "pdf/crop", "pdf"],
  ["redact-pdf", "Redact Content", "⬛", "Permanently purge sensitive text & image regions", "pdf/redact", "pdf"],
  ["protect-pdf", "Protect with Password", "🛡️", "AES-256 encryption with user and owner passwords", "pdf/protect", "pdf"],
  ["ocr-pdf", "PDF OCR", "🔍", "Make scanned PDF searchable with Tesseract or PaddleOCR", "compress/ocr", "ai"],
  ["pdf-markdown", "PDF to Markdown", "📝", "Structured layout parser to Markdown and assets ZIP", "convert/pdf-markdown", "ai"],
  ["repair-pdf", "Repair Corrupt PDF", "🩹", "Rebuild broken XREF tables and trailer dictionaries", "pdf/repair", "pdf"],
];

const OFFICE_CONFIGS: Record<
  "docx" | "pptx" | "xlsx",
  { label: string; mime: string; actions: ActionTuple[] }
> = {
  docx: {
    label: "Microsoft Word Document",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    actions: [
      ["docx-to-pdf", "Word to PDF", "📄", "Convert DOCX to high-fidelity PDF with styles & tables", "convert?from=docx&to=pdf", "convert"],
      ["docx-to-txt", "Extract Text", "📝", "Extract raw document text without formatting", "convert?from=docx&to=txt", "convert"],
    ],
  },
  pptx: {
    label: "PowerPoint Presentation",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    actions: [
      ["pptx-to-pdf", "PowerPoint to PDF", "📊", "Convert slides into multi-page landscape PDF", "convert?from=pptx&to=pdf", "convert"],
      ["pptx-to-txt", "Extract Slide Text", "📝", "Extract text content from every slide in order", "convert?from=pptx&to=txt", "convert"],
    ],
  },
  xlsx: {
    label: "Excel Spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    actions: [
      ["xlsx-to-pdf", "Excel to PDF", "📈", "Convert spreadsheet sheets into formatted PDF tables", "convert?from=xlsx&to=pdf", "convert"],
      ["xlsx-to-csv", "Convert to CSV", "📑", "Export active sheet to comma-separated values", "convert?from=xlsx&to=csv", "convert"],
    ],
  },
};

const IMAGE_ACTIONS: ActionTuple[] = [
  ["compress-image", "Compress Image", "🖼️", "Reduce file size with SSIM quality guard", "compress/images", "compress"],
  ["images-to-pdf", "Images to PDF", "🧩", "Compile one or more images into a multi-page PDF", "compress/images-to-pdf", "compress"],
  ["convert-image", "Convert Format", "🔁", "Convert between WebP, AVIF, PNG, JPEG", "convert?cat=image", "convert"],
  ["watermark-image", "Add Watermark", "🏷️", "Stamp logo or text watermark onto image", "pdf/watermark?type=image", "pdf"],
  ["ocr-image", "Extract Text (OCR)", "🔍", "Extract printed text or handwriting to searchable text", "compress/ocr", "ai"],
];

const VIDEO_ACTIONS: ActionTuple[] = [
  ["compress-video", "Compress Video", "🎬", "WebCodecs hardware acceleration and FFmpeg transcoding", "compress/video", "compress"],
  ["convert-video", "Convert Video Format", "🔁", "Transcode to MP4, WebM, MOV, MKV with custom bitrate", "convert?cat=video", "convert"],
  ["video-to-gif", "Convert to Animated GIF", "🎞️", "Two-pass palettegen Bayer dithering GIF conversion", "compress/gif", "compress"],
  ["repair-video", "Repair Corrupt Video", "🩹", "Recover missing/truncated MOOV atom in MP4/MOV recordings", "pdf/repair?type=video", "pdf"],
];

const AUDIO_ACTIONS: ActionTuple[] = [
  ["compress-audio", "Compress Audio", "🎵", "Optimize bitrate, sample rate, and volume normalization", "compress/audio", "compress"],
  ["convert-audio", "Convert Audio Format", "🔁", "Transcode between MP3, AAC, OGG, Opus, FLAC, and WAV", "convert?cat=audio", "convert"],
];

const GENERIC_ACTIONS: ActionTuple[] = [
  ["repair-general", "Attempt File Repair", "🩹", "Scan for salvageable streams and reconstructed headers", "pdf/repair", "pdf"],
  ["convert-general", "Convert Format", "🔁", "Convert media or document container", "convert", "convert"],
];

/**
 * Universal detector: takes a File and optional pre-read header bytes,
 * returns identified category and all context-specific actions.
 */
export function detectFileTypeAndActions(
  file: File,
  headerBytes?: Uint8Array,
): DetectionResult {
  const name = file.name.toLowerCase();
  const ext = (name.split(".").pop() ?? "") as "docx" | "pptx" | "xlsx";
  const headerCategory = headerBytes ? identifyHeader(headerBytes) : "unknown";

  // Check PDF
  if (
    headerCategory === "pdf" ||
    file.type === "application/pdf" ||
    name.endsWith(".pdf")
  ) {
    return {
      category: "pdf",
      label: "PDF Document",
      mime: "application/pdf",
      actions: buildActions(PDF_ACTION_DEFS),
    };
  }

  // Check Office formats
  if (ext in OFFICE_CONFIGS) {
    const cfg = OFFICE_CONFIGS[ext];
    return {
      category: ext,
      label: cfg.label,
      mime: cfg.mime,
      actions: buildActions(cfg.actions),
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
      actions: buildActions(IMAGE_ACTIONS),
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
      actions: buildActions(VIDEO_ACTIONS),
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
      actions: buildActions(AUDIO_ACTIONS),
    };
  }

  // Default unknown file: offer repair & general convert
  return {
    category: "unknown",
    label: "Generic File",
    mime: file.type || "application/octet-stream",
    actions: buildActions(GENERIC_ACTIONS),
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
