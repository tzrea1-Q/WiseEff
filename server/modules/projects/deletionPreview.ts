import { createHash } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import type { ProjectDeletionPreview } from "../../../src/domain/parameters/projectDeletionPreview";
import { ApiError } from "../../shared/http/errors";

const projectScope = "organization_id = $1 and project_id = $2";
const files = `select id from project_parameter_files where ${projectScope}`;
const versions = `select v.id from project_parameter_file_versions v where v.file_id in (${files})`;
const configurations = `select id from dts_config_set where ${projectScope}`;
const revisions = `select id from dts_config_revisions where ${projectScope}`;
const oldBindings = `select id from public.project_parameter_bindings where ${projectScope}`;
const requests = `select id from parameter_change_requests where ${projectScope}`;
const sessions = `select id from agent_sessions where ${projectScope}`;
const reloads = `select id from dts_reload_runs where ${projectScope}`;

type InventoryQuery = readonly [string, string, "delete" | "detach" | "retain", string];
// Explicit domain ownership, not a recursive FK deletion plan. New lifecycle
// tables must be classified here before project disposal can use this snapshot.
const inventoryQueries: readonly InventoryQuery[] = [
  ["configurations", "项目配置集合", "delete", `select * from dts_config_set where ${projectScope}`],
  ["source-files", "项目源文件", "delete", `select * from project_parameter_files where ${projectScope}`],
  ["shared-source-references", "固定共享引用", "delete", `select * from public.project_shared_dtsi_references where ${projectScope}`],
  ["shared-source-snapshots", "项目只读来源快照", "delete", `select * from public.project_shared_dtsi_snapshots where reference_id in(select id from public.project_shared_dtsi_references where ${projectScope})`],
  ["member-addition-intents", "配置操作记录", "delete", `select * from public.member_addition_intents where ${projectScope}`],
  ["source-versions", "源文件历史版本", "delete", `select * from project_parameter_file_versions where file_id in (${files})`],
  ["upload-candidates", "上传与源码候选", "delete", `select * from project_parameter_file_candidates where ${projectScope}`],
  ["baselines", "发布基线", "delete", `select * from dts_release_baseline where organization_id=$1 and config_set_id in (${configurations})`],
  ["baseline-members", "基线版本关联", "delete", `select * from dts_release_baseline_members where baseline_id in (select id from dts_release_baseline where organization_id=$1 and config_set_id in (${configurations}))`],
  ["config-revisions", "配置解析修订", "delete", `select * from dts_config_revisions where ${projectScope}`],
  ["revision-members", "配置修订成员", "delete", `select * from dts_config_revision_members where config_revision_id in (${revisions})`],
  ["logical-nodes", "逻辑节点", "delete", `select * from dts_logical_nodes where ${projectScope}`],
  ["logical-node-revisions", "逻辑节点修订", "delete", `select * from dts_logical_node_revisions where config_revision_id in (${revisions})`],
  ["node-occurrences", "源码节点实例", "delete", `select * from dts_node_occurrences where config_revision_id in (${revisions})`],
  ["property-occurrences", "源码属性实例", "delete", `select * from dts_property_occurrences where config_revision_id in (${revisions})`],
  ["occurrence-effects", "源码属性覆盖关系", "delete", `select * from dts_occurrence_effects where config_revision_id in (${revisions})`],
  ["parsed-nodes", "文件解析节点", "delete", `select * from dts_nodes where file_version_id in (${versions})`],
  ["parsed-properties", "文件解析属性", "delete", `select * from dts_properties where node_id in (select id from dts_nodes where file_version_id in (${versions}))`],
  ["phandle-references", "文件节点引用", "delete", `select * from dts_phandle_refs where from_property_id in (select id from dts_properties where node_id in (select id from dts_nodes where file_version_id in (${versions})))`],
  ["validation-runs", "配置校验运行", "delete", `select * from dts_validation_runs where organization_id=$1 and config_revision_id in (${revisions})`],
  ["validation-diagnostics", "配置校验诊断", "delete", `select * from dts_validation_diagnostics where validation_run_id in (select id from dts_validation_runs where organization_id=$1 and config_revision_id in (${revisions}))`],
  ["value-drafts", "Canonical 值草稿", "delete", `select * from project_parameter_value_drafts where ${projectScope}`],
  ["value-requests", "Canonical 值、源码及成员审核", "delete", `select * from project_parameter_value_change_requests where ${projectScope}`],
  ["value-targets", "批量变更目标及历史", "delete", `select * from project_parameter_value_change_targets where ${projectScope}`],
  ["modules", "项目模块", "delete", `select * from project_modules where ${projectScope}`],
  ["legacy-bindings", "兼容 Binding", "delete", `select * from public.project_parameter_bindings where ${projectScope}`],
  ["binding-revisions", "兼容 Binding 修订", "delete", `select * from project_parameter_binding_revisions where binding_id in (${oldBindings})`],
  ["drafts", "结构及兼容草稿", "delete", `select * from parameter_drafts where ${projectScope}`],
  ["draft-invalidations", "草稿失效记录", "delete", `select * from parameter_draft_identity_invalidations where ${projectScope}`],
  ["change-requests", "结构及兼容变更请求", "delete", `select * from parameter_change_requests where ${projectScope}`],
  ["review-decisions", "结构审核决定", "delete", `select * from parameter_review_decisions where organization_id=$1 and request_id in (${requests})`],
  ["history", "结构及兼容参数历史", "delete", `select * from parameter_history_entries where ${projectScope}`],
  ["rounds", "提交轮次", "delete", `select * from parameter_submission_rounds where ${projectScope}`],
  ["submission-items", "提交轮次成员", "delete", `select * from parameter_submission_items where organization_id=$1 and submission_round_id in (select id from parameter_submission_rounds where ${projectScope})`],
  ["conflicts", "文件同步冲突", "delete", `select * from parameter_file_sync_conflicts where ${projectScope}`],
  ["imports", "导入历史", "delete", `select * from parameter_import_batches where ${projectScope}`],
  ["initialization-drafts", "项目初始化草稿", "delete", `select * from project_parameter_initialization_drafts where ${projectScope}`],
  ["initialization-reviews", "项目初始化审核", "delete", `select * from project_parameter_initialization_reviews where ${projectScope}`],
  ["mapping-tasks", "身份映射任务", "delete", `select * from identity_mapping_tasks where ${projectScope}`],
  ["spec-review-tasks", "规范识别审核任务", "delete", `select * from parameter_spec_review_tasks where ${projectScope}`],
  ["spec-decisions", "属性识别决定", "delete", `select * from dts_property_occurrence_spec_decisions where ${projectScope}`],
  ["matcher-overrides", "项目识别规则", "delete", `select * from parameter_spec_matcher_overrides where ${projectScope}`],
  ["sensitive-rules", "项目敏感节点规则", "delete", `select * from dts_sensitive_node_rules where ${projectScope}`],
  ["version-cutovers", "规范版本迁移项目关联", "detach", `select * from parameter_spec_version_cutover_items where project_id=$2`],
  ["property-cutovers", "属性身份迁移项目关联", "detach", `select * from parameter_spec_property_key_cutover_items where project_id=$2`],
  ["project-roles", "项目角色关联", "detach", `select * from user_role_bindings where ${projectScope}`],
  ["agent-sessions", "项目 Agent 会话关联", "detach", `select * from agent_sessions where ${projectScope}`],
  ["agent-tool-calls", "项目 Agent 工具调用关联", "detach", `select * from agent_tool_calls where ${projectScope}`],
  ["agent-approvals", "项目 Agent 审批关联", "detach", `select * from agent_approvals where ${projectScope}`],
  ["debug-nodes", "独立调试节点（仅解除项目参数关联）", "detach", `select * from debug_nodes where organization_id=$1 and canonical_project_id=$2`],
  ["node-operations", "设备操作历史（仅解除项目参数关联）", "detach", `select * from node_operations where organization_id=$1 and (canonical_project_id=$2 or project_parameter_binding_id in (${oldBindings}))`],
  ["logs", "独立日志（仅解除项目参数关联）", "detach", `select * from log_records where organization_id=$1 and related_parameter_project_id=$2`],
  ["offline-archives", "离线迁移归档", "delete", `select * from project_parameter_plane_archives where ${projectScope}`],
  ["deployment-evidence", "设备部署运行与证据", "delete", `select * from dts_reload_runs where ${projectScope}`],
  ["deployment-targets", "设备部署参数记录", "delete", `select * from dts_reload_run_targets where reload_run_id in (${reloads})`],
  ["device-residue", "设备部署残留状态", "delete", `select * from dts_reload_device_residue where ${projectScope}`],
  ["knowledge", "独立知识条目及正文", "retain", `select * from knowledge_entries where organization_id=$1 and (source_reload_run_id in (${reloads}) or source_session_id in (${sessions}))`]
];

