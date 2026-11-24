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

export interface ConversionTarget {
  id: string;
  name: string;
  format: string;
  desc?: string;
  badge?: string;
  route: string;
  hub: FileAction["hub"];
}

export interface ConversionGroup {
  category: string;
  targets: ConversionTarget[];
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
  conversionGroups?: ConversionGroup[];
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

  // MP3: ID3 or MPEG sync (exclude UTF-16LE BOM and enforce valid MPEG bits)
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio";
  }
  if (
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0 &&
    bytes[1] !== 0xfe &&
    bytes[1] !== 0xff &&
    (bytes[1] & 0x18) !== 0x08 &&
    (bytes[1] & 0x06) !== 0 &&
    (bytes.length < 3 || (bytes[2] & 0xf0) !== 0xf0)
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
  ["remove-pages", "Remove Pages", "🗑️", "Delete specific pages, ranges, or even/odd pages", "pdf/remove-pages", "pdf"],
  ["organize-pdf", "Organize & Rotate", "🗂️", "Visual drag-and-drop grid, reorder, rotate & delete pages", "pdf/organize", "pdf"],
  ["watermark-pdf", "Add Watermark", "🏷️", "Add diagonal or repeating text & image watermark", "pdf/watermark", "pdf"],
  ["crop-pdf", "Crop PDF", "📐", "Trim margins and adjust visual CropBox boundary", "pdf/crop", "pdf"],
  ["redact-pdf", "Redact Content", "⬛", "Permanently purge sensitive text & image regions", "pdf/redact", "pdf"],
  ["protect-pdf", "Protect with Password", "🛡️", "AES-256 encryption with user and owner passwords", "pdf/protect", "pdf"],
  ["ocr-pdf", "PDF OCR", "🔍", "Add a searchable text layer to scanned PDFs and images with Tesseract.js", "compress/ocr", "ai"],
  ["pdf-markdown", "PDF to Markdown", "📝", "Structured layout parser to Markdown and assets ZIP", "convert/pdf-markdown", "ai"],
  ["repair-pdf", "Repair Corrupt PDF", "🩹", "Rebuild broken XREF tables and trailer dictionaries", "pdf/repair", "pdf"],
];

const OFFICE_CONFIGS: Record<
  "docx" | "pptx" | "xlsx",
  {
    label: string;
    mime: string;
    actions: ActionTuple[];
    conversionGroups: ConversionGroup[];
  }
> = {
  docx: {
    label: "Microsoft Word Document",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    actions: [
      ["docx-to-pdf", "Word to PDF", "📄", "Convert DOCX to high-fidelity PDF with styles & tables", "convert?from=docx&to=pdf", "convert"],
      ["docx-to-txt", "Extract Text", "📝", "Extract raw document text without formatting", "convert?from=docx&to=txt", "convert"],
    ],
    conversionGroups: [
      {
        category: "Convert Document",
        targets: [
          { id: "docx-to-pdf", name: "PDF Document", format: "PDF", route: "convert?from=docx&to=pdf", hub: "convert", badge: "Recommended" },
          { id: "docx-to-txt", name: "Plain Text", format: "TXT", route: "convert?from=docx&to=txt", hub: "convert" },
        ],
      },
    ],
  },
  pptx: {
    label: "PowerPoint Presentation",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    actions: [
      ["pptx-to-pdf", "PowerPoint to PDF", "📊", "Convert slides into multi-page landscape PDF", "convert?from=pptx&to=pdf", "convert"],
      ["pptx-to-txt", "Extract Slide Text", "📝", "Extract text content from every slide in order", "convert?from=pptx&to=txt", "convert"],
    ],
    conversionGroups: [
      {
        category: "Convert Presentation",
        targets: [
          { id: "pptx-to-pdf", name: "PDF Slides", format: "PDF", route: "convert?from=pptx&to=pdf", hub: "convert", badge: "Recommended" },
          { id: "pptx-to-txt", name: "Slide Text", format: "TXT", route: "convert?from=pptx&to=txt", hub: "convert" },
        ],
      },
    ],
  },
  xlsx: {
    label: "Excel Spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    actions: [
      ["xlsx-to-pdf", "Excel to PDF", "📈", "Convert spreadsheet sheets into formatted PDF tables", "convert?from=xlsx&to=pdf", "convert"],
      ["xlsx-to-csv", "Convert to CSV", "📑", "Export active sheet to comma-separated values", "convert?from=xlsx&to=csv", "convert"],
    ],
    conversionGroups: [
      {
        category: "Convert Spreadsheet",
        targets: [
          { id: "xlsx-to-pdf", name: "PDF Document", format: "PDF", route: "convert?from=xlsx&to=pdf", hub: "convert" },
          { id: "xlsx-to-csv", name: "Comma-Separated Values", format: "CSV", route: "convert?from=xlsx&to=csv", hub: "convert", badge: "Standard" },
        ],
      },
    ],
  },
};

