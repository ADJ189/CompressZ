/**
 * excelToPdf.ts — Convert Excel (.xlsx) workbooks to PDF.
 *
 * Parses SpreadsheetML worksheets and shared strings from the OOXML container
 * using in-memory zip.ts, generates a structured HTML table representation,
 * and compiles into PDF via htmlToPdf. 100% offline, zero server uploads.
 * Includes complete HTML escaping to eliminate XSS executable sinks.
 */

import { readZip, zipSupported } from "../zip";
import { htmlToPdf } from "../convertOffice";
import { escapeHtml } from "./common";
export { escapeHtml };

export interface ExcelToPdfOptions {
  onProgress?: (pct: number) => void;
  title?: string;
}

/**
 * Decode XML entities to raw text characters.
 */
function decodeXmlEntities(raw: string): string {
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(
        `<root>${raw}</root>`,
        "text/xml",
      );
      return doc.documentElement?.textContent ?? raw;
    } catch {
      // Fallback to manual replacement
    }
  }
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Extract shared strings table from xl/sharedStrings.xml.
 */
export function parseSharedStringsXml(xmlStr: string): string[] {
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
      const siNodes = doc.getElementsByTagName("si");
      if (siNodes && siNodes.length > 0) {
        const result: string[] = [];
        for (let i = 0; i < siNodes.length; i++) {
          const tNodes = siNodes[i].getElementsByTagName("t");
          let str = "";
          for (let j = 0; j < tNodes.length; j++) {
            str += tNodes[j].textContent || "";
          }
          result.push(str);
        }
        return result;
      }
    } catch {
      // Fallback to regex
    }
  }

  const strings: string[] = [];
  const siRegex = /<si\b[^>]*>(.*?)<\/si>/gs;
  let match: RegExpExecArray | null;

  while ((match = siRegex.exec(xmlStr)) !== null) {
    const siContent = match[1];
    const tRegex = /<t\b[^>]*>(.*?)<\/t>/gs;
    let tMatch: RegExpExecArray | null;
    let combined = "";

    while ((tMatch = tRegex.exec(siContent)) !== null) {
      combined += decodeXmlEntities(tMatch[1]);
    }
    strings.push(combined);
  }

  return strings;
}

export const MAX_WORKSHEET_ROWS = 100_000;
export const MAX_WORKSHEET_COLS = 1_000;
export const MAX_WORKSHEET_CELLS = 2_000_000;

/**
 * Parse a worksheet XML string into a 2D string grid.
 * Safely handles rows and cells whether or not explicit 'r' references are present,
 * including self-closing empty rows and cells.
 */
export function parseWorksheetXml(
  xmlStr: string,
  sharedStrings: string[],
): string[][] {
  const grid: string[][] = [];
  const rowRegex = /<row\b([^>]*?)(?:\/>|>(.*?)<\/row>)/gs;
  let rowMatch: RegExpExecArray | null;
  let fallbackRowIdx = 0;
  let totalMaterializedCells = 0;

  while ((rowMatch = rowRegex.exec(xmlStr)) !== null) {
    const rowAttrs = rowMatch[1];
    const rowContent = rowMatch[2] ?? "";

    const rAttrMatch = /\br="(\d+)"/.exec(rowAttrs);
    const rowIdx = rAttrMatch ? Number.parseInt(rAttrMatch[1], 10) - 1 : fallbackRowIdx;
    if (rowIdx < 0 || rowIdx >= MAX_WORKSHEET_ROWS) {
      throw new Error(`Worksheet row index ${rowIdx + 1} exceeds safety maximum (${MAX_WORKSHEET_ROWS}).`);
    }
    fallbackRowIdx = Math.max(fallbackRowIdx + 1, rowIdx + 1);

    const cellRegex = /<c\b([^>]*?)(?:\/>|>(.*?)<\/c>)/gs;
    let cMatch: RegExpExecArray | null;
    const rowCells: { col: number; val: string }[] = [];
    let fallbackColIdx = 0;

    while ((cMatch = cellRegex.exec(rowContent)) !== null) {
      const cellAttrs = cMatch[1];
      const cellBody = cMatch[2] ?? "";

      const cellRMatch = /\br="([A-Z]+)\d*"/.exec(cellAttrs);
      let colIdx = fallbackColIdx;
      if (cellRMatch) {
        const colLetters = cellRMatch[1];
        let computed = 0;
        for (let i = 0; i < colLetters.length; i++) {
          computed = computed * 26 + (colLetters.charCodeAt(i) - 64);
        }
        colIdx = computed - 1; // 0-based
      }
      if (colIdx < 0 || colIdx >= MAX_WORKSHEET_COLS) {
        throw new Error(`Worksheet column index ${colIdx + 1} exceeds safety maximum (${MAX_WORKSHEET_COLS}).`);
      }
      fallbackColIdx = Math.max(fallbackColIdx + 1, colIdx + 1);

      const typeMatch = /\bt="([^"]*)"/.exec(cellAttrs);
      const type = typeMatch ? typeMatch[1] : "";

      let val = "";
      if (type === "s") {
        // Shared string index
        const vMatch = /<v>(.*?)<\/v>/.exec(cellBody);
        if (vMatch) {
          const sIdx = Number.parseInt(vMatch[1], 10);
          val = sharedStrings[sIdx] ?? "";
        }
      } else if (type === "inlineStr") {
        const tRegex = /<t\b[^>]*>(.*?)<\/t>/gs;
        let tMatch: RegExpExecArray | null;
        let combined = "";
        while ((tMatch = tRegex.exec(cellBody)) !== null) {
          combined += decodeXmlEntities(tMatch[1]);
        }
        val = combined;
      } else {
        const vMatch = /<v>(.*?)<\/v>/.exec(cellBody);
        val = vMatch ? decodeXmlEntities(vMatch[1]) : "";
      }

      rowCells.push({ col: colIdx, val });
    }

    if (rowCells.length > 0) {
      const maxCol = Math.max(...rowCells.map((c) => c.col));
      totalMaterializedCells += (maxCol + 1);
      if (totalMaterializedCells > MAX_WORKSHEET_CELLS) {
        throw new Error(`Worksheet total materialized cells exceed safety limit (${MAX_WORKSHEET_CELLS}).`);
      }
      const cells: string[] = Array(maxCol + 1).fill("");
      for (const c of rowCells) {
        cells[c.col] = c.val;
      }
      while (grid.length <= rowIdx) {
        grid.push([]);
      }
      grid[rowIdx] = cells;
    }
  }

  return grid;
}

