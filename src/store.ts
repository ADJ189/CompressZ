/**
 * store.ts — Central state store for CompressZ.
 *
 * Each tool module stores its file queue and settings here instead of in local
 * mount-function variables. Because this module is loaded once and never
 * re-executed, state survives the router destroying and recreating page DOM.
 *
 * Pattern:
 *   import { imageStore } from '../store';
 *   // read:  imageStore.files
 *   // write: imageStore.files = [...imageStore.files, newEntry];
 */

import type { FileEntry, ImageFormat, AudioFormat, VideoCodec, PdfLevel } from './lib/types';
import { getSettings } from './lib/settings';

// Each tool's starting values come from Settings → Engine Defaults instead
// of being hardcoded here, so editing a default on the Settings page
// actually changes what a fresh visit to that tool starts with. Read once
// at module load — store.ts is a session-wide singleton like the rest of
// this file, so a mid-session settings change intentionally doesn't yank
// the value out from under whatever the user has already configured.
const engineDefaults = getSettings().engines;

// ── Images ────────────────────────────────────────────────────
export interface ImageState {
  files:        FileEntry[];
  mode:         'quality' | 'targetSize';
  quality:      number;
  targetSizeKB: number;
  format:       ImageFormat;
  maxDim:       number;
}
export const imageStore: ImageState = {
  files:        [],
  mode:         'quality',
  quality:      engineDefaults.images.quality,
  targetSizeKB: 200,
  format:       engineDefaults.images.format,
  maxDim:       engineDefaults.images.maxDim,
};

// ── Audio ─────────────────────────────────────────────────────
export interface AudioState {
  files:       FileEntry[];
  fmt:         AudioFormat;
  bitrate:     number;
  sampleRate:  number;
  stripMeta:   boolean;
  passthrough: boolean;
}
export const audioStore: AudioState = {
  files:       [],
  fmt:         engineDefaults.audio.format,
  bitrate:     engineDefaults.audio.bitrate,
  sampleRate:  0,
  stripMeta:   true,
  passthrough: false,
};

// ── Video ─────────────────────────────────────────────────────
export interface VideoState {
  files:        FileEntry[];
  mode:         'crf' | 'bitrate' | 'targetSize';
  crfQuality:   number;
  bitrate:      number;
  targetSizeMB: number;
  codec:        VideoCodec;
  preset:       'ultrafast' | 'fast' | 'medium' | 'slow';
  maxWidth:     number;
  fps:          number;
  tenBit:       boolean;
  proxy:        boolean;
  audioPassthrough: boolean;
  twoPass:      boolean;
  audioTrackMode: 'first' | 'all';
  audioDownmix:   boolean;
  subtitleMode:   'none' | 'all';
  editingId:      string | null; // id of a queued file whose settings are being edited, or null
}
export const videoStore: VideoState = {
  files:        [],
  mode:         'crf',
  crfQuality:   engineDefaults.video.crfQuality,
  bitrate:      2000,
  targetSizeMB: 0,
  codec:        engineDefaults.video.codec,
  preset:       engineDefaults.video.preset,
  maxWidth:     0,
  fps:          0,
  tenBit:       false,
  proxy:        false,
  audioPassthrough: false,
  twoPass:      false,
  audioTrackMode: 'first',
  audioDownmix:   false,
  subtitleMode:   'none',
  editingId:      null,
};

// ── GIF ───────────────────────────────────────────────────────
export interface GifState {
  files:      FileEntry[];
  quality:    number;
  gifToVideo: boolean;
  maxWidth:   number;
  fps:        number;
}
export const gifStore: GifState = {
  files:      [],
  quality:    engineDefaults.gif.quality,
  gifToVideo: false,
  maxWidth:   0,
  fps:        0,
};

// ── PDF ───────────────────────────────────────────────────────
export interface PdfState {
  files:       FileEntry[];
  level:       PdfLevel;
  targetUnit:  'MB' | 'KB';
  targetInput: string;
  stripMeta:   'auto' | 'on' | 'off'; // 'auto' defers to the preset's own default
}
export const pdfStore: PdfState = {
  files:       [],
  level:       engineDefaults.pdf.level,
  targetUnit:  'MB',
  targetInput: '',
  stripMeta:   'auto',
};

// ── Merge PDF ─────────────────────────────────────────────────
// Order-sensitive, many-files → one-file operation — same shape as the
// img2pdf "combine" flow in convert.ts, so it holds a plain File[] (the
// merge order) rather than the FileEntry[] queue the other tools use.
export interface MergeState {
  files: File[];
  busy:  boolean;
}
export const mergeStore: MergeState = {
  files: [],
  busy:  false,
};

// ── Images → PDF ──────────────────────────────────────────────
// Same order-sensitive, many-files → one-file shape as MergeState, plus
// the couple of page-layout options this tool exposes that merge-pdf
// doesn't need.
export interface ImagesToPdfState {
  files:    File[];
  busy:     boolean;
  pageSize: 'auto' | 'a4' | 'letter';
  quality:  number; // JPEG quality used when embedding each image, 1-99
}
export const imagesToPdfStore: ImagesToPdfState = {
  files:    [],
  busy:     false,
  pageSize: 'auto',
  quality:  92,
};
