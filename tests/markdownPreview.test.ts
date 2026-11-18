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

Deno.test("markdownPreview: renders converter HTML table and MathML without visible tag escaping", () => {
  const tableInput = `<table>\n  <thead>\n    <tr><th>Col 1</th><th>Col 2</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>Val 1</td><td>Val 2</td></tr>\n  </tbody>\n</table>`;
  const tableHtml = renderMarkdownToHtml(tableInput);
  assert(tableHtml.includes("<table"), `Should render table element: ${tableHtml}`);
  assert(!tableHtml.includes("&lt;table"), `Should not escape table into &lt;table: ${tableHtml}`);

  const mathInput = `<math display="block"><mrow><mtext>E = mc^2</mtext></mrow></math>`;
  const mathHtml = renderMarkdownToHtml(mathInput);
  assert(mathHtml.includes("<math"), `Should render math element: ${mathHtml}`);
  assert(!mathHtml.includes("&lt;math"), `Should not escape math into &lt;math: ${mathHtml}`);

  // Disallowed arbitrary HTML (like script or iframe) must still be escaped
  const scriptInput = `<script>alert(1)</script>`;
  const scriptHtml = renderMarkdownToHtml(scriptInput);
  assert(!scriptHtml.includes("<script>"));
  assert(scriptHtml.includes("&lt;script&gt;"));

  // MathML with entity-encoded or unauthorized attributes must not leak raw attributes
  const hostileMath = `<math><mtext href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">foo</mtext></math>`;
  const hostileMathHtml = renderMarkdownToHtml(hostileMath);
  assert(!hostileMathHtml.includes("javascript:"));
  assert(!hostileMathHtml.includes("<mtext href="));

  // Table with quoted '>' hiding event handlers must not leak handlers or raw markup
  const hostileTable = `<table><tr><td title=">" onmouseover="alert(1)">Cell</td></tr></table>`;
  const hostileTableHtml = renderMarkdownToHtml(hostileTable);
  assert(!hostileTableHtml.includes("onmouseover"));
  assert(!hostileTableHtml.includes("alert(1)"));
});
