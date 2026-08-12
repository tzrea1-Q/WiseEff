import { describe, expect, it } from "vitest";

import {
  createKnowledgeEntryBodySchema,
  listKnowledgeEntriesQuerySchema,
  restoreKnowledgeRevisionBodySchema,
  searchKnowledgeQuerySchema,
  updateKnowledgeEntryBodySchema
} from "./schemas";

describe("knowledge schemas", () => {
  it("accepts a markdown create body and defaults tags/content", () => {
    const parsed = createKnowledgeEntryBodySchema.parse({
      contentForm: "markdown",
      title: "Tuning notes"
    });
    expect(parsed).toEqual({ contentForm: "markdown", title: "Tuning notes", tags: [], contentMarkdown: "" });
  });

  it("accepts a file create body with base64 content", () => {
    const parsed = createKnowledgeEntryBodySchema.parse({
      contentForm: "file",
      title: "Datasheet",
      tags: ["hardware"],
      file: {
        fileName: "sheet.pdf",
        contentType: "application/pdf",
        contentBase64: Buffer.from("pdf-bytes").toString("base64")
      }
    });
    expect(parsed.contentForm).toBe("file");
  });

  it("rejects a file create body with an unsupported content type", () => {
    const result = createKnowledgeEntryBodySchema.safeParse({
      contentForm: "file",
      title: "Image",
      file: { fileName: "shot.png", contentType: "image/png", contentBase64: Buffer.from("x").toString("base64") }
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid base64 file content", () => {
    const result = createKnowledgeEntryBodySchema.safeParse({
      contentForm: "file",
      title: "Broken",
      file: { fileName: "a.txt", contentType: "text/plain", contentBase64: "@@not-base64@@" }
    });
    expect(result.success).toBe(false);
  });

  it("requires expectedHeadRevisionNumber plus at least one change on update", () => {
    expect(updateKnowledgeEntryBodySchema.safeParse({ expectedHeadRevisionNumber: 1 }).success).toBe(false);
    expect(updateKnowledgeEntryBodySchema.safeParse({ contentMarkdown: "x" }).success).toBe(false);
    expect(
      updateKnowledgeEntryBodySchema.safeParse({ expectedHeadRevisionNumber: 1, contentMarkdown: "x" }).success
    ).toBe(true);
  });

  it("requires expectedHeadRevisionNumber on revision restore", () => {
    expect(restoreKnowledgeRevisionBodySchema.safeParse({}).success).toBe(false);
    expect(restoreKnowledgeRevisionBodySchema.safeParse({ expectedHeadRevisionNumber: 2 }).success).toBe(true);
  });

  it("parses list filters and coerces limit", () => {
    const parsed = listKnowledgeEntriesQuerySchema.parse({ status: "published", tag: "aurora", limit: "25" });
    expect(parsed).toEqual({ status: "published", tag: "aurora", limit: 25 });
  });

  it("requires a non-empty search query", () => {
    expect(searchKnowledgeQuerySchema.safeParse({ q: "" }).success).toBe(false);
    expect(searchKnowledgeQuerySchema.safeParse({ q: "快充" }).success).toBe(true);
  });
});
