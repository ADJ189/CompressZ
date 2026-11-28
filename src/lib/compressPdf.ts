import type { CompressOptions, CompressResult, PdfLevel } from "./types";
import { PDFLIB_ESM, openPdfDocument } from "./pdfLibs";
import { get2D } from "./gpu";
import { resolveExecutionProfile } from "./settings";
import { clampCanvasDimensions } from "./browserProfile";

interface Preset {
  targetDpi: number;
  jpegQuality: number;
  renderScale: number;
  stripMeta: boolean;
  forceCanvas: boolean;
}

const PRESETS: Record<PdfLevel, Preset> = {
  low: {
    targetDpi: 220,
    jpegQuality: 0.85,
    renderScale: 2.0,
    stripMeta: false,
    forceCanvas: false,
  },
  recommended: {
    targetDpi: 150,
    jpegQuality: 0.72,
    renderScale: 1.5,
    stripMeta: false,
    forceCanvas: false,
  },
  extreme: {
    targetDpi: 96,
    jpegQuality: 0.45,
    renderScale: 1.0,
    stripMeta: true,
    forceCanvas: true,
  },
};

// ── Public entry ──────────────────────────────────────────────
export async function compressPdf(
  file: File,
  options: CompressOptions,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  onProgress?.(2);

  const level = (options.pdfCompressionLevel ?? "recommended") as PdfLevel;
  const preset = PRESETS[level];
  const jpegQuality = options.quality ?? preset.jpegQuality;
  const renderScale = options.pdfRenderScale ?? preset.renderScale;
  const targetSizeKB = options.targetSizeKB ?? 0;
  // Metadata stripping used to be baked into the "extreme" preset only —
  // there was no way to strip title/author/producer tags while keeping
  // "low" or "recommended" image quality. An explicit option now overrides
  // the preset default in either direction.
  const stripMeta = options.stripMetadata ?? preset.stripMeta;

  const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = (await import(
    /* @vite-ignore */ PDFLIB_ESM
  )) as any;
  onProgress?.(6);

  const arrayBuffer = await file.arrayBuffer();

  // Strategy A: structural — only resamples embedded images, text/vectors untouched
  if (!preset.forceCanvas) {
    try {
      const result = await structuralCompress(
        arrayBuffer,
        file.size,
        level,
        PDFDocument,
        PDFName,
        PDFRawStream,
        jpegQuality,
        preset.targetDpi,
        stripMeta,
        targetSizeKB,
        onProgress,
        decodePDFRawStream,
      );
      if (result.compressedSize < file.size * 0.98) return result;
    } catch (e) {
      console.warn("[pdf] structural pass failed, trying canvas render:", e);
    }
  }

  // Strategy B: canvas re-render (fallback + extreme preset)
  onProgress?.(10);
  return canvasRender(
    arrayBuffer,
    file,
    level,
    jpegQuality,
    renderScale,
    stripMeta,
    targetSizeKB,
    PDFDocument,
    onProgress,
  );
}

// ── Strategy A: structural image resampling ───────────────────
export interface DrawnDimension {
  widthPt: number;
  heightPt: number;
}

interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

function multiplyMatrix(m: Matrix2D, c: Matrix2D): Matrix2D {
  return {
    a: m.a * c.a + m.b * c.c,
    b: m.a * c.b + m.b * c.d,
    c: m.c * c.a + m.d * c.c,
    d: m.c * c.b + m.d * c.d,
    e: m.e * c.a + m.f * c.c + c.e,
    f: m.e * c.b + m.f * c.d + c.f,
  };
}

/**
 * Parses CTM concat (cm) and XObject paint (Do) operators from a PDF content stream,
 * tracking graphics state pushes (q) and pops (Q) to compute displayed dimensions in points.
 */
