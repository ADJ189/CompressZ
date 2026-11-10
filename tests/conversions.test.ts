/**
 * conversions.test.ts — Unit tests for two-way Office conversion logic.
 */

import { assertEquals } from "./assert.ts";
import {
  buildHeadingXml,
  buildParagraphXml,
  buildListItemXml,
  generateDocumentXml,
  packageDocx,
} from "../src/lib/conversions/pdfToWord.ts";
import {
  columnToLetter,
  clusterTextIntoGrid,
  generateWorksheetXml,
  packageXlsx,
} from "../src/lib/conversions/pdfToExcel.ts";
import {
  generateSlideXml,
  packagePptx,
} from "../src/lib/conversions/pdfToPpt.ts";
import {
  parseSharedStringsXml,
  parseWorksheetXml,
  gridToHtmlTable,
} from "../src/lib/conversions/excelToPdf.ts";
import {
  getLibreOfficeStatus,
  isLibreOfficeLoaded,
} from "../src/lib/conversions/libreOfficeWasm.ts";

Deno.test("conversions: pdfToWord generates valid WordprocessingML tags and packages .docx", async () => {
  const heading = buildHeadingXml("Test Title", 1);
  assertEquals(heading.includes("Test Title"), true);
  assertEquals(heading.includes("Heading1"), true);

  const para = buildParagraphXml("This is paragraph content.");
  assertEquals(para.includes("This is paragraph content."), true);

  const bullet = buildListItemXml("- First item");
  assertEquals(bullet.includes("First item"), true);
  assertEquals(bullet.includes("&#8226;"), true);

  const docXml = generateDocumentXml([
    [
      { type: "heading" as const, text: "Doc Heading", readingOrder: 0, pageNumber: 1, source: "native" as const },
      { type: "paragraph" as const, text: "Body text", readingOrder: 1, pageNumber: 1, source: "native" as const },
    ],
  ]);
  assertEquals(docXml.includes("<w:document"), true);
  assertEquals(docXml.includes("Doc Heading"), true);

  // Package into binary OOXML DOCX
  const docxBytes = await packageDocx([
    [{ type: "paragraph" as const, text: "Hello Docx", readingOrder: 0, pageNumber: 1, source: "native" as const }],
  ]);
  // DOCX begins with PK\x03\x04 zip signature
  assertEquals(docxBytes[0], 0x50);
  assertEquals(docxBytes[1], 0x4b);
  assertEquals(docxBytes[2], 0x03);
  assertEquals(docxBytes[3], 0x04);
});

Deno.test("conversions: pdfToExcel column mapping, text clustering, and .xlsx packaging", async () => {
  assertEquals(columnToLetter(0), "A");
  assertEquals(columnToLetter(1), "B");
  assertEquals(columnToLetter(25), "Z");
  assertEquals(columnToLetter(26), "AA");

  const sampleItems = [
    { str: "Product", x: 50, y: 700, w: 60, h: 12 },
    { str: "Price", x: 200, y: 700, w: 40, h: 12 },
    { str: "Widget", x: 50, y: 680, w: 50, h: 12 },
    { str: "19.99", x: 200, y: 680, w: 30, h: 12 },
  ];

  const grid = clusterTextIntoGrid(sampleItems, 5);
  assertEquals(grid.length, 2);
  assertEquals(grid[0].includes("Product"), true);
  assertEquals(grid[0].includes("Price"), true);

  const sheetXml = generateWorksheetXml(grid);
  assertEquals(sheetXml.includes("<worksheet"), true);
  assertEquals(sheetXml.includes("<row r=\"1\">"), true);

  // Package into binary OOXML XLSX
  const xlsxBytes = await packageXlsx(grid);
  assertEquals(xlsxBytes[0], 0x50);
  assertEquals(xlsxBytes[1], 0x4b);
  assertEquals(xlsxBytes[2], 0x03);
  assertEquals(xlsxBytes[3], 0x04);
});

Deno.test("conversions: pdfToPpt slide generation and .pptx packaging", async () => {
  const slideBlocks = [
    [
      { type: "heading" as const, text: "Slide 1 Title", readingOrder: 0, pageNumber: 1, source: "native" as const },
      { type: "paragraph" as const, text: "Slide 1 body paragraph", readingOrder: 1, pageNumber: 1, source: "native" as const },
    ],
  ];

  const slideXml = generateSlideXml(slideBlocks[0], 1);
  assertEquals(slideXml.includes("<p:sld"), true);
  assertEquals(slideXml.includes("Slide 1 Title"), true);

  const pptxBytes = await packagePptx(slideBlocks);
  assertEquals(pptxBytes[0], 0x50);
  assertEquals(pptxBytes[1], 0x4b);
  assertEquals(pptxBytes[2], 0x03);
  assertEquals(pptxBytes[3], 0x04);
});

Deno.test("conversions: excelToPdf shared strings and sheet parser", () => {
  const sstXml = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <si><t>Header 1</t></si>
    <si><t>Header 2</t></si>
  </sst>`;
  const strings = parseSharedStringsXml(sstXml);
  assertEquals(strings, ["Header 1", "Header 2"]);

  const wsXml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetData>
      <row r="1">
        <c r="A1" t="s"><v>0</v></c>
        <c r="B1" t="s"><v>1</v></c>
      </row>
      <row r="2">
        <c r="A2"><v>100</v></c>
        <c r="B2"><v>200</v></c>
      </row>
    </sheetData>
  </worksheet>`;

  const grid = parseWorksheetXml(wsXml, strings);
  assertEquals(grid.length, 2);
  assertEquals(grid[0], ["Header 1", "Header 2"]);
  assertEquals(grid[1], ["100", "200"]);

  const tableHtml = gridToHtmlTable(grid, "Test Sheet");
  assertEquals(tableHtml.includes("<table"), true);
  assertEquals(tableHtml.includes("Header 1"), true);
  assertEquals(tableHtml.includes("200"), true);
});

Deno.test("conversions: libreOfficeWasm maintains lazy loading status", () => {
  assertEquals(isLibreOfficeLoaded(), false);
  const status = getLibreOfficeStatus();
  assertEquals(status.loaded, false);
  assertEquals(status.loading, false);
});
