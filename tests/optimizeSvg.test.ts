import { assert } from "./assert.ts";
import { optimizeSvg } from "../src/lib/optimizeSvg.ts";

Deno.test("optimizeSvg: strips scripts and XSS inline handlers", async () => {
  const dirtySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <!-- comment to strip -->
    <script>alert(1);</script>
    <circle cx="50" cy="50" r="40" onclick="alert('xss')" onload="evil()" fill="red"/>
    <a href="javascript:alert(2)"><text x="10" y="20">Click</text></a>
  </svg>`;

  const file = new File([dirtySvg], "test.svg", { type: "image/svg+xml" });
  const result = await optimizeSvg(file);
  const text = await result.blob.text();

  assert(!text.includes("<script"), "Must strip <script> tags");
  assert(!text.includes("onclick"), "Must strip onclick attribute");
  assert(!text.includes("onload"), "Must strip onload attribute");
  assert(!text.includes("javascript:"), "Must strip javascript: pseudo-protocol");
  assert(!text.includes("<!-- comment"), "Must strip comments");
  assert(text.includes("<circle"), "Must preserve valid SVG circle geometry");
});

Deno.test("optimizeSvg: rounds long decimals and preserves clean structure", async () => {
  const rawSvg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <path d="M 12.345678 45.678912 L 89.123456 99.888888" stroke="black"/>
  </svg>`;

  const file = new File([rawSvg], "path.svg", { type: "image/svg+xml" });
  const result = await optimizeSvg(file);
  const text = await result.blob.text();

  assert(!text.includes("12.345678"), "Should round long floating point values");
  assert(text.includes("12.35"), "Should format rounded numbers cleanly");
  assert(result.format.includes("SVG"), "Format note should describe SVG output");
});

Deno.test("optimizeSvg: trims trailing zeros from rounded decimals without regex backtracking", async () => {
  const rawSvg = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <path d="M 10.0001 20.3004 L 30.2501 40.0000" stroke="black"/>
  </svg>`;

  const file = new File([rawSvg], "zeros.svg", { type: "image/svg+xml" });
  const result = await optimizeSvg(file);
  const text = await result.blob.text();

  // 10.0001 -> 10, 20.3004 -> 20.3, 30.2501 -> 30.25, 40.0000 -> 40
  // Path data compactor strips whitespace around commands (M10 20.3L30.25 40)
  assert(text.includes('d="M10 20.3L30.25 40"'), "Should cleanly strip trailing zeros without leaving .00 or trailing dot");
});

Deno.test("optimizeSvg: creates valid unitless viewBox from dimensions with units", async () => {
  const rawSvg = `<svg width="150px" height="250pt" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="blue"/>
  </svg>`;

  const file = new File([rawSvg], "units.svg", { type: "image/svg+xml" });
  const result = await optimizeSvg(file);
  const text = await result.blob.text();

  // 150px -> 150, 250pt -> 250 * 4/3 = 333.33
  assert(text.includes('viewBox="0 0 150 333.33"'), "viewBox must convert pt to CSS pixels (approx 333.33)");
  assert(!text.includes('viewBox="0 0 150 250"'), "viewBox must not naively strip units without conversion");
  assert(!text.includes('viewBox="0 0 150px 250pt"'), "viewBox must not contain raw CSS unit strings");
});

Deno.test("optimizeSvg: does not invent viewBox for percentage or em dimensions", async () => {
  const percentSvg = `<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="40" fill="green"/>
  </svg>`;

  const file = new File([percentSvg], "percent.svg", { type: "image/svg+xml" });
  const result = await optimizeSvg(file);
  const text = await result.blob.text();

  assert(!text.includes("viewBox="), "Must not invent a viewBox for percentage dimensions");

  const emSvg = `<svg width="10em" height="5em" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="40" fill="green"/>
  </svg>`;
  const emFile = new File([emSvg], "em.svg", { type: "image/svg+xml" });
  const emResult = await optimizeSvg(emFile);
  const emText = await emResult.blob.text();

  assert(!emText.includes("viewBox="), "Must not invent a viewBox for em dimensions");
});
