/**
 * Minimal, dependency-free markdown renderer for the split edit/preview editor.
 * Input is escaped before any markup is generated, so arbitrary HTML in entry
 * content cannot reach the DOM. Covers the subset engineers actually use in
 * knowledge notes: headings, emphasis, inline code, fenced code, lists, quotes,
 * links, pipe tables, and paragraphs. The one raw tag honoured is `<br>`
 * (outside code spans), because GFM tables have no other way to break a line
 * inside a cell. Anything else renders as plain text.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeUrl(url: string): boolean {
  return /^(https?:\/\/|\/|#|mailto:)/i.test(url.trim());
}

const ESCAPED_LINE_BREAK_TAG = /&lt;br\s*\/?&gt;/gi;

function renderInline(escaped: string): string {
  let html = escaped.split(/(`[^`]+`)/g)
    .map((part, index) => index % 2 === 1 ? part : part.replace(ESCAPED_LINE_BREAK_TAG, "<br/>"))
    .join("");
  html = html.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, (_match, text: string) => `<strong>${text}</strong>`);
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, (_match, prefix: string, text: string) => `${prefix}<em>${text}</em>`);
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, url: string) => {
    if (!isSafeUrl(url)) {
      return match;
    }
    return `<a href="${url}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });
  return html;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
}

export function renderMarkdownPreview(markdown: string, { omitTaskListMarkers = false }: { omitTaskListMarkers?: boolean } = {}): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let codeLines: string[] | null = null;
  let fenceLength = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map((line) => renderInline(escapeHtml(line))).join("<br/>")}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0 && listKind) {
      blocks.push(`<${listKind}>${listItems.join("")}</${listKind}>`);
      listItems = [];
      listKind = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (codeLines !== null) {
      const closingFence = line.trim();
      if (closingFence.length >= fenceLength && /^`+$/.test(closingFence)) {
        blocks.push(`<pre><code>${codeLines.map(escapeHtml).join("\n")}</code></pre>`);
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const openingFence = line.trimStart().match(/^(`{3,})[^`]*$/);
    if (openingFence) {
      flushParagraph();
      flushList();
      codeLines = [];
      fenceLength = openingFence[1].length;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInline(escapeHtml(headingMatch[2]))}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInline(escapeHtml(quoteMatch[1]))}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      const [, marker, text] = listMatch;
      const kind = marker.endsWith(".") ? "ol" : "ul";
      if (listKind !== kind) {
        flushList();
        listKind = kind;
      }
      const content = omitTaskListMarkers ? text.replace(/^\[[ \txX]\](?:[ \t]+|$)/, "") : text;
      listItems.push(`<li>${renderInline(escapeHtml(content))}</li>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    if (/(?<!\\)\|/.test(line) && index + 1 < lines.length) {
      const headers = splitTableRow(line);
      const separator = splitTableRow(lines[index + 1]);
      if (headers.length === separator.length && separator.every((cell) => /^:?-+:?$/.test(cell))) {
        flushParagraph();
        flushList();
        const head = headers.map((cell) => `<th scope="col">${renderInline(escapeHtml(cell))}</th>`).join("");
        const rows: string[] = [];
        index += 1;
        while (index + 1 < lines.length) {
          const row = lines[index + 1];
          if (!/(?<!\\)\|/.test(row) || /^\s*(?:#{1,6}\s|>|[-*]\s|\d+\.\s|`{3,})/.test(row)) break;
          const cells = splitTableRow(row);
          rows.push(`<tr>${headers.map((_, column) => `<td>${renderInline(escapeHtml(cells[column] ?? ""))}</td>`).join("")}</tr>`);
          index += 1;
        }
        blocks.push(`<table><thead><tr>${head}</tr></thead>${rows.length ? `<tbody>${rows.join("")}</tbody>` : ""}</table>`);
        continue;
      }
    }

    flushList();
    paragraph.push(line);
  }

  if (codeLines !== null) {
    blocks.push(`<pre><code>${codeLines.map(escapeHtml).join("\n")}</code></pre>`);
  }
  flushParagraph();
  flushList();

  return blocks.join("\n");
}
