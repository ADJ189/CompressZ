/**
 * repairPdf.ts — Repair and recover corrupted PDF documents and media files.
 *
 * Repairs broken xref tables with QPDF (repair is implicit on read) and falls
 * back to pure JavaScript xref reconstruction. Also inspects MP4 MOOV atoms for
 * unfinalized video recordings.
 */

import { runQpdfCommand } from "../qpdfWasm";
import { EngineError, cleanLogLines, summarizeLog, toErrorMessage } from "../engineError";

export interface RepairPdfResult {
  repairedBytes: Uint8Array;
  method: "qpdf-deep-repair" | "js-salvage-xref";
  message: string;
}

export interface SalvagedPdf {
  objectOffsets: Map<number, number>;
  hasHeader: boolean;
  hasEof: boolean;
  /** Object number of the last `/Type /Catalog` found, or null when none survived. */
  rootObject: number | null;
}

/**
 * Pure JS fallback: scan byte stream for PDF objects and construct a clean synthetic XREF.
 */
export function salvagePdfObjects(bytes: Uint8Array): SalvagedPdf {
  const objectOffsets = new Map<number, number>();
  const text = new TextDecoder("latin1").decode(bytes);

  // A header more than 1 KiB in is treated as absent: repair prepends one and
  // must then shift every recovered offset by its length.
  const headerIndex = text.indexOf("%PDF-");
  const hasHeader = headerIndex >= 0 && headerIndex < 1024;
  const hasEof = text.includes("%%EOF");

  const objRegex = /\b(\d{1,10})\s+\d{1,5}\s+obj\b/g;
  let rootObject: number | null = null;
  let match: RegExpExecArray | null;

  while ((match = objRegex.exec(text)) !== null) {
    const objNum = Number.parseInt(match[1], 10);

    // Last occurrence wins: incremental updates append replacement objects,
    // and the newest definition is the live one.
    objectOffsets.set(objNum, match.index);

    const bodyEnd = text.indexOf("endobj", match.index);
    const body = text.slice(
      match.index,
      bodyEnd === -1 ? Math.min(text.length, match.index + 4096) : bodyEnd,
    );
    if (/\/Type\s*\/Catalog\b/.test(body)) {
      // Likewise, an updated document appends a newer catalog.
      rootObject = objNum;
    }
  }

  return { objectOffsets, hasHeader, hasEof, rootObject };
}

/**
 * Synthesize a repaired cross-reference table and minimal trailer dictionary.
 * `offsetShift` accounts for a `%PDF-` header prepended by the caller, which
 * moves every recovered object forward by that many bytes.
 */
export function buildSyntheticXrefTrailer(
  offsets: Map<number, number>,
  rootObj: number = 1,
  offsetShift: number = 0,
): string {
  let maxObj = 1;
  for (const key of offsets.keys()) {
    if (key > maxObj) maxObj = key;
  }
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;

  for (let i = 1; i <= maxObj; i++) {
    const off = offsets.get(i);
    if (off !== undefined) {
      const pad = String(off + offsetShift).padStart(10, "0");
      xref += `${pad} 00000 n \n`;
    } else {
      xref += `0000000000 65535 f \n`;
    }
  }

  const trailer = `trailer\n<< /Size ${maxObj + 1} /Root ${rootObj} 0 R >>\nstartxref\n`;
  return `${xref}${trailer}`;
}

/**
 * Execute PDF recovery. Tries QPDF WASM first, falls back to JS xref salvage.
 */
