import { describe, expect, it } from "vitest";
import { productFeedbackAdminDtoSchema, productFeedbackDtoSchemaCatalog, productFeedbackUserDtoSchema } from "./productFeedback";

const publicItem = {
  id: "feedback-1", organizationId: "org-1", pagePath: "/logs", pageTitle: "Logs",
  feedbackType: "experience", description: "More details", status: "in_progress", resolutionCode: null,
  submittedAt: "2026-10-15T00:00:00.000Z", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T01:00:00.000Z",
  attachments: [], progressEvents: [{
    id: "event-1", feedbackId: "feedback-1", kind: "progress", fromStatus: "in_progress", toStatus: "in_progress",
    resolutionCode: null, publicMessage: "Public update", author: "team", createdAt: "2026-10-15T01:00:00.000Z"
  }]
};

describe("feedback API DTO contracts", () => {
  it("accepts public replies while rejecting private fields from user responses", () => {
    expect(productFeedbackUserDtoSchema.safeParse(publicItem).success).toBe(true);
    expect(productFeedbackUserDtoSchema.safeParse({ ...publicItem, adminNote: "private" }).success).toBe(false);
    expect(productFeedbackUserDtoSchema.safeParse({ ...publicItem, progressEvents: [{ ...publicItem.progressEvents[0], internalMessage: "private", actorUserId: "admin-1" }] }).success).toBe(false);
    expect(productFeedbackAdminDtoSchema.safeParse({
      ...publicItem, submitterUserId: "user-1", submitter: { id: "user-1", name: "User", username: null },
      adminNote: null, priority: "high", assigneeUserId: null, assignee: null,
      progressEvents: [{ ...publicItem.progressEvents[0], internalMessage: "private", actorUserId: "admin-1" }]
    }).success).toBe(true);
  });

  it("shares runtime request validation and requires opaque response cursors", () => {
    expect(productFeedbackDtoSchemaCatalog.CreateProductFeedbackDraftRequest.safeParse({ description: "Draft" }).success).toBe(true);
    expect(productFeedbackDtoSchemaCatalog.PatchProductFeedbackDraftRequest.parse({ retainedAttachmentIds: [] })).toEqual({ retainedAttachmentIds: [] });
    expect(productFeedbackDtoSchemaCatalog.ReplyToProductFeedbackRequest.safeParse({ message: " " }).success).toBe(false);
    expect(productFeedbackDtoSchemaCatalog.PatchProductFeedbackRequest.safeParse({ priority: "urgent" }).success).toBe(false);
    expect(productFeedbackDtoSchemaCatalog.ProductFeedbackUserListResponse.safeParse({ items: [publicItem], nextCursor: "opaque" }).success).toBe(true);
    expect(productFeedbackDtoSchemaCatalog.ProductFeedbackUserListResponse.safeParse({ items: [publicItem], nextCursor: { updatedAt: "2026-10-15T01:00:00.123456Z", id: "feedback-1" } }).success).toBe(false);
  });
});
