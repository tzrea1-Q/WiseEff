import { randomUUID } from "node:crypto";

import { asAuditTx, writeAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { requireProductFeedbackAdmin, requireProductFeedbackSubmit } from "./policy";
import {
  deleteAttachmentsByIds,
  deleteDraft,
  getFeedbackById,
  getMyFeedbackById,
  insertAttachments,
  insertDraftFeedback,
  insertFeedback,
  listFeedback,
  listMyFeedback,
  submitDraft,
  updateDraftFeedback,
  updateFeedback
} from "./repository";
import type {
  CreateProductFeedbackDraftInput,
  ListMyFeedbackQuery,
  ListProductFeedbackQuery,
  ProductFeedbackAdminDto,
  ProductFeedbackAttachmentContentType,
  ProductFeedbackAttachmentInput,
  ProductFeedbackDto,
  ProductFeedbackStatus,
  ProductFeedbackType,
  ProductFeedbackUserDto,
  SaveProductFeedbackDraftInput,
  SubmitProductFeedbackDraftInput,
  UpdateProductFeedbackPatch
} from "./types";

export type { ProductFeedbackAttachmentInput };

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
  resolved: ["closed"],
  closed: []
};

function hasPatchKey<Key extends keyof UpdateProductFeedbackPatch>(patch: UpdateProductFeedbackPatch, key: Key) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function productFeedbackNotFound(feedbackId: string) {
  return new ApiError("NOT_FOUND", "Product feedback was not found.", { feedbackId });
}

function decodeAttachment(input: ProductFeedbackAttachmentInput) {
  if (!SUPPORTED_CONTENT_TYPES.has(input.contentType)) {
    throw new ApiError("VALIDATION_FAILED", "Unsupported product feedback attachment content type.", {
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
    throw new ApiError("VALIDATION_FAILED", "Product feedback supports up to 5 attachments.", {
      maxAttachments: MAX_ATTACHMENT_COUNT
    });
  }

  const decoded = attachments.map(decodeAttachment);
  let totalBytes = 0;
  for (const attachment of decoded) {
    const sizeBytes = attachment.bytes.byteLength;
    if (sizeBytes > MAX_ATTACHMENT_BYTES) {
      throw new ApiError("VALIDATION_FAILED", "Attachment exceeds the 5MB per-image limit.", {
        fileName: attachment.fileName,
        maxBytes: MAX_ATTACHMENT_BYTES,
        sizeBytes
      });
    }
    totalBytes += sizeBytes;
  }
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new ApiError("VALIDATION_FAILED", "Attachments exceed the 15MB total limit.", {
      maxBytes: MAX_TOTAL_ATTACHMENT_BYTES,
      sizeBytes: totalBytes
    });
  }

  return decoded;
}

async function createProductFeedbackAudit(
  tx: AuditTx,
  auth: AuthContext,
  input: {
    kind: "product-feedback-create" | "product-feedback-update" | "product-feedback-submit";
    action: "create" | "update";
    feedback: ProductFeedbackDto | ProductFeedbackUserDto;
    metadata?: Record<string, unknown>;
  },
  context: ProductFeedbackServiceContext = {}
) {
  // requestId fallback survives only until feedback contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, auth, { requestId: context.requestId ?? randomUUID() }, {
    app: "product-feedback",
    kind: input.kind,
    action: input.action,
    severity: "Medium",
    projectId: null,
    targetType: "product-feedback",
    targetId: input.feedback.id,
    metadata: {
      feedbackType: input.feedback.feedbackType,
      status: input.feedback.status,
      pagePath: input.feedback.pagePath,
      attachmentCount: input.feedback.attachments.length,
      ...input.metadata
    }
  });
}

