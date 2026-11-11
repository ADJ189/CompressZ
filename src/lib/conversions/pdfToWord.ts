/**
 * pdfToWord.ts — Convert PDF documents to Microsoft Word (.docx).
 *
 * Reconstructs semantic structure (headings, paragraphs, bullet lists, page breaks)
 * from PDF text layout and builds a standards-compliant OpenXML (OOXML) .docx file
 * using CompressZ's in-memory zip engine. 100% offline, zero external dependencies.
 */

import { writeZip, type ZipEntryIn } from "../zip";
import type { ExtractedBlock } from "../pdfToMarkdown";
import { escapeXml, extractPdfPageBlocks } from "./common";
export { escapeXml };

export interface PdfToWordOptions {
  title?: string;
  onProgress?: (pct: number) => void;
}

/**
 * Build WordprocessingML paragraph for a heading.
 */
export function buildHeadingXml(text: string, level: number = 1): string {
  const safeLevel = Math.max(1, Math.min(3, level));
  return `<w:p><w:pPr><w:pStyle w:val="Heading${safeLevel}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${safeLevel === 1 ? "32" : safeLevel === 2 ? "28" : "24"}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * Build WordprocessingML paragraph for normal text.
 */
export function buildParagraphXml(text: string): string {
  return `<w:p><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * Build WordprocessingML paragraph for bullet list items.
 */
export function buildListItemXml(text: string): string {
  const cleanText = text.replace(/^[-*•]\s*/, "");
  return `<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:after="80"/></w:pPr><w:r><w:t xml:space="preserve">&#8226; </w:t></w:r><w:r><w:t xml:space="preserve">${escapeXml(cleanText)}</w:t></w:r></w:p>`;
}

/**
 * Build WordprocessingML page break.
 */
export function buildPageBreakXml(): string {
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
}

/**
 * Generate complete word/document.xml from extracted blocks.
 */
export function generateDocumentXml(pages: ExtractedBlock[][]): string {
  let bodyContent = "";

  for (let p = 0; p < pages.length; p++) {
    const blocks = pages[p];
    for (const block of blocks) {
      if (block.type === "heading") {
        bodyContent += buildHeadingXml(block.text, block.level || 1);
      } else if (block.type === "list-item") {
        bodyContent += buildListItemXml(block.text);
      } else if (block.type === "paragraph") {
        bodyContent += buildParagraphXml(block.text);
      } else {
        bodyContent += buildParagraphXml(block.text);
      }
    }
    // Add page break between pages (except the last page)
    if (p < pages.length - 1) {
      bodyContent += buildPageBreakXml();
    }
  }

  // Final section properties (standard letter/A4 with 1-inch margins)
  const sectPr = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyContent}
    ${sectPr}
  </w:body>
</w:document>`;
}

/**
 * Generate word/styles.xml containing definitions for standard styles.
 */
export function generateStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:lang w:val="en-US"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="240" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="2E74B5"/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="180" w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="2E74B5"/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="120" w:after="40"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="1F4D78"/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

/**
 * Package OOXML components into a valid .docx Uint8Array.
 */
export async function packageDocx(pages: ExtractedBlock[][]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const documentXml = generateDocumentXml(pages);
  const stylesXml = generateStylesXml();

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries: ZipEntryIn[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypesXml) },
    { name: "_rels/.rels", data: enc.encode(rootRelsXml) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(docRelsXml) },
    { name: "word/document.xml", data: enc.encode(documentXml) },
    { name: "word/styles.xml", data: enc.encode(stylesXml) },
  ];

  return writeZip(entries);
}

/**
 * Convert a PDF byte buffer or File into an editable .docx document.
 */
export async function convertPdfToWord(
  pdfInput: Uint8Array | File,
  options: PdfToWordOptions = {},
): Promise<Blob> {
  const allPageBlocks = await extractPdfPageBlocks(pdfInput, options.onProgress);
  const docxBytes = await packageDocx(allPageBlocks);
  options.onProgress?.(100);

  return new Blob([new Uint8Array(docxBytes)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
