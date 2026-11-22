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
 * Decode the HTML/XML character references that can hide a URI scheme from a
 * plain-text check. Numeric forms were already handled; named forms such as
 * `&colon;`, `&Tab;` and `&NewLine;` were not, so `javascript&colon;…` slipped
 * through as a live link.
 */
const NAMED_ENTITIES: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  sol: "/",
  bsol: "\\",
  lpar: "(",
  rpar: ")",
  num: "#",
  quest: "?",
  equals: "=",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  period: ".",
  comma: ",",
  semi: ";",
  excl: "!",
  lowbar: "_",
  hyphen: "-",
  plus: "+",
  percnt: "%",
  ast: "*",
  commat: "@",
  grave: "`",
  lsqb: "[",
  rsqb: "]",
  lbrack: "[",
  rbrack: "]",
  lcub: "{",
  rcub: "}",
  verbar: "|",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m: string, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);?/g, (_m: string, dec: string) =>
      String.fromCodePoint(Number(dec)),
    )
    .replace(/&([a-z][a-z0-9]+);?/gi, (match: string, name: string) => {
      const decoded = NAMED_ENTITIES[name.toLowerCase()];
      return decoded === undefined ? match : decoded;
    });
}

/**
 * Clean element attributes strictly on tag headers, preserving text nodes.
 * Strips event handlers, unwanted editor namespaces, and neutralizes javascript: URIs.
 * Uses a single-pass deterministic scanner with zero regular expression backtracking.
 */
function cleanElementAttributes(tagAttrs: string): string {
  let out = "";
  let i = 0;
  const len = tagAttrs.length;

  while (i < len) {
    const loopStart = i;

    if (tagAttrs[i] === " " || tagAttrs[i] === "\t" || tagAttrs[i] === "\n" || tagAttrs[i] === "\r") {
      out += tagAttrs[i];
      i++;
      continue;
    }

    if (tagAttrs[i] === "/" || tagAttrs[i] === ">") {
      out += tagAttrs[i];
      i++;
      continue;
    }

    const nameStart = i;
    while (
      i < len &&
      tagAttrs[i] !== "=" &&
      tagAttrs[i] !== " " &&
      tagAttrs[i] !== "\t" &&
      tagAttrs[i] !== "\n" &&
      tagAttrs[i] !== "\r" &&
      tagAttrs[i] !== "/" &&
      tagAttrs[i] !== ">"
    ) {
      i++;
    }
    const rawAttrName = tagAttrs.slice(nameStart, i);
    const lowerAttrName = rawAttrName.toLowerCase();

    if (rawAttrName.length === 0 && (i >= len || tagAttrs[i] !== "=")) {
      if (i < len) {
        out += tagAttrs[i];
        i++;
      }
      continue;
    }

    let spacingAfterName = "";
    while (i < len && (tagAttrs[i] === " " || tagAttrs[i] === "\t" || tagAttrs[i] === "\n" || tagAttrs[i] === "\r")) {
      spacingAfterName += tagAttrs[i];
      i++;
    }

    let hasEquals = false;
    let spacingAfterEquals = "";
    let rawVal = "";
    let quoteChar: '"' | "'" | "" = "";

    if (i < len && tagAttrs[i] === "=") {
      hasEquals = true;
      i++;
      while (i < len && (tagAttrs[i] === " " || tagAttrs[i] === "\t" || tagAttrs[i] === "\n" || tagAttrs[i] === "\r")) {
        spacingAfterEquals += tagAttrs[i];
        i++;
      }
      if (i < len && (tagAttrs[i] === '"' || tagAttrs[i] === "'")) {
        quoteChar = tagAttrs[i] as '"' | "'";
        i++;
        const valStart = i;
        while (i < len && tagAttrs[i] !== quoteChar) {
          i++;
        }
        rawVal = tagAttrs.slice(valStart, i);
        if (i < len && tagAttrs[i] === quoteChar) {
          i++;
        }
      } else {
        const valStart = i;
        while (
          i < len &&
          tagAttrs[i] !== " " &&
          tagAttrs[i] !== "\t" &&
          tagAttrs[i] !== "\n" &&
          tagAttrs[i] !== "\r" &&
          !(tagAttrs[i] === "/" && (i + 1 === len || tagAttrs[i + 1] === ">")) &&
          tagAttrs[i] !== ">"
        ) {
          i++;
        }
        rawVal = tagAttrs.slice(valStart, i);
      }
    }

    // Strip inline event-handler attributes (onload, onclick, onmouseover, …)
    if (lowerAttrName.startsWith("on") && lowerAttrName.length > 2) {
      continue;
    }

    // Strip editor namespace declarations
    if (
      lowerAttrName === "xmlns:inkscape" ||
      lowerAttrName === "xmlns:sodipodi" ||
      lowerAttrName === "xmlns:sketch" ||
      lowerAttrName === "xmlns:dc" ||
      lowerAttrName === "xmlns:cc" ||
      lowerAttrName === "xmlns:rdf" ||
      lowerAttrName === "xmlns:xlink"
    ) {
      continue;
    }

    // Strip editor attributes (inkscape:*, sodipodi:*)
    if (lowerAttrName.startsWith("inkscape:") || lowerAttrName.startsWith("sodipodi:")) {
      continue;
    }

    // Neutralize javascript: and executable data URIs in href and xlink:href
    if (lowerAttrName === "href" || lowerAttrName === "xlink:href") {
      const decoded = decodeEntities(rawVal);
      let stripped = "";
      for (let c = 0; c < decoded.length; c++) {
        if (decoded.charCodeAt(c) > 32) {
          stripped += decoded[c];
        }
      }
      if (/^javascript:/i.test(stripped) || /^data:text\/(?:html|javascript)/i.test(stripped)) {
        out += `${rawAttrName}="#"`;
        continue;
      }
    }

    // Compact path data inside d attributes deterministically without backtracking
    if (lowerAttrName === "d" && quoteChar) {
      out += `${rawAttrName}=${quoteChar}${compactPathData(rawVal)}${quoteChar}`;
      continue;
    }

    if (hasEquals) {
      if (quoteChar) {
        out += `${rawAttrName}${spacingAfterName}=${spacingAfterEquals}${quoteChar}${rawVal}${quoteChar}`;
      } else {
        out += `${rawAttrName}${spacingAfterName}=${spacingAfterEquals}${rawVal}`;
      }
    } else {
      out += rawAttrName;
    }

    if (i <= loopStart) {
      if (i < len) {
        out += tagAttrs[i];
        i++;
      } else {
        break;
      }
    }
  }

  return out;
}

