import { describe, expect, it } from "vitest";

import { chunkExtractedText, chunkMarkdown } from "./chunking";

describe("chunkMarkdown", () => {
  it("splits heading sections and carries the title + heading breadcrumb", () => {
    const chunks = chunkMarkdown({
      title: "快充温控调参经验",
      markdown: [
        "# 背景",
        "",
        "当电池温度超过 45 度时需要降流。",
        "",
        "## 操作步骤",
        "",
        "按 0.5A 步长下调快充电流,观察 NTC 采样。"
      ].join("\n")
    });

    expect(chunks.length).toBe(2);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].text).toContain("快充温控调参经验 › 背景");
    expect(chunks[0].text).toContain("45 度");
    expect(chunks[1].text).toContain("快充温控调参经验 › 背景 › 操作步骤");
    expect(chunks[1].text).toContain("0.5A");
  });

  it("replaces sibling headings instead of nesting them in the breadcrumb", () => {
    const chunks = chunkMarkdown({
      title: "T",
      markdown: ["## A", "", "aaa", "", "## B", "", "bbb"].join("\n")
    });

    expect(chunks[1].text).toContain("T › B");
    expect(chunks[1].text).not.toContain("T › A › B");
  });

  it("windows long sections into overlapping chunks", () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => `Paragraph ${index} ${"x".repeat(180)}.`);
    const chunks = chunkMarkdown(
      { title: "Long doc", markdown: paragraphs.join("\n\n") },
      { maxChars: 500, overlapChars: 120 }
    );

    expect(chunks.length).toBeGreaterThan(2);
    // Overlap: some trailing content of chunk N reappears at the head of chunk N+1.
    const firstBody = chunks[0].text;
    const secondBody = chunks[1].text;
    const tail = firstBody.slice(-60).trim();
    expect(tail.length).toBeGreaterThan(0);
    expect(secondBody).toContain(tail.split(" ").at(-1) ?? "");
    // Chunk indexes stay sequential from 0.
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
  });

  it("does not treat code-fence comments as headings", () => {
    const chunks = chunkMarkdown({
      title: "T",
      markdown: ["```bash", "# not a heading", "```", "", "body text"].join("\n")
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("# not a heading");
  });

  it("falls back to the title for empty markdown", () => {
    expect(chunkMarkdown({ title: "只有标题", markdown: "" })).toEqual([{ chunkIndex: 0, text: "只有标题" }]);
  });

  it("hard-splits oversized paragraphs without dropping text", () => {
    const bigParagraph = `${"句子。".repeat(600)}`;
    const chunks = chunkMarkdown({ title: "T", markdown: bigParagraph }, { maxChars: 400, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(3);
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(bigParagraph.length);
  });
});

describe("chunkExtractedText", () => {
  it("windows paragraphs with the title prefix", () => {
    const chunks = chunkExtractedText({
      title: "MT5788 手册",
      text: "第一段说明。\n\n第二段说明。\n\n第三段说明。"
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("MT5788 手册");
    expect(chunks[0].text).toContain("第二段说明");
  });

  it("splits single-newline text when no blank-line paragraphs exist", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `Line ${index} ${"y".repeat(80)}`);
    const chunks = chunkExtractedText({ title: "Manual", text: lines.join("\n") }, { maxChars: 400, overlapChars: 80 });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.text.startsWith("Manual"))).toBe(true);
  });

  it("returns the bare title for empty extracted text", () => {
    expect(chunkExtractedText({ title: "Empty", text: "  " })).toEqual([{ chunkIndex: 0, text: "Empty" }]);
  });
});
