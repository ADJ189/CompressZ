import { assert, assertEquals } from "./assert.ts";
import {
  validatePdfBuffer,
  computeSha256,
  reconstructReadingOrder,
  blocksToMarkdown,
  formatGfmTable,
  formatHtmlTable,
  detectRepeatedHeadersFooters,
  type ExtractedBlock,
} from "../src/lib/pdfToMarkdown.ts";

Deno.test("pdfToMarkdown: validatePdfBuffer checks headers and size", () => {
  const tooSmall = new Uint8Array([1, 2, 3]);
  assertEquals(validatePdfBuffer(tooSmall).valid, false);

  const invalidHeader = new TextEncoder().encode("NOT_A_PDF_DOCUMENT_AT_ALL_HERE_TESTING_PADDING_1234567890");
  assertEquals(validatePdfBuffer(invalidHeader).valid, false);

  const validHeader = new TextEncoder().encode("%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
  assertEquals(validatePdfBuffer(validHeader).valid, true);
});

Deno.test("pdfToMarkdown: computeSha256 computes deterministic 64-char hex string", async () => {
  const bytes = new TextEncoder().encode("CompressZ deterministic PDF test payload");
  const hash = await computeSha256(bytes);
  assertEquals(hash.length, 64);
  const hashAgain = await computeSha256(bytes);
  assertEquals(hash, hashAgain);
});

Deno.test("pdfToMarkdown: reconstructReadingOrder extracts headings, paragraphs, and lists", () => {
  const items = [
    { str: "Document Title", x: 50, y: 750, w: 200, h: 24, fontSize: 24, fontName: "Helvetica-Bold" },
    { str: "This is introductory text.", x: 50, y: 700, w: 180, h: 12, fontSize: 12, fontName: "Helvetica" },
    { str: "- First item in bullet list", x: 50, y: 650, w: 150, h: 12, fontSize: 12, fontName: "Helvetica" },
    { str: "- Second item in bullet list", x: 50, y: 620, w: 160, h: 12, fontSize: 12, fontName: "Helvetica" },
  ];

  const blocks = reconstructReadingOrder(items, 600, 800);
  assert(blocks.length >= 3);

  const headingBlock = blocks.find((b) => b.type === "heading");
  assert(headingBlock !== undefined);
  assertEquals(headingBlock?.text, "Document Title");
  assertEquals(headingBlock?.level, 1);

  const listBlocks = blocks.filter((b) => b.type === "list-item");
  assertEquals(listBlocks.length, 2);
});

Deno.test("pdfToMarkdown: blocksToMarkdown generates clean Markdown with page anchors", () => {
  const blocks: ExtractedBlock[] = [
    {
      type: "heading",
      pageNumber: 1,
      readingOrder: 0,
      text: "Introduction",
      level: 2,
      source: "native",
      confidence: 100,
    },
    {
      type: "paragraph",
      pageNumber: 1,
      readingOrder: 1,
      text: "This is a paragraph of extracted text.",
      source: "native",
      confidence: 100,
    },
    {
      type: "figure",
      pageNumber: 1,
      readingOrder: 2,
      text: "Visual Preview",
      assetPath: "assets/pages/page-0001.png",
      source: "visual-preservation",
      confidence: 100,
    },
  ];

  const md = blocksToMarkdown(blocks, 1);
  assert(md.includes("## Page 1"));
  assert(md.includes("## Introduction"));
  assert(md.includes("This is a paragraph of extracted text."));
  assert(md.includes("![Figure on page 1](assets/pages/page-0001.png)"));
});

Deno.test("pdfToMarkdown: blocksToMarkdown formats standalone formulas into LaTeX without image dependencies", () => {
  const blocks: ExtractedBlock[] = [
    {
      type: "formula",
      pageNumber: 1,
      readingOrder: 0,
      text: "E = mc^2",
      assetPath: "assets/figures/eq-001.png",
      source: "visual-preservation",
      confidence: 100,
    },
    {
      type: "paragraph",
      pageNumber: 1,
      readingOrder: 1,
      text: "Page 1 of 10",
      source: "native",
      confidence: 100,
    },
  ];

  // In standalone mode (includeVisualAssets = false):
  const md = blocksToMarkdown(blocks, 1, {
    includeVisualAssets: false,
    formulaFormat: "latex",
    stripHeadersFooters: true,
  });

  assert(md.includes("$$"));
  assert(md.includes("E = mc^2"));
  assert(!md.includes("![Formula"));
  // Page number was stripped
  assert(!md.includes("Page 1 of 10"));
});

Deno.test("pdfToMarkdown: formatGfmTable creates valid pipe table with separator row", () => {
  const rawTable = "Name\tRole\tScore\nAlice\tEngineer\t98\nBob\tDesigner\t95";
  const gfm = formatGfmTable(rawTable);
  assert(gfm.includes("| Name | Role | Score |"));
  assert(gfm.includes("| --- | --- | --- |"));
  assert(gfm.includes("| Alice | Engineer | 98 |"));
});

Deno.test("pdfToMarkdown: F1 pagebreak count equals pageCount - 1", () => {
  const pages = [1, 2, 3].map((pageNum) =>
    blocksToMarkdown(
      [
        {
          type: "paragraph",
          pageNumber: pageNum,
          readingOrder: 0,
          text: `Paragraph on page ${pageNum}`,
          source: "native",
          confidence: 100,
        },
      ],
      pageNum,
      { pageDelimiters: "pagebreak" },
    ),
  );
  // Simulating document join with pageDelimiters === "pagebreak"
  const delimiter = "\n\n<!-- pagebreak -->\n\n";
  const joined = pages.join(delimiter);
  const matches = joined.match(/<!-- pagebreak -->/g) || [];
  assertEquals(matches.length, 2); // 3 pages -> exactly 2 pagebreaks
  // Neither individual page contains a pagebreak
  assert(!pages[0].includes("<!-- pagebreak -->"));
  assert(!pages[1].includes("<!-- pagebreak -->"));
  assert(!pages[2].includes("<!-- pagebreak -->"));
});

Deno.test("pdfToMarkdown: F2 detects and strips repeated headers and footers across pages", () => {
  const page1: ExtractedBlock[] = [
    { type: "paragraph", pageNumber: 1, readingOrder: 0, text: "ACME Quarterly Report", source: "native", confidence: 100 },
    { type: "heading", pageNumber: 1, readingOrder: 1, text: "Section 1", source: "native", confidence: 100 },
    { type: "paragraph", pageNumber: 1, readingOrder: 2, text: "Page content", source: "native", confidence: 100 },
    { type: "paragraph", pageNumber: 1, readingOrder: 3, text: "Confidential & Proprietary", source: "native", confidence: 100 },
  ];
  const page2: ExtractedBlock[] = [
    { type: "paragraph", pageNumber: 2, readingOrder: 0, text: "ACME Quarterly Report", source: "native", confidence: 100 },
    { type: "heading", pageNumber: 2, readingOrder: 1, text: "Section 2", source: "native", confidence: 100 },
    { type: "paragraph", pageNumber: 2, readingOrder: 2, text: "More page content", source: "native", confidence: 100 },
    { type: "paragraph", pageNumber: 2, readingOrder: 3, text: "Confidential & Proprietary", source: "native", confidence: 100 },
  ];

  const repeated = detectRepeatedHeadersFooters([page1, page2]);
  assert(repeated.has("acme quarterly report"));
  assert(repeated.has("confidential & proprietary"));

  const md1 = blocksToMarkdown(page1, 1, { stripHeadersFooters: true, repeatedHeadersFooters: repeated });
  assert(!md1.includes("ACME Quarterly Report"));
  assert(!md1.includes("Confidential & Proprietary"));
  assert(md1.includes("Section 1"));
  assert(md1.includes("Page content"));
});

Deno.test("pdfToMarkdown: F3 formats HTML tables and HTML math tags", () => {
  const tableText = "A\tB\n1\t2";
  const htmlTable = formatHtmlTable(tableText);
  assert(htmlTable.includes("<table>"));
  assert(htmlTable.includes("<th>A</th>"));
  assert(htmlTable.includes("<td>1</td>"));

  const blocks: ExtractedBlock[] = [
    { type: "table", pageNumber: 1, readingOrder: 0, text: tableText, source: "native", confidence: 100 },
    { type: "formula", pageNumber: 1, readingOrder: 1, text: "a^2 + b^2 = c^2", source: "native", confidence: 100 },
  ];
  const md = blocksToMarkdown(blocks, 1, { tableFormat: "html", formulaFormat: "html" });
  assert(md.includes("<table>"));
  assert(md.includes('<math display="block"><mrow><mtext>a^2 + b^2 = c^2</mtext></mrow></math>'));
});

Deno.test("pdfToMarkdown: F13 formatGfmTable pads short rows and escapes pipes", () => {
  // Ragged pipe-delimited table with unescaped pipes inside cells
  const ragged = "| Col 1 | Col 2 | Col 3 |\n| Val A | Val B |\n| Single |";
  const formatted = formatGfmTable(ragged);
  const rows = formatted.split("\n");
  assertEquals(rows.length, 4); // header + sep + 2 data rows
  for (const r of rows) {
    const colCount = r.split(/(?<!\\)\|/).length - 2;
    assertEquals(colCount, 3);
  }

  // Cell with pipe character
  const withPipe = "Key\tValue\nChoice\tA | B";
  const gfmWithPipe = formatGfmTable(withPipe);
  assert(gfmWithPipe.includes("A \\| B"));
});