const IMAGE_ACTIONS: ActionTuple[] = [
  ["compress-image", "Compress Image", "🖼️", "Reduce file size with SSIM quality guard", "compress/images", "compress"],
  ["images-to-pdf", "Images to PDF", "🧩", "Compile one or more images into a multi-page PDF", "compress/images-to-pdf", "compress"],
  ["convert-image", "Convert Format", "🔁", "Convert between WebP, AVIF, PNG, JPEG", "convert?cat=image", "convert"],
  ["ocr-image", "Extract Text (OCR)", "🔍", "Extract printed text or handwriting to searchable text", "compress/ocr", "ai"],
];

const VIDEO_ACTIONS: ActionTuple[] = [
  ["compress-video", "Compress Video", "🎬", "WebCodecs hardware acceleration and FFmpeg transcoding", "compress/video", "compress"],
  ["convert-video", "Convert Video Format", "🔁", "Transcode to MP4, WebM, MOV, MKV with custom bitrate", "convert?cat=video", "convert"],
  ["video-to-gif", "Convert to Animated GIF", "🎞️", "Two-pass palettegen Bayer dithering GIF conversion", "compress/gif", "compress"],
];

const AUDIO_ACTIONS: ActionTuple[] = [
  ["compress-audio", "Compress Audio", "🎵", "Optimize bitrate, sample rate, and volume normalization", "compress/audio", "compress"],
  ["convert-audio", "Convert Audio Format", "🔁", "Transcode between MP3, AAC, OGG, Opus, FLAC, and WAV", "convert?cat=audio", "convert"],
];

const GENERIC_ACTIONS: ActionTuple[] = [
  ["repair-general", "Attempt File Repair", "🩹", "Scan for salvageable streams and reconstructed headers", "pdf/repair", "pdf"],
  ["convert-general", "Convert Format", "🔁", "Convert media or document container", "convert", "convert"],
];

const PDF_CONVERSION_GROUPS: ConversionGroup[] = [
  {
    category: "Convert to Document & Office",
    targets: [
      { id: "pdf-to-word", name: "Word Document", format: "DOCX", route: "convert?from=pdf&to=docx", hub: "convert", badge: "Editable" },
      { id: "pdf-to-excel", name: "Excel Spreadsheet", format: "XLSX", route: "convert?from=pdf&to=xlsx", hub: "convert", badge: "Tables" },
      { id: "pdf-to-ppt", name: "PowerPoint Slides", format: "PPTX", route: "convert?from=pdf&to=pptx", hub: "convert" },
      { id: "pdf-markdown", name: "Structured Markdown", format: "MD", route: "convert/pdf-markdown", hub: "ai", badge: "Tables & Math" },
    ],
  },
  {
    category: "Convert to Images",
    targets: [
      { id: "pdf-to-images-png", name: "Lossless PNG Pages", format: "PNG", route: "convert?cat=pdf2img&to=png", hub: "convert" },
      { id: "pdf-to-images-jpeg", name: "Compact JPEG Pages", format: "JPEG", route: "convert?cat=pdf2img&to=jpeg", hub: "convert" },
    ],
  },
  {
    category: "Essential PDF Workstation",
    targets: [
      { id: "compress-pdf", name: "Compress PDF", format: "PDF", route: "compress/pdf", hub: "compress", badge: "Structural" },
      { id: "edit-sign", name: "Edit & Sign", format: "PDF", route: "pdf/edit", hub: "pdf" },
      { id: "ocr-pdf", name: "Searchable OCR", format: "PDF", route: "compress/ocr", hub: "ai", badge: "Tesseract 5" },
      { id: "split-pdf", name: "Split Pages", format: "PDF", route: "pdf/split", hub: "pdf" },
      { id: "remove-pages", name: "Remove Pages", format: "PDF", route: "pdf/remove-pages", hub: "pdf" },
      { id: "organize-pdf", name: "Organize & Rotate", format: "PDF", route: "pdf/organize", hub: "pdf" },
      { id: "fill-forms", name: "Fill Forms", format: "PDF", route: "pdf/forms", hub: "pdf" },
      { id: "protect-pdf", name: "Protect (AES-256)", format: "PDF", route: "pdf/protect", hub: "pdf" },
      { id: "repair-pdf", name: "Repair Corrupt PDF", format: "PDF", route: "pdf/repair", hub: "pdf" },
    ],
  },
];

