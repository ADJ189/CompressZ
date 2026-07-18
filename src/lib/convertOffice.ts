/**
 * convertOffice.ts — DOCX and PPTX conversion for the Convert page.
 *
 * DOCX: uses mammoth.js (CDN) to turn the document into semantic HTML —
 * it handles headings, lists, tables, and embedded images well. That HTML
 * is then rasterised page-by-page with html2canvas and assembled into a
 * PDF with pdf-lib (already a dependency elsewhere in the app). This is
 * an image-based PDF (like every browser-side HTML→PDF approach without a
 * real layout engine) — text won't be selectable, but formatting is
 * preserved far better than a plain-text dump.
 *
 * PPTX: there is no reasonable client-side library for full slide
 * rendering (that needs a real layout engine for OOXML DrawingML). Rather
 * than pull in something that only partially works, this extracts each
 * slide's text runs directly from the underlying OOXML XML (a PPTX is
 * just a ZIP of XML files) using the project's own zip.ts, and produces
 * a clean, readable, correctly-ordered TEXT reconstruction — explicitly
 * not a visual/layout-accurate conversion. That limitation is surfaced in
 * the UI, not hidden.
 */
import { readZip, zipSupported } from './zip';

const MAMMOTH_ESM = 'https://cdn.jsdelivr.net/npm/mammoth@1.9.1/mammoth.browser.min.js';
const H2C_ESM      = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm';
const PDFLIB_ESM   = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

// ── mammoth loader (UMD script, exposes window.mammoth) ────────
let mammothLoading: Promise<any> | null = null;
function loadMammoth(): Promise<any> {
  if ((window as any).mammoth) return Promise.resolve((window as any).mammoth);
  if (mammothLoading) return mammothLoading;
  mammothLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MAMMOTH_ESM;
    s.onload  = () => {
      const m = (window as any).mammoth;
      if (m) resolve(m); else reject(new Error('mammoth not found on window after load'));
    };
    s.onerror = () => reject(new Error('Failed to load mammoth.js (docx reader)'));
    document.head.appendChild(s);
  }).catch(err => { mammothLoading = null; throw err; });
  return mammothLoading;
}

