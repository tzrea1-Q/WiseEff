import { WORKFLOW_IDS } from "../../../src/domain/workflowDiscovery";
import type { WorkflowPublicationAdminState, WorkflowPublicationState } from "../../../src/domain/workflowPublication";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { writePlatformAuditEvent } from "../audit/repository";
import { projectTrustedInvocationForAudit } from "../audit/trustedAudit";
import { assertTrustedInvocationContext, type UserInvocationContext } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { updateWorkflowPublicationSchema } from "./schemas";

type PublicationRow = {
  workflows: Record<string, boolean>;
  version: number;
  updated_at: Date | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
};

export function requireWorkflowPublicationAdministrator(auth: AuthContext): void {
  if (!auth.user.isActive || !auth.roles.some((role) => role.roleId === "platform-admin" && role.projectId === null)) {
    throw new ApiError("FORBIDDEN", "只有平台超级管理员可以管理工作流发布。", { reason: "workflow-publication-platform-admin-required" });
  }
}

async function readPublication(db: Queryable, lock = false): Promise<PublicationRow> {
  const result = await db.query<PublicationRow>(
    `select publication.workflows, publication.version, publication.updated_at,
            publication.updated_by_user_id, actor.name as updated_by_name
       from workflow_publication publication
       left join users actor on actor.id = publication.updated_by_user_id
      where publication.singleton = true${lock ? " for update of publication" : ""}`
  );
  const row = result.rows[0];
  if (!row) throw new ApiError("INTERNAL_ERROR", "工作流发布配置暂不可用，请重试。", { reason: "workflow-publication-unavailable" });
  return row;
}

function publicationState(row: PublicationRow): WorkflowPublicationState {
  return {
    workflows: Object.fromEntries(WORKFLOW_IDS.map((id) => [id, row.workflows[id] === true])) as WorkflowPublicationState["workflows"],
    version: row.version
  };
}

function adminState(row: PublicationRow): WorkflowPublicationAdminState {
  return {
    ...publicationState(row),
    updatedAt: row.updated_at?.toISOString() ?? null,
    updatedBy: row.updated_by_user_id && row.updated_by_name !== null
      ? { id: row.updated_by_user_id, name: row.updated_by_name }
      : null
  };
}

export async function getWorkflowPublication(db: Queryable, auth: AuthContext): Promise<WorkflowPublicationState> {
  if (!auth.user.isActive) throw new ApiError("FORBIDDEN", "User is inactive.");
  return publicationState(await readPublication(db));
}

export async function getWorkflowPublicationAdmin(db: Queryable, auth: AuthContext): Promise<WorkflowPublicationAdminState> {
  requireWorkflowPublicationAdministrator(auth);
  return adminState(await readPublication(db));
}

export async function updateWorkflowPublication(
  db: Database,
  invocation: UserInvocationContext,
  body: unknown,
  requestId: string
): Promise<WorkflowPublicationAdminState> {
  const trusted = assertTrustedInvocationContext(invocation);
  if (trusted.initiator !== "user") throw new ApiError("FORBIDDEN", "工作流发布配置需要平台超级管理员本人操作。");
  const auth = trusted.principal;
  requireWorkflowPublicationAdministrator(auth);
  const parsed = updateWorkflowPublicationSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "工作流发布配置格式无效。", { issues: parsed.error.issues });
  const { workflows, expectedVersion } = parsed.data;

  return db.transaction(async (tx) => {
    const row = await readPublication(tx, true);
    const previous = publicationState(row);
    if (previous.version !== expectedVersion) {
      throw new ApiError("CONFLICT", "工作流发布配置已被其他管理员更新，请重新加载后核对。", { reason: "stale-workflow-publication" });
    }
    if (WORKFLOW_IDS.every((id) => previous.workflows[id] === workflows[id])) return adminState(row);
    await tx.query(
      `update workflow_publication set workflows = $1::jsonb, version = version + 1,
              updated_at = clock_timestamp(), updated_by_user_id = $2
        where singleton = true`,
      [JSON.stringify(workflows), auth.user.id]
    );
    const next = adminState(await readPublication(tx));
    const actor = projectTrustedInvocationForAudit(trusted);
    await writePlatformAuditEvent(tx, {
      app: "platform", kind: "workflow-publication-updated", action: "update", severity: "High",
      projectId: null, targetType: "workflow-publication", targetId: "platform",
      actorUserId: actor.actorUserId, actorType: actor.actorType, traceId: requestId,
      affectedOrganizationIds: [],
      metadata: { ...actor.metadata, scope: "platform", previous, next: { workflows: next.workflows, version: next.version } }
    });
    return next;
  });
}