export function calculateImageDrawnSizes(
  streamText: string,
): Map<string, DrawnDimension[]> {
  const result = new Map<string, DrawnDimension[]>();
  if (!streamText) return result;

  let currentMatrix: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: Matrix2D[] = [];
  const operands: (number | string)[] = [];

  let i = 0;
  const len = streamText.length;

  while (i < len) {
    const ch = streamText[i];

    // Whitespace
    if (ch <= " " || ch === "\0") {
      i++;
      continue;
    }

    // Array delimiters: [ and ]
    if (ch === "[" || ch === "]") {
      i++;
      operands.length = 0;
      continue;
    }

    // Comment: % ... \n
    if (ch === "%") {
      while (i < len && streamText[i] !== "\r" && streamText[i] !== "\n") {
        i++;
      }
      continue;
    }

    // String literal: ( ... ) with balanced parentheses and escapes
    if (ch === "(") {
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (streamText[i] === "\\" && i + 1 < len) {
          i += 2;
        } else if (streamText[i] === "(") {
          depth++;
          i++;
        } else if (streamText[i] === ")") {
          depth--;
          i++;
        } else {
          i++;
        }
      }
      operands.length = 0;
      continue;
    }

    // Hex string: < ... > (ignoring dictionary << >>)
    if (ch === "<") {
      if (streamText[i + 1] === "<") {
        i += 2;
      } else {
        i++;
        while (i < len && streamText[i] !== ">") i++;
        if (i < len) i++;
      }
      operands.length = 0;
      continue;
    }

    if (ch === ">" && streamText[i + 1] === ">") {
      i += 2;
      operands.length = 0;
      continue;
    }

    // Name token: /Name
    if (ch === "/") {
      const start = i + 1;
      i++;
      while (
        i < len &&
        streamText[i] > " " &&
        streamText[i] !== "/" &&
        streamText[i] !== "(" &&
        streamText[i] !== "[" &&
        streamText[i] !== "<"
      ) {
        i++;
      }
      operands.push(streamText.slice(start, i));
      continue;
    }

    // Numbers, operators, keywords
    const start = i;
    while (
      i < len &&
      streamText[i] > " " &&
      streamText[i] !== "/" &&
      streamText[i] !== "(" &&
      streamText[i] !== "[" &&
      streamText[i] !== "]" &&
      streamText[i] !== "<" &&
      streamText[i] !== ">" &&
      streamText[i] !== "%"
    ) {
      i++;
    }

    if (start === i) {
      i++;
      continue;
    }

    const token = streamText.slice(start, i);
    const num = Number(token);

    if (!Number.isNaN(num)) {
      operands.push(num);
    } else if (token === "cm") {
      if (operands.length >= 6) {
        const [a, b, c, d, e, f] = operands.slice(-6) as number[];
        currentMatrix = multiplyMatrix({ a, b, c, d, e, f }, currentMatrix);
      }
      operands.length = 0;
    } else if (token === "q") {
      stack.push({ ...currentMatrix });
      operands.length = 0;
    } else if (token === "Q") {
      if (stack.length > 0) {
        currentMatrix = stack.pop()!;
      }
      operands.length = 0;
    } else if (token === "Do") {
      if (operands.length >= 1) {
        const name = String(operands[operands.length - 1]).replace(/^\//, "");
        const widthPt = Math.hypot(currentMatrix.a, currentMatrix.b);
        const heightPt = Math.hypot(currentMatrix.c, currentMatrix.d);
        if (widthPt > 0 && heightPt > 0) {
          const list = result.get(name) ?? [];
          list.push({ widthPt, heightPt });
          result.set(name, list);
        }
      }
      operands.length = 0;
    } else {
      operands.length = 0;
    }
  }

  return result;
}

export function calculateEffectiveDpi(
  origW: number,
  origH: number,
  displayedWidthPt?: number,
  displayedHeightPt?: number,
  pageW: number = 612,
  pageH: number = 792,
): number {
  if (displayedWidthPt && displayedWidthPt > 0) {
    const effDpiX = (origW * 72) / displayedWidthPt;
    const effDpiY =
      displayedHeightPt && displayedHeightPt > 0
        ? (origH * 72) / displayedHeightPt
        : effDpiX;
    return Math.min(effDpiX, effDpiY);
  }

  // Page-size bound fallback: max(origW, origH) / (max(pageW, pageH) / 72)
  const maxPixels = Math.max(origW, origH);
  const maxPageInches = Math.max(pageW, pageH) / 72;
  return maxPageInches > 0 ? maxPixels / maxPageInches : 72;
}

export function calculateDpiScale(effDpi: number, targetDpi: number): number {
  if (effDpi <= 0) return 1;
  return Math.min(1, targetDpi / effDpi);
}

export function calculateTargetQuality(
  jpegQuality: number,
  targetSizeKB: number,
  originalSize: number,
): number {
  if (targetSizeKB <= 0) return jpegQuality;
  const targetRatio = (targetSizeKB * 1024) / Math.max(originalSize, 1);
  return Math.max(0.2, Math.min(0.92, jpegQuality * Math.min(1, targetRatio)));
}

export const MAX_PAGE_SCAN_STREAM_BYTES = 4 * 1024 * 1024; // 4 MiB limit per content stream
export const MAX_PAGE_SCAN_TOTAL_BYTES = 32 * 1024 * 1024; // 32 MiB limit across all pages

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

async function decompressFlateWeb(
  bytes: Uint8Array,
  maxBytes: number,
  format: "deflate" | "deflate-raw",
): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    void (async () => {
      try {
        await writer.write(bytes as any);
        await writer.close();
      } catch {
        /**/
      }
    })();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        if (total + value.length > maxBytes) {
          const allowed = maxBytes - total;
          if (allowed > 0) {
            chunks.push(value.subarray(0, allowed));
            total += allowed;
          }
          try {
            await reader.cancel();
          } catch {
            /**/
          }
          break;
        }
        chunks.push(value);
        total += value.length;
      }
    }
    return concatChunks(chunks, total);
  } catch {
    return null;
  }
}