// ── DOCX ─────────────────────────────────────────────────────
export async function docxToHtml(file: File): Promise<string> {
  const mammoth = await loadMammoth();
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

export async function docxToText(file: File): Promise<string> {
  const mammoth = await loadMammoth();
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

export async function docxToPdf(file: File, onProgress?: (pct: number) => void): Promise<Blob> {
  onProgress?.(5);
  const html = await docxToHtml(file);
  onProgress?.(20);
  return htmlToPdf(html, onProgress, 20);
}

// ── PPTX ─────────────────────────────────────────────────────
interface SlideText { index: number; paragraphs: string[]; }

async function extractPptxSlides(file: File): Promise<SlideText[]> {
  if (!zipSupported()) {
    throw new Error('Reading .pptx needs ZIP support (CompressionStream) — please use a current version of Chrome, Firefox, Safari, or Edge.');
  }
  const entries = await readZip(await file.arrayBuffer());

  const slideNames = [...entries.keys()]
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    // Real-world PPTX files name slides sequentially in save order, so a
    // numeric sort on the filename reliably matches presentation order
    // without needing to walk presentation.xml.rels + sldIdLst.
    .sort((a, b) => {
      const na = +(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = +(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });

  if (!slideNames.length) throw new Error('No slides found — this file may not be a valid .pptx');

  const parser = new DOMParser();
  const slides: SlideText[] = [];

  for (let i = 0; i < slideNames.length; i++) {
    const xml  = new TextDecoder('utf-8').decode(entries.get(slideNames[i])!);
    const doc  = parser.parseFromString(xml, 'application/xml');
    // DrawingML paragraphs (<a:p>) each hold one or more text runs (<a:t>).
    // Prefer namespace-aware lookup; fall back to the literal "a:p"/"a:t"
    // tag names, since real PowerPoint output consistently uses the "a:"
    // prefix even though XML technically doesn't require it.
    const ns = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    let paraNodes = Array.from(doc.getElementsByTagNameNS(ns, 'p'));
    if (!paraNodes.length) paraNodes = Array.from(doc.getElementsByTagName('a:p'));

    const paragraphs: string[] = [];
    for (const p of paraNodes) {
      let tNodes = Array.from(p.getElementsByTagNameNS(ns, 't'));
      if (!tNodes.length) tNodes = Array.from(p.getElementsByTagName('a:t'));
      const line = tNodes.map(t => t.textContent ?? '').join('').trim();
      if (line) paragraphs.push(line);
    }
    slides.push({ index: i + 1, paragraphs });
  }
  return slides;
}

export async function pptxToText(file: File): Promise<string> {
  const slides = await extractPptxSlides(file);
  return slides
    .map(s => `--- Slide ${s.index} ---\n${s.paragraphs.join('\n') || '(no text content)'}`)
    .join('\n\n');
}

export async function pptxToPdf(file: File, onProgress?: (pct: number) => void): Promise<Blob> {
  onProgress?.(5);
  const slides = await extractPptxSlides(file);
  onProgress?.(25);

  const { PDFDocument, StandardFonts, rgb } = await import(/* @vite-ignore */ PDFLIB_ESM) as any;
  const pdfDoc = await PDFDocument.create();
  const font      = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 792, pageH = 612; // Letter, landscape — matches slide aspect better than portrait
  const margin = 50;
  const bodySize = 14, titleSize = 20, lineGap = 20;

  for (let i = 0; i < slides.length; i++) {
    const page = pdfDoc.addPage([pageW, pageH]);
    let y = pageH - margin;

    page.drawText(`Slide ${slides[i].index}`, {
      x: margin, y, size: titleSize, font: fontBold, color: rgb(0.1, 0.1, 0.1),
    });
    y -= titleSize + lineGap;
    page.drawLine({
      start: { x: margin, y: y + lineGap / 2 }, end: { x: pageW - margin, y: y + lineGap / 2 },
      thickness: 1, color: rgb(0.8, 0.8, 0.8),
    });

    const maxWidth = pageW - margin * 2;
    for (const para of slides[i].paragraphs) {
      for (const line of wrapText(para, font, bodySize, maxWidth)) {
        if (y < margin + bodySize) break; // slide has more text than one page — best-effort, not paginated further
        page.drawText(line, { x: margin, y, size: bodySize, font, color: rgb(0.15, 0.15, 0.15) });
        y -= bodySize + 8;
      }
      y -= 6;
    }
    if (!slides[i].paragraphs.length) {
      page.drawText('(no text content on this slide — images/shapes are not reconstructed)', {
        x: margin, y, size: bodySize, font, color: rgb(0.6, 0.6, 0.6),
      });
    }
    onProgress?.(25 + Math.round(((i + 1) / slides.length) * 70));
  }

  const bytes = await pdfDoc.save();
  onProgress?.(100);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── Shared: HTML → PDF via html2canvas + pdf-lib ────────────────
async function htmlToPdf(html: string, onProgress?: (pct: number) => void, startPct = 0): Promise<Blob> {
  const h2cMod = await import(/* @vite-ignore */ H2C_ESM) as any;
  const html2canvas = h2cMod.default ?? h2cMod;
  const { PDFDocument } = await import(/* @vite-ignore */ PDFLIB_ESM) as any;
  onProgress?.(startPct + 10);

  // A4 at 96dpi ≈ 794×1123 CSS px — render off-screen at that width so the
  // page-slicing math below lines up with real A4 proportions.
  const PAGE_W_PX = 794, PAGE_H_PX = 1123;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${PAGE_W_PX}px;background:#fff;
    font-family:Georgia,'Times New Roman',serif;color:#111;font-size:15px;line-height:1.55;
    padding:56px 60px;box-sizing:border-box;`;
  container.innerHTML = `<style>
    img{max-width:100%;height:auto}
    table{border-collapse:collapse;width:100%}
    td,th{border:1px solid #ccc;padding:4px 8px}
    h1,h2,h3{color:#111;margin-top:1.2em}
  </style>${html}`;
  document.body.appendChild(container);

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
  } finally {
    document.body.removeChild(container);
  }
  onProgress?.(startPct + 40);

  const pdfDoc = await PDFDocument.create();
  const scale       = canvas.width / PAGE_W_PX;
  const pageHpx     = PAGE_H_PX * scale;
  const totalPages  = Math.max(1, Math.ceil(canvas.height / pageHpx));
  const pagePtW = 595.28, pagePtH = 841.89; // A4 in PDF points

  for (let i = 0; i < totalPages; i++) {
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width  = canvas.width;
    sliceCanvas.height = Math.min(pageHpx, canvas.height - i * pageHpx);
    const ctx = sliceCanvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, -i * pageHpx);

    const blob = await new Promise<Blob>((res, rej) =>
      sliceCanvas.toBlob(b => b ? res(b) : rej(new Error('toBlob returned null')), 'image/jpeg', 0.9));
    const jpg = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));

    const page = pdfDoc.addPage([pagePtW, pagePtH]);
    const drawH = (sliceCanvas.height / canvas.width) * pagePtW;
    page.drawImage(jpg, { x: 0, y: pagePtH - drawH, width: pagePtW, height: drawH });

    sliceCanvas.width = 0; sliceCanvas.height = 0;
    onProgress?.(startPct + 40 + Math.round(((i + 1) / totalPages) * 50));
  }
  canvas.width = 0; canvas.height = 0;

  const bytes = await pdfDoc.save();
  onProgress?.(100);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}
