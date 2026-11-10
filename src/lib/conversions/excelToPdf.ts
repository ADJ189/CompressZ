/**
 * excelToPdf.ts — Convert Excel (.xlsx) workbooks to PDF.
 *
 * Parses SpreadsheetML worksheets and shared strings from the OOXML container
 * using in-memory zip.ts, generates a structured HTML table representation,
 * and compiles into PDF via htmlToPdf. 100% offline, zero server uploads.
 */

import { readZip, zipSupported } from "../zip";
import { htmlToPdf } from "../convertOffice";

export interface ExcelToPdfOptions {
  onProgress?: (pct: number) => void;
  title?: string;
}

/**
 * Extract shared strings table from xl/sharedStrings.xml.
 */
export function parseSharedStringsXml(xmlStr: string): string[] {
  const strings: string[] = [];
  // Match <si>...</si> entries and extract text from <t>
  const siRegex = /<si\b[^>]*>(.*?)<\/si>/gs;
  let match: RegExpExecArray | null;

  while ((match = siRegex.exec(xmlStr)) !== null) {
    const siContent = match[1];
    const tRegex = /<t\b[^>]*>(.*?)<\/t>/gs;
    let tMatch: RegExpExecArray | null;
    let combined = "";

    while ((tMatch = tRegex.exec(siContent)) !== null) {
      combined += tMatch[1];
    }
    strings.push(combined);
  }

  return strings;
}

/**
 * Parse a worksheet XML string into a 2D string grid.
 */
export function parseWorksheetXml(xmlStr: string, sharedStrings: string[]): string[][] {
  const grid: string[][] = [];
  const rowRegex = /<row\b[^>]*r="(\d+)"[^>]*>(.*?)<\/row>/gs;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(xmlStr)) !== null) {
    const _rowNum = parseInt(rowMatch[1], 10);
    const rowContent = rowMatch[2];
    const cellRegex = /<c\b[^>]*r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>(.*?)<\/c>/gs;
    let cMatch: RegExpExecArray | null;
    const rowCells: { col: number; val: string }[] = [];

    while ((cMatch = cellRegex.exec(rowContent)) !== null) {
      const colLetters = cMatch[1];
      const type = cMatch[2];
      const cellBody = cMatch[3];

      let colIdx = 0;
      for (let i = 0; i < colLetters.length; i++) {
        colIdx = colIdx * 26 + (colLetters.charCodeAt(i) - 64);
      }
      colIdx -= 1; // 0-based

      let val = "";
      if (type === "s") {
        // Shared string index
        const vMatch = /<v>(.*?)<\/v>/.exec(cellBody);
        if (vMatch) {
          const sIdx = parseInt(vMatch[1], 10);
          val = sharedStrings[sIdx] ?? "";
        }
      } else if (type === "inlineStr") {
        const tMatch = /<t\b[^>]*>(.*?)<\/t>/.exec(cellBody);
        val = tMatch ? tMatch[1] : "";
      } else {
        const vMatch = /<v>(.*?)<\/v>/.exec(cellBody);
        val = vMatch ? vMatch[1] : "";
      }

      rowCells.push({ col: colIdx, val });
    }

    if (rowCells.length > 0) {
      const maxCol = Math.max(...rowCells.map((c) => c.col));
      const cells: string[] = Array(maxCol + 1).fill("");
      for (const c of rowCells) {
        cells[c.col] = c.val;
      }
      grid.push(cells);
    }
  }

  return grid;
}

/**
 * Convert 2D cell grid into a clean, printable HTML table string.
 */
export function gridToHtmlTable(grid: string[][], title?: string): string {
  let html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:20px;">`;
  if (title) {
    html += `<h2 style="margin-bottom:16px;color:#1e293b;">${title}</h2>`;
  }

  html += `<table style="border-collapse:collapse;width:100%;font-size:12px;text-align:left;">`;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    const isHeader = r === 0;
    const tag = isHeader ? "th" : "td";
    const bg = isHeader ? "background:#f1f5f9;font-weight:600;color:#0f172a;" : r % 2 === 1 ? "background:#f8fafc;" : "background:#ffffff;";

    html += `<tr style="${bg}">`;
    for (const cell of row) {
      html += `<${tag} style="border:1px solid #cbd5e1;padding:6px 10px;word-break:break-word;">${cell || "&nbsp;"}</${tag}>`;
    }
    html += `</tr>`;
  }

  html += `</table></div>`;
  return html;
}

/**
 * Convert Excel workbook (.xlsx) to PDF.
 */
export async function convertExcelToPdf(
  file: File,
  options: ExcelToPdfOptions = {},
): Promise<Blob> {
  if (!zipSupported()) {
    throw new Error("Browser does not support CompressionStream for reading Excel archives.");
  }
  options.onProgress?.(5);

  const entries = await readZip(await file.arrayBuffer());
  options.onProgress?.(20);

  // Parse shared strings if present
  let sharedStrings: string[] = [];
  const sstBytes = entries.get("xl/sharedStrings.xml");
  if (sstBytes) {
    const sstXml = new TextDecoder().decode(sstBytes);
    sharedStrings = parseSharedStringsXml(sstXml);
  }

  // Parse first worksheet
  const sheetBytes = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetBytes) {
    throw new Error("No worksheet found in Excel file.");
  }

  const sheetXml = new TextDecoder().decode(sheetBytes);
  const grid = parseWorksheetXml(sheetXml, sharedStrings);

  options.onProgress?.(40);
  const tableHtml = gridToHtmlTable(grid, options.title || file.name.replace(/\.xlsx$/i, ""));

  return htmlToPdf(tableHtml, options.onProgress, 40);
}
