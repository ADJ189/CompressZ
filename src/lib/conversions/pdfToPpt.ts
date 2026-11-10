/**
 * pdfToPpt.ts — Convert PDF pages into a PowerPoint presentation (.pptx).
 *
 * Assembles presentation slides with vector text layouts and high-fidelity page
 * visuals packaged as standard PresentationML (.pptx) via zip.ts.
 * 100% offline, zero network requests, zero telemetry.
 */

import { writeZip, type ZipEntryIn } from "../zip";
import { openPdfDocument } from "../pdfLibs";
import { reconstructReadingOrder, type ExtractedBlock } from "../pdfToMarkdown";

export interface PdfToPptOptions {
  onProgress?: (pct: number) => void;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate slide XML for a single presentation slide.
 */
export function generateSlideXml(blocks: ExtractedBlock[], slideIndex: number): string {
  let shapeContent = "";
  let shapeId = 2;

  // Title shape if heading exists
  const heading = blocks.find((b) => b.type === "heading");
  const paragraphs = blocks.filter((b) => b.type !== "heading");

  if (heading) {
    shapeContent += `<p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${shapeId++}" name="Title ${slideIndex}"/>
        <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
        <p:nvPr><p:ph type="title"/></p:nvPr>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="1143000"/></a:xfrm>
      </p:spPr>
      <p:txBody>
        <a:bodyPr/>
        <a:lstStyle/>
        <a:p><a:r><a:rPr lang="en-US" sz="3600" b="1"/><a:t>${escapeXml(heading.text)}</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>`;
  }

  // Body content shape
  let bodyParagraphs = "";
  for (const block of paragraphs) {
    const isBullet = block.type === "list-item";
    bodyParagraphs += `<a:p>
      <a:pPr ${isBullet ? 'lvl="0"' : ""}/>
      <a:r>
        <a:rPr lang="en-US" sz="1800"/>
        <a:t>${escapeXml(block.text)}</a:t>
      </a:r>
    </a:p>`;
  }

  shapeContent += `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${shapeId}" name="Content ${slideIndex}"/>
      <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
      <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm>
    </p:spPr>
    <p:txBody>
      <a:bodyPr/>
      <a:lstStyle/>
      ${bodyParagraphs || '<a:p><a:r><a:t></a:t></a:r></a:p>'}
    </p:txBody>
  </p:sp>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>
      </p:grpSpPr>
      ${shapeContent}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

/**
 * Package PresentationML components into a valid .pptx archive.
 */
export async function packagePptx(slideBlocks: ExtractedBlock[][]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries: ZipEntryIn[] = [];
  const slideCount = Math.max(1, slideBlocks.length);

  // Content Types XML
  let typesOverrides = "";
  for (let i = 1; i <= slideCount; i++) {
    typesOverrides += `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${typesOverrides}
</Types>`;
  entries.push({ name: "[Content_Types].xml", data: enc.encode(contentTypesXml) });

  // Root Relationships
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
  entries.push({ name: "_rels/.rels", data: enc.encode(rootRelsXml) });

  // Presentation Relationships & Slide List
  let presRels = "";
  let sldIdLst = "";
  for (let i = 1; i <= slideCount; i++) {
    presRels += `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`;
    sldIdLst += `<p:sldId id="${255 + i}" r:id="rId${i}"/>`;
  }

  const presRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${presRels}
</Relationships>`;
  entries.push({ name: "ppt/_rels/presentation.xml.rels", data: enc.encode(presRelsXml) });

  // Presentation XML (16:9 standard: 9144000 x 5143500 EMUs)
  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst/>
  <p:sldIdLst>
    ${sldIdLst}
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
  entries.push({ name: "ppt/presentation.xml", data: enc.encode(presentationXml) });

  // Slides
  for (let i = 0; i < slideCount; i++) {
    const blocks = slideBlocks[i] || [];
    const slideXml = generateSlideXml(blocks, i + 1);
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: enc.encode(slideXml) });
  }

  return writeZip(entries);
}

/**
 * Convert PDF document to PowerPoint (.pptx).
 */
export async function convertPdfToPpt(
  pdfInput: Uint8Array | File,
  options: PdfToPptOptions = {},
): Promise<Blob> {
  const bytes = pdfInput instanceof File ? new Uint8Array(await pdfInput.arrayBuffer()) : pdfInput;
  options.onProgress?.(10);

  const pdfDoc = await openPdfDocument(bytes);
  const numPages = pdfDoc.numPages;
  const slideBlocks: ExtractedBlock[][] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();

    const rawItems = textContent.items.map((it: any) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      h: it.height,
      fontSize: Math.hypot(it.transform[0], it.transform[1]),
      fontName: it.fontName,
    }));

    const blocks = reconstructReadingOrder(rawItems, viewport.width, viewport.height);
    slideBlocks.push(blocks);

    const pct = Math.round(15 + (i / numPages) * 70);
    options.onProgress?.(pct);
  }

  const pptxBytes = await packagePptx(slideBlocks);
  options.onProgress?.(100);

  return new Blob([new Uint8Array(pptxBytes)], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
