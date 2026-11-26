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

type TargetTuple = [
  id: string,
  name: string,
  format: string,
  route: string,
  hub: FileAction["hub"],
  badge?: string,
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

function buildGroup(category: string, targets: TargetTuple[]): ConversionGroup {
  return {
    category,
    targets: targets.map(([id, name, format, route, hub, badge]) =>
      badge !== undefined ? { id, name, format, route, hub, badge } : { id, name, format, route, hub }
    ),
  };
}

function matchesMagic(bytes: Uint8Array, offset: number, sig: number[]): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

const MAGIC_PREFIX_SIGNATURES: [sig: number[], category: DetectedCategory][] = [
  [[0x25, 0x50, 0x44, 0x46], "pdf"], // %PDF-
  [[0x89, 0x50, 0x4e, 0x47], "image"], // PNG
  [[0xff, 0xd8, 0xff], "image"], // JPEG
  [[0x47, 0x49, 0x46, 0x38], "image"], // GIF87a / GIF89a
  [[0x49, 0x44, 0x33], "audio"], // MP3 ID3
  [[0x66, 0x4c, 0x61, 0x43], "audio"], // FLAC
  [[0x4f, 0x67, 0x67, 0x53], "audio"], // OggS
  [[0x1a, 0x45, 0xdf, 0xa3], "video"], // Matroska / WebM EBML
  [[0x50, 0x4b, 0x03, 0x04], "docx"], // ZIP-based Office container
];

/**
 * Inspect magic bytes from a header buffer to identify file signatures.
 */
export function identifyHeader(bytes: Uint8Array): DetectedCategory {
  if (!bytes || bytes.length < 4) return "unknown";

  for (const [sig, category] of MAGIC_PREFIX_SIGNATURES) {
    if (matchesMagic(bytes, 0, sig)) return category;
  }

  // WebP or WAV: RIFF + sub-brand at bytes 8..11
  if (matchesMagic(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12) {
    const tag = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (tag === "WEBP") return "image";
    if (tag === "WAVE") return "audio";
  }

  // MP3 MPEG sync (exclude UTF-16LE BOM and enforce valid MPEG bits)
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

  // MP4 / MOV / AVIF: ftyp box at offset 4..7
  if (matchesMagic(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    if (bytes.length >= 12) {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (brand.startsWith("avif") || brand.startsWith("avis")) return "image";
    }
    return "video";
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
  ["page-numbers", "Page Numbers & Bates", "🔢", "Add page numbers, header/footers, or Bates stamping", "pdf/page-numbers", "pdf"],
  ["nup-pdf", "Multi-Page (N-Up)", "📑", "Combine 2, 4, or 9 pages per sheet for printing", "pdf/nup", "pdf"],
  ["metadata-pdf", "Edit & Strip Metadata", "🏷️", "Inspect, update, or erase PDF metadata & dates for privacy", "pdf/metadata", "pdf"],
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
      buildGroup("Convert Document", [
        ["docx-to-pdf", "PDF Document", "PDF", "convert?from=docx&to=pdf", "convert", "Recommended"],
        ["docx-to-txt", "Plain Text", "TXT", "convert?from=docx&to=txt", "convert"],
      ]),
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
      buildGroup("Convert Presentation", [
        ["pptx-to-pdf", "PDF Slides", "PDF", "convert?from=pptx&to=pdf", "convert", "Recommended"],
        ["pptx-to-txt", "Slide Text", "TXT", "convert?from=pptx&to=txt", "convert"],
      ]),
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
      buildGroup("Convert Spreadsheet", [
        ["xlsx-to-pdf", "PDF Document", "PDF", "convert?from=xlsx&to=pdf", "convert"],
        ["xlsx-to-csv", "Comma-Separated Values", "CSV", "convert?from=xlsx&to=csv", "convert", "Standard"],
      ]),
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
  ["compress-video", "Compress Video", "🎬", "WebCodecs + Mediabunny fast path and FFmpeg transcoding", "compress/video", "compress"],
  ["convert-video", "Convert Video Format", "🔁", "Transcode to MP4, WebM, MOV, MKV with custom bitrate", "convert?cat=video", "convert"],
  ["video-to-gif", "Convert to Animated GIF", "🎞️", "Two-pass palettegen Bayer dithering GIF conversion", "compress/gif", "compress"],
];

const AUDIO_ACTIONS: ActionTuple[] = [
  ["compress-audio", "Compress Audio", "🎵", "Optimize bitrate, sample rate, and volume normalization", "compress/audio", "compress"],
  ["convert-audio", "Convert Audio Format", "🔁", "Transcode between MP3, AAC, OGG, Opus, FLAC, and WAV", "convert?cat=audio", "convert"],
];

const HTML_ACTIONS: ActionTuple[] = [
  ["convert-html-pdf", "Convert HTML to PDF", "📄", "Render HTML document to PDF pages", "convert?cat=html", "convert"],
];

const GENERIC_ACTIONS: ActionTuple[] = [
  ["repair-general", "Attempt File Repair", "🩹", "Scan for salvageable streams and reconstructed headers", "pdf/repair", "pdf"],
  ["convert-general", "Convert Format", "🔁", "Convert media or document container", "convert", "convert"],
];

const PDF_CONVERSION_GROUPS: ConversionGroup[] = [
  buildGroup("Convert to Document & Office", [
    ["pdf-to-word", "Word Document", "DOCX", "convert?from=pdf&to=docx", "convert", "Editable"],
    ["pdf-to-excel", "Excel Spreadsheet", "XLSX", "convert?from=pdf&to=xlsx", "convert", "Tables"],
    ["pdf-to-ppt", "PowerPoint Slides", "PPTX", "convert?from=pdf&to=pptx", "convert"],
    ["pdf-markdown", "Structured Markdown", "MD", "convert/pdf-markdown", "ai", "Tables & Math"],
  ]),
  buildGroup("Convert to Images", [
    ["pdf-to-images-png", "Lossless PNG Pages", "PNG", "convert?cat=pdf2img&to=png", "convert"],
    ["pdf-to-images-jpeg", "Compact JPEG Pages", "JPEG", "convert?cat=pdf2img&to=jpeg", "convert"],
  ]),
  buildGroup("Essential PDF Workstation", [
    ["compress-pdf", "Compress PDF", "PDF", "compress/pdf", "compress", "Structural"],
    ["edit-sign", "Edit & Sign", "PDF", "pdf/edit", "pdf"],
    ["ocr-pdf", "Searchable OCR", "PDF", "compress/ocr", "ai", "Tesseract 5"],
    ["split-pdf", "Split Pages", "PDF", "pdf/split", "pdf"],
    ["remove-pages", "Remove Pages", "PDF", "pdf/remove-pages", "pdf"],
    ["page-numbers", "Page Numbers", "PDF", "pdf/page-numbers", "pdf"],
    ["nup-pdf", "Multi-Page (N-Up)", "PDF", "pdf/nup", "pdf"],
    ["metadata-pdf", "PDF Metadata", "PDF", "pdf/metadata", "pdf"],
    ["organize-pdf", "Organize & Rotate", "PDF", "pdf/organize", "pdf"],
    ["fill-forms", "Fill Forms", "PDF", "pdf/forms", "pdf"],
    ["protect-pdf", "Protect (AES-256)", "PDF", "pdf/protect", "pdf"],
    ["repair-pdf", "Repair Corrupt PDF", "PDF", "pdf/repair", "pdf"],
  ]),
];

const VIDEO_CONVERSION_GROUPS: ConversionGroup[] = [
  buildGroup("Convert Video Format", [
    ["video-to-mp4", "MP4 Video", "MP4", "convert?cat=video&to=mp4", "convert", "WebCodecs"],
    ["video-to-webm", "WebM Video", "WebM", "convert?cat=video&to=webm", "convert"],
    ["video-to-mkv", "Matroska Video", "MKV", "convert?cat=video&to=mkv", "convert"],
  ]),
  buildGroup("Animation & Audio Extraction", [
    ["video-to-gif", "Animated GIF", "GIF", "compress/gif", "compress", "Two-Pass"],
    ["video-to-mp3", "Extract MP3", "MP3", "convert?cat=audio&to=mp3", "convert"],
    ["video-to-aac", "Extract AAC", "AAC", "convert?cat=audio&to=aac", "convert"],
    ["video-to-opus", "Extract Opus", "Opus", "convert?cat=audio&to=opus", "convert"],
    ["video-to-wav", "Extract WAV", "WAV", "convert?cat=audio&to=wav", "convert"],
  ]),
  buildGroup("Video Utilities", [
    ["compress-video", "Compress Video", "Video", "compress/video", "compress", "Fast Path"],
  ]),
];

const AUDIO_CONVERSION_GROUPS: ConversionGroup[] = [
  buildGroup("Convert Audio Format", [
    ["audio-to-mp3", "MP3 Audio", "MP3", "convert?cat=audio&to=mp3", "convert", "Universal"],
    ["audio-to-aac", "AAC Audio", "AAC", "convert?cat=audio&to=aac", "convert"],
    ["audio-to-opus", "Opus Voice/Music", "Opus", "convert?cat=audio&to=opus", "convert", "High Efficiency"],
    ["audio-to-flac", "FLAC Audio", "FLAC", "convert?cat=audio&to=flac", "convert", "Lossless"],
    ["audio-to-wav", "WAV Audio", "WAV", "convert?cat=audio&to=wav", "convert"],
    ["audio-to-ogg", "Ogg Vorbis", "OGG", "convert?cat=audio&to=ogg", "convert"],
  ]),
  buildGroup("Audio Processing", [
    ["compress-audio", "Compress Audio", "Audio", "compress/audio", "compress", "Bitrate & Normalization"],
  ]),
];

const IMAGE_CONVERSION_GROUPS: ConversionGroup[] = [
  buildGroup("Convert Image Format", [
    ["image-to-webp", "WebP Image", "WebP", "convert?cat=image&to=webp", "convert", "Recommended"],
    ["image-to-avif", "AVIF Image", "AVIF", "convert?cat=image&to=avif", "convert", "Next-Gen"],
    ["image-to-png", "PNG Image", "PNG", "convert?cat=image&to=png", "convert", "Lossless"],
    ["image-to-jpeg", "JPEG Image", "JPEG", "convert?cat=image&to=jpeg", "convert"],
  ]),
  buildGroup("Document & Text Utilities", [
    ["images-to-pdf", "Compile to PDF", "PDF", "compress/images-to-pdf", "compress", "Multi-Page"],
    ["ocr-image", "Extract Text (OCR)", "TXT", "compress/ocr", "ai", "Neural OCR"],
    ["compress-image", "Compress Image", "Image", "compress/images", "compress", "SSIM Guard"],
  ]),
];

const HTML_CONVERSION_GROUPS: ConversionGroup[] = [
  buildGroup("Convert Web Document", [
    ["convert-html-pdf", "PDF Document", "PDF", "convert?cat=html&to=pdf", "convert", "PDF Export"],
  ]),
];

const GENERIC_CONVERSION_GROUPS: ConversionGroup[] = [
  buildGroup("General Utilities", [
    ["convert-general", "Convert Format", "Convert", "convert", "convert"],
    ["repair-general", "Attempt File Repair", "Repair", "pdf/repair", "pdf"],
  ]),
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

function buildDetection(
  category: DetectedCategory,
  label: string,
  mime: string,
  actionDefs: ActionTuple[],
  conversionGroups: ConversionGroup[],
): DetectionResult {
  return {
    category,
    label,
    mime,
    actions: buildActions(actionDefs),
    conversionGroups,
  };
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

  if (headerCategory === "pdf" || file.type === "application/pdf" || name.endsWith(".pdf")) {
    return buildDetection("pdf", "PDF Document", "application/pdf", PDF_ACTION_DEFS, PDF_CONVERSION_GROUPS);
  }

  if (ext === "html" || ext === "htm" || file.type === "text/html" || name.endsWith(".html") || name.endsWith(".htm")) {
    return buildDetection("html", "HTML Document", "text/html", HTML_ACTIONS, HTML_CONVERSION_GROUPS);
  }

  if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
    const cfg = OFFICE_CONFIGS[ext];
    return buildDetection(ext, cfg.label, cfg.mime, cfg.actions, cfg.conversionGroups);
  }

  for (const cfg of MEDIA_CONFIGS) {
    if (
      headerCategory === cfg.category ||
      file.type.startsWith(`${cfg.category}/`) ||
      cfg.extensions.includes(ext)
    ) {
      return buildDetection(
        cfg.category,
        cfg.label,
        file.type || cfg.defaultMime,
        cfg.actions,
        cfg.conversionGroups,
      );
    }
  }

  return buildDetection(
    "unknown",
    "Generic File",
    file.type || "application/octet-stream",
    GENERIC_ACTIONS,
    GENERIC_CONVERSION_GROUPS,
  );
}

/**
 * Read the first 64 bytes of a file asynchronously for magic byte analysis.
 */
export async function readFileHeaderBytes(file: File): Promise<Uint8Array> {
  const slice = file.slice(0, 64);
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}
