import { describe, expect, it } from "vitest";

import {
  createProductFeedbackBodySchema,
  listProductFeedbackQuerySchema,
  patchProductFeedbackBodySchema
} from "./schemas";

function validAttachment(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "screenshot.png",
    contentType: "image/png",
    contentBase64: Buffer.from("image-bytes").toString("base64"),
    ...overrides
  };
}

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    pagePath: "/parameters",
    pageTitle: "Project Parameters",
    feedbackType: "experience",
    description: "The buttons are hard to scan.",
    ...overrides
  };
}

describe("product feedback schemas", () => {
  it("accepts a valid create body with supported image attachments", () => {
    const result = createProductFeedbackBodySchema.safeParse(
      validCreateBody({
        attachments: [
          validAttachment({ contentType: "image/png" }),
          validAttachment({ fileName: "shot.webp", contentType: "image/webp" })
        ]
      })
    );

    expect(result.success).toBe(true);
  });

  it("rejects more than 5 attachments", () => {
    const attachments = Array.from({ length: 6 }, (_, index) => validAttachment({ fileName: `shot-${index}.png` }));

    expect(createProductFeedbackBodySchema.safeParse(validCreateBody({ attachments })).success).toBe(false);
  });

  it("rejects unsupported attachment MIME types and invalid base64", () => {
    expect(
      createProductFeedbackBodySchema.safeParse(
        validCreateBody({
          attachments: [validAttachment({ contentType: "application/pdf" })]
        })
      ).success
    ).toBe(false);

    expect(
      createProductFeedbackBodySchema.safeParse(
        validCreateBody({
          attachments: [validAttachment({ contentBase64: "not base64" })]
        })
      ).success
    ).toBe(false);
  });

  it("enforces create body field lengths", () => {
    expect(createProductFeedbackBodySchema.safeParse(validCreateBody({ pagePath: "" })).success).toBe(false);
    expect(createProductFeedbackBodySchema.safeParse(validCreateBody({ pagePath: "x".repeat(501) })).success).toBe(false);
    expect(createProductFeedbackBodySchema.safeParse(validCreateBody({ pageTitle: "x".repeat(201) })).success).toBe(false);
    expect(createProductFeedbackBodySchema.safeParse(validCreateBody({ description: "x".repeat(4001) })).success).toBe(false);
  });

  it("accepts list query filters for admin triage", () => {
    const result = listProductFeedbackQuerySchema.safeParse({
      status: "open",
      feedbackType: "data",
      q: "export",
      pagePath: "/parameters",
      createdFrom: "2026-07-01T00:00:00.000Z",
      createdTo: "2026-07-08T00:00:00.000Z",
      cursor: "opaque-cursor",
      limit: "25"
    });

    expect(result.success).toBe(true);
    expect(result.data?.limit).toBe(25);
  });

  it("rejects patch on empty body and caps admin note length", () => {
    expect(patchProductFeedbackBodySchema.safeParse({}).success).toBe(false);
    expect(patchProductFeedbackBodySchema.safeParse({ adminNote: "x".repeat(2001) }).success).toBe(false);
    expect(patchProductFeedbackBodySchema.safeParse({ status: "in_progress" }).success).toBe(true);
    expect(patchProductFeedbackBodySchema.safeParse({ adminNote: "" }).success).toBe(true);
    expect(patchProductFeedbackBodySchema.parse({ adminNote: null })).toEqual({ adminNote: null });
  });
});
