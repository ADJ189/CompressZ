import { assert } from "./assert.ts";
import { optimizeSvg } from "../src/lib/optimizeSvg.ts";

async function optimize(svg: string, fileName = "test.svg") {
  const file = new File([svg], fileName, { type: "image/svg+xml" });
  const result = await optimizeSvg(file);
  const text = await result.blob.text();
  return { result, text };
}

async function optimizeWithTiming(svg: string, fileName = "perf.svg") {
  const file = new File([svg], fileName, { type: "image/svg+xml" });
  const start = performance.now();
  const result = await optimizeSvg(file);
  const duration = performance.now() - start;
  const text = await result.blob.text();
  return { duration, text };
}

Deno.test("optimizeSvg: strips scripts and XSS inline handlers", async () => {
  const dirtySvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:script="http://www.w3.org/2000/svg" width="100" height="100">
    <!-- comment to strip -->
    <script>alert(1);</script>
    <script:rect x="10" y="10" width="80" height="80">valid content</script:rect>
    <circle cx="50" cy="50" r="40" onclick="alert('xss')" onload="evil()" fill="red"/>
    <a href="javascript:alert(2)"><text x="10" y="20">Click</text></a>
  </svg>`;

  const { text } = await optimize(dirtySvg);

  assert(!text.match(/<script(?=[\s/>])/i), "Must strip <script> tags");
  assert(!text.includes("alert(1);"), "Must strip script body");
  assert(text.includes("<script:rect"), "Must preserve valid namespace-qualified script:rect element");
  assert(text.includes("</script:rect>"), "Must preserve closing tag of namespace-qualified script:rect element");
  assert(!text.includes("onclick"), "Must strip onclick attribute");
  assert(!text.includes("onload"), "Must strip onload attribute");
  assert(!text.includes("javascript:"), "Must strip javascript: pseudo-protocol");
  assert(!text.includes("<!-- comment"), "Must strip comments");
  assert(text.includes("<circle"), "Must preserve valid SVG circle geometry");
});

Deno.test("optimizeSvg: strips unquoted javascript: href, entity-encoded javascript:, and foreignObject tags", async () => {
  const hostileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <a href=javascript:alert('unquoted')><text x="10" y="20">Unquoted</text></a>
    <a xlink:href=javascript:alert('unquoted-xlink')><text x="10" y="40">Unquoted Xlink</text></a>
    <a href="&#106;avascript:alert('entity')"><text x="10" y="60">Entity</text></a>
    <a href="&#x6a;avascript:alert('hex-entity')"><text x="10" y="80">Hex Entity</text></a>
    <foreignObject width="100" height="100">
      <iframe src="https://evil.com"></iframe>
    </foreignObject>
  </svg>`;

  const { text } = await optimize(hostileSvg, "hostile.svg");

  assert(!/href\s*=\s*javascript:/i.test(text), "Must strip unquoted javascript: href");
  assert(!/href\s*=\s*['"]?&#(?:106|x6a);/i.test(text), "Must strip entity-encoded javascript: href");
  assert(!text.includes("foreignObject"), "Must strip <foreignObject> tags");
  assert(!text.includes("<iframe"), "Must strip child HTML tags in foreignObject");
});

Deno.test("optimizeSvg: rounds long decimals and preserves clean structure", async () => {
  const rawSvg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <path d="M 12.345678 45.678912 L 89.123456 99.888888" stroke="black"/>
  </svg>`;

  const { result, text } = await optimize(rawSvg, "path.svg");

  assert(!text.includes("12.345678"), "Should round long floating point values");
  assert(text.includes("12.35"), "Should format rounded numbers cleanly");
  assert(result.format.includes("SVG"), "Format note should describe SVG output");
});

Deno.test("optimizeSvg: trims trailing zeros from rounded decimals without regex backtracking", async () => {
  const rawSvg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <path d="M 10.0001 20.3004 L 30.2501 40.0000" stroke="black"/>
  </svg>`;

  const { text } = await optimize(rawSvg, "zeros.svg");

  // 10.0001 -> 10, 20.3004 -> 20.3, 30.2501 -> 30.25, 40.0000 -> 40
  // Path data compactor strips whitespace around commands (M10 20.3L30.25 40)
  assert(text.includes('d="M10 20.3L30.25 40"'), "Should cleanly strip trailing zeros without leaving .00 or trailing dot");
});

Deno.test("optimizeSvg: creates valid unitless viewBox from dimensions with units", async () => {
  const rawSvg = `<svg width="150px" height="250pt" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="blue"/>
  </svg>`;

  const { text } = await optimize(rawSvg, "units.svg");

  // 150px -> 150, 250pt -> 250 * 4/3 = 333.33
  assert(text.includes('viewBox="0 0 150 333.33"'), "viewBox must convert pt to CSS pixels (approx 333.33)");
  assert(!text.includes('viewBox="0 0 150 250"'), "viewBox must not naively strip units without conversion");
  assert(!text.includes('viewBox="0 0 150px 250pt"'), "viewBox must not contain raw CSS unit strings");
});

Deno.test("optimizeSvg: does not invent viewBox for percentage or em dimensions", async () => {
  const percentSvg = `<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="40" fill="green"/>
  </svg>`;

  const { text: percentText } = await optimize(percentSvg, "percent.svg");
  assert(!percentText.includes("viewBox="), "Must not invent a viewBox for percentage dimensions");

  const emSvg = `<svg width="10em" height="5em" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="40" fill="green"/>
  </svg>`;
  const { text: emText } = await optimize(emSvg, "em.svg");
  assert(!emText.includes("viewBox="), "Must not invent a viewBox for em dimensions");
});

Deno.test("optimizeSvg: extracts dimensions strictly from root svg element attributes", async () => {
  // 1. Root svg with data-width/data-height only (and child rect with width/height) must NOT generate a viewBox
  const dataSvg = `<svg data-width="200" data-height="200" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="red"/>
  </svg>`;
  const { text: dataText } = await optimize(dataSvg, "data.svg");
  assert(!dataText.includes("viewBox="), "Must not extract dimensions from data-width/data-height or descendant elements");

  // 2. Root svg with single quotes width/height should generate viewBox
  const singleQuoteSvg = `<svg width='120' height='80' xmlns="http://www.w3.org/2000/svg">
    <circle cx="60" cy="40" r="20" fill="blue"/>
  </svg>`;
  const { text: singleText } = await optimize(singleQuoteSvg, "single.svg");
  assert(singleText.includes('viewBox="0 0 120 80"'), "Must extract dimensions from single-quoted root svg attributes");
});

Deno.test("optimizeSvg: handles long unterminated script closing tag without quadratic backtracking", async () => {
  const longWhitespaceClosingTag = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="50" height="50" fill="blue"/>
    </script${" ".repeat(50000)}
  </svg>`;

  const { duration, text } = await optimizeWithTiming(longWhitespaceClosingTag, "unterminated.svg");

  assert(duration < 1000, `Processing must be linear (<1000ms), took ${duration.toFixed(1)}ms`);
  assert(text.includes("<rect"), "Must preserve valid SVG rect geometry");
});

Deno.test("optimizeSvg: preserves paired script:rect namespace-qualified element while stripping script", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:script="http://www.w3.org/2000/svg">
    <script>alert("evil");</script>
    <script:rect id="target" x="5" y="5" width="50" height="50">Drawing</script:rect>
    <script:rect id="self-closing" x="60" y="60" width="20" height="20"/>
  </svg>`;

  const { text } = await optimize(svg, "ns.svg");

  assert(!text.match(/<script(?=[\s/>])/i), "Must strip genuine <script> tag");
  assert(!text.includes('alert("evil")'), "Must strip script content");
  assert(text.includes('<script:rect id="target"'), "Must preserve paired <script:rect>");
  assert(text.includes('Drawing</script:rect>'), "Must preserve paired <script:rect> body and close tag");
  assert(text.includes('<script:rect id="self-closing"'), "Must preserve self-closing <script:rect/>");
});

Deno.test("optimizeSvg: removes hidden elements without regex backtracking", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="10" height="10" style="display:none"/>
    <g style="visibility:hidden"><circle cx="20" cy="20" r="10"/></g>
    <path d="M0 0 L10 10" fill="none"/>
    <text>display:none</text>
  </svg>`;

  const { text } = await optimize(svg, "hidden.svg");

  assert(!text.includes("<rect"), "Should remove self-closing element with display:none");
  assert(!text.includes("<circle"), "Should remove element inside group with visibility:hidden");
  assert(!text.includes("<g"), "Should remove group with visibility:hidden");
  assert(text.includes("<path"), "Should preserve visible path");
  assert(text.includes("<text>display:none</text>"), "Should preserve text node containing literal 'display:none'");
});

Deno.test("optimizeSvg: preserves text nodes beginning with onload= and editor namespace strings", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
    <circle cx="50" cy="50" r="40" fill="blue" onload="evilHandler()"/>
    <text x="10" y="30">onload=executeUserFormula();</text>
    <text x="10" y="60">xmlns:inkscape="http://inkscape.org" and inkscape:label="User Diagram"</text>
  </svg>`;

  const { text } = await optimize(svg, "text-nodes.svg");

  // Attribute onload handler on circle must be stripped
  assert(!text.includes('onload="evilHandler()"'), "Must strip onload attribute from element tag");
  // Visible text node content starting with onload= must be untouched
  assert(text.includes("<text x=\"10\" y=\"30\">onload=executeUserFormula();</text>"), "Must preserve visible text starting with onload=");
  // Visible text node content containing namespace and editor attribute names must be untouched
  assert(text.includes('xmlns:inkscape="http://inkscape.org" and inkscape:label="User Diagram"'), "Must preserve editor namespace strings inside text nodes");
});

Deno.test("optimizeSvg: linear single-pass parser processes large sequence of hidden siblings in linear time", async () => {
  const hiddenSiblings: string[] = [];
  for (let i = 0; i < 500; i++) {
    hiddenSiblings.push(`<rect id="hidden_${i}" x="${i}" y="${i}" width="10" height="10" style="display:none" />`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">
    <circle cx="100" cy="100" r="50" fill="green" />
    ${hiddenSiblings.join("\n")}
    <path d="M 10 10 L 90 90" stroke="black" />
  </svg>`;

  const { duration: elapsed, text } = await optimizeWithTiming(svg, "large-hidden.svg");

  assert(elapsed < 1000, `Large sequence of hidden siblings must be parsed in linear time (<1000ms), took ${elapsed.toFixed(1)}ms`);
  assert(!text.includes("<rect"), "All 500 hidden sibling rects must be removed");
  assert(text.includes("<circle"), "Visible circle must be preserved");
  assert(text.includes("<path"), "Visible path must be preserved");
});

Deno.test("optimizeSvg: retains complete CDATA section containing script token without removing CDATA terminator", async () => {
  const cdataSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <text><![CDATA[<script ]]></text>
  </svg>`;

  const { text } = await optimize(cdataSvg, "cdata.svg");

  assert(text.includes("<text><![CDATA[<script ]]></text>"), "Output must retain the complete CDATA section including CDATA terminator");
});