const catalogInventory: readonly (readonly [string, string, "delete" | "detach" | "retain"])[] = [
  ["canonical-bindings", "Canonical Binding", "delete"],
  ["canonical-values", "Canonical 值及历史版本", "delete"],
  ["canonical-history", "Canonical Binding 历史", "delete"],
  ["source-occurrences", "参数来源身份", "delete"],
  ["source-pins", "参数值来源钉住记录", "delete"],
  ["member-tombstones", "已移除配置成员历史", "delete"],
  ["observations", "参数发现证据", "delete"],
  ["observation-matches", "参数识别结果", "delete"],
  ["review-evidence", "参数识别审核的项目证据", "delete"],
  ["identity-replacements", "定义替代的项目关联", "detach"],
  ["canonical-external-replacements", "其他项目值的替代来源关联", "detach"],
  ["shared-definitions", "平台共享参数定义", "retain"],
  ["plane-disposal", "离线迁移处置证据", "delete"]
];

async function summarize(db: Queryable, sql: string, values: string[]) {
  const result = await db.query<{ count: string; digest: string }>(`select count(*)::text as count,
    encode(sha256(convert_to(coalesce(string_agg(fingerprint, '' order by fingerprint), ''), 'UTF8')), 'hex') as digest
    from (select encode(sha256(convert_to(to_jsonb(r)::text, 'UTF8')), 'hex') as fingerprint from (${sql}) r
      where $1::text is not null and $2::text is not null) fingerprints`, values);
  return { count: Number(result.rows[0]!.count), digest: result.rows[0]!.digest };
}

