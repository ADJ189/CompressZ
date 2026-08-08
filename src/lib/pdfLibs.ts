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
