import { organizationId as logOrganizationId, assertLogInvocation, type LogAccessContext } from "./principal";
import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditedWriteContext } from "../audit/auditedWrite";
import { type TrustedInvocationContext } from "../auth/trustedInvocation";
import { requireLogAdminDomains, requireLogView } from "./policy";
import { getLogDomainById } from "./domainsRepository";
import type { ObjectStore } from "./objectStore";
import { hasLogObjectCustody, withLogObjectCustody } from "./objectWrites";
import { getSourceSnapshotLimits } from "./sourceArchive";
import { insertSkillRevision, listSkillRevisions, lockSkill } from "./skillsRepository";
import type { LogSkillSpec } from "./skillSpec";
import { locateLogStatements, readSourceExcerpt } from "./sourceStatementRepository";
import { getLogRecord } from "./service";

export type SourceSnapshotDto = {
  id: string; skillId: string; versionLabel: string;
  status: "queued" | "indexing" | "ready" | "failed" | "archived";
  filesProcessed: number; filesTotal: number; fileCount: number;
  skippedCount: number; skippedFiles: Array<{ path: string; reason: string }>;
  error: string | null; createdAt: string;
};
const snapshotSelect = `select id, skill_id as "skillId", version_label as "versionLabel", status,
  files_processed as "filesProcessed", files_total as "filesTotal", file_count as "fileCount",
  skipped_count as "skippedCount", skipped_files as "skippedFiles", error, created_at as "createdAt"
  from log_source_snapshots`;

function requireOrganization(auth: LogAccessContext) {
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "无权访问此组织的日志。");
}
async function requireSkill(db: Queryable, auth: LogAccessContext, skillId: string) {
  requireOrganization(auth);
  if (!await getLogDomainById(db, { organizationId: logOrganizationId(auth), domainId: skillId })) {
    throw new ApiError("NOT_FOUND", "分析技能不存在。");
  }
}
async function getSnapshot(db: Queryable, organizationId: string, skillId: string, id: string) {
  const row = (await db.query<SourceSnapshotDto>(`${snapshotSelect}
    where organization_id = $1 and skill_id = $2 and id = $3`, [organizationId, skillId, id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "源码快照不存在。");
  return { ...row, createdAt: new Date(row.createdAt).toISOString() };
}
function audit(id: string, kind: string, skillId: string) {
  return { app: "log-analysis", kind, action: kind, severity: "Medium" as const, projectId: null,
    targetType: "log-source-snapshot", targetId: id, metadata: { skillId } };
}

/** Metadata only: there is deliberately no source-file/content route in this slice. */
export async function listSourceSnapshots(db: Queryable, auth: LogAccessContext, skillId: string) {
  requireLogView(auth);
  await requireSkill(db, auth, skillId);
  const result = await db.query<SourceSnapshotDto>(`${snapshotSelect}
    where organization_id = $1 and skill_id = $2 order by created_at desc, id`, [logOrganizationId(auth), skillId]);
  return { items: result.rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })) };
}

export async function validateDefaultSourceSnapshot(db: Queryable, organizationId: string, skillId: string, spec: LogSkillSpec, allowArchived = false) {
  if (!spec.defaultSourceSnapshotId) return;
  const snapshot = (await db.query<{ status: SourceSnapshotDto["status"] }>(`select s.status from log_source_snapshots s
    where s.organization_id=$1 and s.id=$3 and (s.skill_id=$2 or (s.skill_id is null and exists
      (select 1 from log_skill_revisions r where r.organization_id=$1 and r.skill_id=$2 and r.spec->>'defaultSourceSnapshotId'=s.id)))`,
    [organizationId, skillId, spec.defaultSourceSnapshotId])).rows[0];
  if (!snapshot) throw new ApiError("NOT_FOUND", "源码快照不存在。");
  if (snapshot.status === "archived" && !allowArchived) throw new ApiError("CONFLICT", "已归档的源码快照不能设为默认。");
}

