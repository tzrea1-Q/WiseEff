import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createDefaultKnowledgeTextExtractor } from "./extraction";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "testing", "fixtures");
const extractor = createDefaultKnowledgeTextExtractor();

describe("createDefaultKnowledgeTextExtractor", () => {
  it("passes plain text through unchanged", async () => {
    const outcome = await extractor.extract({
      fileName: "notes.txt",
      contentType: "text/plain",
      bytes: Buffer.from("充电参数调优笔记\r\nfast charge current", "utf8")
    });

    expect(outcome).toEqual({ status: "succeeded", text: "充电参数调优笔记\nfast charge current" });
  });

  it.each(["", " \r\n\t\u0000"])("reports empty plain text as failed (%j)", async (text) => {
    const outcome = await extractor.extract({
      fileName: "empty.txt",
      contentType: "text/plain",
      bytes: Buffer.from(text, "utf8")
    });

    expect(outcome).toEqual({ status: "failed", reason: "无可提取文本" });
  });

  it("passes markdown through unchanged", async () => {
    const outcome = await extractor.extract({
      fileName: "notes.md",
      contentType: "text/markdown",
      bytes: Buffer.from("# Heading\n\nbody", "utf8")
    });

    expect(outcome).toEqual({ status: "succeeded", text: "# Heading\n\nbody" });
  });

  it("extracts text from a real PDF via pdf-parse", async () => {
    const outcome = await extractor.extract({
      fileName: "sample.pdf",
      contentType: "application/pdf",
      bytes: readFileSync(join(fixturesDir, "sample.pdf"))
    });

    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.text).toContain("WiseEff knowledge pdf fixture");
    }
  });

  it("keeps a line break between PDF pages without page-number markers", async () => {
    const outcome = await extractor.extract({
      fileName: "multipage.pdf",
      contentType: "application/pdf",
      bytes: readFileSync(join(fixturesDir, "multipage.pdf"))
    });

    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.text).toBe("First page text\n\n\n\nSecond page text");
      expect(outcome).toMatchObject({ pageOffsets: [0, 19] });
    }
  });

  it("extracts text from a real .docx via mammoth", async () => {
    const outcome = await extractor.extract({
      fileName: "sample.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: readFileSync(join(fixturesDir, "sample.docx"))
    });

    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.text).toContain("WiseEff knowledge docx fixture");
    }
  });

  it("counts a leading blank physical page even when extraction trims its whitespace", async () => {
    const bytes = readFileSync(join(fixturesDir, "multipage.pdf"));
    const outcome = await extractor.extract({
      fileName: "blank-first-page.pdf", contentType: "application/pdf",
      bytes: Buffer.from(bytes.toString().replace("First page text", "               "))
    });
    expect(outcome).toEqual({ status: "succeeded", text: "Second page text", pageOffsets: [0, 0] });
  });

  it("retains a trailing blank page at the end of the trimmed extracted text", async () => {
    const bytes = readFileSync(join(fixturesDir, "multipage.pdf"));
    const outcome = await extractor.extract({
      fileName: "blank-last-page.pdf", contentType: "application/pdf",
      bytes: Buffer.from(bytes.toString().replace("Second page text", "                "))
    });
    expect(outcome).toEqual({ status: "succeeded", text: "First page text", pageOffsets: [0, 15] });
  });

  it("records a broken PDF as an honest failure instead of throwing", async () => {
    const outcome = await extractor.extract({
      fileName: "broken.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("not a pdf at all", "utf8")
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });

  it("records legacy .doc uploads as failed with a readable reason", async () => {
    const outcome = await extractor.extract({
      fileName: "legacy.doc",
      contentType: "application/msword",
      bytes: Buffer.from("legacy binary", "utf8")
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.reason).toContain(".docx");
    }
  });
});
