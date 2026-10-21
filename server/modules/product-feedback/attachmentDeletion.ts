import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { cleanupFeedbackAttachmentUploads, queueFeedbackAttachmentCleanup } from "./attachmentUploads";
import { getFeedbackById, getFeedbackForUpdate, getMyFeedbackById } from "./repository";
import { requireProductFeedbackSubmit } from "./policy";

export async function deleteProductFeedbackAttachment(db: Database, store: ObjectStore, auth: AuthContext, feedbackId: string, attachmentId: string, requestId: string = randomUUID()) {
  requireProductFeedbackSubmit(auth);
  const invocation = createUserInvocation(auth), administrator = auth.permissions.includes("admin:access");
  const receiptId = await db.transaction(async (tx) => {
    const feedback = await getFeedbackForUpdate(tx, auth, feedbackId);
    if (!feedback || feedback.submitted_at === null || (!administrator && feedback.submitter_user_id !== auth.user.id)) throw new ApiError("NOT_FOUND", "反馈附件不存在。");
    const values = [auth.organization.id, feedbackId, attachmentId];
    const live = (await tx.query<{ storage_key: string; uploaded_by_user_id: string | null }>("select storage_key,uploaded_by_user_id from product_feedback_attachments where organization_id=$1 and feedback_id=$2 and id=$3 for update", values)).rows[0];
    const deleted = live ? undefined : (await tx.query<{ cleanup_upload_id: string; uploaded_by_user_id: string | null }>("select cleanup_upload_id,uploaded_by_user_id from product_feedback_attachment_deletions where organization_id=$1 and feedback_id=$2 and id=$3", values)).rows[0];
    const attachment = live ?? deleted;
    if (!attachment) throw new ApiError("NOT_FOUND", "反馈附件不存在。");
    // The original feedback submitter proves ownership of legacy screenshots;
    // preserve their unknown uploader/message fields rather than inventing them.
    if (!administrator && attachment.uploaded_by_user_id && attachment.uploaded_by_user_id !== auth.user.id) throw new ApiError("FORBIDDEN", "只能删除自己提交的附件。");
    if (deleted) {
      // Only this authorized target receipt may be adopted for an administrator retry.
      await tx.query("update product_feedback_attachment_uploads set uploaded_by_user_id=$3 where organization_id=$1 and id=$2", [auth.organization.id, deleted.cleanup_upload_id, auth.user.id]);
      return deleted.cleanup_upload_id;
    }
    const cleanupId = randomUUID();
    await queueFeedbackAttachmentCleanup(tx, auth, [live!.storage_key], cleanupId);
    await tx.query(`insert into product_feedback_attachment_deletions(id,organization_id,feedback_id,message_id,uploaded_by_user_id,deleted_by_user_id,sort_order,created_at,cleanup_upload_id)
      select id,organization_id,feedback_id,message_id,uploaded_by_user_id,$4,sort_order,created_at,$5 from product_feedback_attachments where organization_id=$1 and feedback_id=$2 and id=$3`, [...values, auth.user.id, cleanupId]);
    await tx.query("delete from product_feedback_attachments where organization_id=$1 and feedback_id=$2 and id=$3", values);
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, { app: "product-feedback", kind: "product-feedback-attachment-delete", action: "delete", severity: "Medium",
      targetType: "product-feedback-attachment", targetId: attachmentId, projectId: null, metadata: { feedbackId, attachmentId, deletedCount: 1 } });
    return cleanupId;
  });
  try { await cleanupFeedbackAttachmentUploads(db, store, auth, receiptId); }
  catch (error) {
    if (!["55P03", "40P01", "40001"].includes((error as { code?: string }).code ?? "")) throw error;
    // A busy writer leaves a committed deletion marker with a retryable receipt.
  }
  const item = administrator ? await getFeedbackById(db, auth, feedbackId) : await getMyFeedbackById(db, auth, feedbackId);
  return { item, pendingAttachmentCleanupCount: item?.attachments.filter((attachment) => attachment.cleanupPending).length ?? 0 };
}