const VIDEO_CONVERSION_GROUPS: ConversionGroup[] = [
  {
    category: "Convert Video Format",
    targets: [
      { id: "video-to-mp4", name: "MP4 Video", format: "MP4", route: "convert?cat=video&to=mp4", hub: "convert", badge: "WebCodecs" },
      { id: "video-to-webm", name: "WebM Video", format: "WebM", route: "convert?cat=video&to=webm", hub: "convert" },
      { id: "video-to-mkv", name: "Matroska Video", format: "MKV", route: "convert?cat=video&to=mkv", hub: "convert" },
    ],
  },
  {
    category: "Animation & Audio Extraction",
    targets: [
      { id: "video-to-gif", name: "Animated GIF", format: "GIF", route: "compress/gif", hub: "compress", badge: "Two-Pass" },
      { id: "video-to-mp3", name: "Extract MP3", format: "MP3", route: "convert?cat=audio&to=mp3", hub: "convert" },
      { id: "video-to-aac", name: "Extract AAC", format: "AAC", route: "convert?cat=audio&to=aac", hub: "convert" },
      { id: "video-to-opus", name: "Extract Opus", format: "Opus", route: "convert?cat=audio&to=opus", hub: "convert" },
      { id: "video-to-wav", name: "Extract WAV", format: "WAV", route: "convert?cat=audio&to=wav", hub: "convert" },
    ],
  },
  {
    category: "Video Utilities",
    targets: [
      { id: "compress-video", name: "Compress Video", format: "Video", route: "compress/video", hub: "compress", badge: "Hardware Accel" },
    ],
  },
];

const AUDIO_CONVERSION_GROUPS: ConversionGroup[] = [
  {
    category: "Convert Audio Format",
    targets: [
      { id: "audio-to-mp3", name: "MP3 Audio", format: "MP3", route: "convert?cat=audio&to=mp3", hub: "convert", badge: "Universal" },
      { id: "audio-to-aac", name: "AAC Audio", format: "AAC", route: "convert?cat=audio&to=aac", hub: "convert" },
      { id: "audio-to-opus", name: "Opus Voice/Music", format: "Opus", route: "convert?cat=audio&to=opus", hub: "convert", badge: "High Efficiency" },
      { id: "audio-to-flac", name: "FLAC Audio", format: "FLAC", route: "convert?cat=audio&to=flac", hub: "convert", badge: "Lossless" },
      { id: "audio-to-wav", name: "WAV Audio", format: "WAV", route: "convert?cat=audio&to=wav", hub: "convert" },
      { id: "audio-to-ogg", name: "Ogg Vorbis", format: "OGG", route: "convert?cat=audio&to=ogg", hub: "convert" },
    ],
  },
  {
    category: "Audio Processing",
    targets: [
      { id: "compress-audio", name: "Compress Audio", format: "Audio", route: "compress/audio", hub: "compress", badge: "Bitrate & Normalization" },
    ],
  },
];

