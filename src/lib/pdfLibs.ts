/**
 * pdfLibs.ts — Shared CDN endpoints for pdfjs-dist and pdf-lib.
 *
 * These same version pins and URLs used to be declared independently in
 * compressPdf.ts, convertPdf.ts, convertOffice.ts, and pages/ocr.ts (one of
 * them even under a differently-spelled constant name, PDFJS_VER vs
 * PDFJS_VERSION) — four places to edit in lockstep if a version ever bumps,
 * and four chances for the copies to silently drift apart. Centralised here
 * so there's exactly one source of truth; every module below now imports
 * these instead of redeclaring them.
 */

export const PDFJS_VERSION = '4.4.168';
export const PDFJS_BASE    = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
export const PDFLIB_ESM    = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

// pdf.js module + worker setup used to be re-imported and re-configured
// (GlobalWorkerOptions.workerSrc) independently in compressPdf.ts,
// convertPdf.ts and pages/ocr.ts — three identical dynamic imports, each
// paying the module-fetch/parse cost again if more than one PDF tool runs
// in the same session. Singleton-cached here instead, same pattern as
// ffmpeg.ts's getFFmpeg(): the module is fetched once per page session no
// matter how many callers ask for it.
let _pdfjsLib: any = null;
export async function getPdfJs(): Promise<any> {
  if (_pdfjsLib) return _pdfjsLib;
  const lib = await import(/* @vite-ignore */ `${PDFJS_BASE}/build/pdf.mjs`) as any;
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/build/pdf.worker.mjs`;
  _pdfjsLib = lib;
  return lib;
}

/** Open a PDF document with the standard options every caller here used
 * (no eval, no worker-side fetch, local cmaps/fonts) — one place to keep
 * them in sync instead of three. `bytes` is sliced so callers can safely
 * reuse/transfer their own copy of the buffer afterwards. */
export async function openPdfDocument(bytes: Uint8Array): Promise<any> {
  const lib = await getPdfJs();
  return lib.getDocument({
    data:                bytes.slice(0),
    cMapUrl:             `${PDFJS_BASE}/cmaps/`,
    cMapPacked:          true,
    standardFontDataUrl: `${PDFJS_BASE}/standard_fonts/`,
    useSystemFonts:      true,
    useWorkerFetch:      false,
    isEvalSupported:     false,
  }).promise;
}
