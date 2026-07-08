import type { ProductFeedbackListQuery, ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback, ProductFeedbackAttachment, ProductFeedbackStatus } from "@/domain/productFeedback/types";

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
  if (!feedback) throw new Error(`Product feedback not found: ${id}`);
  return feedback;
}

function isValidStatusTransition(current: ProductFeedbackStatus, next: ProductFeedbackStatus) {
  if (current === next) return true;
  if (current === "open") return next === "in_progress";
  if (current === "in_progress") return next === "closed";
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
        createdAt: MOCK_PRODUCT_FEEDBACK_NOW,
        updatedAt: MOCK_PRODUCT_FEEDBACK_NOW,
        attachments: attachments.map(({ file: _file, ...attachment }) => attachment)
      };
      items = [feedback, ...items];
      return cloneFeedback(feedback);
    },
    async list(query) {
      const filtered = items.filter((feedback) => matchesQuery(feedback, query));
      return { items: filtered.map(cloneFeedback) };
    },
    async get(id) {
      const feedback = items.find((item) => item.id === id);
      return feedback ? cloneFeedback(feedback) : null;
    },
    async update(id, patch) {
      const existing = assertFeedbackExists(items.find((item) => item.id === id), id);
      if (patch.status && !isValidStatusTransition(existing.status, patch.status)) {
        throw new Error(`Illegal product feedback status transition: ${existing.status} -> ${patch.status}`);
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
      if (!file) throw new Error(`Product feedback attachment not found: ${attachmentId}`);
      return createFallbackObjectUrl(file);
    }
  };
}
