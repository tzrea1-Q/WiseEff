import { randomUUID } from "node:crypto";
import { MAX_FEEDBACK_ATTACHMENT_COUNT as MAX_ATTACHMENT_COUNT, MAX_FEEDBACK_ATTACHMENT_BYTES as MAX_ATTACHMENT_BYTES,
  MAX_FEEDBACK_MESSAGE_ATTACHMENT_BYTES as MAX_TOTAL_ATTACHMENT_BYTES } from "../../../src/domain/productFeedback/types";

import { asAuditTx, writeAuditEventInTx, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import { feedbackOrganizationId, feedbackInvocation, type ProductFeedbackAccessContext as AuthContext } from "./scope";
import { type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { ObjectStore } from "../logs/objectStore";
import { notifyUsers } from "../notifications/service";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { requireProductFeedbackAdmin, requireProductFeedbackSubmit } from "./policy";
import { pendingFeedbackAttachmentCleanup, queueFeedbackAttachmentCleanup, withFeedbackAttachmentWrites } from "./attachmentUploads";
import {
  deleteAttachmentsByIds,
  deleteDraft,
  getFeedbackById,
  getFeedbackForUpdate,
  getFeedbackStats,
  getMyFeedbackById,
  insertAttachments,
  insertDraftFeedback,
  insertFeedback,
  insertProgressEvent,
  listFeedback,
  listMyFeedback,
  type ProductFeedbackRow,
  submitDraft,
  updateDraftFeedback,
  updateFeedback,
  updateFeedbackProgressStatus
} from "./repository";
import type {
  AppendProductFeedbackProgressInput,
  CreateProductFeedbackDraftInput,
  ListMyFeedbackQuery,
  ListProductFeedbackQuery,
  ProductFeedbackAdminDto,
  ProductFeedbackAttachmentContentType,
  ProductFeedbackAttachmentInput,
  ProductFeedbackDto,
  ProductFeedbackProgressEventKind,
  ProductFeedbackResolutionCode,
  ProductFeedbackStatsDto,
  ProductFeedbackStatus,
  ProductFeedbackType,
  ProductFeedbackUserDto,
  ReplyToProductFeedbackInput,
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

const SUPPORTED_CONTENT_TYPES = new Set<ProductFeedbackAttachmentContentType>(["image/png", "image/jpeg", "image/webp"]);

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
  invocation: TrustedInvocationContext,
  input: {
    kind: "product-feedback-create" | "product-feedback-update" | "product-feedback-submit";
    action: "create" | "update";
    feedback: ProductFeedbackDto | ProductFeedbackUserDto;
    metadata?: Record<string, unknown>;
  },
  context: ProductFeedbackServiceContext = {}
) {
  // requestId fallback survives only until feedback contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, invocation, { requestId: context.requestId ?? randomUUID() }, {
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

export async function createProductFeedback(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: CreateProductFeedbackInput,
  context: ProductFeedbackServiceContext = {}
): Promise<ProductFeedbackDto> {
  requireProductFeedbackSubmit(auth);
  const decodedAttachments = decodeAndValidateAttachments(input.attachments);
  return withFeedbackAttachmentWrites(db, objectStore, auth, decodedAttachments, async (tx, put) => {
    const storedAttachments = await put();
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
      storedAttachments.map((attachment) => ({ ...attachment, messageId: feedback.progressEvents.find((event) => event.kind === "submitted")?.id }))
    );
    const item = (await getFeedbackById(tx, auth, feedback.id)) ?? { ...feedback, attachments: insertedAttachments };
    await createProductFeedbackAudit(
      asAuditTx(tx),
      feedbackInvocation(auth),
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
  return { ...await listMyFeedback(db, auth, query), pendingAttachmentCleanupCount: await pendingFeedbackAttachmentCleanup(db, auth) };
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
  return readLiveAttachment(objectStore, () => getMyProductFeedback(db, auth, feedbackId), feedbackId, attachmentId);
}

async function readLiveAttachment(store: ObjectStore, read: () => Promise<ProductFeedbackDto | ProductFeedbackUserDto>, feedbackId: string, attachmentId: string) {
  const live = (feedback: ProductFeedbackDto | ProductFeedbackUserDto) => feedback.attachments.find((item) => item.id === attachmentId && !item.deletedAt);
  const attachment = live(await read());
  if (!attachment) throw productFeedbackNotFound(feedbackId);
  const bytes = await store.get(attachment.storageKey);
  if (!live(await read())) throw productFeedbackNotFound(feedbackId);
  return { attachment, bytes };
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
    const existing = await getFeedbackForUpdate(tx, auth, feedbackId);
    if (!existing) {
      throw productFeedbackNotFound(feedbackId);
    }

    const normalizedPatch: UpdateProductFeedbackPatch = {};
    let internalMessage: string | null | undefined;
    if (hasPatchKey(patch, "adminNote")) {
      if (existing.status === "closed" && patch.status !== "in_progress") {
        throw new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated without reopening.");
      }
      normalizedPatch.adminNote = patch.adminNote?.trim() || null;
      if (normalizedPatch.adminNote !== existing.admin_note) {
        if (existing.admin_note?.trim()) {
          const archived = await tx.query(`
            select id from product_feedback_progress_events
            where organization_id = $1 and feedback_id = $2 and internal_message = $3 limit 1
          `, [feedbackOrganizationId(auth), feedbackId, existing.admin_note]);
          if (archived.rows.length === 0) {
            await insertProgressEvent(tx, auth, {
              id: randomUUID(), feedbackId, actorUserId: auth.user.id, kind: "legacy_note",
              fromStatus: existing.status, toStatus: existing.status,
              resolutionCode: existing.resolution_code, internalMessage: existing.admin_note,
              createdAt: existing.updated_at instanceof Date ? existing.updated_at.toISOString() : existing.updated_at
            });
          }
        }
        internalMessage = normalizedPatch.adminNote ?? "处理备注已清空";
      }
    }
    if (patch.priority !== undefined) normalizedPatch.priority = patch.priority;
    if (hasPatchKey(patch, "assigneeUserId")) {
      if (patch.assigneeUserId) {
        const choices = await listProductFeedbackAssignees(tx, auth);
        if (!choices.items.some((user) => user.id === patch.assigneeUserId)) {
          throw new ApiError("VALIDATION_FAILED", "Assignee must be an active administrator in this organization.");
        }
      }
      normalizedPatch.assigneeUserId = patch.assigneeUserId ?? null;
    }
    if ((patch.status && patch.status !== existing.status) || patch.publicMessage?.trim() || internalMessage) {
      await appendProductFeedbackProgress(tx, auth, feedbackId, {
        toStatus: patch.status,
        resolutionCode: patch.resolutionCode,
        publicMessage: patch.publicMessage,
        internalMessage
      }, context);
    } else if (patch.resolutionCode !== undefined) {
      throw new ApiError("VALIDATION_FAILED", "Resolution code requires a progress update.");
    }

    const updated = await updateFeedback(tx, auth, feedbackId, normalizedPatch);
    if (!updated) {
      throw productFeedbackNotFound(feedbackId);
    }
    await createProductFeedbackAudit(
      asAuditTx(tx),
      feedbackInvocation(auth),
      {
        kind: "product-feedback-update",
        action: "update",
        feedback: updated,
        metadata: {
          previousStatus: existing.status,
          nextStatus: updated.status,
          priority: updated.priority,
          assigneeUserId: updated.assigneeUserId
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
  return readLiveAttachment(objectStore, () => getProductFeedback(db, auth, feedbackId), feedbackId, attachmentId);
}

export async function createProductFeedbackDraft(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: CreateProductFeedbackDraftInput = {}
): Promise<ProductFeedbackUserDto> {
  requireProductFeedbackSubmit(auth);
  const decodedAttachments = decodeAndValidateAttachments(input.attachments);
  return withFeedbackAttachmentWrites(db, objectStore, auth, decodedAttachments, async (tx, put) => {
    const storedAttachments = await put();
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
        storedAttachments
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
  const decodedNewAttachments = decodeAndValidateAttachments(input.newAttachments);
  return withFeedbackAttachmentWrites(db, objectStore, auth, decodedNewAttachments, async (tx, put) => {
    await tx.query("select id from product_feedback where organization_id=$1 and id=$2 and (draft_owner_user_id=$3 or $4) for update", [feedbackOrganizationId(auth), draftId, auth.user.id, auth.permissions.includes("admin:access")]);
    const existing = await getMyFeedbackById(tx, auth, draftId);
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

    const retainedBytes = retainedAttachments.reduce((sum, att) => sum + att.sizeBytes, 0);
    const newBytes = decodedNewAttachments.reduce((sum, att) => sum + att.bytes.byteLength, 0);
    if (retainedBytes + newBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new ApiError("VALIDATION_FAILED", "Attachments exceed the 15MB total limit.", {
        maxBytes: MAX_TOTAL_ATTACHMENT_BYTES,
        sizeBytes: retainedBytes + newBytes
      });
    }

    const storedNewAttachments = await put();
    if (discardedAttachments.length > 0) {
      await queueFeedbackAttachmentCleanup(tx, auth, discardedAttachments.map((attachment) => attachment.storageKey));
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
        storedNewAttachments.map((attachment, index) => ({ ...attachment, sortOrder: retainedAttachments.length + index }))
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
}

export async function deleteProductFeedbackDraft(
  db: Database,
  _objectStore: ObjectStore,
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

  const { ok } = await db.transaction(async (tx) => {
    return deleteDraft(tx, auth, draftId);
  });

  if (!ok) {
    throw productFeedbackNotFound(draftId);
  }

  // Shared object keys can still belong to submitted feedback or uploaded logs.
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
      feedbackInvocation(auth),
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

export function validateProgressTransition(
  existing: ProductFeedbackRow,
  input: AppendProductFeedbackProgressInput
): {
  nextStatus: ProductFeedbackStatus;
  nextResolutionCode: ProductFeedbackResolutionCode | null;
  kind: ProductFeedbackProgressEventKind;
} {
  const current = existing.status;
  const nextStatus = input.toStatus ?? current;
  const publicMessage = input.publicMessage?.trim() || null;
  const internalMessage = input.internalMessage?.trim() || null;

  if (nextStatus === current) {
    if (current === "closed") {
      throw new ApiError("VALIDATION_FAILED", "Closed product feedback cannot be updated without reopening.");
    }
    if (!publicMessage && !internalMessage) {
      throw new ApiError("VALIDATION_FAILED", "At least one of publicMessage or internalMessage must be provided.");
    }
    const nextResolutionCode =
      input.resolutionCode !== undefined ? input.resolutionCode : existing.resolution_code;
    if (nextResolutionCode !== existing.resolution_code) {
      throw new ApiError("VALIDATION_FAILED", "Resolution code can only change with the feedback status.");
    }
    return {
      nextStatus,
      nextResolutionCode,
      kind: "progress"
    };
  }

  const allowed: Record<ProductFeedbackStatus, ProductFeedbackStatus[]> = {
    open: ["in_progress", "closed"],
    in_progress: ["resolved", "closed"],
    resolved: ["closed", "in_progress"],
    closed: ["in_progress"]
  };
  if (!allowed[current].includes(nextStatus)) {
    throw new ApiError("VALIDATION_FAILED", `Illegal product feedback status transition: ${current} -> ${nextStatus}.`, {
      currentStatus: current, nextStatus
    });
  }
  if (nextStatus === "resolved" || nextStatus === "closed") {
    const nextResolutionCode = input.resolutionCode ?? existing.resolution_code;
    const action = nextStatus === "resolved" ? "resolving" : "closing";
    if (!nextResolutionCode) throw new ApiError("VALIDATION_FAILED", `Resolution code is required when ${action} feedback.`);
    if (!publicMessage) throw new ApiError("VALIDATION_FAILED", `Public message is required when ${action} feedback.`);
    return { nextStatus, nextResolutionCode, kind: "status_changed" };
  }
  const reopened = current === "resolved" || current === "closed";
  if (reopened && !publicMessage) {
    throw new ApiError("VALIDATION_FAILED", "An explanation is required when reopening feedback.");
  }
  return { nextStatus, nextResolutionCode: null, kind: reopened ? "reopened" : "status_changed" };
}

export async function appendProductFeedbackProgress(
  db: Database,
  auth: AuthContext,
  feedbackId: string,
  input: AppendProductFeedbackProgressInput,
  context: ProductFeedbackServiceContext = {}
): Promise<ProductFeedbackAdminDto> {
  requireProductFeedbackAdmin(auth);

  return db.transaction(async (tx) => {
    const existing = await getFeedbackForUpdate(tx, auth, feedbackId);
    if (!existing || existing.submitted_at === null) {
      throw productFeedbackNotFound(feedbackId);
    }

    const { nextStatus, nextResolutionCode, kind } = validateProgressTransition(existing, input);
    const publicMessage = input.publicMessage?.trim() ||
      (nextStatus !== existing.status && nextStatus === "in_progress" ? "反馈已开始处理" : null);
    const internalMessage = input.internalMessage?.trim() || null;

    await updateFeedbackProgressStatus(tx, auth, feedbackId, nextStatus, nextResolutionCode);

    const progressId = randomUUID();
    await insertProgressEvent(tx, auth, {
      id: progressId,
      feedbackId,
      actorUserId: auth.user.id,
      kind,
      fromStatus: existing.status,
      toStatus: nextStatus,
      resolutionCode: nextResolutionCode,
      publicMessage,
      internalMessage
    });

    if (publicMessage && existing.submitter_user_id) {
      await notifyUsers(tx, {
        organizationId: feedbackOrganizationId(auth),
        recipientUserIds: [existing.submitter_user_id],
        category: "product-feedback.progress",
        title: nextStatus === "resolved" ? "问题反馈已解决" : "问题反馈有新进展",
        body: publicMessage,
        severity: nextStatus === "resolved" ? "success" : "info",
        actionUrl: `/feedback?id=${encodeURIComponent(feedbackId)}`,
        sourceKind: "product-feedback-progress",
        sourceId: progressId,
        metadata: { feedbackId, status: nextStatus }
      });
    }

    await writeAuditEventInTx(asAuditTx(tx), feedbackInvocation(auth), { requestId: context.requestId ?? randomUUID() }, {
      app: "product-feedback",
      kind: "product-feedback-progress",
      action: "update",
      severity: "Medium",
      projectId: null,
      targetType: "product-feedback",
      targetId: feedbackId,
      metadata: {
        previousStatus: existing.status,
        nextStatus,
        resolutionCode: nextResolutionCode,
        hasPublicMessage: Boolean(publicMessage),
        hasInternalMessage: Boolean(internalMessage)
      }
    });

    const updated = await getFeedbackById(tx, auth, feedbackId);
    if (!updated) {
      throw productFeedbackNotFound(feedbackId);
    }
    return updated;
  });
}

export async function getProductFeedbackStats(
  db: Queryable,
  auth: AuthContext
): Promise<ProductFeedbackStatsDto> {
  requireProductFeedbackAdmin(auth);
  return getFeedbackStats(db, auth);
}

export async function listProductFeedbackAssignees(db: Queryable, auth: AuthContext) {
  requireProductFeedbackAdmin(auth);
  const result = await db.query<{ id: string; name: string; username: string | null }>(`
    select users.id, users.name, credentials.username
    from users
    left join user_password_credentials credentials on credentials.user_id = users.id
    where users.organization_id = $1 and users.is_active
      and exists (
        select 1 from user_role_bindings binding join roles on roles.id = binding.role_id
        where binding.user_id = users.id and binding.organization_id = $1
          and 'admin:access' = any(roles.permissions)
      )
    order by users.name, users.id
  `, [feedbackOrganizationId(auth)]);
  return { items: result.rows };
}

export async function replyToProductFeedback(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  feedbackId: string,
  input: ReplyToProductFeedbackInput,
  context: ProductFeedbackServiceContext = {}
): Promise<ProductFeedbackUserDto> {
  requireProductFeedbackSubmit(auth);
  const message = input.message.trim();
  if (!message || message.length > 2000) {
    throw new ApiError("VALIDATION_FAILED", "Reply must contain between 1 and 2000 characters.");
  }
  const decoded = decodeAndValidateAttachments(input.attachments);
  return withFeedbackAttachmentWrites(db, objectStore, auth, decoded, async (tx, put) => {
    const existing = await getFeedbackForUpdate(tx, auth, feedbackId);
    if (!existing || (existing.submitter_user_id !== auth.user.id && existing.draft_owner_user_id !== auth.user.id)) throw productFeedbackNotFound(feedbackId);
    if (existing.status === "closed" && !input.reopen) {
      throw new ApiError("VALIDATION_FAILED", "Closed feedback must be reopened before replying.");
    }
    if (input.reopen && existing.status !== "resolved" && existing.status !== "closed") {
      throw new ApiError("VALIDATION_FAILED", "Only resolved or closed feedback can be reopened.");
    }
    const nextStatus = input.reopen ? "in_progress" : existing.status;
    const resolutionCode = input.reopen ? null : existing.resolution_code;
    const messageId = randomUUID();
    await insertProgressEvent(tx, auth, {
      id: messageId, feedbackId, actorUserId: auth.user.id, author: "submitter",
      kind: input.reopen ? "reopened" : "progress",
      fromStatus: existing.status, toStatus: nextStatus, resolutionCode, publicMessage: message
    });
    await insertAttachments(tx, auth, feedbackId, (await put()).map((attachment) => ({ ...attachment, messageId })));
    await updateFeedbackProgressStatus(tx, auth, feedbackId, nextStatus, resolutionCode);
    await writeAuditEventInTx(asAuditTx(tx), feedbackInvocation(auth), { requestId: context.requestId ?? randomUUID() }, {
      app: "product-feedback", kind: "product-feedback-reply", action: "update", severity: "Medium",
      projectId: null, targetType: "product-feedback", targetId: feedbackId,
      metadata: { previousStatus: existing.status, nextStatus, attachmentCount: decoded.length }
    });
    const updated = await getMyFeedbackById(tx, auth, feedbackId);
    if (!updated) throw productFeedbackNotFound(feedbackId);
    return updated;
  });
}

