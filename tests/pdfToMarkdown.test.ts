import { assert, assertEquals } from "./assert.ts";
import {
  validatePdfBuffer,
  computeSha256,
  reconstructReadingOrder,
  blocksToMarkdown,
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
