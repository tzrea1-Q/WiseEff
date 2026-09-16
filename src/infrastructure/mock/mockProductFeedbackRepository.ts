import type { ProductFeedbackListQuery, ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type {
  ProductFeedback,
  ProductFeedbackAttachment,
  ProductFeedbackProgressEventKind,
  ProductFeedbackStatus
} from "@/domain/productFeedback/types";
import { mockApiError } from "./mockApiError";

const MOCK_PRODUCT_FEEDBACK_NOW = "2026-07-08T00:00:00.000Z";

type StoredAttachment = ProductFeedbackAttachment & { file?: File };

function cloneFeedback(feedback: ProductFeedback): ProductFeedback {
  return {
    ...feedback,
    attachments: feedback.attachments.map((attachment) => ({ ...attachment }))
  };
}

function includesText(value: string, q: string) {
  return value.toLocaleLowerCase().includes(q.toLocaleLowerCase());
}

function matchesQuery(feedback: ProductFeedback, query?: ProductFeedbackListQuery) {
  if (feedback.submittedAt === null) return false;
  if (!query) return true;
  if (query.status && feedback.status !== query.status) return false;
  if (query.feedbackType && feedback.feedbackType !== query.feedbackType) return false;
  if (query.pagePath && feedback.pagePath !== query.pagePath) return false;
  if (query.createdFrom && feedback.createdAt < query.createdFrom) return false;
  if (query.createdTo && feedback.createdAt > query.createdTo) return false;
  if (query.q && !includesText(`${feedback.pageTitle} ${feedback.description} ${feedback.pagePath}`, query.q)) return false;
  return true;
}

function assertFeedbackExists(feedback: ProductFeedback | undefined, id: string): ProductFeedback {
  if (!feedback) throw mockApiError("NOT_FOUND", `Product feedback not found: ${id}`, { id });
  return feedback;
}

function isValidStatusTransition(current: ProductFeedbackStatus, next: ProductFeedbackStatus) {
  if (current === next) return true;
  if (current === "open") return next === "in_progress";
  if (current === "in_progress") return next === "closed" || next === "resolved";
  if (current === "resolved") return next === "closed" || next === "in_progress";
  if (current === "closed") return next === "in_progress";
  return false;
}

function createFallbackObjectUrl(file: File) {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(file);
  }
  return `mock-product-feedback://${encodeURIComponent(file.name)}`;
}

