import { assert } from "./assert.ts";
import { renderMarkdownToHtml } from "../src/lib/markdownPreview.ts";

Deno.test("markdownPreview: escapes raw HTML to prevent XSS", () => {
  const input = "<script>alert('xss')</script>";
  const html = renderMarkdownToHtml(input);
  assert(!html.includes("<script>"), "Must not contain raw script tags");
  assert(html.includes("&lt;script&gt;"), "Must escape opening tag");
});

Deno.test("markdownPreview: renders headings and inline formatting", () => {
  const input = "# Title\n## Subtitle\n\n**bold** and *italic* and `code`";
  const html = renderMarkdownToHtml(input);
  assert(html.includes("<h1>Title</h1>"), "Renders h1");
  assert(html.includes("<h2>Subtitle</h2>"), "Renders h2");
  assert(html.includes("<strong>bold</strong>"), "Renders bold");
  assert(html.includes("<em>italic</em>"), "Renders italic");
  assert(html.includes("<code>code</code>"), "Renders inline code");
});

Deno.test("markdownPreview: renders LaTeX math blocks and inline math", () => {
  const input = "$$ E = mc^2 $$\n\nThe equation is $x = 1$.";
  const html = renderMarkdownToHtml(input);
  assert(html.includes('<div class="cz-rendered-math-block"><code>E = mc^2</code></div>'), "Renders math block");
  assert(html.includes('<code class="cz-math-inline">x = 1</code>'), "Renders inline math");
});

Deno.test("markdownPreview: renders code blocks with language", () => {
  const input = "```typescript\nconst x: number = 42;\n```";
  const html = renderMarkdownToHtml(input);
  assert(html.includes('<pre class="cz-code-block" data-lang="typescript"><code>const x: number = 42;</code></pre>'), "Renders code block");
});

Deno.test("markdownPreview: renders GFM tables", () => {
  const input = "| Col 1 | Col 2 |\n| --- | --- |\n| Val A | Val B |";
  const html = renderMarkdownToHtml(input);
  assert(html.includes('<table class="cz-rendered-table">'), "Renders table");
  assert(html.includes("<th>Col 1</th>"), "Renders th");
  assert(html.includes("<td>Val A</td>"), "Renders td");
});

Deno.test("markdownPreview: sanitizes link protocols", () => {
  const safe = "[Google](https://google.com)";
  const dangerous = "[Exploit](javascript:alert(1))";

  const safeHtml = renderMarkdownToHtml(safe);
  const dangerousHtml = renderMarkdownToHtml(dangerous);

  assert(safeHtml.includes('href="https://google.com"'), "Allows https URL");
  assert(!dangerousHtml.includes('javascript:'), "Strips javascript: pseudo-protocol");
  assert(dangerousHtml.includes('href="#"'), "Replaces unsafe link with #");
});

