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
  const cases = [
    "[a](javascript:alert('http://x'))",
    "[b](//evil.com/path)",
    "[c](///evil.com/path)",
    "[d](data:text/html,<b>)",
    "[e](JaVaScRiPt:void(0))",
    "[f](vbscript:msgbox(1))",
    "[g](java script:alert(1))",
  ];
  for (const input of cases) {
    const html = renderMarkdownToHtml(input);
    assert(
      !/href="(?:javascript|data|vbscript|[/][/])/i.test(html),
      `Unsafe href survived: ${input} -> ${html}`,
    );
  }
});

Deno.test("markdownPreview: escapes href ampersands exactly once", () => {
  const html = renderMarkdownToHtml("[q](https://a.test/?b=1&c=2)");
  assert(html.includes('href="https://a.test/?b=1&amp;c=2"'), `Unexpected href: ${html}`);
  assert(!html.includes("&amp;amp;"), "Href must not be double-escaped");
});

Deno.test("markdownPreview: allows mailto and site-relative links", () => {
  const mail = renderMarkdownToHtml("[m](mailto:a@b.test)");
  const rel = renderMarkdownToHtml("[r](/docs/privacy)");
  const anchor = renderMarkdownToHtml("[t](#section)");
  assert(mail.includes('href="mailto:a@b.test"'), "mailto kept");
  assert(rel.includes('href="/docs/privacy"'), "relative path kept");
  assert(anchor.includes('href="#section"'), "in-page anchor kept");
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
  const dataImg = "![Sample](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==)";
  const html = renderMarkdownToHtml(dataImg);
  assert(html.includes('<img src="data:image/png;base64,'));
  assert(html.includes('alt="Sample"'));

  const badImg = "![Exploit](javascript:alert(1))";
  const badHtml = renderMarkdownToHtml(badImg);
  assert(!badHtml.includes("<img"));
  assert(badHtml.includes("<!-- [image: Exploit] -->"));
});

Deno.test("markdownPreview: F4 does not create emphasis inside code spans", () => {
  const input = "Use `foo * bar * baz` in your code.";
  const html = renderMarkdownToHtml(input);
  assert(html.includes("<code>foo * bar * baz</code>"));
  assert(!html.includes("<em>bar</em>"));
});
