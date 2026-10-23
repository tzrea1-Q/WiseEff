import type { z } from "zod";
import { feedbackHandoverBodySchema } from "./schemas";
export { feedbackHandoverBodySchema } from "./schemas";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { requireProductFeedbackAdmin } from "./policy";
import { feedbackInvocation, feedbackOrganizationId, type ProductFeedbackAccessContext } from "./scope";

const administrator = `exists(select 1 from user_role_bindings b join roles r on r.id=b.role_id where b.user_id=u.id and b.organization_id=u.organization_id and b.project_id is null and 'admin:access'=any(r.permissions))`;
export async function listFeedbackHandovers(db: Queryable, auth: ProductFeedbackAccessContext) {
  requireProductFeedbackAdmin(auth);
  const organizationId = feedbackOrganizationId(auth);
  const items = (await db.query<{ id: string; title: string; kind: "feedback-draft" | "feedback-work"; responsibleUserId: string | null; responsibleUserName: string | null; pending: boolean }>(`
    select f.id,case when f.submitted_at is null then 'feedback-draft' else 'feedback-work' end as kind,
      coalesce(nullif(f.page_title,''),'产品反馈') as title,case when f.submitted_at is null then f.draft_owner_user_id else f.assignee_user_id end as "responsibleUserId",u.name as "responsibleUserName",
      not coalesce(u.is_active and u.organization_id=$1 and (f.submitted_at is null or ${administrator}),false) as pending
    from product_feedback f left join users u on u.id=case when f.submitted_at is null then f.draft_owner_user_id else f.assignee_user_id end
    where f.organization_id=$1 and (f.submitted_at is null or f.status in ('open','in_progress')) order by pending desc,f.updated_at desc,f.id`, [organizationId])).rows;
  const candidates = (await db.query<{ id: string; name: string; canTriage: boolean }>(`select u.id,u.name,${administrator} as "canTriage" from users u where u.organization_id=$1 and u.is_active order by u.name,u.id`, [organizationId])).rows;
  return { items, candidates };
}
export async function assignFeedbackResponsibility(db: Database, auth: ProductFeedbackAccessContext, id: string, input: z.infer<typeof feedbackHandoverBodySchema>, requestId: string) {
  requireProductFeedbackAdmin(auth);
  const organizationId = feedbackOrganizationId(auth);
  return db.transaction(async tx => {
    const current = (await tx.query<{ responsible_user_id: string | null; submitted_at: Date | null; status: string }>("select case when submitted_at is null then draft_owner_user_id else assignee_user_id end as responsible_user_id,submitted_at,status from product_feedback where id=$1 and organization_id=$2 for update", [id, organizationId])).rows[0];
    if (!current) throw new ApiError("NOT_FOUND", "待交接反馈不存在。");
    if (current.submitted_at && !["open", "in_progress"].includes(current.status)) throw new ApiError("CONFLICT", "反馈已结束，无需交接。");
    if (current.responsible_user_id !== input.expectedResponsibleUserId) throw new ApiError("CONFLICT", "责任人已变化，请刷新后重试。");
    if (input.responsibleUserId !== null) {
      const successor = await tx.query(`select u.id from users u where u.id=$1 and u.organization_id=$2 and u.is_active and ($3::boolean or ${administrator}) for update`, [input.responsibleUserId, organizationId, current.submitted_at === null]);
      if (!successor.rowCount) throw new ApiError("VALIDATION_FAILED", "接任者须为当前组织有效成员；反馈处理职责须交给管理员。");
    }
    if (current.responsible_user_id === input.responsibleUserId) return;
    const column = current.submitted_at === null ? "draft_owner_user_id" : "assignee_user_id";
    await tx.query(`update product_feedback set ${column}=$3 where id=$1 and organization_id=$2`, [id, organizationId, input.responsibleUserId]);
    await writeAuditEventInTx(asAuditTx(tx), feedbackInvocation(auth), { requestId }, { app: "product-feedback", kind: "product-feedback-handover", action: "assign-responsibility", severity: "Medium", projectId: null,
      targetType: "product-feedback", targetId: id, metadata: { previousResponsibleUserId: current.responsible_user_id, responsibleUserId: input.responsibleUserId, draft: current.submitted_at === null } });
  });
}