Deno.test("markdownPreview: rejects scheme smuggling and protocol-relative hrefs", () => {
  const mdAttacks = [
    "[smuggle](javascript:alert('http://x'))",
    "[netloc](//evil.com/path)",
    "[triple-slash](///evil.com/path)",
    "[raw-data](data:text/html,<b>)",
    "[mixed-case](JaVaScRiPt:void(0))",
    "[vbs](vbscript:msgbox(1))",
    "[spaces](java script:alert(1))",
  ];
  for (const attack of mdAttacks) {
    const html = renderMarkdownToHtml(attack);
    assert(!/href="(?:javascript|data|vbscript|[/][/])/i.test(html), `Unsafe href: ${html}`);
  }
});

Deno.test("markdownPreview: escapes href ampersands exactly once", () => {
  const html = renderMarkdownToHtml("[q](https://a.test/?b=1&c=2)");
  assert(html.includes('href="https://a.test/?b=1&amp;c=2"'), `Unexpected href: ${html}`);
  assert(!html.includes("&amp;amp;"), "Href must not be double-escaped");
});

Deno.test("markdownPreview: allows mailto and site-relative links", () => {
  const doc = "[contact](mailto:support@compressz.test)\n[docs](/guide/overview)\n[top](#summary)";
  const html = renderMarkdownToHtml(doc);
  assert(html.includes('href="mailto:support@compressz.test"'));
  assert(html.includes('href="/guide/overview"'));
  assert(html.includes('href="#summary"'));
});

Deno.test("markdownPreview: F4 renders multi-line math blocks", () => {
  const input = "$$\n\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$";
  const html = renderMarkdownToHtml(input);
  assert(html.includes('<div class="cz-rendered-math-block">'));
  assert(html.includes("int_{0}"));
});

Deno.test("markdownPreview: F4 table escapes pipes and pads ragged rows", () => {
  const input = "| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell \\| with pipe | Second |\n| Only One |";
  const html = renderMarkdownToHtml(input);
  assert(html.includes('<table class="cz-rendered-table">'));
  assert(html.includes("<td>Cell | with pipe</td>"));
  assert(html.includes("<td>Second</td>"));
  assert(html.includes("<td></td>")); // padded empty cell
});

Deno.test("markdownPreview: F4 renders safe image tags", () => {
  const pixel = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const ok = renderMarkdownToHtml(`![Preview](${pixel})`);
  assert(ok.includes('<img src="data:image/gif;base64,'));
  assert(ok.includes('alt="Preview"'));

  const filtered = renderMarkdownToHtml("![Blocked](javascript:alert(1))");
  assert(!filtered.includes("<img"));
  assert(filtered.includes("<!-- [image: Blocked] -->"));
});

Deno.test("markdownPreview: F4 does not create emphasis inside code spans", () => {
  const input = "Use `foo * bar * baz` in your code.";
  const html = renderMarkdownToHtml(input);
  assert(html.includes("<code>foo * bar * baz</code>"));
  assert(!html.includes("<em>bar</em>"));
});

Deno.test("markdownPreview: safeHref rejects tokens preventing event handler injection", () => {
  const input = "[t](https://a/![x](https://onmouseover=alert//))";
  const html = renderMarkdownToHtml(input);
  assert(!html.includes("onmouseover"), `Output must not contain onmouseover handler: ${html}`);
});

Deno.test("markdownPreview: renders converter HTML table and MathML with strict sanitization", () => {
  const scenarios = [
    {
      label: "HTML table structure",
      raw: "<table><thead><tr><th>Col 1</th><th>Col 2</th></tr></thead><tbody><tr><td>Val 1</td><td>Val 2</td></tr></tbody></table>",
      contains: ["<table", "<th>Col 1</th>", "<td>Val 1</td>"],
      excludes: ["&lt;table"],
    },
    {
      label: "MathML block equation",
      raw: '<math display="block"><mrow><mtext>E = mc^2</mtext></mrow></math>',
      contains: ["<math", 'display="block"', "E = mc^2"],
      excludes: ["&lt;math"],
    },
    {
      label: "Hostile MathML attributes",
      raw: '<math><mtext href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">foo</mtext></math>',
      contains: ["<math>", "<mtext>foo</mtext>"],
      excludes: ["javascript:", "<mtext href=", "alert(1)"],
    },
    {
      label: "Hostile HTML table attributes",
      raw: '<table><tr><td title=">" onmouseover="alert(1)">Cell</td></tr></table>',
      contains: ["<table", "<td>Cell</td>"],
      excludes: ["onmouseover", "alert(1)", "title="],
    },
  ];

  for (const { label, raw, contains, excludes } of scenarios) {
    const html = renderMarkdownToHtml(raw);
    for (const match of contains) {
      assert(html.includes(match), `${label} missing '${match}': ${html}`);
    }
    for (const forbidden of excludes) {
      assert(!html.includes(forbidden), `${label} leaked forbidden '${forbidden}': ${html}`);
    }
  }
});

Deno.test("markdownPreview: preserves URLs containing asterisks and avoids swallowing doc after unclosed table/math", () => {
  const withWildcards = renderMarkdownToHtml("[**Docs**](https://example.com/*a*/*b*) ![alt *tag*](javascript:alert(1))");
  assert(withWildcards.includes('href="https://example.com/*a*/*b*"'), `URL corrupted: ${withWildcards}`);
  assert(withWildcards.includes("<strong>Docs</strong>"), `Link label bold failed: ${withWildcards}`);
  assert(!withWildcards.includes("<em>a</em>"), `Corrupted URL with <em>: ${withWildcards}`);
  assert(withWildcards.includes("<!-- [image: alt *tag*] -->"), `Fallback comment corrupted: ${withWildcards}`);

  const unclosedTable = renderMarkdownToHtml("<table><tr><td>broken\n\n# Real Heading");
  assert(unclosedTable.includes("<h1>Real Heading</h1>"), `Unclosed <table> swallowed heading: ${unclosedTable}`);

  const unclosedMath = renderMarkdownToHtml("<math><mi>x</mi>\n\nAfter math paragraph");
  assert(unclosedMath.includes("<p>After math paragraph</p>"), `Unclosed <math> swallowed paragraph: ${unclosedMath}`);
});

Deno.test("markdownPreview: handles many unclosed html blocks linearly without swallowing trailing markdown", () => {
  const repeatedUnclosed = Array.from({ length: 1200 }, (_, idx) =>
    idx % 2 === 0 ? `<table>row-${idx}` : `<math>expr-${idx}`,
  ).join("\n");
  const md = `${repeatedUnclosed}\n\n# Final Section\n\nTrailing content stays intact.`;
  const start = Date.now();
  const html = renderMarkdownToHtml(md);
  const elapsedMs = Date.now() - start;

  assert(elapsedMs < 1500, `Expected linear runtime (<1500ms), took ${elapsedMs}ms`);
  assert(html.includes("<h1>Final Section</h1>"), "Trailing heading must render");
  assert(html.includes("<p>Trailing content stays intact.</p>"), "Trailing paragraph must render");
});