export async function decompressFlateNode(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array | null> {
  try {
    const zlibMod = "node:zlib";
    const zlib = await import(/* @vite-ignore */ zlibMod);
    return await new Promise<Uint8Array | null>((resolve) => {
      let settled = false;
      const finish = (val: Uint8Array | null) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const chunks: Uint8Array[] = [];
      let total = 0;
      const inf = zlib.createInflate();
      inf.on("data", (chunk: any) => {
        if (total < maxBytes) {
          const take = Math.min(chunk.length, maxBytes - total);
          chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, take));
          total += take;
        }
        if (total >= maxBytes) {
          finish(concatChunks(chunks, total));
          inf.destroy();
        }
      });
      inf.on("end", () => finish(concatChunks(chunks, total)));
      inf.on("error", () => {
        if (settled) return;
        // Fall back to raw inflate
        const rawChunks: Uint8Array[] = [];
        let rawTotal = 0;
        const rawInf = zlib.createInflateRaw();
        rawInf.on("data", (chunk: any) => {
          if (rawTotal < maxBytes) {
            const take = Math.min(chunk.length, maxBytes - rawTotal);
            rawChunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, take));
            rawTotal += take;
          }
          if (rawTotal >= maxBytes) {
            finish(concatChunks(rawChunks, rawTotal));
            rawInf.destroy();
          }
        });
        rawInf.on("end", () => finish(concatChunks(rawChunks, rawTotal)));
        rawInf.on("error", () => finish(null));
        rawInf.end(Buffer.from(bytes));
      });
      inf.end(Buffer.from(bytes));
    });
  } catch {
    return null;
  }
}

export type DecodedAsciiHex = Uint8Array & {
  bytes: Uint8Array;
  terminated: boolean;
};

export function decodeAsciiHex(
  bytes: Uint8Array,
  maxBytes: number,
): DecodedAsciiHex | null {
  if (maxBytes <= 0) {
    const empty = new Uint8Array(0) as DecodedAsciiHex;
    empty.bytes = empty;
    empty.terminated = bytes.length === 0;
    return empty;
  }
  const out: number[] = [];
  let firstNibble = -1;
  let terminated = false;
  let i = 0;
  for (; i < bytes.length && out.length < maxBytes; i++) {
    const ch = bytes[i];
    if (ch === 0x3e) {
      terminated = true;
      break; // '>'
    }
    // PDF whitespace characters (ISO 32000-1 §7.2.2): NUL, TAB, LF, FF, CR, SP
    if (ch === 0x00 || ch === 0x09 || ch === 0x0a || ch === 0x0c || ch === 0x0d || ch === 0x20) {
      continue;
    }
    let nibble: number;
    if (ch >= 0x30 && ch <= 0x39) nibble = ch - 0x30;
    else if (ch >= 0x41 && ch <= 0x46) nibble = ch - 0x41 + 10;
    else if (ch >= 0x61 && ch <= 0x66) nibble = ch - 0x61 + 10;
    else return null; // invalid non-hexadecimal character before '>'
    if (firstNibble === -1) {
      firstNibble = nibble;
    } else {
      out.push((firstNibble << 4) | nibble);
      firstNibble = -1;
    }
  }
  if (firstNibble !== -1 && out.length < maxBytes) {
    out.push(firstNibble << 4);
  }
  if (!terminated) {
    let j = i;
    while (j < bytes.length) {
      const ch = bytes[j];
      if (ch === 0x00 || ch === 0x09 || ch === 0x0a || ch === 0x0c || ch === 0x0d || ch === 0x20) {
        j++;
        continue;
      }
      if (ch === 0x3e) {
        terminated = true;
      }
      break;
    }
  }
  // Distinguish output-cap exhaustion from genuinely missing terminator:
  // Only reject as malformed if the stream ended without reaching maxBytes
  // and without seeing '>'.
  if (out.length < maxBytes && bytes.length > 0 && !terminated) {
    return null; // stream was not properly terminated with '>'
  }
  const result = new Uint8Array(out) as DecodedAsciiHex;
  result.bytes = result;
  result.terminated = terminated;
  return result;
}

export async function decompressFlate(
  bytes: Uint8Array,
  maxBytes = MAX_PAGE_SCAN_STREAM_BYTES,
): Promise<Uint8Array | null> {
  if (typeof DecompressionStream !== "undefined") {
    const webResult =
      (await decompressFlateWeb(bytes, maxBytes, "deflate")) ??
      (await decompressFlateWeb(bytes, maxBytes, "deflate-raw"));
    if (webResult) return webResult;
  }
  if (typeof process !== "undefined" && (process as any).versions?.node) {
    const nodeResult = await decompressFlateNode(bytes, maxBytes);
    if (nodeResult) return nodeResult;
  }
  return null;
}

