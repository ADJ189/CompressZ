/**
 * store.ts — Central reactive state store for CompressZ.
 *
 * Implements the standard Svelte Store contract ({ subscribe, set, update })
 * using a pure TypeScript subscriber model that works both inside Svelte components
 * (via auto-subscription `$store`) and inside framework-independent TypeScript
 * controllers and unit test suites.
 *
 * State survives route navigation, preserving file queues and user settings.
 */

import type {
  FileEntry,
  ImageFormat,
  AudioFormat,
  VideoCodec,
  PdfLevel,
} from "./lib/types";
import { getSettings } from "./lib/settings";
import type { OcrEngine, OcrLanguage, OcrProfile } from "./lib/ocrEngines";
import type { PdfMarkdownBundle } from "./lib/pdfToMarkdown";

export interface Writable<T> {
  subscribe: (fn: (value: T) => void) => () => void;
  set: (value: T) => void;
  update: (fn: (current: T) => T) => void;
  get: () => T;
}

export function createStore<T>(initialValue: T): Writable<T> {
  let value = initialValue;
  const subscribers = new Set<(val: T) => void>();

  return {
    subscribe(fn: (val: T) => void): () => void {
      subscribers.add(fn);
      fn(value);
      return () => {
        subscribers.delete(fn);
      };
    },
    set(newValue: T) {
      value = newValue;
      for (const fn of subscribers) {
        try {
          fn(value);
        } catch (err) {
          console.error("[store] subscriber error:", err);
        }
      }
    },
    update(updater: (current: T) => T) {
      this.set(updater(value));
    },
    get() {
      return value;
    },
  };
}

const engineDefaults = getSettings().engines;

// ── Active Route Store ─────────────────────────────────────────
export const currentRoute = createStore<string>("");

// ── Images Store ──────────────────────────────────────────────
export interface ImageState {
  files: FileEntry[];
  mode: "quality" | "targetSize";
  quality: number;
  targetSizeKB: number;
  format: ImageFormat;
  maxDim: number;
}
export const imageStore = createStore<ImageState>({
  files: [],
  mode: "quality",
  quality: engineDefaults.images.quality,
  targetSizeKB: 200,
  format: engineDefaults.images.format,
  maxDim: engineDefaults.images.maxDim,
});

// ── Audio Store ───────────────────────────────────────────────
export interface AudioState {
  files: FileEntry[];
  fmt: AudioFormat;
  bitrate: number;
  sampleRate: number;
  stripMeta: boolean;
  passthrough: boolean;
}
export const audioStore = createStore<AudioState>({
  files: [],
  fmt: engineDefaults.audio.format,
  bitrate: engineDefaults.audio.bitrate,
  sampleRate: 0,
  stripMeta: true,
  passthrough: false,
});

// ── Video Store ───────────────────────────────────────────────
export interface VideoState {
  files: FileEntry[];
  mode: "crf" | "bitrate" | "targetSize";
  crfQuality: number;
  bitrate: number;
  targetSizeMB: number;
  codec: VideoCodec;
  preset: "ultrafast" | "fast" | "medium" | "slow";
  maxWidth: number;
  fps: number;
  tenBit: boolean;
  proxy: boolean;
  audioPassthrough: boolean;
  twoPass: boolean;
  audioTrackMode: "first" | "all";
  audioDownmix: boolean;
  subtitleMode: "none" | "all";
  editingId: string | null;
}
export const videoStore = createStore<VideoState>({
  files: [],
  mode: "crf",
  crfQuality: engineDefaults.video.crfQuality,
  bitrate: 2000,
  targetSizeMB: 0,
  codec: engineDefaults.video.codec,
  preset: engineDefaults.video.preset,
  maxWidth: 0,
  fps: 0,
  tenBit: false,
  proxy: false,
  audioPassthrough: false,
  twoPass: false,
  audioTrackMode: "first",
  audioDownmix: false,
  subtitleMode: "none",
  editingId: null,
});

// ── GIF Store ─────────────────────────────────────────────────
export interface GifState {
  files: FileEntry[];
  quality: number;
  gifToVideo: boolean;
  maxWidth: number;
  fps: number;
}
export const gifStore = createStore<GifState>({
  files: [],
  quality: engineDefaults.gif.quality,
  gifToVideo: false,
  maxWidth: 0,
  fps: 0,
});

// ── PDF Store ─────────────────────────────────────────────────
export interface PdfState {
  files: FileEntry[];
  level: PdfLevel;
  targetUnit: "MB" | "KB";
  targetInput: string;
  stripMeta: "auto" | "on" | "off";
}
export const pdfStore = createStore<PdfState>({
  files: [],
  level: engineDefaults.pdf.level,
  targetUnit: "MB",
  targetInput: "",
  stripMeta: "auto",
});

// ── Merge PDF Store ───────────────────────────────────────────
export interface MergeState {
  files: File[];
  busy: boolean;
}
export const mergeStore = createStore<MergeState>({
  files: [],
  busy: false,
});

// ── Images → PDF Store ────────────────────────────────────────
export interface ImagesToPdfState {
  files: File[];
  busy: boolean;
  pageSize: "auto" | "a4" | "letter";
  quality: number;
  maxDim: number;
}
export const imagesToPdfStore = createStore<ImagesToPdfState>({
  files: [],
  busy: false,
  pageSize: "auto",
  quality: engineDefaults.images.quality,
  maxDim: engineDefaults.images.maxDim,
});

// ── OCR Store ─────────────────────────────────────────────────
export interface OcrState {
  files: FileEntry[];
  engine: OcrEngine;
  profile: OcrProfile;
  language: OcrLanguage;
  renderDpi: number;
  overlayMode: boolean;
  extractText: boolean;
  symbolMode: boolean;
  busy: boolean;
}
export const ocrStore = createStore<OcrState>({
  files: [],
  engine: "auto",
  profile: "printed",
  language: "auto",
  renderDpi: 200,
  overlayMode: true,
  extractText: true,
  symbolMode: false,
  busy: false,
});

// ── PDF → Markdown Workspace Store ────────────────────────────
export interface PdfMarkdownState {
  file: File | null;
  bundle: PdfMarkdownBundle | null;
  processing: boolean;
  progress: number;
  statusMessage: string;
  profile: "auto" | "printed" | "handwriting" | "mixed";
  language: OcrLanguage;
  includeVisuals: boolean;
  activePageIndex: number;
  editedMarkdown: string;
}
export const pdfMarkdownStore = createStore<PdfMarkdownState>({
  file: null,
  bundle: null,
  processing: false,
  progress: 0,
  statusMessage: "",
  profile: "auto",
  language: "eng",
  includeVisuals: true,
  activePageIndex: 0,
  editedMarkdown: "",
});
