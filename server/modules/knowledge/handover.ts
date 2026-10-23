import type { z } from "zod";
import { knowledgeHandoverBodySchema } from "./schemas";
export { knowledgeHandoverBodySchema, knowledgeHandoverParamsSchema } from "./schemas";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { requireKnowledgeManage } from "./policy";
import { knowledgeOrganizationId, type KnowledgeAccessContext } from "./scope";
import { knowledgeServiceInvocation } from "./service";

const eligible = `exists(select 1 from user_role_bindings b join roles r on r.id=b.role_id
  where b.user_id=u.id and b.organization_id=u.organization_id and b.project_id is null and 'knowledge:edit'=any(r.permissions))`;
export async function listKnowledgeHandovers(db: Queryable, auth: KnowledgeAccessContext) {
  requireKnowledgeManage(auth);
  const organizationId = knowledgeOrganizationId(auth);
  const items = (await db.query<{ kind: "entry" | "import"; id: string; title: string; responsibleUserId: string | null; responsibleUserName: string | null; pending: boolean; createdByUserId: string | null }>(`
    select a.kind,a.id,a.title,a.responsible_user_id as "responsibleUserId",u.name as "responsibleUserName",
      a.created_by_user_id as "createdByUserId",not coalesce(u.is_active and u.organization_id=$1 and ${eligible},false) as pending
    from (
      select 'entry' as kind,id,title,responsible_user_id,created_by_user_id,updated_at from knowledge_entries where organization_id=$1 and status='draft'
      union all
      select 'import',id,'文档导入批次 · ' || document_count || ' 份文档',responsible_user_id,created_by_user_id,created_at from knowledge_import_batches where organization_id=$1 and completed_at is null
    ) a left join users u on u.id=a.responsible_user_id order by pending desc,a.updated_at desc,a.id`, [organizationId])).rows;
  const candidates = (await db.query<{ id: string; name: string }>(`select u.id,u.name from users u where u.organization_id=$1 and u.is_active and ${eligible} order by u.name,u.id`, [organizationId])).rows;
  return { items, candidates };
}

export async function assignKnowledgeResponsibility(db: Database, auth: KnowledgeAccessContext,
  kind: "entry" | "import", id: string, input: z.infer<typeof knowledgeHandoverBodySchema>, requestId: string) {
  requireKnowledgeManage(auth);
  const organizationId = knowledgeOrganizationId(auth);
  return db.transaction(async tx => {
    const current = (await (kind === "entry"
      ? tx.query<{ responsible_user_id: string | null }>("select responsible_user_id from knowledge_entries where id=$1 and organization_id=$2 for update", [id, organizationId])
      : tx.query<{ responsible_user_id: string | null }>("select responsible_user_id from knowledge_import_batches where id=$1 and organization_id=$2 for update", [id, organizationId]))).rows[0];
    if (!current) throw new ApiError("NOT_FOUND", "待交接业务不存在。");
    if (current.responsible_user_id !== input.expectedResponsibleUserId) throw new ApiError("CONFLICT", "责任人已变化，请刷新后重试。");
    if (input.responsibleUserId !== null) {
      const successor = await tx.query(`select u.id from users u where u.id=$1 and u.organization_id=$2 and u.is_active and ${eligible} for update`, [input.responsibleUserId, organizationId]);
      if (!successor.rowCount) throw new ApiError("VALIDATION_FAILED", "接任者必须是当前组织中有效的知识编辑者。");
    }
    if (current.responsible_user_id === input.responsibleUserId) return;
    if (kind === "entry") {
      await tx.query("update knowledge_entries set responsible_user_id=$3 where id=$1 and organization_id=$2", [id, organizationId, input.responsibleUserId]);
    } else {
      await tx.query("update knowledge_import_batches set responsible_user_id=$3 where id=$1 and organization_id=$2", [id, organizationId, input.responsibleUserId]);
    }
    await writeAuditEventInTx(asAuditTx(tx), knowledgeServiceInvocation(auth), { requestId }, {
      app: "knowledge", kind: "knowledge-handover", action: "assign-responsibility", severity: "Medium", projectId: null,
      targetType: kind === "entry" ? "knowledge-entry" : "knowledge-import-batch", targetId: id,
      metadata: { previousResponsibleUserId: current.responsible_user_id, responsibleUserId: input.responsibleUserId }
    });
  });
}