export interface PageContentTextResult {
  text: string;
  bytesRead: number;
  truncated: boolean;
  incomplete: boolean;
}

export function extractPdfFilterNames(filterObj: any, context?: any): string[] {
  if (!filterObj) return [];
  let resolved = filterObj;
  if (context && (resolved?.constructor?.name === "PDFRef" || resolved?.objectNumber !== undefined)) {
    try {
      resolved = context.lookup(resolved);
    } catch {
      return [];
    }
  }
  let items: any[];
  if (typeof resolved?.asArray === "function") {
    items = resolved.asArray();
  } else if (Array.isArray(resolved?.array)) {
    items = resolved.array;
  } else if (Array.isArray(resolved)) {
    items = resolved;
  } else {
    items = [resolved];
  }

  const names: string[] = [];
  for (let entry of items) {
    if (context && (entry?.constructor?.name === "PDFRef" || entry?.objectNumber !== undefined)) {
      try {
        entry = context.lookup(entry);
      } catch {
        /**/
      }
    }
    const name = entry?.encodedName ?? entry?.name ?? entry?.toString?.() ?? "";
    if (name) {
      names.push(name);
    }
  }
  return names;
}

export async function getPageContentText(
  page: any,
  pdfDoc: any,
  _decodePDFRawStream?: any,
  maxStreamBytes = MAX_PAGE_SCAN_STREAM_BYTES,
): Promise<PageContentTextResult> {
  try {
    const contents =
      page.node.Contents?.() ??
      page.node.dict?.lookup?.(pdfDoc.context.obj("Contents"));
    if (!contents) return { text: "", bytesRead: 0, truncated: false, incomplete: false };

    const streamItems: any[] = [];
    if (Array.isArray(contents)) {
      streamItems.push(...contents);
    } else if (typeof contents.asArray === "function" && Array.isArray(contents.asArray())) {
      streamItems.push(...contents.asArray());
    } else if (Array.isArray(contents.array)) {
      streamItems.push(...contents.array);
    } else {
      streamItems.push(contents);
    }

    let text = "";
    let totalBytes = 0;
    let truncated = false;
    let incomplete = false;

    for (let item of streamItems) {
      if (totalBytes >= maxStreamBytes) {
        truncated = true;
        incomplete = true;
        break;
      }
      if (item?.constructor?.name === "PDFRef" || item?.objectNumber !== undefined) {
        item = pdfDoc.context.lookup(item);
      }
      if (!item) {
        incomplete = true;
        continue;
      }

      const remainingBytes = maxStreamBytes - totalBytes;
      let rawBytes: Uint8Array | null = null;
      if (item.contents instanceof Uint8Array) {
        rawBytes = item.contents;
      } else if (typeof item.getContents === "function") {
        rawBytes = item.getContents();
      }
      if (!rawBytes || rawBytes.length === 0) continue;

      // DO NOT call decodePDFRawStream because it is unbounded and materializes
      // full decompression bombs in memory before capping. Instead, decode
      // supported content filters incrementally up to remainingBytes in order.
      let decodedBytes: Uint8Array | null = null;
      const filterObj = item.dict?.lookup?.(pdfDoc.context.obj("Filter"));
      const filterNames = extractPdfFilterNames(filterObj, pdfDoc.context);

      let currentBytes: Uint8Array = rawBytes;
      let failedOrUnsupported = false;

      if (filterNames.length === 0) {
        decodedBytes = currentBytes.subarray(0, remainingBytes);
      } else {
        for (const rawName of filterNames) {
          const norm = rawName.replace(/^\//, "");
          if (norm === "" || norm === "None") {
            continue;
          } else if (norm === "ASCIIHexDecode") {
            const next = decodeAsciiHex(currentBytes, remainingBytes);
            if (!next) {
              failedOrUnsupported = true;
              break;
            }
            if (!next.terminated) {
              incomplete = true;
            }
            currentBytes = next.bytes;
          } else if (norm === "FlateDecode") {
            const next = await decompressFlate(currentBytes, remainingBytes);
            if (!next) {
              failedOrUnsupported = true;
              break;
            }
            currentBytes = next;
          } else {
            // Unsupported filter (e.g. ASCII85Decode, LZWDecode):
            // mark skipped stream as incomplete to avoid downsampling unknown placements
            failedOrUnsupported = true;
            break;
          }
        }
        if (!failedOrUnsupported) {
          decodedBytes = currentBytes;
        }
      }

      if (failedOrUnsupported || !decodedBytes) {
        incomplete = true;
        continue;
      }

      if (decodedBytes.length > 0) {
        if (decodedBytes.length >= remainingBytes) {
          truncated = true;
          incomplete = true;
          decodedBytes = decodedBytes.subarray(0, remainingBytes);
        }
        totalBytes += decodedBytes.length;
        text += "\n" + new TextDecoder("latin1").decode(decodedBytes);
        if (totalBytes >= maxStreamBytes) {
          truncated = true;
          incomplete = true;
          break;
        }
      }
    }
    return { text, bytesRead: totalBytes, truncated, incomplete };
  } catch {
    return { text: "", bytesRead: 0, truncated: false, incomplete: true };
  }
}

async function structuralCompress(
  arrayBuffer: ArrayBuffer,
  originalSize: number,
  level: PdfLevel,
  PDFDocument: any,
  PDFName: any,
  PDFRawStream: any,
  jpegQuality: number,
  targetDpi: number,
  stripMeta: boolean,
  targetSizeKB: number,
  onProgress?: (pct: number) => void,
  _decodePDFRawStream?: any,
): Promise<CompressResult> {
  const pdfDoc = await PDFDocument.load(new Uint8Array(arrayBuffer), {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  if (pdfDoc.isEncrypted) {
    throw new Error("Encrypted PDF requires canvas fallback");
  }

  const pages = pdfDoc.getPages();
  const total = pages.length;

  // Track image page references to detect shared images across pages
  const imagePageReferences = new Map<string, Set<number>>();
  for (let p = 0; p < total; p++) {
    const resources = pages[p].node.Resources?.();
    const xObjects = resources?.lookup?.(PDFName.of("XObject"));
    if (xObjects) {
      const keys: any[] = xObjects.keys?.() ?? [];
      for (const key of keys) {
        const rawRef = xObjects.dict ? xObjects.dict.get(key) : (xObjects.get?.(key) ?? null);
        const refObj = rawRef?.objectNumber !== undefined ? rawRef : xObjects.lookup(key)?.ref;
        const refKey = refObj?.objectNumber !== undefined
          ? `${refObj.objectNumber}_${refObj.generationNumber ?? 0}`
          : (key.name ?? key.encodedName?.replace(/^\//, ""));
        if (refKey) {
          let pageSet = imagePageReferences.get(refKey);
          if (!pageSet) {
            pageSet = new Set<number>();
            imagePageReferences.set(refKey, pageSet);
          }
          pageSet.add(p);
        }
      }
    }
  }

  // Pre-scan content streams to find drawn dimensions across all pages
  const drawnSizesByRef = new Map<string, DrawnDimension[]>();
  const drawnSizesByName = new Map<string, DrawnDimension[]>();
  const fullyScannedPages = new Set<number>();
  let scanComplete = true;

  let totalScannedBytes = 0;
  for (let p = 0; p < total; p++) {
    if (totalScannedBytes >= MAX_PAGE_SCAN_TOTAL_BYTES) {
      scanComplete = false;
      break;
    }
    const page = pages[p];
    const streamLimit = Math.min(
      MAX_PAGE_SCAN_STREAM_BYTES,
      MAX_PAGE_SCAN_TOTAL_BYTES - totalScannedBytes,
    );
    const { text: streamText, bytesRead, truncated, incomplete } = await getPageContentText(
      page,
      pdfDoc,
      undefined,
      streamLimit,
    );
    totalScannedBytes += bytesRead;
    if (truncated || incomplete || bytesRead >= streamLimit) {
      scanComplete = false;
    } else {
      fullyScannedPages.add(p);
    }
    if (!streamText) continue;

    const pageDrawn = calculateImageDrawnSizes(streamText);
    const resources = page.node.Resources();
    const xObjects = resources?.lookup(PDFName.of("XObject"));
    const keys: any[] = xObjects?.keys?.() ?? [];

    for (const key of keys) {
      const name = key.name ?? key.encodedName?.replace(/^\//, "");
      const drawnList = pageDrawn.get(name);
      if (!drawnList || drawnList.length === 0) continue;

      const existingByName = drawnSizesByName.get(name) ?? [];
      existingByName.push(...drawnList);
      drawnSizesByName.set(name, existingByName);

      const rawRef = xObjects.dict ? xObjects.dict.get(key) : (xObjects.get?.(key) ?? null);
      const refObj = rawRef?.objectNumber !== undefined ? rawRef : xObjects.lookup(key)?.ref;
      if (refObj?.objectNumber !== undefined) {
        const refStr = `${refObj.objectNumber}_${refObj.generationNumber ?? 0}`;
        const existingByRef = drawnSizesByRef.get(refStr) ?? [];
        existingByRef.push(...drawnList);
        drawnSizesByRef.set(refStr, existingByRef);
      }
    }
  }

  const processedObjects = new Set<any>();
  const processedRefKeys = new Set<string>();
  const replacementsByRef = new Map<string, any>();

  for (let p = 0; p < total; p++) {
    const page = pages[p];
    const resources = page.node.Resources();
    if (!resources) continue;

    const xObjects = resources.lookup(PDFName.of("XObject"));
    if (!xObjects) continue;

    const keys: any[] = xObjects.keys?.() ?? [];

    for (const key of keys) {
      const xObj = xObjects.lookup(key);
      if (!xObj?.dict) continue;

      const rawRef = xObjects.dict ? xObjects.dict.get(key) : (xObjects.get?.(key) ?? null);
      const targetRef = rawRef?.objectNumber !== undefined ? rawRef : xObj.ref;
      const refKey = targetRef?.objectNumber !== undefined
        ? `${targetRef.objectNumber}_${targetRef.generationNumber ?? 0}`
        : null;

      // Skip already processed images (shared across pages or multiple keys)
      if (
        processedObjects.has(xObj) ||
        processedObjects.has(xObj.dict) ||
        (refKey && processedRefKeys.has(refKey))
      ) {
        if (refKey && replacementsByRef.has(refKey)) {
          xObjects.set(key, replacementsByRef.get(refKey));
        }
        continue;
      }

      const subtype = xObj.dict.lookup(PDFName.of("Subtype"));
      if (subtype?.encodedName !== "/Image") continue;

      // Mark as inspected so unsupported/skipped formats are not repeatedly analyzed
      processedObjects.add(xObj);
      processedObjects.add(xObj.dict);
      if (refKey) processedRefKeys.add(refKey);

      // Skip color spaces the canvas cannot represent correctly
      const cs = xObj.dict.lookup(PDFName.of("ColorSpace"));
      const csName = cs?.encodedName ?? cs?.toString() ?? "";
      if (/CMYK|Indexed|Separation|DeviceN/i.test(csName)) continue;

      const origW = xObj.dict.lookup(PDFName.of("Width"))?.numberValue ?? 0;
      const origH = xObj.dict.lookup(PDFName.of("Height"))?.numberValue ?? 0;
      if (origW < 64 || origH < 64) continue; // skip tiny decorations

      // Skip images with transparency masks: JPEG cannot represent alpha channels,
      // and deleting SMask flattens transparent illustrations/logos into opaque blocks.
      const hasSMask =
        xObj.dict.has(PDFName.of("SMask")) || xObj.dict.has(PDFName.of("Mask"));
      if (hasSMask) continue;

      // Resolve drawn dimensions across all occurrences
      const name = key.name ?? key.encodedName?.replace(/^\//, "");

      // If the scan was incomplete, verify whether this image's placements are fully known.
      // Any image referenced on a page that was not fully scanned must skip resizing
      // to prevent shrinking and blurring due to unknown placement dimensions.
      // Shared images (appearing on multiple pages) must also skip resizing if scan was incomplete.
      const pageSet = (refKey ? imagePageReferences.get(refKey) : null) ??
        (name ? imagePageReferences.get(name) : null);
      const isShared = pageSet ? pageSet.size > 1 : false;
      const hasUnscannedPage = pageSet
        ? pageSet.size === 0 || Array.from(pageSet).some((idx) => !fullyScannedPages.has(idx))
        : true;
      if (hasUnscannedPage || (!scanComplete && isShared)) {
        continue;
      }

      const drawnPlacements =
        (refKey ? drawnSizesByRef.get(refKey) : null) ??
        drawnSizesByName.get(name) ??
        [];

      let displayedWidthPt: number | undefined;
      let displayedHeightPt: number | undefined;
      if (drawnPlacements.length > 0) {
        // Use maximum displayed dimensions across all placements to preserve quality
        displayedWidthPt = Math.max(...drawnPlacements.map((d) => d.widthPt));
        displayedHeightPt = Math.max(...drawnPlacements.map((d) => d.heightPt));
      }

      const pageWidthPt = page.getWidth?.() ?? 612;
      const pageHeightPt = page.getHeight?.() ?? 792;

      const effDpi = calculateEffectiveDpi(
        origW,
        origH,
        displayedWidthPt,
        displayedHeightPt,
        pageWidthPt,
        pageHeightPt,
      );

      const dpiScale = calculateDpiScale(effDpi, targetDpi);

      // Downsample only when effective DPI exceeds target DPI (dpiScale < 1)
      // or if target size constraint requires re-encoding
      if (dpiScale >= 1 && targetSizeKB <= 0) {
        continue;
      }

      const newW = Math.max(1, Math.round(origW * dpiScale));
      const newH = Math.max(1, Math.round(origH * dpiScale));

      let imgBlob: Blob;
      try {
        imgBlob = await decodeXObjectToBlob(xObj, origW, origH, PDFName);
      } catch {
        continue;
      }

      const quality = calculateTargetQuality(
        jpegQuality,
        targetSizeKB,
        originalSize,
      );

      let reencoded: Uint8Array;
      try {
        reencoded = await reencodeToJpeg(imgBlob, newW, newH, quality);
      } catch {
        continue;
      }

      // Only replace when the new stream is actually smaller
      if (reencoded.byteLength >= imgBlob.size) continue;

      xObj.dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
      xObj.dict.set(PDFName.of("Width"), pdfDoc.context.obj(newW));
      xObj.dict.set(PDFName.of("Height"), pdfDoc.context.obj(newH));
      xObj.dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
      xObj.dict.set(PDFName.of("BitsPerComponent"), pdfDoc.context.obj(8));
      xObj.dict.delete(PDFName.of("DecodeParms"));
      xObj.dict.delete(PDFName.of("Mask"));
      xObj.dict.delete(PDFName.of("SMask"));

      // If the XObject has a stable resource reference, update it in-place.
      // Otherwise register a new object, point the XObject dict entry at it,
      // and track the replacement so other aliases redirect to it.
      if (targetRef) {
        pdfDoc.context.assign(targetRef, new PDFRawStream(xObj.dict, reencoded));
        if (refKey) {
          replacementsByRef.set(refKey, targetRef);
        }
      } else {
        const newRef = pdfDoc.context.register(
          new PDFRawStream(xObj.dict, reencoded),
        );
        xObjects.set(key, newRef);
        processedObjects.add(newRef);
        if (refKey) {
          replacementsByRef.set(refKey, newRef);
          processedRefKeys.add(refKey);
        }
        processedRefKeys.add(
          `${newRef.objectNumber}_${newRef.generationNumber}`,
        );
      }
    }

    onProgress?.(6 + Math.floor(((p + 1) / total) * 82));
  }

  if (stripMeta) stripMetadata(pdfDoc);

  onProgress?.(92);
  const bytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
  });
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  onProgress?.(100);

  return {
    blob,
    originalSize,
    compressedSize: blob.size,
    compressionRatio: originalSize / blob.size,
    format: `PDF · ${level} · structural`,
  };
}

// ── Decode image XObject to a Blob the canvas can read ────────
async function decodeXObjectToBlob(
  xObj: any,
  w: number,
  h: number,
  PDFName: any,
): Promise<Blob> {
  const rawBytes: Uint8Array =
    xObj.contents ?? xObj.getContents?.() ?? new Uint8Array(0);
  if (!rawBytes.length) throw new Error("empty stream");
  // Ensure concrete ArrayBuffer — pdf-lib can return views backed by SharedArrayBuffer
  // which Blob() rejects in strict TS lib. Slice copies into a plain ArrayBuffer.
  const safeBytes = new Uint8Array(
    rawBytes.buffer instanceof ArrayBuffer
      ? rawBytes.buffer.slice(
          rawBytes.byteOffset,
          rawBytes.byteOffset + rawBytes.byteLength,
        )
      : new Uint8Array(rawBytes).buffer,
  );

  // JPEG: magic bytes FF D8
  if (rawBytes[0] === 0xff && rawBytes[1] === 0xd8) {
    return new Blob([safeBytes], { type: "image/jpeg" });
  }

  // Try wrapping as a generic blob and decoding (handles PNG, etc.)
  try {
    const b = new Blob([safeBytes]);
    const bmp = await createImageBitmap(b);
    bmp.close(); // just testing decodability; close immediately
    return b;
  } catch {
    /**/
  }

  // Raw RGB/Gray pixel data — reconstruct via ImageData
  const cs =
    xObj.dict.lookup?.(PDFName.of("ColorSpace"))?.encodedName ??
    "/DeviceRGB";
  const channels = cs.includes("Gray") ? 1 : 3;
  if (rawBytes.length < w * h * channels)
    throw new Error("stream too short for stated dimensions");

  const osc = new OffscreenCanvas(w, h);
  const ctx = get2D(osc, "pdf") as OffscreenCanvasRenderingContext2D;
  const imgData = ctx.createImageData(w, h);
  const d = imgData.data;

  for (let i = 0; i < w * h; i++) {
    if (channels === 1) {
      const v = rawBytes[i];
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    } else {
      d[i * 4] = rawBytes[i * 3];
      d[i * 4 + 1] = rawBytes[i * 3 + 1];
      d[i * 4 + 2] = rawBytes[i * 3 + 2];
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return osc.convertToBlob({ type: "image/png" });
}

// ── Re-encode blob → JPEG at target dimensions ────────────────
async function reencodeToJpeg(
  blob: Blob,
  w: number,
  h: number,
  quality: number,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  const osc = new OffscreenCanvas(w, h);
  const ctx = get2D(osc, "pdf") as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = "#ffffff"; // flatten transparency before JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await osc.convertToBlob({ type: "image/jpeg", quality });
  return new Uint8Array(await out.arrayBuffer());
}

// ── Strategy B: full page canvas render via PDF.js ────────────
async function canvasRender(
  arrayBuffer: ArrayBuffer,
  file: File,
  level: PdfLevel,
  jpegQuality: number,
  renderScale: number,
  stripMeta: boolean,
  targetSizeKB: number,
  PDFDocument: any,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  onProgress?.(14);
  const srcDoc = await openPdfDocument(new Uint8Array(arrayBuffer));
  onProgress?.(18);

  const newPdf = await PDFDocument.create();
  const total = srcDoc.numPages;
  const execProfile = resolveExecutionProfile();
  const hasOSC =
    execProfile.browserProfile.canvas.useOffscreenCanvas &&
    typeof OffscreenCanvas !== "undefined";
  const effectiveScale = Math.min(
    renderScale,
    execProfile.browserProfile.wasm.pdfMaxRenderScale,
  );

  try {
    for (let i = 1; i <= total; i++) {
      const page = await srcDoc.getPage(i);
      try {
        const pointsVp = page.getViewport({ scale: 1 });
        const pageW = pointsVp.width;
        const pageH = pointsVp.height;

        let vp = page.getViewport({ scale: effectiveScale });
        const clamped = clampCanvasDimensions(
          vp.width,
          vp.height,
          execProfile.browserProfile,
        );
        if (clamped.clamped) {
          const adj =
            effectiveScale *
            Math.min(
              clamped.width / Math.max(1, vp.width),
              clamped.height / Math.max(1, vp.height),
            );
          vp = page.getViewport({ scale: adj });
        }
        const w = Math.max(1, Math.floor(vp.width));
        const h = Math.max(1, Math.floor(vp.height));

        let jpegBytes: Uint8Array;

        if (hasOSC) {
          const osc = new OffscreenCanvas(w, h);
          try {
            const ctx = get2D(osc, "pdf", { alpha: false, colorSpace: "srgb" });
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            await page.render({ canvasContext: ctx, viewport: vp, intent: "print" })
              .promise;

            const q =
              targetSizeKB > 0
                ? await oscBinarySearch(osc, (targetSizeKB * 1024) / total)
                : jpegQuality;
            const outBlob = await osc.convertToBlob({
              type: "image/jpeg",
              quality: q,
            });
            jpegBytes = new Uint8Array(await outBlob.arrayBuffer());
          } finally {
            osc.width = 0;
            osc.height = 0;
          }
        } else {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          try {
            const ctx = get2D(canvas, "pdf", { alpha: false });
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            await page.render({ canvasContext: ctx, viewport: vp, intent: "print" })
              .promise;

            const q =
              targetSizeKB > 0
                ? await canvasBinarySearch(canvas, (targetSizeKB * 1024) / total)
                : jpegQuality;
            const d = canvas.toDataURL("image/jpeg", q);
            jpegBytes = base64ToBytes(d.replace(/^data:image\/jpeg;base64,/, ""));
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }

        const img = await (newPdf as any).embedJpg(jpegBytes);
        const newPage = (newPdf as any).addPage([pageW, pageH]);
        newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
      } finally {
        page.cleanup?.();
      }

      onProgress?.(18 + Math.floor((i / total) * 76));
    }
  } finally {
    await srcDoc.destroy().catch(() => {});
  }
  onProgress?.(96);

  if (stripMeta) stripMetadata(newPdf);

  const bytes = await (newPdf as any).save({
    useObjectStreams: true,
    addDefaultPage: false,
  });
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });

  if (blob.size < 256)
    throw new Error(`Output too small (${blob.size}b) — PDF may be corrupt`);

  onProgress?.(100);
  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: file.size / blob.size,
    format: `PDF · ${level} · canvas`,
  };
}

// ── Binary search helpers ─────────────────────────────────────
async function oscBinarySearch(
  osc: OffscreenCanvas,
  targetBytes: number,
): Promise<number> {
  let lo = 0.2,
    hi = 0.92,
    best = 0.6;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const b = await osc.convertToBlob({ type: "image/jpeg", quality: mid });
    if (b.size <= targetBytes) {
      best = mid;
      lo = mid;
    } else hi = mid;
    if (hi - lo < 0.01) break;
  }
  return best;
}

async function canvasBinarySearch(
  canvas: HTMLCanvasElement,
  targetBytes: number,
): Promise<number> {
  let lo = 0.2,
    hi = 0.92,
    best = 0.6;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const d = canvas.toDataURL("image/jpeg", mid);
    const sz = Math.round(
      ((d.length - "data:image/jpeg;base64,".length) * 3) / 4,
    );
    if (sz <= targetBytes) {
      best = mid;
      lo = mid;
    } else hi = mid;
    if (hi - lo < 0.01) break;
  }
  return best;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function stripMetadata(doc: any) {
  try {
    doc.setTitle("");
    doc.setAuthor("");
    doc.setSubject("");
    doc.setKeywords([]);
    doc.setProducer("");
    doc.setCreator("");
  } catch {
    /**/
  }
}
