import { describe, expect, it } from "vitest";

import { renderMarkdownPreview } from "./markdown";

describe("renderMarkdownPreview", () => {
  it("renders headings, lists, quotes, and paragraphs", () => {
    const html = renderMarkdownPreview("# 标题\n\n正文第一行\n\n- 项目一\n- 项目二\n\n> 引用");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<p>正文第一行</p>");
    expect(html).toContain("<ul><li>项目一</li><li>项目二</li></ul>");
    expect(html).toContain("<blockquote>引用</blockquote>");
  });

  it("renders ordered lists and fenced code", () => {
    const html = renderMarkdownPreview("1. one\n2. two\n\n```\nconst x = 1 < 2;\n```");
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(html).toContain("<pre><code>const x = 1 &lt; 2;</code></pre>");
  });

  it("renders inline emphasis, code, and safe links", () => {
    const html = renderMarkdownPreview("**加粗** *斜体* `code` [文档](https://example.com)");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer noopener">文档</a>');
  });

  it("escapes raw HTML so entry content cannot inject markup", () => {
    const html = renderMarkdownPreview('<img src=x onerror="alert(1)"> <script>alert(2)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses javascript: links", () => {
    const html = renderMarkdownPreview("[x](javascript:alert(1))");
    expect(html).not.toContain("<a ");
  });
});
