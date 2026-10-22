import { createHash } from "node:crypto";
import pg from "pg";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { SkillDeletionPreview, SkillDeletionStatus } from "../contracts/dtoSchemas/skillDeletion";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationContext, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import { referencedLogObjects } from "./deletionPreview";
import type { ObjectStore } from "./objectStore";
import { requireLogAdminDomains } from "./policy";

type Receipt = { skill_id: string; skill_name: string; skill_key: string; preview_version: string; pending_object_keys: string[]; retained_objects: number };
const status = (r: Receipt): SkillDeletionStatus => ({ skillId: r.skill_id, name: r.skill_name, skillKey: r.skill_key,
  version: r.preview_version, database: "deleted", objects: r.pending_object_keys.length ? "pending" : "complete",
  pendingObjects: r.pending_object_keys.length, retainedObjects: r.retained_objects });
function requireAdministrator(auth: AuthContext) {
  requireLogAdminDomains(auth);
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "无权访问此组织的技能。");
}
async function currentAdministrator(tx: Queryable, auth: AuthContext) {
  requireAdministrator(auth);
  const result = await tx.query(`select 1 from users u where u.id=$1 and u.organization_id=$2 and u.is_active
    and exists(select 1 from user_role_bindings b where b.user_id=u.id and b.organization_id=$2
      and b.project_id is null and b.role_id in ('admin','platform-admin'))`, [auth.user.id, auth.organization.id]);
  if (!result.rows.length) throw new ApiError("FORBIDDEN", "需要本组织当前有效的管理员权限。");
}
async function receipt(tx: Queryable, auth: AuthContext, skillId: string) {
  return (await tx.query<Receipt>("select * from log_skill_deletions where organization_id=$1 and skill_id=$2", [auth.organization.id, skillId])).rows[0];
}
function normalize(error: unknown): never {
  if (error instanceof pg.DatabaseError && ["40001", "40P01", "55P03", "55000", "23503"].includes(error.code ?? ""))
    throw new ApiError("CONFLICT", "技能或关联任务正在更新，请刷新预览后重试。", { reason: "skill-deletion-busy" });
  throw error;
}
const ownKeys = `select object_key from log_skill_artifact_objects where organization_id=$1 and skill_id=$2
  union select object_key from log_skill_samples where organization_id=$1 and skill_id=$2
  union select sample_object_key from log_skill_dry_runs where organization_id=$1 and skill_id=$2
  union select storage_key from log_source_snapshots where organization_id=$1 and skill_id=$2
  union select u->>'objectKey' from log_skill_analysis_cases c cross join lateral jsonb_array_elements(c.uploads) u
    where organization_id=$1 and skill_id=$2 and u->>'objectKey' is not null`;
const inventoryLabels = [
  ["skill", "技能身份及回调配置", "delete"], ["revisions", "版本、草稿及解析测试", "delete"], ["samples", "样例", "delete"],
  ["cases", "实验测试用例", "delete"], ["case-runs", "实验测试运行", "delete"], ["dry-runs", "试跑及轨迹", "delete"],
  ["snapshots", "专属源码快照", "delete"], ["source-files", "源码文件索引", "delete"], ["source-chunks", "源码片段索引", "delete"],
  ["source-statements", "源码语句索引", "delete"], ["artifacts", "对象写入记录", "delete"], ["deliveries", "Webhook 投递记录", "delete"],
  ["credentials", "集成凭证（含已吊销）", "delete"], ["outbox", "待投递事件", "delete"],
  ["logs", "历史日志（技能名称快照）", "retain"], ["runs", "分析报告（技能名称与版本快照）", "retain"],
  ["shared-snapshots", "其他技能引用的源码快照及索引", "retain"],
  ["knowledge-links", "知识关联", "delete"],
  ["knowledge", "共享知识及历史修订", "retain"]
] as const;

