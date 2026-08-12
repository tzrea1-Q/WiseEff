import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { ensureDefaultConfigSetInTx } from "../parameter-files/configSetService";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canAdminParameters } from "./policy";
import { createProject, deleteProject, updateProject } from "./projectRepository";
import type { ProjectAdminSummaryDto } from "./types";

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

export type ProjectServiceContext = AuditCorrelationContext;

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

/**
 * Creates a project and idempotently ensures the implicit `default` config set
 * in the same transaction (decision B1).
 */
export async function createProjectForAuth(
  db: Database,
  auth: AuthContext,
  input: CreateProjectForAuthInput,
  context: ProjectServiceContext = {}
): Promise<ProjectAdminSummaryDto> {
  requireCanAdmin(auth);

  return db.transaction(async (tx) => {
    const item = await createProject(tx, {
      organizationId: auth.organization.id,
      id: input.id,
      name: input.name,
      code: input.code,
      status: input.status
    });

    await ensureDefaultConfigSetInTx(tx, auth, item.id, context);

    // Written inside the same transaction so a created project can never
    // exist without its audit evidence (docs/SECURITY.md production writes).
    await createAuditEvent(tx, {
      id: randomUUID(),
      organizationId: auth.organization.id,
      projectId: item.id,
      actorUserId: auth.user.id,
      actorType: "user",
      app: "parameter-admin",
      kind: "project-created",
      action: `已创建项目「${item.name}」`,
      severity: "Low",
      targetType: "project",
      targetId: item.id,
      metadata: {
        name: item.name,
        code: item.code,
        status: item.status
      },
      traceId: context.requestId ?? randomUUID()
    });

    return item;
  });
}

export async function updateProjectForAuth(
  db: Database,
  auth: AuthContext,
  input: UpdateProjectForAuthInput,
  context: ProjectServiceContext = {}
): Promise<ProjectAdminSummaryDto | null> {
  requireCanAdmin(auth);

  const item = await updateProject(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    name: input.name,
    code: input.code,
    status: input.status
  });

  if (!item) {
    return null;
  }

  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: item.id,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-admin",
    kind: "project-updated",
    action: `已更新项目「${item.name}」`,
    severity: "Low",
    targetType: "project",
    targetId: item.id,
    metadata: {
      name: item.name,
      code: item.code,
      status: item.status
    },
    traceId: context.requestId ?? randomUUID()
  });

  return item;
}

export async function deleteProjectForAuth(
  db: Database,
  auth: AuthContext,
  input: DeleteProjectForAuthInput,
  context: ProjectServiceContext = {}
): Promise<{ deleted: boolean; reason?: "not_found" }> {
  requireCanAdmin(auth);

  const result = await deleteProject(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });

  if (!result.deleted) {
    return result;
  }

  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameter-admin",
    kind: "project-deleted",
    action: `已删除项目「${input.projectName}」`,
    severity: "Medium",
    targetType: "project",
    targetId: input.projectId,
    metadata: { name: input.projectName },
    traceId: context.requestId ?? randomUUID()
  });

  return result;
}
