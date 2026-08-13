import { withAuditedWrite, type AuditedWriteContext } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { ensureDefaultConfigSetInTx } from "../parameter-files/configSetService";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canAdminParameters } from "../parameter-kernel/policy";
import { createProject, deleteProject, updateProject } from "../projects/repository";
import type { ProjectAdminSummaryDto } from "../projects/types";

export type CreateProjectForAuthInput = {
  id: string;
  name: string;
  code: string;
  status?: string;
};

export type UpdateProjectForAuthInput = {
  projectId: string;
  name?: string;
  code?: string;
  status?: string;
};

export type DeleteProjectForAuthInput = {
  projectId: string;
  /** Display name for the audit action text (caller already knows it from UI/list). */
  projectName: string;
};

/** Project mutations are audited writes: correlation is mandatory (ADR-0027). */
export type ProjectServiceContext = AuditedWriteContext;

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

/**
 * Creates a project and idempotently ensures the implicit `default` config set
 * in the same transaction (decision B1). The creation audit event commits in
 * that same transaction.
 */
export async function createProjectForAuth(
  db: Database,
  auth: AuthContext,
  input: CreateProjectForAuthInput,
  context: ProjectServiceContext
): Promise<ProjectAdminSummaryDto> {
  requireCanAdmin(auth);

  return withAuditedWrite(db, auth, context, async (tx) => {
    const item = await createProject(tx, {
      organizationId: auth.organization.id,
      id: input.id,
      name: input.name,
      code: input.code,
      status: input.status
    });

    await ensureDefaultConfigSetInTx(tx, auth, item.id, context);

    return {
      result: item,
      audit: {
        app: "parameter-admin",
        kind: "project-created",
        action: `已创建项目「${item.name}」`,
        severity: "Medium",
        projectId: item.id,
        targetType: "project",
        targetId: item.id,
        metadata: {
          name: item.name,
          code: item.code,
          status: item.status
        }
      }
    };
  });
}

export async function updateProjectForAuth(
  db: Database,
  auth: AuthContext,
  input: UpdateProjectForAuthInput,
  context: ProjectServiceContext
): Promise<ProjectAdminSummaryDto | null> {
  requireCanAdmin(auth);

  return withAuditedWrite(db, auth, context, async (tx) => {
    const item = await updateProject(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId,
      name: input.name,
      code: input.code,
      status: input.status
    });

    if (!item) {
      return { result: null, audit: null };
    }

    return {
      result: item,
      audit: {
        app: "parameter-admin",
        kind: "project-updated",
        action: `已更新项目「${item.name}」`,
        severity: "Low",
        projectId: item.id,
        targetType: "project",
        targetId: item.id,
        metadata: {
          name: item.name,
          code: item.code,
          status: item.status
        }
      }
    };
  });
}

export async function deleteProjectForAuth(
  db: Database,
  auth: AuthContext,
  input: DeleteProjectForAuthInput,
  context: ProjectServiceContext
): Promise<{ deleted: boolean; reason?: "not_found" }> {
  requireCanAdmin(auth);

  return withAuditedWrite(db, auth, context, async (tx) => {
    const result = await deleteProject(tx, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });

    if (!result.deleted) {
      return { result, audit: null };
    }

    return {
      result,
      audit: {
        app: "parameter-admin",
        kind: "project-deleted",
        action: `已删除项目「${input.projectName}」`,
        severity: "Medium",
        projectId: input.projectId,
        targetType: "project",
        targetId: input.projectId,
        metadata: { name: input.projectName }
      }
    };
  });
}
