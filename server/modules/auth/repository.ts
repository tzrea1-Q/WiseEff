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

const authContextSelect = `
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
`;

function authContextFromRows(rows: AuthRow[]) {
  if (rows.length === 0) {
    throw new ApiError("UNAUTHENTICATED", "User is not authenticated.", 401);
  }

  const first = rows[0];
  if (!first.is_active) {
    throw new ApiError("FORBIDDEN", "User is inactive.", 403);
  }

  const roles = rows.map((row) => ({ projectId: row.project_id, roleId: row.role_id }));

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

export async function getAuthContext(db: Queryable, userId: string): Promise<AuthContext> {
  const result = await db.query<AuthRow>(
    `
    ${authContextSelect}
    where users.id = $1
    order by user_role_bindings.project_id nulls first
    `,
    [userId]
  );

  return authContextFromRows(result.rows);
}

export async function getAuthContextForExternalIdentity(
  db: Queryable,
  input: { organizationId: string; subject: string; email?: string }
): Promise<AuthContext> {
  const subjectResult = await db.query<AuthRow>(
    `
    ${authContextSelect}
    where users.organization_id = $1 and users.id = $2
    order by user_role_bindings.project_id nulls first
    `,
    [input.organizationId, input.subject]
  );
  if (subjectResult.rows.length > 0) {
    return authContextFromRows(subjectResult.rows);
  }

  if (!input.email?.trim()) {
    throw new ApiError("UNAUTHENTICATED", "User is not authenticated.", 401);
  }

  const emailResult = await db.query<AuthRow>(
    `
    ${authContextSelect}
    where users.organization_id = $1 and lower(users.email) = lower($2)
    order by user_role_bindings.project_id nulls first
    `,
    [input.organizationId, input.email]
  );

  return authContextFromRows(emailResult.rows);
}
