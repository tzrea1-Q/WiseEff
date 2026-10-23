import { createHash } from "node:crypto";
import type { z } from "zod";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getExperienceRegistrationSettings, type ExperienceRegistrationDefaults } from "../auth/experienceRegistration";
import { getAuthContext } from "../auth/repository";
import { resolveOperatingContext } from "../auth/operatingContext";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import type { organizationDeletionPreviewSchema } from "../contracts/dtoSchemas/organizationDeletion";
import { hasOrganizationRole, listUsableAdministratorIds, lockAdministratorMutation, type AdministratorMutationContext } from "./administratorContinuity";
import { listUsers } from "./repository";
import { requirePlatformOrganizationManager } from "./platformOrganizations";

type Preview = z.infer<typeof organizationDeletionPreviewSchema>;
export type OrganizationDeletionContext = AdministratorMutationContext & ExperienceRegistrationDefaults;

async function readPreview(tx: Database, caller: UserInvocationContext, organizationId: string, context: OrganizationDeletionContext): Promise<Preview> {
  const actor = await getAuthContext(tx, caller.principal.user.id);
  requirePlatformOrganizationManager(actor);
  const scoped = await resolveOperatingContext(tx, caller, organizationId);
  const organization = (await tx.query<{ name: string; status: string; version: string }>(
    "select name,status,lifecycle_version::text as version from organizations where id=$1", [organizationId])).rows[0]!;
  const rows = (await tx.query<{ key: string; category: string; item_count: string; state_digest: string }>(
    "select * from parameter_catalog.preview_organization_deletion($1,$2) order by key", [organizationId, actor.user.id])).rows;
  const inventory = rows.filter(row => row.category !== "storage").map(row => ({ key: row.key, category: row.category, count: Number(row.item_count) }));
  const users = await listUsers(tx, organizationId), usable = await listUsableAdministratorIds(tx, null, "platform-admin", context);
  const platformAccounts = users.filter(user => hasOrganizationRole(user.roles, "platform-admin"))
    .map(user => ({ id: user.id, name: user.name, isActive: user.isActive, canLogin: usable.includes(user.id) }));
  const survivingPlatformAdministrators = usable.filter(id => !users.some(user => user.id === id)).length;
  const registration = await getExperienceRegistrationSettings(tx, context);
  const experienceRegistration = { isTarget: registration.organizationId === organizationId, enabled: registration.enabled };
  const producerRow = (await tx.query<Record<string, number>>(`select
    (select count(*)::int from jobs where organization_id=$1 and status in ('queued','processing')) jobs,
    (select count(*)::int from knowledge_index_status where organization_id=$1 and status in ('pending','processing')) knowledge,
    (select count(*)::int from knowledge_import_batches where organization_id=$1 and completed_at is null) imports,
    (select count(*)::int from dts_config_revisions where organization_id=$1 and status='resolving') configurations,
    (select count(*)::int from log_source_snapshots where organization_id=$1 and status in ('queued','indexing')) sources,
    (select count(*)::int from log_webhook_outbox where organization_id=$1 and status in ('pending','processing','retry')) webhooks,
    (select count(*)::int from notification_outbox where (organization_id=$1 or payload->'metadata'->>'feedbackOrganizationId'=$1) and status in ('pending','processing','retry')) notifications,
    ((select count(*) from agent_tool_calls where organization_id=$1 and status in ('requested','running','pending_approval'))
      +(select count(*) from agent_approvals where organization_id=$1 and status='pending')
      +(select count(*) from agent_sessions where organization_id=$1 and status='active'))::int agent,
    (select count(*)::int from product_feedback_attachment_uploads where organization_id=$1 and in_flight) uploads,
    (select count(*)::int from device_bridges where organization_id=$1 and revoked_at is null) bridges`, [organizationId])).rows[0]!;
  const labels: Record<string, string> = { jobs: "排队或执行中的后台任务", knowledge: "知识索引任务", imports: "未完成的知识导入", configurations: "解析中的配置", sources: "源码索引任务", webhooks: "待发送或发送中的 Webhook", notifications: "待投递或投递中的通知", agent: "可继续的 Agent 会话、调用与审批", uploads: "进行中的附件上传", bridges: "尚未撤销的设备代理" };
  const producers = Object.entries(producerRow).map(([key, count]) => ({ key, label: labels[key]!, count }));
  const storage = { exclusiveObjects: Number(rows.find(row => row.key === "storage.exclusive")?.item_count ?? 0), sharedObjects: Number(rows.find(row => row.key === "storage.shared")?.item_count ?? 0) };
  const blockers: Preview["blockers"] = [];
  if (!survivingPlatformAdministrators) blockers.push({ code: "last-platform-administrator", message: "组织外没有可登录的平台超级管理员。请先调离或配置至少一位可用的平台管理员。" });
  if (actor.user.organizationId === organizationId) blockers.push({ code: "actor-home-organization", message: "当前操作账号属于此组织，请先将账号调往其他组织，再发起删除。" });
  if (experienceRegistration.isTarget && experienceRegistration.enabled) blockers.push({ code: "experience-registration", message: "此组织正在接纳公开体验注册，请先关闭入口或调整目标组织。" });
  if (inventory.some(row => row.category === "unclassified" && row.count)) blockers.push({ code: "unclassified-ownership", message: "发现尚未完成归属核实的数据或检查点，当前不能确认完整清理。" });
  if (inventory.some(row => row.category === "legacy-archives" && row.count)) blockers.push({ code: "protected-legacy-archives", message: "存在离线迁移归档或保护证据，需先核实共享引用与领域清理支持。" });
  const snapshot = { organizationId, organizationName: organization.name, status: organization.status, inventory, platformAccounts, survivingPlatformAdministrators, experienceRegistration, producers, storage, blockers };
  return { ...snapshot, generatedAt: new Date().toISOString(), stateDigest: createHash("sha256").update(JSON.stringify([
    "organization-erasure-preview-v1", scoped.principal.user.id, organization, rows, snapshot
  ])).digest("hex"), admissionAvailable: blockers.length === 0, notes: [
    "本页只预览，不会删除、撤销凭据、停止任务或授予删除权限；实际执行前会重新核对权限、账号、对象数量和组织状态。",
    "需保留的平台账号请先调离；其余本组织账号、身份、业务数据、历史、文件和待办属于清理范围。",
    "平台共享 Catalog 定义、发布记录及其他组织的数据和引用保留；共享文件仅清理本组织引用，不承诺删除共用对象。",
    "平台级参数定义删除回执和未完成的全局清理任务保留；操作者所属组织只是历史关联，不代表这些数据或文件归本组织所有。",
    "文件数量按数据库中明确登记的物理引用去重，不表示已检查底层文件；内存检查点和在途生产者必须由对应运行时停止并清理。",
    "在线删除不等于备份即时擦除。备份按部署保留周期过期；恢复旧备份后，重新开放访问前必须重新落实更新的删除状态。",
    "清理无法撤回已发送到外部系统的数据或已执行的设备命令。"
  ] };
}

