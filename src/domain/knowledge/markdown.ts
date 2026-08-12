/**
 * Minimal, dependency-free markdown renderer for the split edit/preview editor.
 * Input is escaped before any markup is generated, so arbitrary HTML in entry
 * content cannot reach the DOM. Covers the subset engineers actually use in
 * knowledge notes: headings, emphasis, inline code, fenced code, lists, quotes,
 * links, and paragraphs. Anything else renders as plain text.
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

function renderInline(escaped: string): string {
  let html = escaped;
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

export function renderMarkdownPreview(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listKind: "ul" | "ol" | null = null;
  let codeLines: string[] | null = null;

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

  for (const line of lines) {
    if (codeLines !== null) {
      if (line.trimEnd() === "```") {
        blocks.push(`<pre><code>${codeLines.map(escapeHtml).join("\n")}</code></pre>`);
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
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

    const unorderedMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listKind !== "ul") {
        flushList();
        listKind = "ul";
      }
      listItems.push(`<li>${renderInline(escapeHtml(unorderedMatch[1]))}</li>`);
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listKind !== "ol") {
        flushList();
        listKind = "ol";
      }
      listItems.push(`<li>${renderInline(escapeHtml(orderedMatch[1]))}</li>`);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
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
