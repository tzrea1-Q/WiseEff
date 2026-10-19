import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditedWriteContext } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { bundleFileUtf8Bytes, decodeLogBundleFile, isLogArchive } from "./bundleIntake";
import type { ObjectStore } from "./objectStore";
import { requireLogAdminDomains } from "./policy";
import { getLogSkill } from "./skillsService";
import { lockSkill } from "./skillsRepository";

const maxBytes = 2 * 1024 * 1024;
type SampleRow = { id: string; skillId: string; fileName: string; sizeBytes: string; sha256: string; encoding: string;
  lineCount: number; objectKey: string; uploadedByUserId: string | null; createdAt: Date; updatedAt: Date };
const selectSample = `select id, skill_id as "skillId", file_name as "fileName", size_bytes as "sizeBytes", sha256,
  encoding, line_count as "lineCount", object_key as "objectKey", uploaded_by_user_id as "uploadedByUserId",
  created_at as "createdAt", updated_at as "updatedAt" from log_skill_samples`;
function metadata(row: SampleRow) {
  const { objectKey: _objectKey, ...item } = row;
  return { ...item, sizeBytes: Number(row.sizeBytes), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
function audit(skillId: string, kind: string) {
  return { app: "log-analysis", kind, action: kind, severity: "Medium" as const, projectId: null,
    targetType: "log-skill", targetId: skillId, metadata: {} };
}
function requireSampleWrite(auth: AuthContext) {
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "Log organization access is required.");
  requireLogAdminDomains(auth);
}
export async function getLogSkillSample(db: Database, store: ObjectStore, auth: AuthContext, skillId: string) {
  await getLogSkill(db, auth, skillId);
  const row = (await db.query<SampleRow>(`${selectSample} where organization_id = $1 and skill_id = $2`, [auth.organization.id, skillId])).rows[0];
  if (!row) return null;
  const text = (await store.get(row.objectKey)).toString("utf8");
  return { ...metadata(row), content: text.split(/\r\n|\n|\r/, 5000).join("\n"), truncated: row.lineCount > 5000 };
}
export async function replaceLogSkillSample(db: Database, store: ObjectStore, auth: AuthContext, skillId: string,
  input: { fileName: string; contentBase64: string }, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Replace skill sample");
  requireSampleWrite(auth);
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.length > maxBytes) throw new ApiError("VALIDATION_FAILED", "样例日志不能超过 2 MiB。");
  if (isLogArchive(input.fileName) || bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))
    || bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    || bytes.subarray(257, 262).toString() === "ustar") throw new ApiError("VALIDATION_FAILED", "样例日志只支持一个文本文件，不支持压缩包。");
  const file = decodeLogBundleFile(input.fileName, bytes, false);
  if (file.status !== "analyzed") throw new ApiError("VALIDATION_FAILED", `无法上传样例：${file.skipReason}。`);
  const id = randomUUID();
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    // Unique names isolate sample objects from content-addressed record objects.
    // Old objects are retained: a failed DB write must never remove shared data.
    const object = await store.put({ organizationId: auth.organization.id, fileName: `sample-${id}.log`,
      contentType: "text/plain; charset=utf-8", bytes: bundleFileUtf8Bytes(file) });
    await tx.query(`insert into log_skill_samples (id, organization_id, skill_id, file_name, size_bytes, sha256,
      encoding, line_count, object_key, uploaded_by_user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (skill_id) do update set id = excluded.id, file_name = excluded.file_name,
      size_bytes = excluded.size_bytes, sha256 = excluded.sha256, encoding = excluded.encoding,
      line_count = excluded.line_count, object_key = excluded.object_key,
      uploaded_by_user_id = excluded.uploaded_by_user_id, updated_at = now()`,
    [id, auth.organization.id, skillId, input.fileName, file.sizeBytes, file.sha256, file.encoding, file.lineCount, object.storageKey, auth.user.id]);
    const row = (await tx.query<SampleRow>(`${selectSample} where organization_id = $1 and skill_id = $2`, [auth.organization.id, skillId])).rows[0];
    return { result: metadata(row), audit: audit(skillId, "log-skill-sample-replace") };
  });
}
export async function deleteLogSkillSample(db: Database, auth: AuthContext, skillId: string,
  invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Delete skill sample");
  requireSampleWrite(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    await tx.query("delete from log_skill_samples where organization_id = $1 and skill_id = $2", [auth.organization.id, skillId]);
    return { result: undefined, audit: audit(skillId, "log-skill-sample-delete") };
  });
}
