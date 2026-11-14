/**
 * pdfToExcel.ts — Convert PDF tabular data to Microsoft Excel (.xlsx).
 *
 * Clusters text coordinates into table rows and columns, converts cells,
 * and packages directly into OpenXML SpreadsheetML (.xlsx) via zip.ts.
 * 100% offline, zero network requests, zero telemetry.
 */

import { writeZip, type ZipEntryIn } from "../zip";
import { openPdfDocument } from "../pdfLibs";

export interface PdfToExcelOptions {
  onProgress?: (pct: number) => void;
  toleranceY?: number; // row clustering threshold in points (default 5)
}

/**
 * Convert 0-based column index to Excel column string (0 -> "A", 25 -> "Z", 26 -> "AA").
 */
export function columnToLetter(col: number): string {
  let letter = "";
  let temp = col + 1;
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * Cluster raw PDF text items into 2D table grid (rows and columns).
 */
export function clusterTextIntoGrid(
  items: { str: string; x: number; y: number; w: number; h: number }[],
  toleranceY: number = 5,
): string[][] {
  if (items.length === 0) return [];

  // Sort descending by Y (top to bottom), then ascending by X (left to right)
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) <= toleranceY) {
      return a.x - b.x;
    }
    return b.y - a.y; // In PDF coordinates, Y increases upwards
  });

  // Group into rows
  const rows: { y: number; items: typeof items }[] = [];
  for (const item of sorted) {
    const existing = rows.find((r) => Math.abs(r.y - item.y) <= toleranceY);
    if (existing) {
      existing.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  // Determine global column boundaries by clustering X coordinates
  const allX = sorted.map((it) => Math.round(it.x / 10) * 10);
  const uniqueX = Array.from(new Set(allX)).sort((a, b) => a - b);

  function findColIndex(x: number): number {
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < uniqueX.length; i++) {
      const dist = Math.abs(uniqueX[i] - x);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    return closest;
  }

  // Build 2D string grid
  const grid: string[][] = [];
  for (const row of rows) {
    const rowItems = row.items.sort((a, b) => a.x - b.x);
    const rowCells: string[] = [];

    for (const it of rowItems) {
      const colIdx = findColIndex(it.x);
      while (rowCells.length <= colIdx) {
        rowCells.push("");
      }
      rowCells[colIdx] = rowCells[colIdx] ? `${rowCells[colIdx]} ${it.str.trim()}` : it.str.trim();
    }

    if (rowCells.some((c) => c.length > 0)) {
      grid.push(rowCells);
    }
  }

  return grid;
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate SpreadsheetML worksheet XML from 2D data matrix.
 */
export function generateWorksheetXml(grid: string[][]): string {
  let sheetData = "";

  for (let r = 0; r < grid.length; r++) {
    const rowNum = r + 1;
    const row = grid[r];
    let rowXml = `<row r="${rowNum}">`;

    for (let c = 0; c < row.length; c++) {
      const cellVal = row[c];
      if (!cellVal || cellVal.trim().length === 0) continue;

      const cellRef = `${columnToLetter(c)}${rowNum}`;
      const numVal = Number(cellVal.replace(/,/g, ""));

      if (!Number.isNaN(numVal) && cellVal.trim() !== "" && !cellVal.startsWith("0") || cellVal === "0") {
        rowXml += `<c r="${cellRef}"><v>${numVal}</v></c>`;
      } else {
        rowXml += `<c r="${cellRef}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cellVal)}</t></is></c>`;
      }
    }

    rowXml += `</row>`;
    sheetData += rowXml;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetData}
  </sheetData>
</worksheet>`;
}

/**
 * Package spreadsheet XML files into valid .xlsx archive.
 */
export async function packageXlsx(grid: string[][]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const worksheetXml = generateWorksheetXml(grid);

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const entries: ZipEntryIn[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypesXml) },
    { name: "_rels/.rels", data: enc.encode(rootRelsXml) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRelsXml) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(worksheetXml) },
  ];

  return writeZip(entries);
}

/**
 * Convert PDF document to an Excel .xlsx workbook.
 */
export async function convertPdfToExcel(
  pdfInput: Uint8Array | File,
  options: PdfToExcelOptions = {},
): Promise<Blob> {
  const bytes = pdfInput instanceof File ? new Uint8Array(await pdfInput.arrayBuffer()) : pdfInput;
  options.onProgress?.(10);

  const pdfDoc = await openPdfDocument(bytes);
  let xlsxBytes: Uint8Array;
  try {
    const numPages = pdfDoc.numPages;
    const masterGrid: string[][] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();

      const items = textContent.items.map((it: any) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        h: it.height,
      }));

      const pageGrid = clusterTextIntoGrid(items, options.toleranceY ?? 5);
      if (pageGrid.length > 0) {
        if (masterGrid.length > 0) {
          // Blank row separator between pages
          masterGrid.push([`--- Page ${i} ---`]);
        }
        masterGrid.push(...pageGrid);
      }

      const pct = Math.round(15 + (i / numPages) * 70);
      options.onProgress?.(pct);
    }

    xlsxBytes = await packageXlsx(masterGrid);
  } finally {
    if (pdfDoc && typeof pdfDoc.destroy === "function") {
      await pdfDoc.destroy().catch(() => {});
    }
  }

  options.onProgress?.(100);

  return new Blob([new Uint8Array(xlsxBytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