/**
 * Convert 2D cell grid into a clean, printable, and XSS-safe HTML table string.
 */
export function gridToHtmlTable(grid: string[][], title?: string): string {
  let html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:20px;">`;
  if (title) {
    html += `<h2 style="margin-bottom:16px;color:#1e293b;">${escapeHtml(title)}</h2>`;
  }

  html += `<table style="border-collapse:collapse;width:100%;font-size:12px;text-align:left;">`;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    const isHeader = r === 0;
    const tag = isHeader ? "th" : "td";
    const bg = isHeader
      ? "background:#f1f5f9;font-weight:600;color:#0f172a;"
      : r % 2 === 1
        ? "background:#f8fafc;"
        : "background:#ffffff;";

    html += `<tr style="${bg}">`;
    for (const cell of row) {
      const safeContent = cell ? escapeHtml(cell) : "&nbsp;";
      html += `<${tag} style="border:1px solid #cbd5e1;padding:6px 10px;word-break:break-word;">${safeContent}</${tag}>`;
    }
    html += `</tr>`;
  }

  html += `</table></div>`;
  return html;
}

/**
 * Convert Excel workbook (.xlsx) to PDF.
 * Parses all worksheets in the workbook with decompression bounds.
 */
interface ParsedWorksheet {
  key: string;
  name?: string;
  grid: string[][];
}

