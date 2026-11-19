import type { CompressResult } from './types';

/**
 * Parse an SVG dimension value with units into user-unit numbers (CSS pixels).
 * Converts absolute units (pt, in, cm, mm, pc, px, unitless).
 * Rejects percentages (%) and relative font-relative units (em, rem, etc.) whose
 * user-unit equivalent cannot be established without an external context.
 */
export function parseSvgLength(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)\s*(px|pt|in|cm|mm|pc)?$/i);
  if (!match) return null;
  const num = Number.parseFloat(match[1]);
  if (Number.isNaN(num) || num <= 0) return null;
  const unit = (match[2] ?? "px").toLowerCase();
  switch (unit) {
    case "px":
      return num;
    case "pt":
      return (num * 4) / 3;
    case "in":
      return num * 96;
    case "cm":
      return (num * 96) / 2.54;
    case "mm":
      return (num * 96) / 25.4;
    case "pc":
      return num * 16;
    default:
      return null;
  }
}

export async function optimizeSvg(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  onProgress?.(5);
  let svg = await file.text();
  onProgress?.(15);

  // Remove XML declaration
  svg = svg.replace(/<\?xml[^?]*\?>/gi, '');

  // Remove comments
  let prev: string;
  do { prev = svg; svg = svg.replace(/<!--[\s\S]*?-->/g, ''); } while (svg !== prev);

  // Remove metadata, editor namespaces
  svg = svg.replace(/<metadata[\s\S]*?<\/metadata>/gi, '');
  svg = svg.replace(/<sodipodi:[^/]*(\/>|[\s\S]*?<\/sodipodi:[^>]*>)/gi, '');
  svg = svg.replace(/<inkscape:[^/]*(\/>|[\s\S]*?<\/inkscape:[^>]*>)/gi, '');
  svg = svg.replace(/\s+xmlns:(inkscape|sodipodi|sketch|dc|cc|rdf|xlink)="[^"]*"/gi, '');
  svg = svg.replace(/\s+(inkscape|sodipodi):[a-z-]+="[^"]*"/gi, '');
  onProgress?.(35);

  // Remove empty groups and defs
  svg = svg.replace(/<g[^>]*>\s*<\/g>/gi, '');
  svg = svg.replace(/<g\s*\/>/gi, '');
  svg = svg.replace(/<defs>\s*<\/defs>/gi, '');

  // Round long decimals (≥3 decimal places → 2)
  svg = svg.replace(/(\d+\.\d{3,})/g, (m) =>
    Number(Number.parseFloat(m).toFixed(2)).toString());
  onProgress?.(55);

  // Compact path data
  svg = svg.replace(/\s+([MmZzLlHhVvCcSsQqTtAa])/g, '$1');
  svg = svg.replace(/([MmZzLlHhVvCcSsQqTtAa])\s+/g, '$1');
  svg = svg.replace(/,\s+/g, ',');

  // Strip embedded scripts (security)
  do {
    prev = svg;
    svg  = svg.replace(/<script\b[^>]*(?:\/>|>[\s\S]*?<\/script(?:\s[^>]*)?>)/gi, '');
  } while (svg !== prev);

  // Strip inline event-handler attributes (onload, onclick, onmouseover, …)
  // and javascript: URIs — <script> removal alone leaves these XSS vectors
  // intact if the SVG is ever rendered inline (e.g. via innerHTML or <object>).
  do {
    prev = svg;
    svg = svg.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  } while (svg !== prev);
  svg = svg.replace(/(href|xlink:href)\s*=\s*"(\s*javascript:[^"]*)"/gi, '$1="#"');
  svg = svg.replace(/(href|xlink:href)\s*=\s*'(\s*javascript:[^']*)'/gi, "$1='#'");

  // Remove hidden elements
  do {
    prev = svg;
    svg = svg.replace(/<[^>]+(?:display\s*:\s*none|visibility\s*:\s*hidden)[^>]*(\/>|[\s\S]*?<\/[a-z]+>)/gi, '');
  } while (svg !== prev);

  // Re-strip embedded scripts in case hidden-element removal exposes new tags
  do {
    prev = svg;
    svg  = svg.replace(/<script\b[^>]*(?:\/>|>[\s\S]*?<\/script(?:\s[^>]*)?>)/gi, '');
  } while (svg !== prev);

  // Collapse whitespace
  svg = svg.replace(/>\s{2,}</g, '><');
  svg = svg.replace(/\s{2,}/g, ' ').trim();
  onProgress?.(80);

  // Add viewBox if missing (SVG viewBox coordinates must be unitless numbers in CSS pixels)
  if (!svg.includes('viewBox') && svg.includes('width=') && svg.includes('height=')) {
    const w = svg.match(/\bwidth=["']([^"']+)["']/i)?.[1];
    const h = svg.match(/\bheight=["']([^"']+)["']/i)?.[1];
    if (w && h) {
      const numW = parseSvgLength(w);
      const numH = parseSvgLength(h);
      if (numW !== null && numH !== null) {
        const fmtW = Number(numW.toFixed(2));
        const fmtH = Number(numH.toFixed(2));
        svg = svg.replace('<svg', `<svg viewBox="0 0 ${fmtW} ${fmtH}"`);
      }
    }
  }

  onProgress?.(100);
  const blob = new Blob([svg], { type: 'image/svg+xml' });

  return {
    blob,
    originalSize:     file.size,
    compressedSize:   blob.size,
    compressionRatio: file.size / blob.size,
    format:           'SVG (optimised · pure TS)',
  };
}
