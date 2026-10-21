import { createHash } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { LogDeletionPreview } from "../../../src/domain/logs/deletionPreview";
import { requireLogAdminDomains } from "./policy";

const runs = "select id from log_analysis_runs where organization_id=$1 and log_record_id=$2";
const ownFiles = "select file_object_id from log_records where organization_id=$1 and id=$2";
const recordObjectKeys = `select storage_key object_key from log_file_objects where id in (${ownFiles})
  union select object_key from log_files where organization_id=$1 and record_id=$2 and object_key is not null
  union select line_index_key from log_files where organization_id=$1 and record_id=$2 and line_index_key is not null
  union select object_key from log_original_uploads where organization_id=$1 and record_id=$2
  union select object_key from log_artifact_objects where organization_id=$1 and record_id=$2
  union select decoded_events_object_key from log_analysis_runs where organization_id=$1 and log_record_id=$2 and decoded_events_object_key is not null`;
const retainedKnowledge = `select * from knowledge_entries where organization_id=$1 and (source_log_id=$2 or id::text in
  (select revision->>'entryId' from log_analysis_runs r cross join lateral jsonb_array_elements(r.knowledge_revisions) revision where r.organization_id=$1 and r.log_record_id=$2
   union select legacy.entry_id from log_analysis_runs r cross join lateral jsonb_array_elements_text(coalesce(r.legacy_knowledge_entry_ids,'[]')) legacy(entry_id) where r.organization_id=$1 and r.log_record_id=$2))`;
const inventoryLabels: readonly (readonly [string, string, "delete" | "retain"])[] = [
  ["records", "日志记录", "delete"], ["original-uploads", "原始上传文件", "delete"],
  ["files", "文件清单及行索引", "delete"], ["file-objects", "独占原文件元数据", "delete"],
  ["artifacts", "分析及索引对象写入记录", "delete"], ["notification-outbox", "日志站内通知待投递", "delete"], ["notifications", "日志站内通知", "delete"],
  ["runs", "分析运行及解码产物", "delete"], ["stages", "分析阶段", "delete"],
  ["reports", "分析报告", "delete"], ["evidence", "分析证据", "delete"], ["traces", "分析轨迹", "delete"],
  ["feedback", "质量反馈", "delete"], ["deliveries", "Webhook 投递历史", "delete"],
  ["outbox", "Webhook 待投递事件", "delete"], ["jobs", "分析任务", "delete"],
  ["skills", "分析技能", "retain"], ["skill-revisions", "钉住的技能修订", "retain"],
  ["source-snapshots", "共享源码快照及索引", "retain"], ["knowledge", "独立知识条目", "retain"],
  ["audit", "管理审计身份与时间（移除日志内容）", "retain"],
  ["knowledge-revisions", "独立知识正文及历史修订", "retain"], ["analysis-cases", "共享原文件的独立测试用例", "retain"]
];

// Compare physical keys, not checksums: equal bytes can be independently owned.
// Include references outside logs, including archived rows and saved analysis cases.
// ponytail: reference scans grow with stored metadata; add indexed key references if inventory becomes a measured bottleneck.
const objectReferences = `
  select 'file-object' kind, id, null::text owner_id, storage_key object_key, to_jsonb(f) state from log_file_objects f
  union all select 'file', id, record_id, object_key, to_jsonb(f) from log_files f where object_key is not null
  union all select 'line-index', id, record_id, line_index_key, to_jsonb(f) from log_files f where line_index_key is not null
  union all select 'upload', position::text, record_id, object_key, to_jsonb(u) from log_original_uploads u
  union all select 'decoded', id, log_record_id, decoded_events_object_key, to_jsonb(r) from log_analysis_runs r where decoded_events_object_key is not null
  union all select 'artifact', record_id, record_id, object_key, to_jsonb(r) from log_artifact_objects r
  union all select 'sample', id, null, object_key, to_jsonb(s) from log_skill_samples s
  union all select 'dry-run', id, null, sample_object_key, to_jsonb(r) from log_skill_dry_runs r
  union all select 'case', c.id, null, u->>'objectKey', to_jsonb(c) from log_skill_analysis_cases c cross join lateral jsonb_array_elements(c.uploads) u
  union all select 'source', id, null, storage_key, to_jsonb(s) from log_source_snapshots s
  union all select 'knowledge-file', id::text, null, storage_key, to_jsonb(f) from knowledge_files f
  union all select 'feedback-attachment', id::text, null, storage_key, to_jsonb(a) from product_feedback_attachments a
  union all select 'parameter-file', id, null, storage_key, to_jsonb(v) from project_parameter_file_versions v
  union all select 'parameter-candidate', id, null, storage_key, to_jsonb(c) from project_parameter_file_candidates c where storage_key is not null
  union all select 'reload-source', id, null, overlay_source_storage_key, to_jsonb(r) from dts_reload_runs r where overlay_source_storage_key is not null
  union all select 'reload-artifact', id, null, overlay_artifact_storage_key, to_jsonb(r) from dts_reload_runs r where overlay_artifact_storage_key is not null`;

