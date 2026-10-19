import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditedWriteContext } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { requireLogAdminDomains, requireLogView } from "./policy";
import { getLogDomainById } from "./domainsRepository";
import type { ObjectStore } from "./objectStore";
import { getSourceSnapshotLimits } from "./sourceArchive";
import { insertSkillRevision, listSkillRevisions, lockSkill } from "./skillsRepository";
import type { LogSkillSpec } from "./skillSpec";

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

function requireOrganization(auth: AuthContext) {
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "Log organization access is required.");
}
async function requireSkill(db: Queryable, auth: AuthContext, skillId: string) {
  requireOrganization(auth);
  if (!await getLogDomainById(db, { organizationId: auth.organization.id, domainId: skillId })) {
    throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  }
}
async function getSnapshot(db: Queryable, organizationId: string, skillId: string, id: string) {
  const row = (await db.query<SourceSnapshotDto>(`${snapshotSelect}
    where organization_id = $1 and skill_id = $2 and id = $3`, [organizationId, skillId, id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "Source snapshot was not found.");
  return { ...row, createdAt: new Date(row.createdAt).toISOString() };
}
function audit(id: string, kind: string, skillId: string) {
  return { app: "log-analysis", kind, action: kind, severity: "Medium" as const, projectId: null,
    targetType: "log-source-snapshot", targetId: id, metadata: { skillId } };
}

/** Metadata only: there is deliberately no source-file/content route in this slice. */
export async function listSourceSnapshots(db: Queryable, auth: AuthContext, skillId: string) {
  requireLogView(auth);
  await requireSkill(db, auth, skillId);
  const result = await db.query<SourceSnapshotDto>(`${snapshotSelect}
    where organization_id = $1 and skill_id = $2 order by created_at desc, id`, [auth.organization.id, skillId]);
  return { items: result.rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })) };
}

export async function validateDefaultSourceSnapshot(db: Queryable, organizationId: string, skillId: string, spec: LogSkillSpec, allowArchived = false) {
  if (!spec.defaultSourceSnapshotId) return;
  const snapshot = await getSnapshot(db, organizationId, skillId, spec.defaultSourceSnapshotId);
  if (snapshot.status === "archived" && !allowArchived) throw new ApiError("CONFLICT", "Archived source snapshots cannot be set as default.");
}

export async function uploadSourceSnapshot(db: Database, objectStore: ObjectStore, auth: AuthContext, skillId: string,
  input: { versionLabel: string; fileName: string; bytes: Buffer }, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Upload source snapshot");
  requireLogAdminDomains(auth);
  await requireSkill(db, auth, skillId);
  const versionLabel = input.versionLabel.trim();
  if (!versionLabel || versionLabel.length > 200) throw new ApiError("VALIDATION_FAILED", "A version label of at most 200 characters is required.");
  if (!/\.(?:tar\.gz|tgz|zip)$/i.test(input.fileName) || /[/\\]|\.\./.test(input.fileName)) {
    throw new ApiError("VALIDATION_FAILED", "A .tar.gz, .tgz or .zip source archive is required.");
  }
  if (!input.bytes.length || input.bytes.length > getSourceSnapshotLimits().maxCompressedBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Source archive exceeds the compressed upload limit.");
  }
  let storedKey: string | undefined;
  let rollbackConfirmed = false;
  try {
    return await db.transaction((transaction) => withAuditedWrite(transaction, invocation, context, async (tx) => {
      await lockSkill(tx, auth.organization.id, skillId);
      if ((await tx.query(`select id from log_source_snapshots where organization_id = $1 and skill_id = $2
        and version_label = $3 and status <> 'archived'`, [auth.organization.id, skillId, versionLabel])).rows.length) {
        throw new ApiError("CONFLICT", "This source version label already exists for the skill.");
      }
      const id = randomUUID();
      // A unique object name keeps rollback cleanup from deleting another upload.
      const stored = await objectStore.put({ organizationId: auth.organization.id, fileName: `${id}-${input.fileName}`,
        contentType: "application/octet-stream", bytes: input.bytes });
      storedKey = stored.storageKey;
      await tx.query(`insert into log_source_snapshots (id, organization_id, skill_id, version_label, storage_key, file_name)
        values ($1,$2,$3,$4,$5,$6)`, [id, auth.organization.id, skillId, versionLabel, stored.storageKey, input.fileName]);
      return { result: await getSnapshot(tx, auth.organization.id, skillId, id), audit: audit(id, "log-source-snapshot-upload", skillId) };
    }), { onConfirmedRollback: () => { rollbackConfirmed = true; } });
  } catch (error) {
    // Never delete after an ambiguous COMMIT: the row may already be durable.
    if (rollbackConfirmed && storedKey) await objectStore.delete?.(storedKey).catch(() => undefined);
    throw error;
  }
}

export async function archiveSourceSnapshot(db: Database, auth: AuthContext, skillId: string, id: string,
  invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Archive source snapshot");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    await getSnapshot(tx, auth.organization.id, skillId, id);
    await tx.query(`update log_source_snapshots set status = 'archived', updated_at = now()
      where organization_id = $1 and skill_id = $2 and id = $3`, [auth.organization.id, skillId, id]);
    return { result: await getSnapshot(tx, auth.organization.id, skillId, id), audit: audit(id, "log-source-snapshot-archive", skillId) };
  });
}

/** Update under the same skill lock used by save/publish, replacing the draft token. */
export async function setDefaultSourceSnapshot(db: Database, auth: AuthContext, skillId: string, id: string,
  invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Set default source snapshot");
  requireOrganization(auth);
  requireLogAdminDomains(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    const revisions = await listSkillRevisions(tx, auth.organization.id, skillId);
    const base = revisions.find((r) => r.status === "draft") ?? revisions.find((r) => r.status === "published");
    if (!base) throw new ApiError("CONFLICT", "Analysis skill has no published revision.");
    const spec = { ...base.spec, defaultSourceSnapshotId: id };
    await validateDefaultSourceSnapshot(tx, auth.organization.id, skillId, spec);
    await tx.query(`delete from log_skill_revisions where organization_id = $1 and skill_id = $2 and status = 'draft'`, [auth.organization.id, skillId]);
    await insertSkillRevision(tx, { organizationId: auth.organization.id, skillId, spec, userId: auth.user.id });
    return { result: undefined, audit: audit(id, "log-source-snapshot-default", skillId) };
  });
}