export async function uploadSourceSnapshot(db: Database, objectStore: ObjectStore, auth: LogAccessContext, skillId: string,
  input: { versionLabel: string; fileName: string; bytes: Buffer }, invocation: TrustedInvocationContext, context: AuditedWriteContext): Promise<Awaited<ReturnType<typeof getSnapshot>>> {
  if (!hasLogObjectCustody(objectStore)) return withLogObjectCustody(db, objectStore, scoped => uploadSourceSnapshot(db, scoped, auth, skillId, input, invocation, context));
  assertLogInvocation(auth, invocation, "Upload source snapshot");
  requireLogAdminDomains(auth);
  await requireSkill(db, auth, skillId);
  const versionLabel = input.versionLabel.trim();
  if (!versionLabel || versionLabel.length > 200) throw new ApiError("VALIDATION_FAILED", "请填写版本名称，最多 200 个字符。");
  if (!/\.(?:tar\.gz|tgz|zip)$/i.test(input.fileName) || /[/\\]|\.\./.test(input.fileName)) {
    throw new ApiError("VALIDATION_FAILED", "请上传 .tar.gz、.tgz 或 .zip 源码压缩包。");
  }
  if (!input.bytes.length || input.bytes.length > getSourceSnapshotLimits().maxCompressedBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "源码压缩包超过上传大小上限。");
  }
  let storedKey: string | undefined;
  let rollbackConfirmed = false;
  try {
    return await db.transaction((transaction) => withAuditedWrite(transaction, invocation, context, async (tx) => {
      await lockSkill(tx, logOrganizationId(auth), skillId);
      if ((await tx.query(`select id from log_source_snapshots where organization_id = $1 and skill_id = $2
        and version_label = $3 and status <> 'archived'`, [logOrganizationId(auth), skillId, versionLabel])).rows.length) {
        throw new ApiError("CONFLICT", "此技能已存在同名源码版本。");
      }
      const id = randomUUID();
      const revisions = await listSkillRevisions(tx, logOrganizationId(auth), skillId);
      const revision = revisions.find((item) => item.status === "draft") ?? revisions.find((item) => item.status === "published");
      // A unique object name keeps rollback cleanup from deleting another upload.
      const stored = await objectStore.put({ organizationId: logOrganizationId(auth), fileName: `${id}-${input.fileName}`,
        contentType: "application/octet-stream", bytes: input.bytes });
      storedKey = stored.storageKey;
      await tx.query(`insert into log_source_snapshots (id, organization_id, skill_id, version_label, storage_key, file_name, statement_patterns)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [id, logOrganizationId(auth), skillId, versionLabel, stored.storageKey, input.fileName,
        JSON.stringify(revision?.spec.source?.statementPatterns ?? [])]);
      return { result: await getSnapshot(tx, logOrganizationId(auth), skillId, id), audit: audit(id, "log-source-snapshot-upload", skillId) };
    }), { onConfirmedRollback: () => { rollbackConfirmed = true; } });
  } catch (error) {
    // Never delete after an ambiguous COMMIT: the row may already be durable.
    if (rollbackConfirmed && storedKey) await objectStore.delete?.(storedKey).catch(() => undefined);
    throw error;
  }
}

/** Administrators can try only an organization's chosen ready snapshot. */
export async function trySourceStatement(db: Queryable, auth: LogAccessContext, skillId: string, snapshotId: string, line: string) {
  requireLogAdminDomains(auth);
  await requireSkill(db, auth, skillId);
  const snapshot = await getSnapshot(db, logOrganizationId(auth), skillId, snapshotId);
  if (snapshot.status !== "ready") throw new ApiError("CONFLICT", "请等待源码快照处理完成。");
  if (!line.trim() || line.length > 4000) throw new ApiError("VALIDATION_FAILED", "请输入一行日志，最多 4000 个字符。");
  return locateLogStatements(db, { organizationId: logOrganizationId(auth), snapshotId, line });
}

/** No path input: report viewers can retrieve only the location cited by this record's evidence. */
export async function getSourceEvidence(db: Queryable, auth: LogAccessContext, logId: string, evidenceId: string) {
  requireOrganization(auth);
  const record = await getLogRecord(db, auth, logId);
  const evidence = record.evidence.find((item) => item.id === evidenceId);
  if (!evidence?.sourceLocation) throw new ApiError("NOT_FOUND", "引用的源码证据不存在。");
  const excerpt = await readSourceExcerpt(db, { organizationId: logOrganizationId(auth), ...evidence.sourceLocation });
  if (!excerpt) throw new ApiError("NOT_FOUND", "引用的源码片段不存在。");
  return excerpt;
}

export async function archiveSourceSnapshot(db: Database, auth: LogAccessContext, skillId: string, id: string,
  invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertLogInvocation(auth, invocation, "Archive source snapshot");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, logOrganizationId(auth), skillId);
    await getSnapshot(tx, logOrganizationId(auth), skillId, id);
    await tx.query(`update log_source_snapshots set status = 'archived', updated_at = now()
      where organization_id = $1 and skill_id = $2 and id = $3`, [logOrganizationId(auth), skillId, id]);
    return { result: await getSnapshot(tx, logOrganizationId(auth), skillId, id), audit: audit(id, "log-source-snapshot-archive", skillId) };
  });
}

/** Reuse the immutable upload and its captured indexing inputs; a worker creates a fresh attempt token. */
export async function retrySourceSnapshot(db: Database, auth: LogAccessContext, skillId: string, id: string,
  invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertLogInvocation(auth, invocation, "Retry source snapshot indexing");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, logOrganizationId(auth), skillId);
    const snapshot = await getSnapshot(tx, logOrganizationId(auth), skillId, id);
    if (snapshot.status !== "failed") throw new ApiError("CONFLICT", "仅索引失败的源码快照可重新排队，请刷新状态。", { snapshotId: id, status: snapshot.status });
    return { result: await requeueSnapshot(tx, logOrganizationId(auth), skillId, id, "failed"), audit: audit(id, "log-source-snapshot-retry", skillId) };
  });
}

async function requeueSnapshot(tx: Queryable, organizationId: string, skillId: string, id: string, expectedStatus: "failed" | "archived") {
  const queued = await tx.query(`update log_source_snapshots set status='queued', index_attempt_id=null, error=null,
    files_processed=0, files_total=0, file_count=0, skipped_count=0, skipped_files='[]'::jsonb,
    statement_count=0, statements_truncated=false, updated_at=now()
    where organization_id=$1 and skill_id=$2 and id=$3 and status=$4 returning id`, [organizationId, skillId, id, expectedStatus]);
  if (!queued.rows.length) throw new ApiError("CONFLICT", "快照状态已变化，请刷新后重试。");
  return getSnapshot(tx, organizationId, skillId, id);
}

export async function restoreSourceSnapshot(db: Database, store: ObjectStore, auth: LogAccessContext, skillId: string, id: string,
  invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertLogInvocation(auth, invocation, "Restore source snapshot");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, logOrganizationId(auth), skillId);
    const snapshot = await getSnapshot(tx, logOrganizationId(auth), skillId, id);
    if (snapshot.status !== "archived") throw new ApiError("CONFLICT", "仅已归档的源码快照可恢复，请刷新状态。", { snapshotId: id, status: snapshot.status });
    const conflict = (await tx.query<{ id: string; versionLabel: string; status: string }>(`select id,version_label as "versionLabel",status
      from log_source_snapshots where organization_id=$1 and skill_id=$2 and version_label=$3 and status<>'archived' and id<>$4`,
    [logOrganizationId(auth), skillId, snapshot.versionLabel, id])).rows[0];
    if (conflict) throw new ApiError("CONFLICT", "该版本标签已被其他快照占用，请先归档占用项后重试。", { conflictingSnapshot: conflict });
    const key = (await tx.query<{ storage_key: string }>("select storage_key from log_source_snapshots where organization_id=$1 and skill_id=$2 and id=$3", [logOrganizationId(auth), skillId, id])).rows[0]!.storage_key;
    try {
      let readable = false;
      if (store.getStream) {
        // A range read checks existence without loading the archive; breaking closes the stream.
        for await (const chunk of await store.getStream(key, { start: 0, end: 0 })) { if (Buffer.byteLength(chunk)) { readable = true; break; } }
      } else readable = (await store.get(key)).length > 0;
      if (!readable) throw new Error("empty source object");
    } catch { throw new ApiError("CONFLICT", "原始源码文件无法读取，请检查对象存储并恢复原文件后重试。", { reason: "source-snapshot-object-unavailable", snapshotId: id }); }
    return { result: await requeueSnapshot(tx, logOrganizationId(auth), skillId, id, "archived"), audit: audit(id, "log-source-snapshot-restore", skillId) };
  });
}

/** Update under the same skill lock used by save/publish, replacing the draft token. */
export async function setDefaultSourceSnapshot(db: Database, auth: LogAccessContext, skillId: string, id: string,
  invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertLogInvocation(auth, invocation, "Set default source snapshot");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, logOrganizationId(auth), skillId);
    const revisions = await listSkillRevisions(tx, logOrganizationId(auth), skillId);
    const base = revisions.find((r) => r.status === "draft") ?? revisions.find((r) => r.status === "published");
    if (!base) throw new ApiError("CONFLICT", "分析技能尚未发布版本。");
    const spec = { ...base.spec, defaultSourceSnapshotId: id };
    await validateDefaultSourceSnapshot(tx, logOrganizationId(auth), skillId, spec);
    await tx.query(`delete from log_skill_revisions where organization_id = $1 and skill_id = $2 and status = 'draft'`, [logOrganizationId(auth), skillId]);
    await insertSkillRevision(tx, { organizationId: logOrganizationId(auth), skillId, spec, userId: auth.user.id });
    return { result: undefined, audit: audit(id, "log-source-snapshot-default", skillId) };
  });
}
