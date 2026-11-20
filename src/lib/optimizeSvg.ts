import type { CompressResult } from "./types";

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

/**
 * Deterministic, linear-time path data compactor (O(N) with zero regex backtracking).
 * Strips whitespace around path commands (M, L, C, etc.) and commas without ReDoS risk.
 */
function compactPathData(d: string): string {
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < d.length; i++) {
    const ch = d[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      pendingSpace = true;
      continue;
    }
    if (ch === ",") {
      out += ",";
      pendingSpace = false;
      continue;
    }
    const isCmd = (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");
    if (isCmd) {
      out += ch;
      pendingSpace = false;
      continue;
    }
    if (pendingSpace) {
      const last = out[out.length - 1];
      if (
        last &&
        last !== "," &&
        !((last >= "A" && last <= "Z") || (last >= "a" && last <= "z"))
      ) {
        out += " ";
      }
      pendingSpace = false;
    }
    out += ch;
  }
  return out;
}

/**
 * Clean element attributes strictly on tag headers, preserving text nodes.
 * Strips event handlers, unwanted editor namespaces, and neutralizes javascript: URIs.
 * Uses a linear scan (O(N) with zero regex backtracking).
 */
function cleanElementAttributes(tagAttrs: string): string {
  let cleaned = "";
  let i = 0;
  const len = tagAttrs.length;

  while (i < len) {
    // Collect leading whitespace
    const wsStart = i;
    while (
      i < len &&
      (tagAttrs[i] === " " ||
        tagAttrs[i] === "\t" ||
        tagAttrs[i] === "\n" ||
        tagAttrs[i] === "\r")
    ) {
      i++;
    }
    const ws = tagAttrs.slice(wsStart, i);
    if (i >= len) {
      cleaned += ws;
      break;
    }

    // Read attribute name
    const nameStart = i;
    while (
      i < len &&
      tagAttrs[i] !== "=" &&
      tagAttrs[i] !== ">" &&
      tagAttrs[i] !== "/" &&
      tagAttrs[i] !== " " &&
      tagAttrs[i] !== "\t" &&
      tagAttrs[i] !== "\n" &&
      tagAttrs[i] !== "\r"
    ) {
      i++;
    }
    const attrName = tagAttrs.slice(nameStart, i);
    if (!attrName) {
      cleaned += ws + tagAttrs[i++];
      continue;
    }

    // Check for optional '=' and attribute value
    let hasEquals = false;
    let quote = "";
    let attrVal = "";

    const beforeEqWsStart = i;
    while (
      i < len &&
      (tagAttrs[i] === " " ||
        tagAttrs[i] === "\t" ||
        tagAttrs[i] === "\n" ||
        tagAttrs[i] === "\r")
    ) {
      i++;
    }

    if (i < len && tagAttrs[i] === "=") {
      hasEquals = true;
      i++; // consume '='
      // skip whitespace after '='
      while (
        i < len &&
        (tagAttrs[i] === " " ||
          tagAttrs[i] === "\t" ||
          tagAttrs[i] === "\n" ||
          tagAttrs[i] === "\r")
      ) {
        i++;
      }

      if (i < len) {
        if (tagAttrs[i] === '"' || tagAttrs[i] === "'") {
          quote = tagAttrs[i];
          i++; // consume opening quote
          const valStart = i;
          while (i < len && tagAttrs[i] !== quote) {
            i++;
          }
          attrVal = tagAttrs.slice(valStart, i);
          if (i < len && tagAttrs[i] === quote) {
            i++; // consume closing quote
          }
        } else {
          // Unquoted value: terminates at whitespace, '>', or '/'
          const valStart = i;
          while (
            i < len &&
            tagAttrs[i] !== " " &&
            tagAttrs[i] !== "\t" &&
            tagAttrs[i] !== "\n" &&
            tagAttrs[i] !== "\r" &&
            tagAttrs[i] !== ">" &&
            tagAttrs[i] !== "/"
          ) {
            i++;
          }
          attrVal = tagAttrs.slice(valStart, i);
        }
      }
    } else {
      // Attribute without value (e.g. boolean attribute)
      i = beforeEqWsStart;
    }

    const lowerName = attrName.toLowerCase();

    // 1. Drop inline event handlers (onload, onclick, onmouseover, ...)
    if (lowerName.startsWith("on")) {
      continue;
    }

    // 2. Drop editor namespace declarations (xmlns:inkscape, xmlns:sodipodi, etc.)
    if (
      lowerName === "xmlns:inkscape" ||
      lowerName === "xmlns:sodipodi" ||
      lowerName === "xmlns:sketch" ||
      lowerName === "xmlns:dc" ||
      lowerName === "xmlns:cc" ||
      lowerName === "xmlns:rdf" ||
      lowerName === "xmlns:xlink"
    ) {
      continue;
    }

    // 3. Drop editor attributes (inkscape:*, sodipodi:*)
    if (lowerName.startsWith("inkscape:") || lowerName.startsWith("sodipodi:")) {
      continue;
    }

    // 4. Neutralize javascript: and executable data URIs in href and xlink:href
    if (lowerName === "href" || lowerName === "xlink:href") {
      const decoded = attrVal
        .replace(/&#(\d+);?/g, (_: string, n: string) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);?/gi, (_: string, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
      let stripped = "";
      for (let c = 0; c < decoded.length; c++) {
        if (decoded.charCodeAt(c) > 32) {
          stripped += decoded[c];
        }
      }
      if (/^javascript:/i.test(stripped) || /^data:text\/(?:html|javascript)/i.test(stripped)) {
        attrVal = "#";
        quote = quote || '"';
      }
    }

    // 5. Compact path data inside d attributes
    if (lowerName === "d") {
      attrVal = compactPathData(attrVal);
      quote = quote || '"';
    }

    // Append preserved/sanitized attribute
    const sep = ws || " ";
    if (hasEquals) {
      const q = quote || '"';
      cleaned += `${sep}${attrName}=${q}${attrVal}${q}`;
    } else {
      cleaned += `${sep}${attrName}`;
    }
  }

  return cleaned;
}

/**
 * Finds the matching '>' closing a tag, respecting quoted attribute values.
 */
function findTagEnd(str: string, startIndex: number): number {
  let inQuote: '"' | "'" | null = null;
  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

const DISCARD_TAGS = new Set(["script", "foreignobject", "metadata"]);

function shouldDiscardElement(tagName: string): boolean {
  const lower = tagName.toLowerCase();
  return (
    DISCARD_TAGS.has(lower) ||
    lower.startsWith("sodipodi:") ||
    lower.startsWith("inkscape:")
  );
}

function isElementHidden(tagAttrs: string): boolean {
  return (
    /\b(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(tagAttrs) ||
    /\b(?:display|visibility)\s*=\s*["'](?:none|hidden)["']/i.test(tagAttrs)
  );
}

/**
 * Linear-pass SVG parser and optimizer (O(N) single pass).
 * - Collects surviving ranges into chunks and joins once, eliminating quadratic string copies.
 * - Leaves text nodes completely untouched, protecting user visible text (e.g. onload=).
 * - Discards <script>, <foreignObject>, <metadata>, editor tags, and hidden elements.
 */
function processSvgLinear(svg: string): string {
  const chunks: string[] = [];
  let pos = 0;
  const len = svg.length;

  let discardDepth = 0;
  let discardTag = "";

  while (pos < len) {
    const tagStart = svg.indexOf("<", pos);
    if (tagStart === -1) {
      // Remaining trailing text node
      if (discardDepth === 0) {
        chunks.push(svg.slice(pos));
      }
      break;
    }

    // Text before the tag
    if (tagStart > pos && discardDepth === 0) {
      chunks.push(svg.slice(pos, tagStart));
    }

    // Handle XML comments <!-- ... -->
    if (svg.startsWith("<!--", tagStart)) {
      const commentEnd = svg.indexOf("-->", tagStart + 4);
      pos = commentEnd === -1 ? len : commentEnd + 3;
      continue;
    }

    // Handle XML declaration <?xml ... ?>
    if (svg.startsWith("<?", tagStart)) {
      const declEnd = svg.indexOf("?>", tagStart + 2);
      pos = declEnd === -1 ? len : declEnd + 2;
      continue;
    }

    // Handle CDATA <![CDATA[ ... ]]>
    if (svg.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = svg.indexOf("]]>", tagStart + 9);
      const endPos = cdataEnd === -1 ? len : cdataEnd + 3;
      if (discardDepth === 0) {
        chunks.push(svg.slice(tagStart, endPos));
      }
      pos = endPos;
      continue;
    }

    const tagEnd = findTagEnd(svg, tagStart);
    if (tagEnd === -1) {
      // Unclosed tag at EOF
      break;
    }

    const isClose = svg[tagStart + 1] === "/";
    const rawTagContent = svg.slice(tagStart + (isClose ? 2 : 1), tagEnd);
    const isSelfClosing = !isClose && rawTagContent.trimEnd().endsWith("/");
    const tagContent = isSelfClosing
      ? rawTagContent.slice(0, rawTagContent.lastIndexOf("/")).trimEnd()
      : rawTagContent;

    const nameMatch = tagContent.match(/^([a-z0-9:-]+)/i);
    const tagName = nameMatch ? nameMatch[1] : "";
    const lowerName = tagName.toLowerCase();

    // If currently inside a discarded container element
    if (discardDepth > 0) {
      if (isClose && lowerName === discardTag) {
        discardDepth--;
      } else if (!isClose && !isSelfClosing && lowerName === discardTag) {
        discardDepth++;
      }
      pos = tagEnd + 1;
      continue;
    }

    // Check if element should be discarded (script, foreignObject, metadata, editor namespaces)
    if (shouldDiscardElement(tagName)) {
      if (!isClose && !isSelfClosing) {
        discardDepth = 1;
        discardTag = lowerName;
      }
      pos = tagEnd + 1;
      continue;
    }

    // Check if element is hidden (display:none or visibility:hidden)
    // Never discard the root <svg> container
    const tagAttrs = tagContent.slice(tagName.length);
    if (!isClose && lowerName !== "svg" && isElementHidden(tagAttrs)) {
      if (!isSelfClosing) {
        discardDepth = 1;
        discardTag = lowerName;
      }
      pos = tagEnd + 1;
      continue;
    }

    // Surviving tag: clean attributes only on opening/self-closing tags
    if (isClose) {
      chunks.push(`</${tagName}>`);
    } else {
      const cleanedAttrs = cleanElementAttributes(tagAttrs);
      chunks.push(`<${tagName}${cleanedAttrs}${isSelfClosing ? " /" : ""}>`);
    }

    pos = tagEnd + 1;
  }

  let result = chunks.join("");

  // Remove empty groups and defs
  result = result.replace(/<g[^>]*>\s*<\/g>/gi, "");
  result = result.replace(/<g\s*\/>/gi, "");
  result = result.replace(/<defs>\s*<\/defs>/gi, "");

  return result;
}

/**
 * Linear-time removal of inter-tag whitespace between '>' and '<'.
 * Replaces sequences of 2 or more whitespace characters between tags with zero spaces (O(N) with zero backtracking).
 */
function collapseInterTagWhitespace(svg: string): string {
  let out = "";
  let i = 0;
  const len = svg.length;
  while (i < len) {
    if (svg[i] === ">") {
      out += ">";
      i++;
      const wsStart = i;
      while (
        i < len &&
        (svg[i] === " " || svg[i] === "\t" || svg[i] === "\n" || svg[i] === "\r")
      ) {
        i++;
      }
      if (i - wsStart >= 2 && i < len && svg[i] === "<") {
        // Collapsed whitespace between '>' and '<'
      } else {
        out += svg.slice(wsStart, i);
      }
    } else {
      out += svg[i];
      i++;
    }
  }
  return out;
}

export async function optimizeSvg(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  onProgress?.(5);
  let svg = await file.text();
  onProgress?.(15);

  // Linear-pass parser: removes comments, hidden elements, scripts, unwanted attributes, and namespaces
  // while strictly leaving text nodes untouched
  svg = processSvgLinear(svg);
  onProgress?.(55);

  // Round long decimals (≥3 decimal places → 2), e.g. 12.345678 -> 12.35, 10.0001 -> 10
  svg = svg.replace(/\d+\.\d{3,}/g, (m: string) =>
    Number(Number.parseFloat(m).toFixed(2)).toString()
  );
  onProgress?.(70);

  // Collapse whitespace
  svg = collapseInterTagWhitespace(svg);
  svg = svg.replace(/\s{2,}/g, " ").trim();
  onProgress?.(80);

  // Add viewBox if missing from the root <svg> element (SVG viewBox coordinates must be unitless numbers in CSS pixels).
  // Read width and height only from exact attributes on the root svg element, avoiding data-width or descendant attributes.
  const rootSvgMatch = svg.match(/<svg\b([^>]*)>/i);
  if (rootSvgMatch) {
    const rootAttrs = rootSvgMatch[1];
    const hasViewBox = /(?:^|\s)viewBox\s*=/i.test(rootAttrs);
    if (!hasViewBox) {
      const wMatch = rootAttrs.match(/(?:^|\s)width\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      const hMatch = rootAttrs.match(/(?:^|\s)height\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
      if (wMatch && hMatch) {
        const rawW = wMatch[1] ?? wMatch[2];
        const rawH = hMatch[1] ?? hMatch[2];
        if (rawW && rawH) {
          const numW = parseSvgLength(rawW);
          const numH = parseSvgLength(rawH);
          if (numW !== null && numH !== null) {
            const fmtW = Number(numW.toFixed(2));
            const fmtH = Number(numH.toFixed(2));
            svg = svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${fmtW} ${fmtH}"`);
          }
        }
      }
    }
  }

  onProgress?.(100);
  const blob = new Blob([svg], { type: "image/svg+xml" });

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: file.size / blob.size,
    format: "SVG (optimised · pure TS)",
  };
}
