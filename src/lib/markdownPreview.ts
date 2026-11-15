/**
 * markdownPreview.ts — Safe, deterministic, zero-dependency Markdown to HTML renderer.
 *
 * Implements strict HTML escaping to guarantee XSS prevention while rendering
 * structured typography, tables, LaTeX math equations, code blocks, and lists.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validate a link target that has already been HTML-escaped by `renderInline`.
 *
 * Only explicit web/mail schemes, single-slash site-relative paths and in-page
 * anchors are accepted. Everything else — `javascript:`, `data:`,
 * protocol-relative `//host`, bare words — is rejected. The URL must NOT be
 * escaped again here: it already went through `escapeHtml`, so escaping twice
 * turns `&` into `&amp;amp;` and breaks legitimate query strings.
 */
function safeHref(escapedUrl: string): string | null {
  const url = escapedUrl.trim();
  if (/^https?:\/\/[^\s]+/i.test(url)) return url;
  if (/^mailto:[^\s@]+@[^\s@]+/i.test(url)) return url;
  if (/^\/(?!\/)/.test(url)) return url; // "/x" but not "//evil.com"
  if (/^#[^\s]*$/.test(url)) return url;
  return null;
}

function safeImgSrc(escapedUrl: string): string | null {
  const url = escapedUrl.trim();
  if (
    /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(
      url,
    )
  ) {
    return url;
  }
  if (/^https?:\/\/[^\s]+/i.test(url)) return url;
  if (/^(?:\.\/|\/)?assets\/[^\s]+/i.test(url)) return url;
  return null;
}

function renderInline(text: string): string {
  let result = escapeHtml(text);

  const tokens: string[] = [];
  const stash = (html: string) => {
    const idx = tokens.length;
    tokens.push(html);
    return `%%CZ_TOKEN_${idx}%%`;
  };

  // LaTeX inline math $ ... $
  result = result.replace(/\$([^$\n]+?)\$/g, (_match, math) => {
    return stash(`<code class="cz-math-inline">${math}</code>`);
  });

  // Inline code `...`
  result = result.replace(/`([^`\n]+?)`/g, (_match, code) => {
    return stash(`<code>${code}</code>`);
  });

  // Images ![alt](src) (handled before links)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
    const safe = safeImgSrc(src);
    if (!safe) return `<!-- [image: ${escapeHtml(alt)}] -->`;
    return stash(
      `<img src="${safe}" alt="${escapeHtml(alt)}" class="cz-rendered-img" />`,
    );
  });

  // Bold **...**
  result = result.replace(/\*\*([^*\n]+?)\*\*/g, (_match, bold) => {
    return `<strong>${bold}</strong>`;
  });

  // Italic *...*
  result = result.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, (_match, italic) => {
    return `<em>${italic}</em>`;
  });

  // Links [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const safeHrefValue = safeHref(href) ?? "#";
    return `<a href="${safeHrefValue}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Restore stashed code/math/image tokens
  return result.replace(
    /%%CZ_TOKEN_(\d+)%%/g,
    (_m, idx) => tokens[Number(idx)] ?? "",
  );
}