export async function previewProjectDeletion(db: Database, organizationId: string, projectId: string, principalId: string): Promise<ProjectDeletionPreview> {
  return db.transaction(async (tx) => {
    // Every count and fingerprint describes one coherent read-only snapshot.
    await tx.query("set transaction isolation level repeatable read read only");
    return readProjectDeletionPreview(tx, organizationId, projectId, principalId);
  });
}

/** The executor holds the maintenance fence while reading this same inventory. */
export async function readProjectDeletionPreview(tx: Queryable, organizationId: string, projectId: string, principalId: string): Promise<ProjectDeletionPreview> {
    const project = (await tx.query<{ name: string; state: string }>(
      "select name, to_jsonb(p)::text as state from projects p where organization_id=$1 and id=$2", [organizationId, projectId])).rows[0];
    if (!project) throw new ApiError("NOT_FOUND", "Project was not found.", { projectId });
    const values = [organizationId, projectId];
    const state = createHash("sha256").update("project-deletion-preview-v1").update(project.state);
    const inventory: ProjectDeletionPreview["inventory"] = [];
    for (const [key, label, disposition, sql] of inventoryQueries) {
      const summary = await summarize(tx, sql, values);
      inventory.push({ key, label, disposition, count: summary.count });
      state.update(key).update(summary.digest);
    }
    // The bounded definer exposes counts/fingerprints only. Runtime roles gain
    // no private Catalog table privileges and cannot supply arbitrary SQL.
    const catalogRows = (await tx.query<{ key: string; item_count: string; state_digest: string }>(
      "select * from parameter_catalog.preview_project_deletion_catalog($1,$2,$3)", [organizationId, projectId, principalId])).rows;
    for (const row of catalogRows) state.update(row.key).update(row.state_digest);
    for (const [key, label, disposition] of catalogInventory) {
      const row = catalogRows.find((item) => item.key === key);
      if (!row) throw new ApiError("INTERNAL_ERROR", "Project Catalog inventory is unavailable.");
      inventory.push({ key, label, disposition, count: Number(row.item_count) });
    }

    const storageRows = (await tx.query<{ shared: boolean; size_bytes: string; digest: string }>(`
      with owned as (
        select v.storage_key, v.size_bytes from project_parameter_file_versions v where v.file_id in (${files})
        union all select c.storage_key, c.size_bytes from project_parameter_file_candidates c where ${projectScope}
        union all select a.object_ref, 0 from project_parameter_plane_archives a where ${projectScope}
        union all select r.overlay_source_storage_key, 0 from dts_reload_runs r where ${projectScope}
        union all select r.overlay_artifact_storage_key, coalesce(r.overlay_artifact_bytes, 0) from dts_reload_runs r where ${projectScope}
      ), objects as (select storage_key, max(size_bytes)::text as size_bytes from owned where storage_key is not null group by storage_key)
      select o.size_bytes, encode(sha256(convert_to(o.storage_key, 'UTF8')), 'hex') as digest,
        (exists(select 1 from project_parameter_file_versions v join project_parameter_files f on f.id=v.file_id
          where v.storage_key=o.storage_key and not (f.organization_id=$1 and f.project_id=$2))
        or exists(select 1 from project_parameter_file_candidates c where c.storage_key=o.storage_key and not(c.organization_id=$1 and c.project_id=$2))
        or exists(select 1 from project_parameter_plane_archives a where a.object_ref=o.storage_key and not(a.organization_id=$1 and a.project_id=$2))
        or exists(select 1 from dts_reload_runs r where (r.overlay_source_storage_key=o.storage_key or r.overlay_artifact_storage_key=o.storage_key)
          and not(r.organization_id=$1 and r.project_id=$2))
        or exists(select 1 from knowledge_files k where k.storage_key=o.storage_key)
        or exists(select 1 from log_file_objects l where l.storage_key=o.storage_key)
        or exists(select 1 from log_source_snapshots s where s.storage_key=o.storage_key)
        or exists(select 1 from product_feedback_attachments a where a.storage_key=o.storage_key)) as shared
      from objects o order by o.storage_key`, values)).rows;
    const storage = { exclusiveObjects: 0, sharedObjects: 0, totalBytes: 0 };
    for (const object of storageRows) {
      storage[object.shared ? "sharedObjects" : "exclusiveObjects"] += 1;
      storage.totalBytes += Number(object.size_bytes);
      state.update(object.digest).update(String(object.shared)).update(object.size_bytes);
    }

    const blockerQueries = [
      ["pending-review", "有待处理的值、源码或成员审核。", "在配置工作台处理或取消待审请求后刷新。", `select * from project_parameter_value_change_requests where ${projectScope} and status='pending'`],
      ["structural-review", "有待处理的结构变更。", "在审核收件箱处理或撤回变更后刷新。", `select * from parameter_change_requests where ${projectScope} and status in ('submitted','hardware_review','software_review','software_merge')`],
      ["configuration-resolving", "配置正在解析。", "等待解析完成或处理解析失败后刷新。", `select * from dts_config_revisions where ${projectScope} and status='resolving'`],
      ["initialization-review", "项目初始化仍待审核。", "处理或撤回初始化申请后刷新。", `select * from project_parameter_initialization_reviews where ${projectScope} and status='pending'`],
      ["agent-write", "项目有未结束的 Agent 审批或工具调用。", "处理审批并等待工具执行结束后刷新；预览不会批准或取消设备写入。", `select id from agent_tool_calls where ${projectScope} and status in ('requested','running','pending_approval') union all select id from agent_approvals where ${projectScope} and status='pending'`],
      ["spec-migration", "项目有关联的待执行规范迁移。", "完成或按规范迁移流程处置后刷新。", `select id from parameter_spec_version_cutover_items where project_id=$2 and status in ('pending','ready') union all select id from parameter_spec_property_key_cutover_items where project_id=$2 and status in ('pending','ready')`]
    ] as const;
    const blockers: ProjectDeletionPreview["blockers"] = [];
    for (const [code, message, action, sql] of blockerQueries) {
      const summary = await summarize(tx, sql, values);
      state.update(code).update(summary.digest);
      if (summary.count) blockers.push({ code, count: summary.count, message, action });
    }
    const migrationCount = Number(catalogRows.find((row) => row.key === "active-definition-migration")?.item_count ?? 0);
    if (migrationCount) blockers.push({ code: "definition-migration", count: migrationCount,
      message: "定义替代仍关联未完成的项目迁移。", action: "完成或按迁移流程处置该项目迁移后刷新。" });
    return { organizationId, projectId, projectName: project.name, generatedAt: new Date().toISOString(), stateDigest: state.digest("hex"),
      executionAvailable: blockers.length === 0, inventory, storage, blockers, notes: [
        "确认后永久清理项目专属数据。数据库与独占对象清理状态分别显示；对象失败后可以重试。",
        "状态摘要仅绑定本次项目、组织及相关数据快照，不是删除授权；执行前必须重新读取并校验。",
        "独立知识正文、日志原文、设备及平台共享定义保留；仅处置已明确列出的项目关联。",
        "存储数量按数据库引用去重；不会下载或删除对象，也不证明底层文件当前可读。共享对象在项目删除后仍保留。"
      ] };
}
