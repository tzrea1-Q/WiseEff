import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { requireProductFeedbackAdmin, requireProductFeedbackSubmit } from "./policy";
import {
  getFeedbackById,
  insertAttachments,
  insertFeedback,
  listFeedback,
  updateFeedback
} from "./repository";
import type {
  ListProductFeedbackQuery,
  ProductFeedbackAttachmentContentType,
  ProductFeedbackDto,
  ProductFeedbackStatus,
  ProductFeedbackType,
  UpdateProductFeedbackPatch
} from "./types";

export type ProductFeedbackAttachmentInput = {
  fileName: string;
  contentType: ProductFeedbackAttachmentContentType;
  contentBase64: string;
};

export type CreateProductFeedbackInput = {
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  attachments?: ProductFeedbackAttachmentInput[];
};

export type ProductFeedbackServiceContext = AuditCorrelationContext;

const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const SUPPORTED_CONTENT_TYPES = new Set<ProductFeedbackAttachmentContentType>(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED: Record<ProductFeedbackStatus, ProductFeedbackStatus[]> = {
  open: ["in_progress"],
  in_progress: ["closed"],
  closed: []
};

function hasPatchKey<Key extends keyof UpdateProductFeedbackPatch>(patch: UpdateProductFeedbackPatch, key: Key) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function productFeedbackNotFound(feedbackId: string) {
  return new ApiError("NOT_FOUND", "Product feedback was not found.", 404, { feedbackId });
}

function decodeAttachment(input: ProductFeedbackAttachmentInput) {
  if (!SUPPORTED_CONTENT_TYPES.has(input.contentType)) {
    throw new ApiError("VALIDATION_FAILED", "Unsupported product feedback attachment content type.", 400, {
      contentType: input.contentType
    });
  }

  return {
    ...input,
    bytes: Buffer.from(input.contentBase64, "base64")
  };
}

function decodeAndValidateAttachments(attachments: ProductFeedbackAttachmentInput[] = []) {
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new ApiError("VALIDATION_FAILED", "Product feedback supports up to 5 attachments.", 400, {
      maxAttachments: MAX_ATTACHMENT_COUNT
    });
  }

  const decoded = attachments.map(decodeAttachment);
  let totalBytes = 0;
  for (const attachment of decoded) {
    const sizeBytes = attachment.bytes.byteLength;
    if (sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new ApiError("VALIDATION_FAILED", "Attachment exceeds the 5MB per-image limit.", 400, {
        fileName: attachment.fileName,
        maxBytes: MAX_ATTACHMENT_BYTES,
        sizeBytes
      });
    }
    totalBytes += sizeBytes;
  }
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new ApiError("VALIDATION_FAILED", "Attachments exceed the 15MB total limit.", 400, {
      maxBytes: MAX_TOTAL_ATTACHMENT_BYTES,
      sizeBytes: totalBytes
    });
  }

  return decoded;
}

async function createProductFeedbackAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind: "product-feedback-create" | "product-feedback-update";
    action: "create" | "update";
    feedback: ProductFeedbackDto;
    metadata?: Record<string, unknown>;
  },
  context: ProductFeedbackServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "product-feedback",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    targetType: "product-feedback",
    targetId: input.feedback.id,
    metadata: {
      feedbackType: input.feedback.feedbackType,
      status: input.feedback.status,
      pagePath: input.feedback.pagePath,
      attachmentCount: input.feedback.attachments.length,
      ...input.metadata
    },
    traceId: context.requestId ?? randomUUID()
  });
}

function assertTransition(current: ProductFeedbackStatus, next: ProductFeedbackStatus) {
  if (current === "closed") {
    throw new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated.", 400);
  }
  if (current === next) return;
  if (!ALLOWED[current].includes(next)) {
    throw new ApiError("VALIDATION_FAILED", `Illegal product feedback status transition: ${current} -> ${next}.`, 400, {
      currentStatus: current,
      nextStatus: next
    });
  }
}

export async function createProductFeedback(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: CreateProductFeedbackInput,
  context: ProductFeedbackServiceContext = {}
): Promise<ProductFeedbackDto> {
  requireProductFeedbackSubmit(auth);
  const decodedAttachments = decodeAndValidateAttachments(input.attachments);
  const storedAttachments = await Promise.all(
    decodedAttachments.map(async (attachment) => {
      const stored = await objectStore.put({
        organizationId: auth.organization.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        bytes: attachment.bytes
      });
      return { attachment, stored };
    })
  );

  return db.transaction(async (tx) => {
    const feedback = await insertFeedback(tx, auth, {
      id: randomUUID(),
      pagePath: input.pagePath,
      pageTitle: input.pageTitle,
      feedbackType: input.feedbackType,
      description: input.description
    });
    const attachments = await insertAttachments(
      tx,
      auth,
      feedback.id,
      storedAttachments.map(({ attachment, stored }, index) => ({
        id: randomUUID(),
        storageKey: stored.storageKey,
        fileName: stored.fileName,
        contentType: attachment.contentType,
        sizeBytes: stored.fileSizeBytes,
        checksum: stored.checksumSha256,
        sortOrder: index
      }))
    );
    const item = { ...feedback, attachments };
    await createProductFeedbackAudit(
      tx,
      auth,
      {
        kind: "product-feedback-create",
        action: "create",
        feedback: item
      },
      context
    );

    return item;
  });
}

export async function listProductFeedback(db: Queryable, auth: AuthContext, query: ListProductFeedbackQuery = {}) {
  requireProductFeedbackAdmin(auth);
  return listFeedback(db, auth, query);
}

export async function getProductFeedback(db: Queryable, auth: AuthContext, feedbackId: string) {
  requireProductFeedbackAdmin(auth);
  const feedback = await getFeedbackById(db, auth, feedbackId);
  if (!feedback) {
    throw productFeedbackNotFound(feedbackId);
  }
  return feedback;
}

export async function updateProductFeedback(
  db: Database,
  auth: AuthContext,
  feedbackId: string,
  patch: UpdateProductFeedbackPatch,
  context: ProductFeedbackServiceContext = {}
) {
  requireProductFeedbackAdmin(auth);

  return db.transaction(async (tx) => {
    const existing = await getFeedbackById(tx, auth, feedbackId);
    if (!existing) {
      throw productFeedbackNotFound(feedbackId);
    }
    if (existing.status === "closed") {
      throw new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated.", 400);
    }

    const normalizedPatch: UpdateProductFeedbackPatch = {};
    if (hasPatchKey(patch, "status") && patch.status) {
      assertTransition(existing.status, patch.status);
      normalizedPatch.status = patch.status;
    }
    if (hasPatchKey(patch, "adminNote")) {
      normalizedPatch.adminNote = patch.adminNote === "" ? null : patch.adminNote ?? null;
    }

    const updated = await updateFeedback(tx, auth, feedbackId, normalizedPatch);
    if (!updated) {
      throw productFeedbackNotFound(feedbackId);
    }
    await createProductFeedbackAudit(
      tx,
      auth,
      {
        kind: "product-feedback-update",
        action: "update",
        feedback: updated,
        metadata: {
          previousStatus: existing.status,
          nextStatus: updated.status
        }
      },
      context
    );

    return updated;
  });
}

export async function getProductFeedbackAttachmentContent(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  feedbackId: string,
  attachmentId: string
) {
  requireProductFeedbackAdmin(auth);
  const feedback = await getProductFeedback(db, auth, feedbackId);
  const attachment = feedback.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    throw productFeedbackNotFound(feedbackId);
  }

  return {
    attachment,
    bytes: await objectStore.get(attachment.storageKey)
  };
}