export function renderMarkdownToHtml(markdown: string): string {
  if (!markdown) return "";

  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];

  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = "";

  let inMathBlock = false;
  let mathBuffer: string[] = [];

  let inTable = false;
  let tableRows: string[][] = [];

  let inList: "ul" | "ol" | null = null;

  function closeList() {
    if (inList) {
      out.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  }

  function flushTable() {
    if (!inTable || tableRows.length === 0) {
      inTable = false;
      tableRows = [];
      return;
    }

    const header = tableRows[0];
    const dataRows = tableRows
      .slice(1)
      .filter((r) => !r.every((c) => /^:?-+:?$/.test(c.trim())));
    const maxCols = Math.max(1, ...tableRows.map((r) => r.length));

    let tableHtml =
      '<div class="cz-table-wrap"><table class="cz-rendered-table"><thead><tr>';
    for (let i = 0; i < maxCols; i++) {
      const col = header[i] ? header[i].trim() : "";
      tableHtml += `<th>${renderInline(col)}</th>`;
    }
    tableHtml += "</tr></thead><tbody>";

    for (const row of dataRows) {
      tableHtml += "<tr>";
      for (let i = 0; i < maxCols; i++) {
        const cell = row[i] ? row[i].trim() : "";
        tableHtml += `<td>${renderInline(cell)}</td>`;
      }
      tableHtml += "</tr>";
    }

    tableHtml += "</tbody></table></div>";
    out.push(tableHtml);

    inTable = false;
    tableRows = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block toggle ```
    if (trimmed.startsWith("```")) {
      closeList();
      flushTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
        codeBuffer = [];
      } else {
        inCodeBlock = false;
        const codeContent = escapeHtml(codeBuffer.join("\n"));
        const langAttr = codeLang
          ? ` data-lang="${escapeHtml(codeLang)}"`
          : "";
        out.push(
          `<pre class="cz-code-block"${langAttr}><code>${codeContent}</code></pre>`,
        );
        codeBuffer = [];
        codeLang = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Multi-line LaTeX math block toggle/content
    if (inMathBlock) {
      if (
        trimmed === "$$" ||
        (trimmed.endsWith("$$") && !trimmed.startsWith("$$"))
      ) {
        if (trimmed !== "$$") {
          mathBuffer.push(trimmed.slice(0, -2).trim());
        }
        out.push(
          `<div class="cz-rendered-math-block"><code>${escapeHtml(mathBuffer.join("\n").trim())}</code></div>`,
        );
        inMathBlock = false;
        mathBuffer = [];
        continue;
      }
      mathBuffer.push(line);
      continue;
    }

    if (trimmed === "$$") {
      closeList();
      flushTable();
      inMathBlock = true;
      mathBuffer = [];
      continue;
    }

    // Single-line LaTeX Display math block $$ ... $$
    if (
      trimmed.startsWith("$$") &&
      trimmed.endsWith("$$") &&
      trimmed.length > 4
    ) {
      closeList();
      flushTable();
      const math = trimmed.slice(2, -2).trim();
      out.push(
        `<div class="cz-rendered-math-block"><code>${escapeHtml(math)}</code></div>`,
      );
      continue;
    }

    // Table rows | ... |
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      inTable = true;
      const cells = trimmed
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, "|").trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Empty line
    if (!trimmed) {
      closeList();
      continue;
    }

    // Horizontal rule --- or ***
    if (/^(---|___|\*\*\*)$/.test(trimmed)) {
      closeList();
      out.push('<hr class="cz-rendered-hr" />');
      continue;
    }

    // Headings
    if (trimmed.startsWith("# ")) {
      closeList();
      out.push(`<h1>${renderInline(trimmed.slice(2))}</h1>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeList();
      out.push(`<h2>${renderInline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("### ")) {
      closeList();
      out.push(`<h3>${renderInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("#### ")) {
      closeList();
      out.push(`<h4>${renderInline(trimmed.slice(5))}</h4>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      closeList();
      out.push(`<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered List
    if (/^[-*+]\s+/.test(trimmed)) {
      if (inList !== "ul") {
        closeList();
        inList = "ul";
        out.push("<ul>");
      }
      const itemText = trimmed.replace(/^[-*+]\s+/, "");
      out.push(`<li>${renderInline(itemText)}</li>`);
      continue;
    }

    // Ordered List
    if (/^\d+\.\s+/.test(trimmed)) {
      if (inList !== "ol") {
        closeList();
        inList = "ol";
        out.push("<ol>");
      }
      const itemText = trimmed.replace(/^\d+\.\s+/, "");
      out.push(`<li>${renderInline(itemText)}</li>`);
      continue;
    }

    // Normal paragraph
    closeList();
    out.push(`<p>${renderInline(trimmed)}</p>`);
  }

  closeList();
  flushTable();

  if (inCodeBlock && codeBuffer.length > 0) {
    const codeContent = escapeHtml(codeBuffer.join("\n"));
    out.push(`<pre class="cz-code-block"><code>${codeContent}</code></pre>`);
  }

  if (inMathBlock && mathBuffer.length > 0) {
    out.push(
      `<div class="cz-rendered-math-block"><code>${escapeHtml(mathBuffer.join("\n").trim())}</code></div>`,
    );
  }

  return out.join("\n");
}
