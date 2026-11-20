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

function removeHiddenElements(svg: string): string {
  const hiddenDecl = /\b(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;
  if (!hiddenDecl.test(svg)) return svg;

  let prev: string;
  do {
    prev = svg;
    let searchIdx = 0;
    while (searchIdx < svg.length) {
      const match = svg.slice(searchIdx).match(hiddenDecl);
      if (!match || match.index === undefined) break;

      const declIdx = searchIdx + match.index;
      const tagOpen = svg.lastIndexOf("<", declIdx);
      if (tagOpen === -1) {
        searchIdx = declIdx + match[0].length;
        continue;
      }

      // If there is a '>' between tagOpen and declIdx, decl is not inside tag attributes
      const closeBeforeDecl = svg.indexOf(">", tagOpen);
      if (closeBeforeDecl !== -1 && closeBeforeDecl < declIdx) {
        searchIdx = declIdx + match[0].length;
        continue;
      }

      const tagClose = svg.indexOf(">", declIdx);
      if (tagClose === -1) break;

      const tagHeader = svg.slice(tagOpen + 1, tagClose);
      const nameMatch = tagHeader.match(/^([a-z0-9:-]+)/i);
      if (!nameMatch) {
        searchIdx = tagClose + 1;
        continue;
      }
      const tagName = nameMatch[1];
      if (tagName.toLowerCase() === "svg") {
        searchIdx = tagClose + 1;
        continue;
      }

      if (tagHeader.trimEnd().endsWith("/")) {
        svg = svg.slice(0, tagOpen) + svg.slice(tagClose + 1);
        searchIdx = tagOpen;
        continue;
      }

      const closePattern = new RegExp(`</${tagName}(?:\\s[^>]*)?>`, "i");
      const rest = svg.slice(tagClose + 1);
      const closeMatch = rest.match(closePattern);
      if (closeMatch && closeMatch.index !== undefined) {
        const endPos = tagClose + 1 + closeMatch.index + closeMatch[0].length;
        svg = svg.slice(0, tagOpen) + svg.slice(endPos);
        searchIdx = tagOpen;
      } else {
        searchIdx = tagClose + 1;
      }
    }
  } while (svg !== prev);
  return svg;
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
  svg = svg.replace(/<sodipodi:[^>]*\/>|<sodipodi:[^>]*>[\s\S]*?<\/sodipodi:[^>]*>/gi, '');
  svg = svg.replace(/<inkscape:[^>]*\/>|<inkscape:[^>]*>[\s\S]*?<\/inkscape:[^>]*>/gi, '');
  svg = svg.replace(/\s?\bxmlns:(inkscape|sodipodi|sketch|dc|cc|rdf|xlink)="[^"]*"/gi, '');
  svg = svg.replace(/\s?\b(inkscape|sodipodi):[a-z-]+="[^"]*"/gi, '');
  onProgress?.(35);

  // Remove empty groups and defs
  svg = svg.replace(/<g[^>]*>\s*<\/g>/gi, '');
  svg = svg.replace(/<g\s*\/>/gi, '');
  svg = svg.replace(/<defs>\s*<\/defs>/gi, '');

  // Round long decimals (≥3 decimal places → 2)
  svg = svg.replace(/\d+\.\d{3,}/g, (m) =>
    Number(Number.parseFloat(m).toFixed(2)).toString());
  onProgress?.(55);

  // Compact path data inside d attributes
  svg = svg.replace(/\bd="([^"]*)"|\bd='([^']*)'/gi, (_m, dDouble, dSingle) => {
    const isDouble = dDouble !== undefined;
    const quote = isDouble ? '"' : "'";
    const d = isDouble ? dDouble : dSingle;
    const compacted = d
      .replace(/\s+([MmZzLlHhVvCcSsQqTtAa])/g, '$1')
      .replace(/([MmZzLlHhVvCcSsQqTtAa])\s+/g, '$1')
      .replace(/,\s+/g, ',');
    return `d=${quote}${compacted}${quote}`;
  });

  // Strip embedded scripts and dangerous foreignObject HTML embeddings (security)
  do {
    prev = svg;
    svg = svg.replace(/<script(?=[\s/>])[^>]*\/>|<script(?=[\s/>])[^>]*>[\s\S]*?<\/script(?:\s[^>]*)?>/gi, '');
    svg = svg.replace(/<foreignObject(?=[\s/>])[^>]*\/>|<foreignObject(?=[\s/>])[\s\S]*?<\/foreignObject(?:\s[^>]*)?>/gi, '');
  } while (svg !== prev);

  // Strip inline event-handler attributes (onload, onclick, onmouseover, …)
  // and javascript: URIs — <script> removal alone leaves these XSS vectors
  // intact if the SVG is ever rendered inline (e.g. via innerHTML or <object>).
  do {
    prev = svg;
    svg = svg.replace(/\s?\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  } while (svg !== prev);

  // Neutralize javascript: and executable data URIs in href and xlink:href (quoted and unquoted, including entity encodings)
  svg = svg.replace(/\b(href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (full: string, attr: string, dQuote?: string, sQuote?: string, uQuote?: string) => {
    const rawVal = dQuote ?? sQuote ?? uQuote ?? "";
    const decoded = rawVal
      .replace(/&#(\d+);?/g, (_: string, n: string) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);?/gi, (_: string, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
      .replace(/[\s\x00-\x1f]+/g, "");
    if (/^javascript:/i.test(decoded) || /^data:text\/(?:html|javascript)/i.test(decoded)) {
      return `${attr}="#"`;
    }
    return full;
  });

  // Remove hidden elements
  svg = removeHiddenElements(svg);

  // Re-strip embedded scripts in case hidden-element removal exposes new tags
  do {
    prev = svg;
    svg  = svg.replace(/<script(?=[\s/>])[^>]*\/>|<script(?=[\s/>])[^>]*>[\s\S]*?<\/script(?:\s[^>]*)?>/gi, '');
  } while (svg !== prev);

  // Collapse whitespace
  svg = svg.replace(/>\s{2,}</g, '><');
  svg = svg.replace(/\s{2,}/g, ' ').trim();
  onProgress?.(80);

  // Add viewBox if missing from the root <svg> element (SVG viewBox coordinates must be unitless numbers in CSS pixels).
  // Read width and height only from exact attributes on the root svg element, avoiding data-width or descendant attributes.
  const rootSvgMatch = svg.match(/<svg\b([^>]*)>/i);
  if (rootSvgMatch) {
    const rootAttrs = rootSvgMatch[1];
    const hasViewBox = /(?<![a-zA-Z0-9_-])viewBox\s*=/i.test(rootAttrs);
    if (!hasViewBox) {
      const wMatch = rootAttrs.match(/(?<![a-zA-Z0-9_-])width\s*=\s*["']([^"']+)["']/i);
      const hMatch = rootAttrs.match(/(?<![a-zA-Z0-9_-])height\s*=\s*["']([^"']+)["']/i);
      if (wMatch && hMatch) {
        const numW = parseSvgLength(wMatch[1]);
        const numH = parseSvgLength(hMatch[1]);
        if (numW !== null && numH !== null) {
          const fmtW = Number(numW.toFixed(2));
          const fmtH = Number(numH.toFixed(2));
          svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${fmtW} ${fmtH}"`);
        }
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
