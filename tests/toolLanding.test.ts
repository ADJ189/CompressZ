import { assert } from "./assert.ts";

Deno.test("tool landing: ToolCard and ToolGrid components exist and comply with CSS floor", async () => {
  const cardSvelte = await Deno.readTextFile(
    new URL("../src/components/ToolCard.svelte", import.meta.url)
  );
  const gridSvelte = await Deno.readTextFile(
    new URL("../src/components/ToolGrid.svelte", import.meta.url)
  );

  // Must not have transition: all
  assert(!cardSvelte.includes("transition: all"), "ToolCard must never use transition: all");
  assert(!gridSvelte.includes("transition: all"), "ToolGrid must never use transition: all");

  // Must respect prefers-reduced-motion
  assert(
    cardSvelte.includes("prefers-reduced-motion: reduce"),
    "ToolCard must include prefers-reduced-motion: reduce rules"
  );

  // Must have focus-visible
  assert(
    cardSvelte.includes(":focus-visible"),
    "ToolCard must include :focus-visible styling"
  );

  // Must have accessibility attributes
  assert(cardSvelte.includes('role="button"'), 'ToolCard must have role="button"');
  assert(cardSvelte.includes("tabindex="), "ToolCard must be keyboard focusable");
  assert(gridSvelte.includes('role="list"'), 'ToolGrid must have role="list"');
});

Deno.test("tool landing: PdfSuite and Convert implement tool-first interactive landings", async () => {
  const pdfSuite = await Deno.readTextFile(
    new URL("../src/routes/PdfSuite.svelte", import.meta.url)
  );
  const convert = await Deno.readTextFile(
    new URL("../src/routes/Convert.svelte", import.meta.url)
  );

  // Both must import and mount ToolGrid
  assert(pdfSuite.includes("ToolGrid"), "PdfSuite must import and render ToolGrid");
  assert(convert.includes("ToolGrid"), "Convert must import and render ToolGrid");

  // Must have tool-first landing container
  assert(pdfSuite.includes("cz-suite-landing"), "PdfSuite must have cz-suite-landing container");
  assert(convert.includes("cz-convert-landing"), "Convert must have cz-convert-landing container");

  // Check that all essential PDF subtools are present in TOOLS definition
  const requiredPdfTools = [
    "split",
    "remove",
    "page-numbers",
    "nup",
    "metadata",
    "organize",
    "studio",
    "watermark",
    "crop",
    "forms",
    "security",
    "repair",
    "redact",
  ];
  for (const t of requiredPdfTools) {
    assert(
      pdfSuite.includes(`id: "${t}"`),
      `PdfSuite must define tool with id "${t}"`
    );
  }

  // Check that all essential conversion groups are present
  assert(convert.includes("DOC_CONVERT_TOOLS"), "Convert must define DOC_CONVERT_TOOLS");
  assert(convert.includes("OFFICE_CONVERT_TOOLS"), "Convert must define OFFICE_CONVERT_TOOLS");
  assert(convert.includes("MEDIA_CONVERT_TOOLS"), "Convert must define MEDIA_CONVERT_TOOLS");

  // Check that Convert pre-upload landing retains category selector, options bar, and drawer
  assert(convert.includes("cz-cat-segmented"), "Convert pre-upload landing must retain cz-cat-segmented");
  assert(convert.includes("cz-options-pill-bar"), "Convert pre-upload landing must retain cz-options-pill-bar");
  assert(convert.includes("cz-advanced-drawer"), "Convert pre-upload landing must retain cz-advanced-drawer");
});

Deno.test("tool landing: ToolsMegaMenu aligns with plain-English naming", async () => {
  const megaMenu = await Deno.readTextFile(
    new URL("../src/components/ToolsMegaMenu.svelte", import.meta.url)
  );

  const plainEnglishNames = [
    "Edit & Annotate",
    "Fill & Sign",
    "Add Watermark",
    "Crop Pages",
    "Redact Content",
    "Password Protect",
    "Repair File",
    "Extract to Markdown",
  ];

  for (const name of plainEnglishNames) {
    assert(
      megaMenu.includes(`"${name}"`),
      `ToolsMegaMenu must include plain-English name "${name}"`
    );
  }
});

Deno.test("tool landing: ActionPalette portals to viewport and escapes transformed dialog", async () => {
  const actionPalette = await Deno.readTextFile(
    new URL("../src/components/ActionPalette.svelte", import.meta.url)
  );

  assert(actionPalette.includes("use:portal"), "ActionPalette must portal itself outside transformed ancestors");
  assert(actionPalette.includes("document.body.appendChild"), "Portal must append to document.body");
});

Deno.test("tool landing: ToolsDialog responsive grid and handwriting route verification", async () => {
  const toolsDialog = await Deno.readTextFile(
    new URL("../src/app/ToolsDialog.svelte", import.meta.url)
  );
  const ocrSvelte = await Deno.readTextFile(
    new URL("../src/routes/Ocr.svelte", import.meta.url)
  );

  // Responsive grid
  assert(
    toolsDialog.includes("min(100%"),
    "ToolsDialog must bound grid minimum by available width"
  );
  assert(
    toolsDialog.includes("@media (max-width: 520px)"),
    "ToolsDialog must provide narrow mobile responsive rules"
  );

  // Handwriting route & bare route reset
  assert(
    toolsDialog.includes('route: "compress/ocr?profile=handwriting"'),
    "ToolsDialog Handwriting Recognition must route to OCR with handwriting profile"
  );
  assert(
    ocrSvelte.includes("applyQueryParams"),
    "Ocr.svelte must read query params and select handwriting profile on entry"
  );
  assert(
    ocrSvelte.includes('profile: "printed"'),
    "Ocr.svelte must restore printed profile on bare route"
  );
  assert(
    ocrSvelte.includes('outputKind: "pdf"'),
    "Ocr.svelte must restore PDF output on bare route entry"
  );
});

Deno.test("tool landing: bare OCR route restores printed profile and PDF output mode", async () => {
  const ocrSvelte = await Deno.readTextFile(
    new URL("../src/routes/Ocr.svelte", import.meta.url)
  );

  // Check explicit query parameter handlers
  assert(
    ocrSvelte.includes('prof === "handwriting" || prof === "trocr"'),
    "Ocr.svelte must recognize handwriting/trocr query params"
  );
  assert(
    ocrSvelte.includes('prof === "printed" || prof === "tesseract"'),
    "Ocr.svelte must recognize printed/tesseract query params"
  );

  // Check bare route fallback logic resets profile to printed and outputKind to pdf
  assert(
    ocrSvelte.includes('current.profile !== "printed"') && ocrSvelte.includes('outputKind: "pdf"'),
    "Ocr.svelte must reset profile to printed and restore outputKind to pdf on bare route"
  );
});