export async function previewLogDeletion(db: Database, auth: AuthContext, logId: string): Promise<LogDeletionPreview> {
  requireLogAdminDomains(auth);
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "无权访问此组织的日志。");
  return db.transaction(async (tx) => {
    await tx.query("set transaction isolation level repeatable read read only");
    return readLogDeletionPreview(tx, auth.organization.id, logId, auth.user.id);
  });
}

/** The executor must re-read this inventory while holding its deletion fence. */
export async function readLogDeletionPreview(tx: Queryable, organizationId: string, logId: string, principalId: string): Promise<LogDeletionPreview> {
  const values = [organizationId, logId];
  const log = (await tx.query<{ file_name: string }>("select file_name from log_records where organization_id=$1 and id=$2", values)).rows[0];
  if (!log) throw new ApiError("NOT_FOUND", "分析记录不存在。", { logId });
  const version = createHash("sha256").update(JSON.stringify(["log-deletion-preview-v1", organizationId, logId, principalId]));
  const summaries = (await tx.query<{ key: string; count: number; digest: string }>(`with scope(key,state) as (
    select 'records',to_jsonb(r) from log_records r where organization_id=$1 and id=$2
    union all select 'original-uploads',to_jsonb(r) from log_original_uploads r where organization_id=$1 and record_id=$2
    union all select 'files',to_jsonb(r) from log_files r where organization_id=$1 and record_id=$2
    union all select 'artifacts',to_jsonb(r) from log_artifact_objects r where organization_id=$1 and record_id=$2
    union all select 'notification-outbox',to_jsonb(r) from notification_outbox r where organization_id=$1 and
      ((payload->>'sourceKind'='log-analysis-run' and payload->>'sourceId' in (${runs})) or payload->'metadata'->>'logId'=$2)
    union all select 'notifications',to_jsonb(r) from user_notifications r where organization_id=$1 and
      ((source_kind='log-analysis-run' and source_id in (${runs})) or metadata->>'logId'=$2)
    union all select 'file-objects',to_jsonb(f) from log_file_objects f where id in (${ownFiles}) and not exists (select 1 from log_records r where r.file_object_id=f.id and r.id<>$2)
    union all select 'runs',to_jsonb(r) from log_analysis_runs r where organization_id=$1 and log_record_id=$2
    union all select 'stages',to_jsonb(r) from log_analysis_stages r where organization_id=$1 and run_id in (${runs})
    union all select 'reports',to_jsonb(r) from log_analysis_reports r where organization_id=$1 and log_record_id=$2
    union all select 'evidence',to_jsonb(r) from log_evidence r where organization_id=$1 and log_record_id=$2
    union all select 'traces',to_jsonb(r) from log_analysis_trace_steps r where organization_id=$1 and run_id in (${runs})
    union all select 'feedback',to_jsonb(r) from log_feedback r where organization_id=$1 and log_record_id=$2
    union all select 'deliveries',to_jsonb(r) from log_webhook_deliveries r where organization_id=$1 and log_record_id=$2
    union all select 'outbox',to_jsonb(r) from log_webhook_outbox r where organization_id=$1 and log_record_id=$2
    union all select 'jobs',to_jsonb(r) from jobs r where organization_id=$1 and kind='log-analysis' and target_id in (${runs})
    union all select 'audit',to_jsonb(r) from audit_events r where organization_id=$1 and target_type='log-record' and target_id=$2
    union all select 'skills',to_jsonb(r) from log_domains r where organization_id=$1 and id in
      (select log_domain_id from log_records where organization_id=$1 and id=$2 union select skill_id from log_skill_revisions where id in (select skill_revision_id from log_analysis_runs where organization_id=$1 and log_record_id=$2))
    union all select 'skill-revisions',to_jsonb(r) from log_skill_revisions r where organization_id=$1 and id in (select skill_revision_id from log_analysis_runs where organization_id=$1 and log_record_id=$2)
    union all select 'source-snapshots',to_jsonb(r) from log_source_snapshots r where organization_id=$1 and id in
      (select source_snapshot_id from log_analysis_runs where organization_id=$1 and log_record_id=$2 union select source_snapshot_id from log_evidence where organization_id=$1 and log_record_id=$2)
    union all select 'knowledge',to_jsonb(r) from (${retainedKnowledge}) r
    union all select 'knowledge-revisions',to_jsonb(r) from knowledge_revisions r where organization_id=$1 and entry_id in (select id from (${retainedKnowledge}) k)
    union all select 'analysis-cases',to_jsonb(c) from log_skill_analysis_cases c where organization_id=$1 and exists
      (select 1 from jsonb_array_elements(c.uploads) u where u->>'objectKey' in (${recordObjectKeys}))
  ), fingerprints as (select key,encode(sha256(convert_to(state::text,'UTF8')),'hex') fingerprint from scope)
    select key,count(*)::int count,encode(sha256(convert_to(string_agg(fingerprint,'' order by fingerprint),'UTF8')),'hex') digest
    from fingerprints group by key`, values)).rows;
  const inventory = inventoryLabels.map(([key, label, disposition]) => {
    const summary = summaries.find((row) => row.key === key);
    version.update(key).update(summary?.digest ?? "");
    return { key, label, disposition, count: summary?.count ?? 0 };
  });
  const objects = (await tx.query<{ total: number; shared: number; digest: string }>(`with refs as (${objectReferences}),
    owned as (${recordObjectKeys}),
    matched as (select r.*, (owner_id=$2 or (kind='file-object' and id in (${ownFiles}) and not exists
      (select 1 from log_records l where l.file_object_id=r.id and l.id<>$2))) is_owned from refs r join owned o using(object_key))
    select (select count(*)::int from owned) total,
      count(distinct object_key) filter(where not coalesce(is_owned,false))::int shared,
      encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(state::text || kind || id,'UTF8')),'hex'), '' order by object_key,kind,id), ''),'UTF8')),'hex') digest from matched`, values)).rows[0]!;
  version.update(objects.digest).update(JSON.stringify([objects.total, objects.shared]));
  const pending = (await tx.query<{ jobs: number; runs: number; deliveries: number }>(`select
    (select count(*)::int from jobs where organization_id=$1 and kind='log-analysis' and target_id in (${runs}) and status in ('queued','running','processing')) jobs,
    (select count(*)::int from log_analysis_runs where organization_id=$1 and log_record_id=$2 and status in ('queued','processing','running')) runs,
    (select count(*)::int from log_webhook_outbox where organization_id=$1 and log_record_id=$2 and status in ('pending','retry','processing')) deliveries`, values)).rows[0]!;
  return { organizationId, logId, fileName: log.file_name, version: version.digest("hex"), generatedAt: new Date().toISOString(), inventory,
    objects: { total: objects.total, shared: objects.shared, exclusive: objects.total - objects.shared },
    conditions: [
      { code: "analysis-jobs", count: pending.jobs, message: "排队或进行中的分析任务须先停止或隔离，避免重新生成日志数据。" },
      { code: "analysis-runs", count: pending.runs, message: "尚未结束的分析运行须与清理操作协调。" },
      { code: "webhook-events", count: pending.deliveries, message: "待投递、重试或投递中的 Webhook 事件须停止或隔离。" }
    ],
    notes: ["预览本身不会修改数据；勾选确认并执行后才永久删除。", "共享存储对象按真实引用保留，包括其他日志、测试用例、技能样例及独立业务引用。",
      "分析技能、技能修订、源码快照和试跑/测试用例历史保留。", "独立知识正文、已保存的引用内容及历史修订保留；确认删除后解除日志来源关系并显示来源已删除。",
      "日志、任务或引用变化后请重新获取预览；此快照不构成删除授权。"] };
}

/** Physical references across retained businesses, read only under the erasure fence. */
export async function referencedLogObjects(tx: Queryable, keys: string[]): Promise<Set<string>> {
  const rows = (await tx.query<{ object_key: string }>(`with refs as (${objectReferences})
    select distinct object_key from refs where object_key=any($1::text[])`, [keys])).rows;
  return new Set(rows.map((row) => row.object_key));
}