async function readPreview(tx: Queryable, auth: AuthContext, skillId: string): Promise<SkillDeletionPreview> {
  const values = [auth.organization.id, skillId];
  const skill = (await tx.query<{ name: string; skill_key: string; status: "active" | "archived" }>(
    "select name,skill_key,status from log_domains where organization_id=$1 and id=$2", values)).rows[0];
  if (!skill) throw new ApiError("NOT_FOUND", "未找到分析技能。");
  const summaries = (await tx.query<{ key: string; count: number; digest: string }>(`with exclusive_snapshots as (
    select s.id from log_source_snapshots s where s.organization_id=$1 and s.skill_id=$2 and not exists
      (select 1 from log_skill_revisions r where r.organization_id=$1 and r.skill_id<>$2 and r.spec->>'defaultSourceSnapshotId'=s.id)
  ), scope(key,state) as (
    select 'skill',to_jsonb(r) from log_domains r where organization_id=$1 and id=$2
    union all select 'revisions',to_jsonb(r) from log_skill_revisions r where organization_id=$1 and skill_id=$2
    union all select 'samples',to_jsonb(r) from log_skill_samples r where organization_id=$1 and skill_id=$2
    union all select 'cases',to_jsonb(r) from log_skill_analysis_cases r where organization_id=$1 and skill_id=$2
    union all select 'case-runs',jsonb_build_object('id',id) from log_skill_analysis_case_runs where organization_id=$1 and skill_id=$2
    union all select 'dry-runs',jsonb_build_object('id',id,'sample',sample_object_key) from log_skill_dry_runs where organization_id=$1 and skill_id=$2
    union all select 'snapshots',jsonb_build_object('id',id,'key',storage_key) from log_source_snapshots where organization_id=$1 and id in (select id from exclusive_snapshots)
    union all select 'source-files',jsonb_build_object('id',id) from log_source_files where organization_id=$1 and snapshot_id in (select id from exclusive_snapshots)
    union all select 'source-chunks',jsonb_build_object('id',id) from log_source_chunks where organization_id=$1 and snapshot_id in (select id from exclusive_snapshots)
    union all select 'source-statements',jsonb_build_object('id',id) from log_source_statements where organization_id=$1 and snapshot_id in (select id from exclusive_snapshots)
    union all select 'artifacts',to_jsonb(r) from log_skill_artifact_objects r where organization_id=$1 and skill_id=$2
    union all select 'deliveries',to_jsonb(r) from log_webhook_deliveries r where organization_id=$1 and log_domain_id=$2
    union all select 'credentials',to_jsonb(r) from log_integration_credentials r where organization_id=$1 and skill_id=$2
    union all select 'outbox',to_jsonb(r) from log_webhook_outbox r where organization_id=$1 and log_domain_id=$2
    union all select 'knowledge-links',to_jsonb(r) from log_domain_knowledge_links r where organization_id=$1 and log_domain_id=$2
    union all select 'logs',jsonb_build_object('id',id) from log_records where organization_id=$1 and log_domain_id=$2
    union all select 'runs',jsonb_build_object('id',id,'revision',skill_revision_id,'source',source_snapshot_id) from log_analysis_runs where organization_id=$1 and
      (skill_revision_id in (select id from log_skill_revisions where organization_id=$1 and skill_id=$2)
       or log_record_id in (select id from log_records where organization_id=$1 and log_domain_id=$2))
    union all select 'shared-snapshots',jsonb_build_object('id',s.id) from log_source_snapshots s where s.organization_id=$1 and s.skill_id=$2
      and exists(select 1 from log_skill_revisions r where r.organization_id=$1 and r.skill_id<>$2 and r.spec->>'defaultSourceSnapshotId'=s.id)
    union all select 'knowledge',jsonb_build_object('id',id) from knowledge_entries where organization_id=$1 and id::text in
      (select knowledge_entry_id::text from log_domain_knowledge_links where organization_id=$1 and log_domain_id=$2
       union select jsonb_array_elements_text(coalesce(spec->'knowledgeEntryIds','[]')) from log_skill_revisions where organization_id=$1 and skill_id=$2)
  ) select key,count(*)::int count,encode(sha256(convert_to(string_agg(state::text,'' order by state::text),'UTF8')),'hex') digest from scope group by key`, values)).rows;
  const counts = (await tx.query<{ published: number; logs: number; runs: number; evidence: number; credentials: number; references: number; deliveries: number }>(`select
    (select count(*)::int from log_skill_revisions where organization_id=$1 and skill_id=$2 and (status<>'draft' or published_at is not null)) published,
    (select count(*)::int from log_records where organization_id=$1 and log_domain_id=$2) logs,
    (select count(*)::int from log_analysis_runs where organization_id=$1 and (skill_revision_id in (select id from log_skill_revisions where organization_id=$1 and skill_id=$2)
      or source_snapshot_id in (select id from log_source_snapshots where organization_id=$1 and skill_id=$2))) runs,
    (select count(*)::int from log_evidence where organization_id=$1 and source_snapshot_id in (select id from log_source_snapshots where organization_id=$1 and skill_id=$2)) evidence,
    (select count(*)::int from log_integration_credentials where organization_id=$1 and skill_id=$2) credentials,
    (select count(*)::int from log_skill_revisions where organization_id=$1 and skill_id<>$2 and spec->>'defaultSourceSnapshotId' in (select id from log_source_snapshots where organization_id=$1 and skill_id=$2)) references,
    (select count(*)::int from log_webhook_deliveries where organization_id=$1 and log_domain_id=$2 and kind<>'test') deliveries`, values)).rows[0]!;
  const blockers = skill.status === "archived" || Object.values(counts).every(count => count === 0)
    ? [] : [{ code: "active", count: 1, message: "请先归档技能，再彻底删除。" }];
  const unfinished = (await tx.query<{ count: number }>(`select count(*)::int count from (
    select a.id from log_analysis_runs a
      join log_records l on l.id=a.log_record_id and l.organization_id=a.organization_id
      left join log_skill_revisions r on r.id=a.skill_revision_id and r.organization_id=a.organization_id
      where a.organization_id=$1 and (r.skill_id=$2 or l.log_domain_id=$2
        or a.source_snapshot_id in (select id from log_source_snapshots where organization_id=$1 and skill_id=$2)
        or r.spec->>'defaultSourceSnapshotId' in (select id from log_source_snapshots where organization_id=$1 and skill_id=$2))
        and (a.status not in ('complete','failed') or exists(select 1 from jobs j where j.organization_id=$1
          and j.kind='log-analysis' and j.target_id=a.id and j.status not in ('complete','failed')))
    union all select id from log_skill_dry_runs where organization_id=$1 and skill_id=$2 and status not in ('complete','failed')
    union all select id from log_skill_analysis_case_runs where organization_id=$1 and skill_id=$2 and status not in ('complete','failed')
  ) ongoing`, values)).rows[0]!.count;
  if (unfinished) blockers.push({ code: "analyses-in-progress", count: unfinished, message: `有 ${unfinished} 个分析仍在进行，完成后再删除。` });
  const keys = (await tx.query<{ object_key: string }>(ownKeys, values)).rows.map((r) => r.object_key);
  const shared = await referencedLogObjects(tx, keys, skillId);
  const sharedSnapshots = (await tx.query<{ storage_key: string }>(`select s.storage_key from log_source_snapshots s
    where s.organization_id=$1 and s.skill_id=$2 and exists(select 1 from log_skill_revisions r
      where r.organization_id=$1 and r.skill_id<>$2 and r.spec->>'defaultSourceSnapshotId'=s.id)`, values)).rows;
  for (const snapshot of sharedSnapshots) shared.add(snapshot.storage_key);
  // Derived worker progress cannot enlarge the confirmed experiment scope. New roots, drafts, artifacts and external references invalidate it.
  const stable = summaries.filter((s) => !["source-files", "source-chunks", "source-statements", "deliveries", "knowledge"].includes(s.key));
  const version = createHash("sha256").update(JSON.stringify(["skill-deletion-v1", auth.organization.id, auth.user.id, skillId,
    stable.sort((a, b) => a.key.localeCompare(b.key)), counts, unfinished, keys.sort(), [...shared].sort()])).digest("hex");
  return { skillId, name: skill.name, skillKey: skill.skill_key, status: skill.status, version, generatedAt: new Date().toISOString(), canDelete: !blockers.length,
    inventory: inventoryLabels.map(([key, label, disposition]) => ({ key, label, disposition, count: summaries.find((r) => r.key === key)?.count ?? 0 })),
    objects: { total: keys.length, shared: shared.size, exclusive: keys.length - shared.size }, blockers,
    notes: ["已归档或从未发布且无外部使用的技能可以彻底删除；名称和技能标识可重新使用。", "历史日志与分析报告保留技能名称和版本快照；其他技能引用的源码快照及共享知识保留。", "独占存储对象一起清理，失败可重试。"] };
}

