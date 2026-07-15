import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { ensureDefaultConfigSetInTx } from "../parameter-files/configSetService";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canAdminParameters } from "./policy";
import { createProject } from "./repository";
import type { ProjectAdminSummaryDto } from "./types";

export type CreateProjectForAuthInput = {
  id: string;
  name: string;
  code: string;
  status?: string;
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

    return item;
  });
}