export async function previewOrganizationDeletion(db: Database, caller: UserInvocationContext, organizationId: string, context: OrganizationDeletionContext = {}) {
  requireUserInitiatedInvocation(caller); requirePlatformOrganizationManager(caller.principal);
  return db.transaction(async tx => {
    await tx.query("set transaction isolation level repeatable read read only");
    return readPreview(tx, caller, organizationId, context);
  });
}

/** The erasure executor must call inside its own transaction and retain these locks
 * through its durable intent/fence. A client preview is never execution authority. */
export async function admitOrganizationDeletion(tx: Database, caller: UserInvocationContext, organizationId: string, expectedDigest: string, context: OrganizationDeletionContext = {}) {
  requireUserInitiatedInvocation(caller); requirePlatformOrganizationManager(caller.principal);
  await lockAdministratorMutation(tx);
  // Registration updates lock the singleton before the target Organization too.
  await tx.query("select singleton from public_experience_registration where singleton=true for update");
  await tx.query("select id from organizations where id=$1 for update", [organizationId]);
  const preview = await readPreview(tx, caller, organizationId, context);
  if (preview.stateDigest !== expectedDigest) throw new ApiError("CONFLICT", "删除影响已变化，请重新查看预览。", { code: "organization-deletion-preview-stale" });
  if (!preview.admissionAvailable) throw new ApiError("CONFLICT", "请先处理组织删除的阻断项。", { blockers: preview.blockers });
  return preview;
}
