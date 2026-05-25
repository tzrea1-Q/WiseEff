import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { permissionsForRoles } from "./policy";
import type { AuthContext, BackendRoleId } from "./types";

type AuthRow = {
  user_id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  email: string;
  title: string;
  is_active: boolean;
  project_id: string | null;
  role_id: BackendRoleId;
};

export async function getAuthContext(db: Queryable, userId: string): Promise<AuthContext> {
  const result = await db.query<AuthRow>(
    `
    select
      users.id as user_id,
      users.organization_id,
      organizations.name as organization_name,
      users.name,
      users.email,
      users.title,
      users.is_active,
      user_role_bindings.project_id,
      user_role_bindings.role_id
    from users
    join organizations on organizations.id = users.organization_id
    join user_role_bindings on user_role_bindings.user_id = users.id
    where users.id = $1
    order by user_role_bindings.project_id nulls first
    `,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new ApiError("UNAUTHENTICATED", "User is not authenticated.", 401);
  }

  const first = result.rows[0];
  if (!first.is_active) {
    throw new ApiError("FORBIDDEN", "User is inactive.", 403);
  }

  const roles = result.rows.map((row) => ({ projectId: row.project_id, roleId: row.role_id }));

  return {
    user: {
      id: first.user_id,
      organizationId: first.organization_id,
      name: first.name,
      email: first.email,
      title: first.title,
      isActive: first.is_active
    },
    organization: {
      id: first.organization_id,
      name: first.organization_name
    },
    roles,
    permissions: permissionsForRoles(roles.map((role) => role.roleId))
  };
}