function assertTransition(current: ProductFeedbackStatus, next: ProductFeedbackStatus) {
  if (current === "closed") {
    throw new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated.");
  }
  if (current === next) return;
  if (!ALLOWED[current].includes(next)) {
    throw new ApiError("VALIDATION_FAILED", `Illegal product feedback status transition: ${current} -> ${next}.`, {
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
    const insertedAttachments = await insertAttachments(
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
    const item = (await getFeedbackById(tx, auth, feedback.id)) ?? { ...feedback, attachments: insertedAttachments };
    await createProductFeedbackAudit(
      asAuditTx(tx),
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

export async function listMyProductFeedback(
  db: Queryable,
  auth: AuthContext,
  query: ListMyFeedbackQuery = {}
) {
  requireProductFeedbackSubmit(auth);
  return listMyFeedback(db, auth, query);
}

export async function getMyProductFeedback(db: Queryable, auth: AuthContext, feedbackId: string) {
  requireProductFeedbackSubmit(auth);
  const feedback = await getMyFeedbackById(db, auth, feedbackId);
  if (!feedback) {
    throw productFeedbackNotFound(feedbackId);
  }
  return feedback;
}

export async function getMyProductFeedbackAttachmentContent(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  feedbackId: string,
  attachmentId: string
) {
  requireProductFeedbackSubmit(auth);
  const feedback = await getMyProductFeedback(db, auth, feedbackId);
  const attachment = feedback.attachments.find((item) => item.id === attachmentId);
  if (!attachment) {
    throw productFeedbackNotFound(feedbackId);
  }

  return {
    attachment,
    bytes: await objectStore.get(attachment.storageKey)
  };
}

export async function listProductFeedback(db: Queryable, auth: AuthContext, query: ListProductFeedbackQuery = {}) {
  requireProductFeedbackAdmin(auth);
  return listFeedback(db, auth, query);
}

export async function getProductFeedback(db: Queryable, auth: AuthContext, feedbackId: string) {
  requireProductFeedbackAdmin(auth);
  const feedback = await getFeedbackById(db, auth, feedbackId);
  if (!feedback || feedback.submittedAt === null) {
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
    if (!existing || existing.submittedAt === null) {
      throw productFeedbackNotFound(feedbackId);
    }
    if (existing.status === "closed") {
      throw new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated.");
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
      asAuditTx(tx),
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

export async function createProductFeedbackDraft(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: CreateProductFeedbackDraftInput = {}
): Promise<ProductFeedbackUserDto> {
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
    const draftId = randomUUID();
    await insertDraftFeedback(tx, auth, {
      id: draftId,
      pagePath: input.pagePath,
      pageTitle: input.pageTitle,
      feedbackType: input.feedbackType,
      description: input.description
    });

    if (storedAttachments.length > 0) {
      await insertAttachments(
        tx,
        auth,
        draftId,
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
    }

    const item = await getMyFeedbackById(tx, auth, draftId);
    if (!item) {
      throw new Error(`Failed to retrieve inserted draft: ${draftId}`);
    }
    return item;
  });
}

export async function saveProductFeedbackDraft(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  draftId: string,
  input: SaveProductFeedbackDraftInput
): Promise<ProductFeedbackUserDto> {
  requireProductFeedbackSubmit(auth);
  const existing = await getMyFeedbackById(db, auth, draftId);
  if (!existing) {
    throw productFeedbackNotFound(draftId);
  }
  if (existing.submittedAt !== null) {
    throw new ApiError("VALIDATION_FAILED", "Submitted feedback cannot be edited as draft.", {
      feedbackId: draftId
    });
  }

  let retainedAttachments = existing.attachments;
  let discardedAttachments: typeof existing.attachments = [];
  if (input.retainedAttachmentIds !== undefined) {
    const retainedSet = new Set(input.retainedAttachmentIds);
    retainedAttachments = existing.attachments.filter((att) => retainedSet.has(att.id));
    discardedAttachments = existing.attachments.filter((att) => !retainedSet.has(att.id));
  }

  const newAttachmentCount = input.newAttachments?.length ?? 0;
  const totalCount = retainedAttachments.length + newAttachmentCount;
  if (totalCount > MAX_ATTACHMENT_COUNT) {
    throw new ApiError("VALIDATION_FAILED", "Product feedback supports up to 5 attachments.", {
      maxAttachments: MAX_ATTACHMENT_COUNT
    });
  }

  const decodedNewAttachments = decodeAndValidateAttachments(input.newAttachments);
  const retainedBytes = retainedAttachments.reduce((sum, att) => sum + att.sizeBytes, 0);
  const newBytes = decodedNewAttachments.reduce((sum, att) => sum + att.bytes.byteLength, 0);
  if (retainedBytes + newBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new ApiError("VALIDATION_FAILED", "Attachments exceed the 15MB total limit.", {
      maxBytes: MAX_TOTAL_ATTACHMENT_BYTES,
      sizeBytes: retainedBytes + newBytes
    });
  }

  const storedNewAttachments = await Promise.all(
    decodedNewAttachments.map(async (attachment) => {
      const stored = await objectStore.put({
        organizationId: auth.organization.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        bytes: attachment.bytes
      });
      return { attachment, stored };
    })
  );

  const updated = await db.transaction(async (tx) => {
    if (discardedAttachments.length > 0) {
      await deleteAttachmentsByIds(
        tx,
        auth,
        draftId,
        discardedAttachments.map((att) => att.id)
      );
    }

    if (storedNewAttachments.length > 0) {
      await insertAttachments(
        tx,
        auth,
        draftId,
        storedNewAttachments.map(({ attachment, stored }, index) => ({
          id: randomUUID(),
          storageKey: stored.storageKey,
          fileName: stored.fileName,
          contentType: attachment.contentType,
          sizeBytes: stored.fileSizeBytes,
          checksum: stored.checksumSha256,
          sortOrder: retainedAttachments.length + index
        }))
      );
    }

    const item = await updateDraftFeedback(tx, auth, draftId, {
      pagePath: input.pagePath,
      pageTitle: input.pageTitle,
      feedbackType: input.feedbackType,
      description: input.description
    });
    if (!item) {
      throw productFeedbackNotFound(draftId);
    }
    return item;
  });

  for (const discarded of discardedAttachments) {
    try {
      await objectStore.delete?.(discarded.storageKey);
    } catch {
      // Best-effort cleanup
    }
  }

  return updated;
}

export async function deleteProductFeedbackDraft(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  draftId: string
): Promise<{ ok: boolean }> {
  requireProductFeedbackSubmit(auth);
  const existing = await getMyFeedbackById(db, auth, draftId);
  if (!existing) {
    throw productFeedbackNotFound(draftId);
  }
  if (existing.submittedAt !== null) {
    throw new ApiError("VALIDATION_FAILED", "Submitted feedback cannot be deleted as draft.", {
      feedbackId: draftId
    });
  }

  const { ok, storageKeys } = await db.transaction(async (tx) => {
    return deleteDraft(tx, auth, draftId);
  });

  if (!ok) {
    throw productFeedbackNotFound(draftId);
  }

  for (const key of storageKeys) {
    try {
      await objectStore.delete?.(key);
    } catch {
      // Best-effort cleanup
    }
  }

  return { ok: true };
}

export async function submitProductFeedbackDraft(
  db: Database,
  auth: AuthContext,
  draftId: string,
  input?: SubmitProductFeedbackDraftInput,
  context: ProductFeedbackServiceContext = {}
): Promise<ProductFeedbackUserDto> {
  requireProductFeedbackSubmit(auth);
  const existing = await getMyFeedbackById(db, auth, draftId);
  if (!existing) {
    throw productFeedbackNotFound(draftId);
  }
  if (existing.submittedAt !== null) {
    throw new ApiError("VALIDATION_FAILED", "Product feedback has already been submitted.", {
      feedbackId: draftId
    });
  }

  const finalDescription = input?.description !== undefined ? input.description : existing.description;
  if (!finalDescription || !finalDescription.trim()) {
    throw new ApiError("VALIDATION_FAILED", "Description is required to submit feedback.");
  }

  return db.transaction(async (tx) => {
    const submitted = await submitDraft(tx, auth, draftId, {
      pagePath: input?.pagePath,
      pageTitle: input?.pageTitle,
      feedbackType: input?.feedbackType,
      description: input?.description
    });
    if (!submitted) {
      throw productFeedbackNotFound(draftId);
    }

    await createProductFeedbackAudit(
      asAuditTx(tx),
      auth,
      {
        kind: "product-feedback-submit",
        action: "create",
        feedback: submitted
      },
      context
    );

    return submitted;
  });
}