/**
 * Finds the matching '>' closing a DOCTYPE declaration, respecting quotes and internal subsets [...].
 */
function findDocTypeEnd(str: string, startIndex: number): number {
  let inQuote: '"' | "'" | null = null;
  let inBracket = false;
  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "[" && !inBracket) {
      inBracket = true;
    } else if (ch === "]" && inBracket) {
      inBracket = false;
    } else if (ch === ">" && !inBracket) {
      return i;
    }
  }
  return -1;
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
  // Inspect the `style` attribute (or a real display/visibility attribute),
  // never the whole tag text: an unrelated attribute such as
  // aria-label="display:none" used to make a visible element disappear.
  const styleMatch = /(?<![-\w:])style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
    tagAttrs,
  );
  if (styleMatch) {
    const style = styleMatch[1] ?? styleMatch[2] ?? styleMatch[3] ?? "";
    if (
      /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/i.test(style) ||
      /(?:^|;)\s*visibility\s*:\s*hidden(?:\s*!important)?\s*(?:;|$)/i.test(style)
    ) {
      return true;
    }
  }

  const displayAttr =
    /(?<![-\w:])display\s*=\s*(?:"none"|'none'|none)(?=[\s/>]|$)/i.test(tagAttrs);
  const visibilityAttr =
    /(?<![-\w:])visibility\s*=\s*(?:"hidden"|'hidden'|hidden)(?=[\s/>]|$)/i.test(
      tagAttrs,
    );
  return displayAttr || visibilityAttr;
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

    // Handle DOCTYPE <!DOCTYPE ... >
    if (/^<!doctype\b/i.test(svg.slice(tagStart, tagStart + 10))) {
      const docTypeEnd = findDocTypeEnd(svg, tagStart);
      const endPos = docTypeEnd === -1 ? len : docTypeEnd + 1;
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
      // Rounding and whitespace compaction are applied to the tag markup only.
      // Running them over the joined document (as an earlier version did)
      // rewrote visible text nodes, so `<text>v1.2345</text>` came out as
      // `v1.23` and intentional spacing inside `<tspan>` was lost.
      const tagOut = `<${tagName}${cleanedAttrs}${isSelfClosing ? " /" : ""}>`;
      chunks.push(roundLongDecimals(tagOut));
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
 * Round long decimals (≥3 decimal places → 2), e.g. 12.345678 -> 12.35, 10.0001 -> 10.
 * Single-pass linear scan with zero regex backtracking.
 */
function roundLongDecimals(str: string): string {
  let out = "";
  let i = 0;
  const len = str.length;

  while (i < len) {
    const ch = str[i];
    if (ch >= "0" && ch <= "9") {
      const numStart = i;
      while (i < len && str[i] >= "0" && str[i] <= "9") {
        i++;
      }
      if (i < len && str[i] === ".") {
        i++;
        const fracStart = i;
        while (i < len && str[i] >= "0" && str[i] <= "9") {
          i++;
        }
        const fracLen = i - fracStart;
        if (fracLen >= 3) {
          const numStr = str.slice(numStart, i);
          const rounded = Number(Number.parseFloat(numStr).toFixed(2)).toString();
          out += rounded;
          continue;
        } else {
          out += str.slice(numStart, i);
          continue;
        }
      } else {
        out += str.slice(numStart, i);
        continue;
      }
    }
    out += ch;
    i++;
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

  // Decimal rounding already happened inside the tag pass above, so visible
  // text nodes and CDATA sections keep their exact contents.
  onProgress?.(70);

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
  const blob = new Blob([svg], { type: "image/svg+xml" });

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: file.size / blob.size,
    format: "SVG (optimised · pure TS)",
  };
}
