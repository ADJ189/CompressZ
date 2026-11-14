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
