import { createHash, randomUUID } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { referencedLogObjects } from "../logs/deletionPreview";
import { sanitizeFileName, sanitizePathSegment, type ObjectStore } from "../logs/objectStore";
import { requireProductFeedbackSubmit } from "./policy";
import type { InsertProductFeedbackAttachmentInput, ProductFeedbackAttachmentContentType } from "./types";

type Upload = { fileName: string; contentType: ProductFeedbackAttachmentContentType; bytes: Buffer };

export async function pendingFeedbackAttachmentCleanup(db: Queryable, auth: AuthContext) {
  requireProductFeedbackSubmit(auth);
  const result = await db.query<{ count: number }>(`select coalesce(sum(cardinality(object_keys)),0)::int count from product_feedback_attachment_uploads u
    where organization_id=$1 and uploaded_by_user_id=$2 and not exists(select 1 from product_feedback_attachment_deletions d where d.cleanup_upload_id=u.id)`, [auth.organization.id, auth.user.id]);
  return result.rows[0]?.count ?? 0;
}

export async function queueFeedbackAttachmentCleanup(db: Queryable, auth: AuthContext, keys: string[], id = randomUUID(), inFlight = false) {
  if (!keys.length) return;
  await db.query(`insert into product_feedback_attachment_uploads(id,organization_id,uploaded_by_user_id,object_keys,in_flight) values($1,$2,$3,$4,$5)
    on conflict(id) do update set object_keys=excluded.object_keys,in_flight=excluded.in_flight where product_feedback_attachment_uploads.organization_id=excluded.organization_id and product_feedback_attachment_uploads.uploaded_by_user_id=excluded.uploaded_by_user_id`,
  [id, auth.organization.id, auth.user.id, [...new Set(keys)], inFlight]);
}

export async function cleanupFeedbackAttachmentUploads(db: Database, store: ObjectStore, auth: AuthContext, receiptId?: string) {
  requireProductFeedbackSubmit(auth);
  await db.transaction(async (tx) => {
    if (receiptId) {
      // ponytail: fixed metadata fence matches the shared reference scan. Narrow
      // this when every legacy-key writer uses a common per-object reservation.
      await tx.query(`lock table public.dts_reload_runs,public.knowledge_files,public.log_analysis_runs,public.log_artifact_objects,
        public.log_file_objects,public.log_files,public.log_original_uploads,public.log_skill_analysis_cases,public.log_skill_artifact_objects,
        public.log_skill_dry_runs,public.log_skill_samples,public.log_source_snapshots,public.product_feedback_attachments,
        public.project_parameter_file_candidates,public.project_parameter_file_versions in share mode nowait`);
    }
    // ponytail: admission must acquire its row lock within five minutes; use renewed leases if connection queues can exceed that ceiling.
    const rows = (await tx.query<{ id: string; object_keys: string[] }>(`select id,object_keys from product_feedback_attachment_uploads u
      where organization_id=$1 and uploaded_by_user_id=$2 and ($3::uuid is null or id=$3)
        and (not in_flight or created_at<now()-interval '5 minutes')
        and ($3::uuid is not null or not exists(select 1 from product_feedback_attachment_deletions d where d.cleanup_upload_id=u.id))
      order by created_at,id for update skip locked`, [auth.organization.id, auth.user.id, receiptId ?? null])).rows;
    if (!rows.length) return;
    const referenced = await referencedLogObjects(tx, rows.flatMap((row) => row.object_keys));
    for (const row of rows) {
      const remaining: string[] = [];
      for (const key of row.object_keys) {
        if (referenced.has(key)) continue;
        try { if (!store.delete) throw new Error("Object deletion unavailable"); await store.delete(key); }
        catch { remaining.push(key); }
      }
      if (remaining.length) await tx.query("update product_feedback_attachment_uploads set object_keys=$2 where id=$1", [row.id, remaining]);
      else await tx.query("delete from product_feedback_attachment_uploads where id=$1", [row.id]);
    }
  });
  return { pendingAttachmentCleanupCount: await pendingFeedbackAttachmentCleanup(db, auth) };
}