export function createMockProductFeedbackRepository(initialItems: ProductFeedback[] = []): ProductFeedbackRepository {
  let counter = initialItems.length;
  const attachmentFiles = new Map<string, File>();
  let items = initialItems.map(cloneFeedback);

  return {
    async submit(input) {
      counter += 1;
      const id = `mock-feedback-${counter}`;
      const attachments: StoredAttachment[] = input.files.map((file, index) => {
        const attachment = {
          id: `${id}-attachment-${index + 1}`,
          feedbackId: id,
          fileName: file.name,
          contentType: (file.type || "image/png") as ProductFeedbackAttachment["contentType"],
          sizeBytes: file.size,
          sortOrder: index,
          createdAt: MOCK_PRODUCT_FEEDBACK_NOW,
          file
        };
        attachmentFiles.set(`${id}:${attachment.id}`, file);
        return attachment;
      });
      const feedback: ProductFeedback = {
        id,
        pagePath: input.pagePath,
        pageTitle: input.pageTitle,
        feedbackType: input.feedbackType,
        description: input.description,
        status: "open",
        adminNote: null,
        submittedAt: MOCK_PRODUCT_FEEDBACK_NOW,
        createdAt: MOCK_PRODUCT_FEEDBACK_NOW,
        updatedAt: MOCK_PRODUCT_FEEDBACK_NOW,
        attachments: attachments.map(({ file: _file, ...attachment }) => attachment),
        progressEvents: [
          {
            id: `${id}-event-1`,
            feedbackId: id,
            kind: "submitted",
            toStatus: "open",
            publicMessage: "反馈已提交",
            createdAt: MOCK_PRODUCT_FEEDBACK_NOW
          }
        ],
        latestPublicProgress: "反馈已提交"
      };
      items = [feedback, ...items];
      return cloneFeedback(feedback);
    },
    async list(query) {
      const filtered = items.filter((feedback) => matchesQuery(feedback, query));
      return { items: filtered.map(cloneFeedback) };
    },
    async get(id) {
      const feedback = items.find((item) => item.id === id && item.submittedAt !== null);
      return feedback ? cloneFeedback(feedback) : null;
    },
    async update(id, patch) {
      const existing = assertFeedbackExists(
        items.find((item) => item.id === id && item.submittedAt !== null),
        id
      );
      if (patch.status && !isValidStatusTransition(existing.status, patch.status)) {
        throw mockApiError("CONFLICT", `Illegal product feedback status transition: ${existing.status} -> ${patch.status}`, { status: existing.status, patchStatus: patch.status });
      }
      const updated: ProductFeedback = {
        ...existing,
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote } : {}),
        updatedAt: MOCK_PRODUCT_FEEDBACK_NOW
      };
      items = items.map((item) => (item.id === id ? updated : item));
      return cloneFeedback(updated);
    },
    async getAttachmentObjectUrl(feedbackId, attachmentId) {
      assertFeedbackExists(items.find((item) => item.id === feedbackId), feedbackId);
      const file = attachmentFiles.get(`${feedbackId}:${attachmentId}`);
      if (!file) throw mockApiError("NOT_FOUND", `Product feedback attachment not found: ${attachmentId}`, { attachmentId });
      return createFallbackObjectUrl(file);
    },

    async createDraft(input = {}) {
      counter += 1;
      const id = `mock-draft-${counter}`;
      const attachments: StoredAttachment[] = (input.files ?? []).map((file, index) => {
        const attachment = {
          id: `${id}-attachment-${index + 1}`,
          feedbackId: id,
          fileName: file.name,
          contentType: (file.type || "image/png") as ProductFeedbackAttachment["contentType"],
          sizeBytes: file.size,
          sortOrder: index,
          createdAt: MOCK_PRODUCT_FEEDBACK_NOW,
          file
        };
        attachmentFiles.set(`${id}:${attachment.id}`, file);
        return attachment;
      });

      const draft: ProductFeedback = {
        id,
        pagePath: input.pagePath ?? "/",
        pageTitle: input.pageTitle ?? "",
        feedbackType: input.feedbackType ?? "experience",
        description: input.description ?? "",
        status: "open",
        adminNote: null,
        submittedAt: null,
        createdAt: MOCK_PRODUCT_FEEDBACK_NOW,
        updatedAt: MOCK_PRODUCT_FEEDBACK_NOW,
        attachments: attachments.map(({ file: _file, ...attachment }) => attachment),
        progressEvents: [],
        latestPublicProgress: null
      };

      items = [draft, ...items];
      return cloneFeedback(draft);
    },

    async saveDraft(id, input) {
      const existing = assertFeedbackExists(items.find((item) => item.id === id), id);
      if (existing.submittedAt !== null && existing.submittedAt !== undefined) {
        throw mockApiError("VALIDATION_FAILED", "Submitted feedback cannot be edited as draft.", { feedbackId: id });
      }

      let retainedAttachments = existing.attachments;
      if (input.retainedAttachmentIds !== undefined) {
        const retainedSet = new Set(input.retainedAttachmentIds);
        retainedAttachments = existing.attachments.filter((att) => retainedSet.has(att.id));
      }

      const newAttachments: StoredAttachment[] = (input.newFiles ?? []).map((file, index) => {
        const attachment = {
          id: `${id}-attachment-${Date.now()}-${index + 1}`,
          feedbackId: id,
          fileName: file.name,
          contentType: (file.type || "image/png") as ProductFeedbackAttachment["contentType"],
          sizeBytes: file.size,
          sortOrder: retainedAttachments.length + index,
          createdAt: MOCK_PRODUCT_FEEDBACK_NOW,
          file
        };
        attachmentFiles.set(`${id}:${attachment.id}`, file);
        return attachment;
      });

      const allAttachments = [
        ...retainedAttachments,
        ...newAttachments.map(({ file: _file, ...att }) => att)
      ];

      const updated: ProductFeedback = {
        ...existing,
        ...(input.pagePath !== undefined ? { pagePath: input.pagePath } : {}),
        ...(input.pageTitle !== undefined ? { pageTitle: input.pageTitle } : {}),
        ...(input.feedbackType !== undefined ? { feedbackType: input.feedbackType } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        attachments: allAttachments,
        updatedAt: MOCK_PRODUCT_FEEDBACK_NOW
      };

      items = items.map((item) => (item.id === id ? updated : item));
      return cloneFeedback(updated);
    },

    async deleteDraft(id) {
      const existing = assertFeedbackExists(items.find((item) => item.id === id), id);
      if (existing.submittedAt !== null && existing.submittedAt !== undefined) {
        throw mockApiError("VALIDATION_FAILED", "Submitted feedback cannot be deleted as draft.", { feedbackId: id });
      }

      items = items.filter((item) => item.id !== id);
      return { ok: true };
    },

    async submitDraft(id, input) {
      const existing = assertFeedbackExists(items.find((item) => item.id === id), id);
      if (existing.submittedAt !== null && existing.submittedAt !== undefined) {
        throw mockApiError("VALIDATION_FAILED", "Feedback has already been submitted.", { feedbackId: id });
      }

      const finalDescription = input?.description !== undefined ? input.description : existing.description;
      if (!finalDescription || !finalDescription.trim()) {
        throw mockApiError("VALIDATION_FAILED", "Description is required to submit feedback.");
      }

      const updated: ProductFeedback = {
        ...existing,
        ...(input?.pagePath !== undefined ? { pagePath: input.pagePath } : {}),
        ...(input?.pageTitle !== undefined ? { pageTitle: input.pageTitle } : {}),
        ...(input?.feedbackType !== undefined ? { feedbackType: input.feedbackType } : {}),
        description: finalDescription,
        status: "open",
        submittedAt: MOCK_PRODUCT_FEEDBACK_NOW,
        updatedAt: MOCK_PRODUCT_FEEDBACK_NOW,
        progressEvents: [
          ...(existing.progressEvents ?? []),
          {
            id: `${id}-event-${(existing.progressEvents?.length ?? 0) + 1}`,
            feedbackId: id,
            kind: "submitted",
            toStatus: "open",
            publicMessage: "反馈已提交",
            createdAt: MOCK_PRODUCT_FEEDBACK_NOW
          }
        ],
        latestPublicProgress: "反馈已提交"
      };

      items = items.map((item) => (item.id === id ? updated : item));
      return cloneFeedback(updated);
    },

    async listMine() {
      return { items: items.map(cloneFeedback) };
    },

    async getMine(id) {
      const feedback = items.find((item) => item.id === id);
      return feedback ? cloneFeedback(feedback) : null;
    },

    async getMineAttachmentObjectUrl(feedbackId, attachmentId) {
      return this.getAttachmentObjectUrl(feedbackId, attachmentId);
    },

    async getStats() {
      const submitted = items.filter((item) => item.submittedAt !== null && item.submittedAt !== undefined);
      return {
        total: submitted.length,
        open: submitted.filter((item) => item.status === "open").length,
        inProgress: submitted.filter((item) => item.status === "in_progress").length,
        resolved: submitted.filter((item) => item.status === "resolved").length,
        closed: submitted.filter((item) => item.status === "closed").length
      };
    },

    async appendProgress(id, input) {
      const existing = assertFeedbackExists(items.find((item) => item.id === id), id);
      if (existing.submittedAt === null || existing.submittedAt === undefined) {
        throw mockApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId: id });
      }

      const current = existing.status;
      const nextStatus = input.toStatus ?? current;
      const publicMessage = input.publicMessage?.trim() || null;
      const internalMessage = input.internalMessage?.trim() || null;

      let kind: ProductFeedbackProgressEventKind = "progress";
      let nextResolutionCode = existing.resolutionCode ?? null;

      if (nextStatus === current) {
        if (current === "closed") {
          throw mockApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated without reopening.");
        }
        if (!publicMessage && !internalMessage) {
          throw mockApiError("VALIDATION_FAILED", "At least one of publicMessage or internalMessage must be provided.");
        }
        if (input.resolutionCode !== undefined) {
          nextResolutionCode = input.resolutionCode;
        }
        kind = "progress";
      } else {
        if (current === "open" && nextStatus === "in_progress") {
          kind = "status_changed";
          nextResolutionCode = null;
        } else if (current === "open" && nextStatus === "closed") {
          const res = input.resolutionCode ?? existing.resolutionCode;
          if (!res) {
            throw mockApiError("VALIDATION_FAILED", "Resolution code is required when closing feedback.");
          }
          kind = "status_changed";
          nextResolutionCode = res;
        } else if (current === "in_progress" && nextStatus === "resolved") {
          const res = input.resolutionCode ?? existing.resolutionCode;
          if (!res) {
            throw mockApiError("VALIDATION_FAILED", "Resolution code is required when resolving feedback.");
          }
          if (!publicMessage) {
            throw mockApiError("VALIDATION_FAILED", "Public message is required when resolving feedback.");
          }
          kind = "status_changed";
          nextResolutionCode = res;
        } else if (current === "in_progress" && nextStatus === "closed") {
          const res = input.resolutionCode ?? existing.resolutionCode;
          if (!res) {
            throw mockApiError("VALIDATION_FAILED", "Resolution code is required when closing feedback.");
          }
          kind = "status_changed";
          nextResolutionCode = res;
        } else if (current === "resolved" && nextStatus === "closed") {
          kind = "status_changed";
          nextResolutionCode = input.resolutionCode ?? existing.resolutionCode ?? null;
        } else if ((current === "resolved" || current === "closed") && nextStatus === "in_progress") {
          if (!publicMessage && !internalMessage) {
            throw mockApiError("VALIDATION_FAILED", "An explanation is required when reopening feedback.");
          }
          kind = "reopened";
          nextResolutionCode = null;
        } else {
          throw mockApiError("VALIDATION_FAILED", `Illegal product feedback status transition: ${current} -> ${nextStatus}.`);
        }
      }

      const newEvent = {
        id: `${id}-event-${(existing.progressEvents?.length ?? 0) + 1}`,
        feedbackId: id,
        kind,
        fromStatus: current,
        toStatus: nextStatus,
        resolutionCode: nextResolutionCode,
        publicMessage,
        internalMessage,
        createdAt: MOCK_PRODUCT_FEEDBACK_NOW
      };

      const updated: ProductFeedback = {
        ...existing,
        status: nextStatus,
        resolutionCode: nextResolutionCode,
        updatedAt: MOCK_PRODUCT_FEEDBACK_NOW,
        progressEvents: [...(existing.progressEvents ?? []), newEvent],
        latestPublicProgress: publicMessage ?? existing.latestPublicProgress ?? null
      };

      items = items.map((item) => (item.id === id ? updated : item));
      return cloneFeedback(updated);
    }
  };
}