const IMAGE_CONVERSION_GROUPS: ConversionGroup[] = [
  {
    category: "Convert Image Format",
    targets: [
      { id: "image-to-webp", name: "WebP Image", format: "WebP", route: "convert?cat=image&to=webp", hub: "convert", badge: "Recommended" },
      { id: "image-to-avif", name: "AVIF Image", format: "AVIF", route: "convert?cat=image&to=avif", hub: "convert", badge: "Next-Gen" },
      { id: "image-to-png", name: "PNG Image", format: "PNG", route: "convert?cat=image&to=png", hub: "convert", badge: "Lossless" },
      { id: "image-to-jpeg", name: "JPEG Image", format: "JPEG", route: "convert?cat=image&to=jpeg", hub: "convert" },
    ],
  },
  {
    category: "Document & Text Utilities",
    targets: [
      { id: "images-to-pdf", name: "Compile to PDF", format: "PDF", route: "compress/images-to-pdf", hub: "compress", badge: "Multi-Page" },
      { id: "ocr-image", name: "Extract Text (OCR)", format: "TXT", route: "compress/ocr", hub: "ai", badge: "Neural OCR" },
      { id: "compress-image", name: "Compress Image", format: "Image", route: "compress/images", hub: "compress", badge: "SSIM Guard" },
    ],
  },
];

const HTML_CONVERSION_GROUPS: ConversionGroup[] = [
  {
    category: "Convert Web Document",
    targets: [
      { id: "convert-html-pdf", name: "PDF Document", format: "PDF", route: "convert?cat=html&to=pdf", hub: "convert", badge: "Vector Print" },
    ],
  },
];

const GENERIC_CONVERSION_GROUPS: ConversionGroup[] = [
  {
    category: "General Utilities",
    targets: [
      { id: "convert-general", name: "Convert Format", format: "Convert", route: "convert", hub: "convert" },
      { id: "repair-general", name: "Attempt File Repair", format: "Repair", route: "pdf/repair", hub: "pdf" },
    ],
  },
];

interface MediaConfig {
  category: "image" | "video" | "audio";
  label: string;
  defaultMime: string;
  extensions: string[];
  actions: ActionTuple[];
  conversionGroups: ConversionGroup[];
}

const MEDIA_CONFIGS: MediaConfig[] = [
  {
    category: "image",
    label: "Image File",
    defaultMime: "image/jpeg",
    extensions: ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "bmp"],
    actions: IMAGE_ACTIONS,
    conversionGroups: IMAGE_CONVERSION_GROUPS,
  },
  {
    category: "video",
    label: "Video File",
    defaultMime: "video/mp4",
    extensions: ["mp4", "webm", "mov", "mkv", "avi"],
    actions: VIDEO_ACTIONS,
    conversionGroups: VIDEO_CONVERSION_GROUPS,
  },
  {
    category: "audio",
    label: "Audio File",
    defaultMime: "audio/mpeg",
    extensions: ["mp3", "m4a", "aac", "ogg", "opus", "flac", "wav"],
    actions: AUDIO_ACTIONS,
    conversionGroups: AUDIO_CONVERSION_GROUPS,
  },
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
  const ext = name.split(".").pop() ?? "";
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
      conversionGroups: PDF_CONVERSION_GROUPS,
    };
  }

  // Check HTML
  if (
    ext === "html" ||
    ext === "htm" ||
    file.type === "text/html" ||
    name.endsWith(".html") ||
    name.endsWith(".htm")
  ) {
    return {
      category: "html",
      label: "HTML Document",
      mime: "text/html",
      actions: buildActions([
        ["convert-html-pdf", "Convert HTML to PDF", "📄", "Render responsive HTML document to vector PDF", "convert?cat=html", "convert"],
      ]),
      conversionGroups: HTML_CONVERSION_GROUPS,
    };
  }

  // Check Office formats
  if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
    const cfg = OFFICE_CONFIGS[ext];
    return {
      category: ext,
      label: cfg.label,
      mime: cfg.mime,
      actions: buildActions(cfg.actions),
      conversionGroups: cfg.conversionGroups,
    };
  }

  // Check Media formats (image, video, audio)
  for (const cfg of MEDIA_CONFIGS) {
    if (
      headerCategory === cfg.category ||
      file.type.startsWith(`${cfg.category}/`) ||
      cfg.extensions.includes(ext)
    ) {
      return {
        category: cfg.category,
        label: cfg.label,
        mime: file.type || cfg.defaultMime,
        actions: buildActions(cfg.actions),
        conversionGroups: cfg.conversionGroups,
      };
    }
  }

  // Default unknown file: offer repair & general convert
  return {
    category: "unknown",
    label: "Generic File",
    mime: file.type || "application/octet-stream",
    actions: buildActions(GENERIC_ACTIONS),
    conversionGroups: GENERIC_CONVERSION_GROUPS,
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
