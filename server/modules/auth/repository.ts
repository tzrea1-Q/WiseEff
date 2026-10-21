import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { catalogTestCapabilitiesForUser } from "./catalogTestCapabilities";
import { compareRoles, permissionsForRoles } from "./policy";
import type { AuthContext, BackendPermission, BackendRoleId } from "./types";

type AuthRow = {
  user_id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  email: string | null;
  username: string | null;
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
      user_password_credentials.username,
      users.title,
      users.is_active,
      user_role_bindings.project_id,
      user_role_bindings.role_id
    from users
    join organizations on organizations.id = users.organization_id
    join user_role_bindings on user_role_bindings.user_id = users.id
    left join user_password_credentials on user_password_credentials.user_id = users.id
`;

function authContextFromRows(rows: AuthRow[]) {
  if (rows.length === 0) {
    throw new ApiError("UNAUTHENTICATED", "User is not authenticated.");
  }

  const first = rows[0];
  if (!first.is_active) {
    throw new ApiError("FORBIDDEN", "User is inactive.");
  }

  const knownRoleIds = new Set<BackendRoleId>([
    "guest",
    "hardware-user",
    "software-user",
    "hardware-committer",
    "software-committer",
    "admin",
    "platform-admin"
  ]);
  const roles = rows
    .filter((row) => knownRoleIds.has(row.role_id))
    .map((row) => ({ projectId: row.project_id, roleId: row.role_id }))
    .sort((left, right) => compareRoles(right.roleId, left.roleId));

  return {
    user: {
      id: first.user_id,
      organizationId: first.organization_id,
      name: first.name,
      ...(first.email ? { email: first.email } : {}),
      ...(first.username ? { username: first.username } : {}),
      title: first.title,
      isActive: first.is_active
    },
    organization: {
      id: first.organization_id,
      name: first.organization_name
    },
    roles,
    permissions: uniquePermissions([
      ...permissionsForRoles(roles.map((role) => role.roleId)),
      ...catalogTestCapabilitiesForUser(first.user_id)
    ])
  };
}

function uniquePermissions(permissions: readonly BackendPermission[]): BackendPermission[] {
  return [...new Set(permissions)];
}

const catalogCapabilityPermissions = new Set<BackendPermission>([
  "catalog:author",
  "catalog:publish",
  "catalog:review-high-risk"
]);

async function loadCatalogCapabilityGrants(
  db: Queryable,
  userId: string
): Promise<BackendPermission[]> {
  const result = await db.query<{ permission: string }>(
    `
    select unnest(roles.permissions) as permission
    from user_role_bindings
    join roles on roles.id = user_role_bindings.role_id
    where user_role_bindings.user_id = $1
      and roles.id like 'catalog-capability-%'
    `,
    [userId]
  );
  return result.rows
    .map((row) => row.permission)
    .filter((permission): permission is BackendPermission =>
      catalogCapabilityPermissions.has(permission as BackendPermission)
    );
}

async function withCatalogCapabilityGrants(
  db: Queryable,
  userId: string,
  context: AuthContext
): Promise<AuthContext> {
  const grants = await loadCatalogCapabilityGrants(db, userId);
  if (grants.length === 0) {
    return context;
  }
  return {
    ...context,
    permissions: uniquePermissions([...context.permissions, ...grants])
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

  return withCatalogCapabilityGrants(db, userId, authContextFromRows(result.rows));
}

export async function getAuthContextForExternalIdentity(
  db: Queryable,
  input: { organizationId: string; subject: string; email?: string; issuer?: string }
): Promise<AuthContext> {
  if (input.issuer) {
    const explicit = await db.query<{ user_id: string }>("select user_id from public.user_oidc_identities where organization_id=$1 and issuer=$2 and subject=$3", [input.organizationId,input.issuer,input.subject]);
    if (explicit.rows[0]) return getAuthContext(db, explicit.rows[0].user_id);
    const legacy = await db.query<{ user_id: string }>(`
      select user_id from public.user_oidc_identities where organization_id=$1 and issuer is null and legacy_subject=true
        and (user_id=$2 or ($3::text is not null and legacy_email=lower($3)))
    `, [input.organizationId,input.subject,input.email ?? null]);
    if (legacy.rows.length !== 1) throw new ApiError("UNAUTHENTICATED", "OIDC identity has no unambiguous member binding; contact an administrator.");
    return getAuthContext(db, legacy.rows[0].user_id);
  }
  const subjectResult = await db.query<AuthRow>(
    `
    ${authContextSelect}
    where users.organization_id = $1 and users.id = $2
    order by user_role_bindings.project_id nulls first
    `,
    [input.organizationId, input.subject]
  );
  if (subjectResult.rows.length > 0) {
    return withCatalogCapabilityGrants(
      db,
      subjectResult.rows[0].user_id,
      authContextFromRows(subjectResult.rows)
    );
  }

  if (!input.email?.trim()) {
    throw new ApiError("UNAUTHENTICATED", "User is not authenticated.");
  }

  const emailResult = await db.query<AuthRow>(
    `
    ${authContextSelect}
    where users.organization_id = $1 and lower(users.email) = lower($2)
    order by user_role_bindings.project_id nulls first
    `,
    [input.organizationId, input.email]
  );

  return withCatalogCapabilityGrants(
    db,
    emailResult.rows[0]?.user_id ?? "",
    authContextFromRows(emailResult.rows)
  );
}