// ponytail: deletion briefly pauses public metadata writers; replace with per-object writer fences if this becomes a measured bottleneck.
async function fence(tx: Queryable, auth: AuthContext, skillId: string) {
  await tx.query("set local lock_timeout='2s'");
  // Use the same first row lock as save/publish/sample admission before the maintenance fence.
  await tx.query("select id from log_domains where organization_id=$1 and id=$2 for update", [auth.organization.id, skillId]);
  await tx.query(`lock table log_domains,log_skill_revisions,log_skill_samples,log_skill_dry_runs,log_skill_analysis_cases,
    log_skill_analysis_case_runs,log_source_snapshots,log_source_files,log_source_chunks,log_source_statements,
    log_analysis_trace_steps,log_skill_artifact_objects,log_skill_deletions,log_file_objects,log_files,log_original_uploads,
    log_artifact_objects,jobs,log_analysis_runs,log_evidence,log_records,knowledge_files,product_feedback_attachments,
    project_parameter_file_versions,project_parameter_file_candidates,dts_reload_runs,log_integration_credentials,
    log_webhook_outbox,log_webhook_deliveries,log_domain_knowledge_links,users,user_role_bindings in exclusive mode nowait`);
  await currentAdministrator(tx, auth);
}
export async function previewSkillDeletion(db: Database, auth: AuthContext, skillId: string) {
  requireAdministrator(auth);
  return db.transaction(async (tx) => { await tx.query("set transaction isolation level repeatable read read only"); await currentAdministrator(tx, auth); return readPreview(tx, auth, skillId); });
}
export async function getSkillDeletionStatus(db: Database, auth: AuthContext, skillId: string) {
  await currentAdministrator(db, auth);
  const item = await receipt(db, auth, skillId);
  if (!item) throw new ApiError("NOT_FOUND", "技能尚未永久删除。");
  return status(item);
}
export async function listSkillDeletions(db: Database, auth: AuthContext) {
  await currentAdministrator(db, auth);
  return (await db.query<Receipt>("select * from log_skill_deletions where organization_id=$1 and cardinality(pending_object_keys)>0 order by erased_at desc", [auth.organization.id])).rows.map(status);
}
export async function purgeSkill(db: Database, invocation: TrustedInvocationContext, skillId: string, version: string, requestId: string, store?: ObjectStore) {
  const trusted = assertTrustedInvocationContext(invocation);
  if (trusted.initiator !== "user") throw new ApiError("FORBIDDEN", "技能删除须由管理员本人确认。");
  const auth = trusted.principal;
  requireAdministrator(auth);
  try {
    await db.transaction(async (tx) => {
      await fence(tx, auth, skillId);
      const previous = await receipt(tx, auth, skillId);
      if (previous) {
        if (previous.preview_version !== version) throw new ApiError("CONFLICT", "确认信息与原删除请求不一致，请读取删除状态。");
        return;
      }
      const preview = await readPreview(tx, auth, skillId);
      if (!preview.canDelete) throw new ApiError("CONFLICT", preview.blockers.map(blocker => blocker.message).join(""), { blockers: preview.blockers });
      if (preview.version !== version) throw new ApiError("CONFLICT", "技能或引用已变化，请刷新影响预览后确认。", { reason: "skill-deletion-preview-stale" });
      const keys = (await tx.query<{ object_key: string }>(ownKeys, [auth.organization.id, skillId])).rows.map((r) => r.object_key);
      await tx.query(`insert into log_skill_deletions(organization_id,skill_id,skill_name,skill_key,preview_version,pending_object_keys,erased_by)
        values($1,$2,$3,$4,$5,$6,$7)`, [auth.organization.id, skillId, preview.name, preview.skillKey, version, keys, auth.user.id]);
      const values = [auth.organization.id, skillId];
      await tx.query(`update log_analysis_runs a set
        skill_name_snapshot=coalesce(a.skill_name_snapshot,d.name),
        skill_revision_number_snapshot=coalesce(a.skill_revision_number_snapshot,r.revision_number),skill_revision_id=null
        from log_skill_revisions r join log_domains d on d.id=r.skill_id and d.organization_id=r.organization_id
        where a.organization_id=$1 and r.organization_id=$1 and r.skill_id=$2 and a.skill_revision_id=r.id`, values);
      await tx.query(`update log_records set skill_name_snapshot=coalesce(skill_name_snapshot,$3),log_domain_id=null
        where organization_id=$1 and log_domain_id=$2`, [...values, preview.name]);
      await tx.query(`update log_records set created_by_credential_id=null where organization_id=$1 and created_by_credential_id in
        (select id from log_integration_credentials where organization_id=$1 and skill_id=$2)`, values);
      await tx.query(`update log_file_objects set created_by_credential_id=null where organization_id=$1 and created_by_credential_id in
        (select id from log_integration_credentials where organization_id=$1 and skill_id=$2)`, values);
      await tx.query("delete from log_integration_credentials where organization_id=$1 and skill_id=$2", values);
      await tx.query(`update log_source_snapshots s set skill_id=null where s.organization_id=$1 and s.skill_id=$2
        and exists(select 1 from log_skill_revisions r where r.organization_id=$1 and r.skill_id<>$2 and r.spec->>'defaultSourceSnapshotId'=s.id)`, values);
      await tx.query(`update log_analysis_runs set source_snapshot_id=null,source_snapshot_status='missing'
        where organization_id=$1 and source_snapshot_id in (select id from log_source_snapshots where organization_id=$1 and skill_id=$2)`, values);
      await tx.query(`update log_evidence set source_snapshot_id=null,source_path=null,source_line=null
        where organization_id=$1 and source_snapshot_id in (select id from log_source_snapshots where organization_id=$1 and skill_id=$2)`, values);
      await tx.query("delete from log_domains where organization_id=$1 and id=$2", values);
      await writeTrustedAuditEventInTx(asAuditTx(tx), { invocation: trusted, projectId: null, app: "log-analysis", kind: "skill-experiment-purged",
        action: "彻底删除技能及专属数据", severity: "High", targetType: "log-skill", targetId: skillId, traceId: requestId,
        metadata: { version, inventory: preview.inventory, objects: preview.objects } });
    });
    try {
      await db.transaction(async (tx) => {
        await fence(tx, auth, skillId);
        const item = (await receipt(tx, auth, skillId))!;
        const shared = await referencedLogObjects(tx, item.pending_object_keys);
        for (const key of item.pending_object_keys) {
          if (!shared.has(key)) {
            if (!store?.delete) return;
            try { await store.delete(key); } catch { return; }
          }
          await tx.query(`update log_skill_deletions set pending_object_keys=array_remove(pending_object_keys,$3),
            retained_objects=retained_objects+$4 where organization_id=$1 and skill_id=$2`, [auth.organization.id, skillId, key, shared.has(key) ? 1 : 0]);
        }
      });
    } catch (error) {
      if (!(error instanceof pg.DatabaseError) || !["40001", "40P01", "55P03"].includes(error.code ?? "")) throw error;
      // The committed database deletion remains truthful while a busy cleanup can be retried.
    }
    return getSkillDeletionStatus(db, auth, skillId);
  } catch (error) { return normalize(error); }
}