export async function repairCorruptPdf(
  pdfBytes: Uint8Array,
  onProgress?: (pct: number) => void,
): Promise<RepairPdfResult> {
  onProgress?.(15);

  // Strategy 1: QPDF. Repairing a broken xref is implicit on read — there is
  // no `--repair-file` flag. Exit 0 is clean, exit 3 means "completed with
  // warnings"; both can still have produced a usable file.
  let qpdfDiagnostic: string;
  try {
    const result = await runQpdfCommand(["corrupt.pdf", "repaired.pdf"], [
      { name: "corrupt.pdf", data: pdfBytes },
    ]);

    const out = result.outputFiles.find((f) => f.name === "repaired.pdf");
    if (
      out &&
      out.data.length > 0 &&
      (result.exitCode === 0 || result.exitCode === 3)
    ) {
      onProgress?.(100);
      return {
        repairedBytes: out.data,
        method: "qpdf-deep-repair",
        message: "Successfully rebuilt PDF xref table and recovered document structure.",
      };
    }
    qpdfDiagnostic = result.stdout;
  } catch (err) {
    qpdfDiagnostic = toErrorMessage(err, "");
    console.warn("[repairPdf] QPDF WASM failed, attempting JS salvage:", err);
  }

  onProgress?.(60);

  // Strategy 2: JS XREF salvage. When QPDF also failed, say why it did — the
  // user's file may simply be empty, and "no valid objects" alone is vague.
  const qpdfNote = qpdfDiagnostic
    ? ` QPDF reported: ${summarizeLog(qpdfDiagnostic)}`
    : "";
  const { objectOffsets, hasHeader, rootObject } = salvagePdfObjects(pdfBytes);
  if (objectOffsets.size === 0) {
    throw new EngineError(
      `Unable to recover document: no valid PDF objects could be found in the file.${qpdfNote}`,
      "qpdf",
      { log: cleanLogLines(qpdfDiagnostic) },
    );
  }
  if (rootObject === null) {
    throw new EngineError(
      `Unable to recover document: no document catalog (/Type /Catalog) survived, so the rebuilt file would not open.${qpdfNote}`,
      "qpdf",
      { log: cleanLogLines(qpdfDiagnostic) },
    );
  }

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let headerLen = 0;

  if (!hasHeader) {
    const header = enc.encode("%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n");
    chunks.push(header);
    headerLen = header.length;
  }
  chunks.push(pdfBytes);

  const currentLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const syntheticXref = buildSyntheticXrefTrailer(objectOffsets, rootObject, headerLen);
  const footer = `${syntheticXref}${currentLen}\n%%EOF\n`;
  chunks.push(enc.encode(footer));

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    combined.set(c, pos);
    pos += c.length;
  }

  onProgress?.(100);
  return {
    repairedBytes: combined,
    method: "js-salvage-xref",
    message: `Salvaged ${objectOffsets.size} PDF objects and appended synthetic cross-reference table.`,
  };
}

export type Mp4RepairResult =
  | { ok: true; repairedBytes: Uint8Array; message: string }
  | { ok: false; reason: string; alreadyValid: boolean };

/**
 * Inspect an MP4 container for an unfinalized recording.
 *
 * A missing `moov` atom means the recording index was never written; the media
 * data alone is not enough to rebuild it, so this reports an honest failure
 * instead of handing the untouched input back as "repaired".
 */
export function inspectAndRepairMp4Moov(bytes: Uint8Array): Mp4RepairResult {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let hasFtyp = false;
  let hasMdat = false;
  let hasMoov = false;
  let offset = 0;

  while (offset + 8 <= bytes.length) {
    const size = dv.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (type === "ftyp") hasFtyp = true;
    if (type === "mdat") hasMdat = true;
    if (type === "moov") hasMoov = true;

    if (size === 0 || size === 1) break; // Extended or unbounded
    if (size < 8) break; // Not a valid box; stop rather than crawl byte by byte
    offset += size;
  }

  if (!hasMoov) {
    if (!hasMdat) {
      return {
        ok: false,
        alreadyValid: false,
        reason: "Invalid MP4 payload: missing media data (mdat) box.",
      };
    }
    return {
      ok: false,
      alreadyValid: false,
      reason:
        "This recording has no MOOV index, which cannot be rebuilt from the media data alone. " +
        "Re-save it from the app that recorded it (playing to the end usually finalizes it), " +
        "or use a dedicated MOOV-recovery tool.",
    };
  }

  // A finalized container that only lost its `ftyp` box is genuinely fixable.
  if (!hasFtyp) {
    const ftypBox = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, // size 24
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x69, 0x73, 0x6f, 0x6d, // isom
      0x00, 0x00, 0x02, 0x00, // minor version
      0x69, 0x73, 0x6f, 0x6d, // isom
      0x6d, 0x70, 0x34, 0x32, // mp42
    ]);

    const out = new Uint8Array(ftypBox.length + bytes.length);
    out.set(ftypBox, 0);
    out.set(bytes, ftypBox.length);
    return {
      ok: true,
      repairedBytes: out,
      message: "Prepended the missing MP4 header box (ftyp).",
    };
  }

  return {
    ok: false,
    alreadyValid: true,
    reason: "This MP4 already contains a valid MOOV atom, so there is nothing to repair.",
  };
}