/** One feedback mutation owns unique upload names and a durable failure receipt.
 * The actual IO stays under the receipt row lock until it settles; cleanup skips
 * active writes and rechecks committed references after an uncertain commit. */
export async function withFeedbackAttachmentWrites<T>(db: Database, store: ObjectStore, auth: AuthContext, uploads: Upload[],
  write: (tx: Database, put: () => Promise<InsertProductFeedbackAttachmentInput[]>) => Promise<T>): Promise<T> {
  requireProductFeedbackSubmit(auth);
  const attemptId = randomUUID();
  const planned = uploads.map((input) => {
    const id = randomUUID(), fileName = sanitizeFileName(input.fileName);
    const objectName = `feedback-${id}.${input.contentType === "image/jpeg" ? "jpg" : input.contentType.slice(6)}`;
    const key = `${sanitizePathSegment(auth.organization.id, "organization id")}/${createHash("sha256").update(input.bytes).digest("hex")}-${objectName}`;
    return { ...input, id, fileName, objectName, key };
  });
  const keys = new Set(planned.map((item) => item.key));
  await queueFeedbackAttachmentCleanup(db, auth, [...keys], attemptId, true);
  let storageFailure: unknown;
  try {
    const result = await db.transaction(async (tx) => {
      if (planned.length) {
        const locked = await tx.query("select id from product_feedback_attachment_uploads where id=$1 and organization_id=$2 and uploaded_by_user_id=$3 for update", [attemptId, auth.organization.id, auth.user.id]);
        if (!locked.rows.length) throw new ApiError("CONFLICT", "附件上传已取消，请重试本次提交。");
      }
      const result = await write(tx, async () => {
        const stored: InsertProductFeedbackAttachmentInput[] = [];
        for (const [index, item] of planned.entries()) {
          try {
            const value = await store.put({ organizationId: auth.organization.id, fileName: item.objectName, contentType: item.contentType, bytes: item.bytes });
            keys.add(value.storageKey);
            stored.push({ id: item.id, storageKey: value.storageKey, fileName: item.fileName, contentType: item.contentType,
              sizeBytes: item.bytes.length, checksum: value.checksumSha256, sortOrder: index });
          } catch (error) { storageFailure = error; throw error; }
        }
        return stored;
      });
      await tx.query("delete from product_feedback_attachment_uploads where id=$1", [attemptId]);
      return result;
    });
    // Draft removals may have queued their old keys in the same transaction.
    await cleanupFeedbackAttachmentUploads(db, store, auth).catch(() => undefined);
    return result;
  } catch (error) {
    // Actual returned keys also survive adapters with a different key format.
    await queueFeedbackAttachmentCleanup(db, auth, [...keys], attemptId).catch(() => undefined);
    const cleanup = await cleanupFeedbackAttachmentUploads(db, store, auth).catch(() => null);
    if (!storageFailure) throw error;
    const code = (storageFailure as { code?: string; name?: string; status?: number; $metadata?: { httpStatusCode?: number } });
    const status = code.$metadata?.httpStatusCode ?? code.status;
    const sizeLimit = ["EntityTooLarge", "PAYLOAD_TOO_LARGE"].includes(code.code ?? code.name ?? "") || status === 413;
    const limit = sizeLimit || ["ENOSPC", "EDQUOT", "QuotaExceeded", "BucketQuotaExceeded", "InsufficientStorage"].includes(code.code ?? code.name ?? "") || status === 507;
    const pending = cleanup?.pendingAttachmentCleanupCount ?? keys.size;
    const message = sizeLimit ? "附件写入失败：部署对象存储的单对象大小限制已触发，请联系管理员核对存储设置。" : limit ? "附件写入失败：部署存储空间或配额不足，请联系管理员释放空间后重试。" : "附件存储暂不可用，请稍后重试本次提交。";
    throw new ApiError("INTERNAL_ERROR", `${message}${pending ? ` 有 ${pending} 个上传对象待清理，可在“我的反馈”中重试上传清理。` : ""}`,
      { reason: limit ? "deployment-storage-limit" : "attachment-storage-unavailable", pendingAttachmentCleanupCount: pending });
  }
}