async function extractWorksheetGrids(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ParsedWorksheet[]> {
  if (!zipSupported()) {
    throw new Error(
      "Browser does not support CompressionStream for reading Excel archives.",
    );
  }
  onProgress?.(10);

  const entries = await readZip(await file.arrayBuffer(), {
    maxEntries: 300,
    maxEntryBytes: 32 * 1024 * 1024,
    maxAggregateBytes: 128 * 1024 * 1024,
  });
  onProgress?.(25);

  let sharedStrings: string[] = [];
  const sstBytes = entries.get("xl/sharedStrings.xml");
  if (sstBytes) {
    const sstXml = new TextDecoder().decode(sstBytes);
    sharedStrings = parseSharedStringsXml(sstXml);
  }

  // Parse workbook relationships to resolve sheet r:id -> worksheet part path
  const relsBytes = entries.get("xl/_rels/workbook.xml.rels");
  const relsMap = new Map<string, string>();
  if (relsBytes) {
    const relsXml = new TextDecoder().decode(relsBytes);
    const relRegex = /<Relationship\b([^>]*?)(?:\/>|>(.*?)<\/Relationship>)/gs;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relRegex.exec(relsXml)) !== null) {
      const attrs = relMatch[1];
      const idMatch = /\bId="([^"]+)"/.exec(attrs);
      const targetMatch = /\bTarget="([^"]+)"/.exec(attrs);
      if (idMatch && targetMatch) {
        let target = targetMatch[1].replace(/\\/g, "/");
        if (target.startsWith("/")) target = target.slice(1);
        if (!target.toLowerCase().startsWith("xl/")) {
          target = `xl/${target}`;
        }
        relsMap.set(idMatch[1], target);
      }
    }
  }

  // Parse workbook.xml to get tab order and filter out hidden/veryHidden sheets
  const wbBytes = entries.get("xl/workbook.xml");
  const orderedParts: { key: string; name: string }[] = [];
  if (wbBytes) {
    const wbXml = new TextDecoder().decode(wbBytes);
    const sheetRegex = /<sheet\b([^>]*?)(?:\/>|>(.*?)<\/sheet>)/gs;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = sheetRegex.exec(wbXml)) !== null) {
      const attrs = sMatch[1];
      const stateMatch = /\bstate="([^"]+)"/i.exec(attrs);
      const state = stateMatch ? stateMatch[1].toLowerCase() : "visible";
      if (state === "hidden" || state === "veryhidden") {
        continue;
      }
      const nameMatch = /\bname="([^"]+)"/.exec(attrs);
      const name = nameMatch ? decodeXmlEntities(nameMatch[1]) : "Sheet";

      const rIdMatch = /\br:id="([^"]+)"/i.exec(attrs) || /\bid="([^"]+)"/i.exec(attrs);
      if (rIdMatch) {
        const target = relsMap.get(rIdMatch[1]);
        if (target && entries.has(target)) {
          orderedParts.push({ key: target, name });
        }
      }
    }
  }

  let sheetTargets: { key: string; name?: string }[] = orderedParts;

  // Fallback if workbook.xml was missing or had no valid sheets
  if (sheetTargets.length === 0) {
    const sheetKeys: string[] = [];
    for (const k of entries.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(k)) {
        sheetKeys.push(k);
      }
    }
    sheetKeys.sort((a, b) => {
      const numA = Number.parseInt(a.match(/\d+/)![0], 10);
      const numB = Number.parseInt(b.match(/\d+/)![0], 10);
      return numA - numB;
    });
    sheetTargets = sheetKeys.map((k) => ({ key: k }));
  }

  if (sheetTargets.length === 0) {
    throw new Error("No worksheet found in Excel file.");
  }

  const worksheets: ParsedWorksheet[] = [];
  for (const target of sheetTargets) {
    const bytes = entries.get(target.key);
    if (!bytes) continue;
    const sheetXml = new TextDecoder().decode(bytes);
    const grid = parseWorksheetXml(sheetXml, sharedStrings);
    worksheets.push({ key: target.key, name: target.name, grid });
  }

  return worksheets;
}

/**
 * Convert Excel (.xlsx) file to PDF document.
 * Combines parsed worksheets into structured printable HTML and renders via pdf-lib.
 */
export async function convertExcelToPdf(
  file: File,
  options: ExcelToPdfOptions = {},
): Promise<Blob> {
  const worksheets = await extractWorksheetGrids(file, options.onProgress);
  const baseTitle = options.title || file.name.replace(/\.xlsx$/i, "");
  let combinedHtml = "";

  for (let i = 0; i < worksheets.length; i++) {
    const { grid, name } = worksheets[i];
    const sheetTitle = name || (worksheets.length > 1 ? `${baseTitle} — Sheet ${i + 1}` : baseTitle);
    const pageBreak = i > 0 ? "page-break-before: always; margin-top: 32px;" : "";
    combinedHtml += `<div style="${pageBreak}">${gridToHtmlTable(grid, sheetTitle)}</div>`;
  }

  options.onProgress?.(40);
  return htmlToPdf(combinedHtml, options.onProgress, 40);
}

/**
 * Convert 2D string grid into RFC 4180-compliant CSV string.
 * Neutralizes potential CSV formula injection payloads (=, +, -, @).
 */
export function gridToCsv(grid: string[][]): string {
  return grid
    .map((row) =>
      row
        .map((cell) => {
          if (!cell) return "";
          let val = cell;
          // Neutralize cells beginning with formula triggers (=, +, -, @)
          // including values with leading whitespace or control characters
          // eslint-disable-next-line no-control-regex
          const trimmed = val.replace(/^[\s\x00-\x1f]+/, "");
          if (
            trimmed.startsWith("=") ||
            trimmed.startsWith("+") ||
            trimmed.startsWith("-") ||
            trimmed.startsWith("@") ||
            trimmed.startsWith("\t") ||
            trimmed.startsWith("\r")
          ) {
            val = "'" + val;
          }
          if (
            val.includes('"') ||
            val.includes(",") ||
            val.includes("\n") ||
            val.includes("\r")
          ) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val;
        })
        .join(","),
    )
    .join("\r\n");
}

/**
 * Convert Excel workbook (.xlsx) to CSV blob.
 * Enforces resource bounds against oversized archives and parses all sheets.
 */
export async function convertExcelToCsv(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const worksheets = await extractWorksheetGrids(file, onProgress);

  const masterGrid: string[][] = [];
  for (let i = 0; i < worksheets.length; i++) {
    const { grid } = worksheets[i];
    if (grid.length > 0) {
      if (worksheets.length > 1 && masterGrid.length > 0) {
        masterGrid.push([`--- ${worksheets[i].name || `Sheet ${i + 1}`} ---`]);
      }
      masterGrid.push(...grid);
    }
  }

  onProgress?.(80);
  const csv = gridToCsv(masterGrid);
  onProgress?.(100);

  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}
