import type { CompressOptions, CompressResult, PdfLevel } from "./types";
import { PDFLIB_ESM, openPdfDocument } from "./pdfLibs";
import { get2D } from "./gpu";

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

  const { PDFDocument, PDFName, PDFRawStream } = (await import(
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
      streamText[i] !== "<" &&
      streamText[i] !== "%"
    ) {
      i++;
    }
    const token = streamText.slice(start, i);
    const num = Number(token);

    if (!isNaN(num)) {
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
    return Math.max(effDpiX, effDpiY);
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

async function decompressFlate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof process !== "undefined" && (process as any).versions?.node) {
    try {
      const zlibMod = "node:zlib";
      const zlib = await import(/* @vite-ignore */ zlibMod);
      return new Uint8Array(zlib.inflateSync(bytes));
    } catch {
      /**/
    }
  }
  if (typeof DecompressionStream !== "undefined") {
    try {
      const ds = new DecompressionStream("deflate");
      const writer = ds.writable.getWriter();
      writer.write(bytes as any);
      writer.close();
      const res = new Response(ds.readable);
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      /**/
    }
  }
  return bytes;
}

async function getPageContentText(page: any, pdfDoc: any): Promise<string> {
  try {
    const contents =
      page.node.Contents?.() ??
      page.node.dict?.lookup?.(pdfDoc.context.obj("Contents"));
    if (!contents) return "";

    const streamItems: any[] = [];
    if (typeof contents.asArray === "function" && Array.isArray(contents.asArray())) {
      streamItems.push(...contents.asArray());
    } else if (Array.isArray(contents.array)) {
      streamItems.push(...contents.array);
    } else {
      streamItems.push(contents);
    }

    let text = "";
    for (let item of streamItems) {
      if (item?.constructor?.name === "PDFRef" || item?.objectNumber !== undefined) {
        item = pdfDoc.context.lookup(item);
      }
      if (!item) continue;

      let rawBytes: Uint8Array | null = null;
      if (item.contents instanceof Uint8Array) {
        rawBytes = item.contents;
      } else if (typeof item.getContents === "function") {
        rawBytes = item.getContents();
      }
      if (!rawBytes || rawBytes.length === 0) continue;

      const filter =
        item.dict?.lookup?.(pdfDoc.context.obj("Filter"))?.encodedName ?? "";
      let decoded = rawBytes;
      if (filter === "/FlateDecode") {
        decoded = await decompressFlate(rawBytes);
      }
      text += "\n" + new TextDecoder("latin1").decode(decoded);
    }
    return text;
  } catch {
    return "";
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
): Promise<CompressResult> {
  const pdfDoc = await PDFDocument.load(new Uint8Array(arrayBuffer), {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const pages = pdfDoc.getPages();
  const total = pages.length;

  // Pre-scan content streams to find drawn dimensions across all pages
  const drawnSizesByRef = new Map<string, DrawnDimension[]>();
  const drawnSizesByName = new Map<string, DrawnDimension[]>();

  for (let p = 0; p < total; p++) {
    const page = pages[p];
    const streamText = await getPageContentText(page, pdfDoc);
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

      const xObj = xObjects.lookup(key);
      if (xObj?.ref) {
        const refStr = `${xObj.ref.objectNumber}_${xObj.ref.generationNumber}`;
        const existingByRef = drawnSizesByRef.get(refStr) ?? [];
        existingByRef.push(...drawnList);
        drawnSizesByRef.set(refStr, existingByRef);
      }
    }
  }

  const processedObjects = new Set<any>();
  const processedRefKeys = new Set<string>();

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

      const refKey = xObj.ref
        ? `${xObj.ref.objectNumber}_${xObj.ref.generationNumber}`
        : null;

      // Skip already processed images (shared across pages or multiple keys)
      if (
        processedObjects.has(xObj) ||
        processedObjects.has(xObj.dict) ||
        (refKey && processedRefKeys.has(refKey))
      ) {
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
        imgBlob = await decodeXObjectToBlob(xObj, origW, origH);
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

      // If the XObject already has a stable ref, update it in-place.
      // Otherwise register a new object and point the XObject dict entry at it.
      if (xObj.ref) {
        pdfDoc.context.assign(xObj.ref, new PDFRawStream(xObj.dict, reencoded));
      } else {
        const newRef = pdfDoc.context.register(
          new PDFRawStream(xObj.dict, reencoded),
        );
        xObjects.set(key, newRef);
        processedObjects.add(newRef);
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
    xObj.dict.lookup?.({ encodedName: "/ColorSpace" } as any)?.encodedName ??
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
  const hasOSC = typeof OffscreenCanvas !== "undefined";

  for (let i = 1; i <= total; i++) {
    const page = await srcDoc.getPage(i);
    // PDF.js viewport dimensions scale 1:1 with `scale`, and at scale=1
    // they equal the page's PDF points (1 unit = 1/72in for the default
    // UserUnit). Using the *scaled* viewport as the new page's physical
    // size — as this used to — made increasing render quality (renderScale)
    // silently blow up the physical page dimensions. Points (page size)
    // and pixels (render/image resolution) have to be tracked separately.
    const pointsVp = page.getViewport({ scale: 1 });
    const pageW = pointsVp.width;
    const pageH = pointsVp.height;

    const vp = page.getViewport({ scale: renderScale });
    const w = Math.floor(vp.width);
    const h = Math.floor(vp.height);

    let jpegBytes: Uint8Array;

    if (hasOSC) {
      const osc = new OffscreenCanvas(w, h);
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
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
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
      canvas.width = 0;
      canvas.height = 0;
    }

    const img = await (newPdf as any).embedJpg(jpegBytes);
    const newPage = (newPdf as any).addPage([pageW, pageH]);
    newPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
    page.cleanup();

    onProgress?.(18 + Math.floor((i / total) * 76));
  }

  await srcDoc.destroy();
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
