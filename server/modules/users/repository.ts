import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type { BackendRoleId, RoleBinding } from "../auth/types";
import type {
  CreateUserInput,
  OrganizationDto,
  ProjectWorkflowRoleBindingItem,
  ProjectWorkflowRoleId,
  RegistrationRoleRequestDto,
  RegistrationRoleRequestListStatus,
  RegistrationRoleRequestStatus,
  RegistrationDecisionOutcome,
  UserGovernanceDto
} from "./types";

type UserGovernanceRow = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  username: string | null;
  title: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string | null;
  roles?: unknown;
  oidc_issuer?: string | null;
  oidc_subject?: string | null;
  legacy_oidc_email?: string | null;
};

type RegistrationRoleRequestRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  user_id: string;
  user_name: string;
  username: string | null;
  current_role_id: BackendRoleId;
  requested_role_id: BackendRoleId;
  status: RegistrationRoleRequestStatus;
  created_at: string;
  decided_at: string | null;
  decided_by_user_id: string | null;
  account_changed_at: string | null;
  account_changed?: boolean;
  decision_outcome: RegistrationDecisionOutcome | null;
  decision_can_login: boolean | null;
  decision_role_ids: BackendRoleId[] | null;
};

function parseRoles(value: unknown): RoleBinding[] {
  if (!Array.isArray(value)) return [];
  return value.map((role) => {
    const item = role as { projectId?: unknown; project_id?: unknown; roleId?: unknown; role_id?: unknown };
    return {
      projectId: typeof item.projectId === "string" ? item.projectId : typeof item.project_id === "string" ? item.project_id : null,
      roleId: (item.roleId ?? item.role_id) as BackendRoleId
    };
  });
}

function toDto(row: UserGovernanceRow): UserGovernanceDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    email: row.email ?? null,
    username: row.username ?? null,
    title: row.title,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    roles: parseRoles(row.roles),
    ...(row.oidc_issuer && row.oidc_subject ? { oidcIdentity: { issuer: row.oidc_issuer,subject: row.oidc_subject } } : {}),
    ...(row.legacy_oidc_email ? { legacyOidcEmail: row.legacy_oidc_email } : {})
  };
}

function registrationRoleRequestToDto(row: RegistrationRoleRequestRow): RegistrationRoleRequestDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    userId: row.user_id,
    userName: row.user_name,
    username: row.username,
    currentRoleId: row.current_role_id,
    requestedRoleId: row.requested_role_id,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedByUserId: row.decided_by_user_id,
    decisionOutcome: row.decision_outcome ?? null,
    decisionCanLogin: row.decision_can_login ?? null,
    decisionRoleIds: row.decision_role_ids ?? null,
    accountChanged: row.status === "pending" && (row.account_changed ?? Boolean(row.account_changed_at))
  };
}

const userWithRolesSelect = `
  select
    users.id,
    users.organization_id,
    users.name,
    users.email,
    user_password_credentials.username,
    identity.issuer as oidc_issuer,identity.subject as oidc_subject,identity.legacy_email as legacy_oidc_email,
    users.title,
    users.is_active,
    users.created_at::text as created_at,
    users.last_active_at::text as last_active_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object('projectId', user_role_bindings.project_id, 'roleId', user_role_bindings.role_id)
        order by user_role_bindings.project_id nulls first, user_role_bindings.role_id
      ) filter (where user_role_bindings.id is not null),
      '[]'::jsonb
    ) as roles
  from users
  left join user_role_bindings on user_role_bindings.user_id = users.id
  left join user_password_credentials on user_password_credentials.user_id = users.id
  left join public.user_oidc_identities identity on identity.user_id=users.id and identity.organization_id=users.organization_id
`;

type OrganizationRow = {
  id: string;
  name: string;
  created_at: string;
};

function organizationToDto(row: OrganizationRow): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at
  };
}

export async function getOrganizationById(db: Queryable, organizationId: string) {
  const result = await db.query<OrganizationRow>(
    `
    select id, name, created_at::text as created_at
    from organizations
    where id = $1
    limit 1
    `,
    [organizationId]
  );
  return result.rows[0] ? organizationToDto(result.rows[0]) : null;
}

export async function updateOrganizationName(db: Queryable, organizationId: string, name: string) {
  const result = await db.query<OrganizationRow>(
    `
    update organizations
    set name = $2
    where id = $1
    returning id, name, created_at::text as created_at
    `,
    [organizationId, name]
  );
  return result.rows[0] ? organizationToDto(result.rows[0]) : null;
}

export async function listUsers(db: Queryable, organizationId: string) {
  const result = await db.query<UserGovernanceRow>(
    `
    ${userWithRolesSelect}
    where users.organization_id = $1
    group by users.id, user_password_credentials.username,identity.user_id
    order by users.name
    `,
    [organizationId]
  );

  return result.rows.map(toDto);
}

export async function getUserById(db: Queryable, input: { organizationId: string; userId: string }) {
  const result = await db.query<UserGovernanceRow>(
    `
    ${userWithRolesSelect}
    where users.organization_id = $1 and users.id = $2
    group by users.id, user_password_credentials.username,identity.user_id
    `,
    [input.organizationId, input.userId]
  );

  return result.rows[0] ? toDto(result.rows[0]) : null;
}

export async function lockUserById(db: Queryable, input: { organizationId: string; userId: string }) {
  const result = await db.query<{ id: string }>(
    `
    select id
    from users
    where organization_id = $1 and id = $2
    for no key update
    `,
    [input.organizationId, input.userId]
  );
  return result.rows[0]?.id ?? null;
}

export async function deleteUserById(
  db: Queryable,
  input: { organizationId: string; userId: string; allowPlatformAdmin: boolean }
) {
  const result = await db.query(
    `
    delete from users
    where organization_id = $1 and id = $2
      and (
        $3::boolean
        or not exists (
          select 1
          from user_role_bindings
          where user_id = users.id and role_id = 'platform-admin'
        )
      )
    `,
    [input.organizationId, input.userId, input.allowPlatformAdmin]
  );
  return result.rowCount;
}

export async function insertUser(db: Queryable, input: Pick<CreateUserInput, "name" | "title"> & { id: string; organizationId: string; email?: string }) {
  const result = await db.query<UserGovernanceRow>(
    `
    insert into users (id, organization_id, name, title, email, is_active)
    values ($1, $2, $3, $4, $5, true)
    returning id, organization_id, name, email, title, is_active, created_at::text as created_at, last_active_at::text as last_active_at
    `,
    [input.id, input.organizationId, input.name, input.title,input.email ?? null]
  );

  return toDto({ ...result.rows[0], roles: [] });
}

export async function findPasswordCredentialByUsername(db: Queryable, username: string) {
  const result = await db.query<{ id: string }>(
    `
    select user_id as id
    from user_password_credentials
    where lower(username) = lower($1)
    limit 1
    `,
    [username]
  );

  return result.rows[0] ?? null;
}

export async function insertPasswordCredential(db: Queryable, input: { userId: string; username: string; passwordHash: string }) {
  await db.query("insert into user_password_credentials (user_id, username, password_hash) values ($1, $2, $3)", [
    input.userId,
    input.username,
    input.passwordHash
  ]);
}

export async function updatePasswordCredential(db: Queryable, input: { userId: string; passwordHash: string }) {
  const result = await db.query(
    `
    update user_password_credentials
    set password_hash = $2, password_updated_at = now()
    where user_id = $1
    `,
    [input.userId, input.passwordHash]
  );
  return result.rowCount;
}

export async function updateUser(db: Queryable, input: { organizationId: string; userId: string; name?: string; email?: string; title?: string }) {
  const current = await getUserById(db, { organizationId: input.organizationId, userId: input.userId });
  if (!current) return null;

  const result = await db.query<UserGovernanceRow>(
    `
    update users
    set name = $3, email = $4, title = $5
    where organization_id = $1 and id = $2
    returning id, organization_id, name, email, title, is_active, created_at::text as created_at, last_active_at::text as last_active_at
    `,
    [
      input.organizationId,
      input.userId,
      input.name ?? current.name,
      input.email ?? current.email,
      input.title ?? current.title
    ]
  );

  return { ...current,...toDto({ ...result.rows[0], username: current.username, roles: current.roles }) };
}

export async function updateUserActive(db: Queryable, input: { organizationId: string; userId: string; isActive: boolean }) {
  const current = await getUserById(db, { organizationId: input.organizationId, userId: input.userId });
  if (!current) return null;

  const result = await db.query<UserGovernanceRow>(
    `
    update users
    set is_active = $3
    where organization_id = $1 and id = $2
    returning id, organization_id, name, email, title, is_active, created_at::text as created_at, last_active_at::text as last_active_at
    `,
    [input.organizationId, input.userId, input.isActive]
  );

  return { ...current,...toDto({ ...result.rows[0], username: current.username, roles: current.roles }) };
}

export async function replaceRoleBindings(db: Queryable, input: { organizationId: string; userId: string; roles: RoleBinding[] }) {
  await db.query(
    `
    delete from user_role_bindings
    where organization_id = $1 and user_id = $2
    `,
    [input.organizationId, input.userId]
  );

  for (const role of input.roles) {
    await db.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, $4, $5)
      `,
      [randomUUID(), input.userId, input.organizationId, role.projectId, role.roleId]
    );
  }
}

export async function listActiveAdminUserIds(db: Queryable, organizationId: string) {
  const result = await db.query<{ id: string }>(
    `
    select distinct users.id
    from users
    join user_role_bindings on user_role_bindings.user_id = users.id
    where users.organization_id = $1
      and users.is_active = true
      and user_role_bindings.role_id in ('admin', 'platform-admin')
    order by users.id asc
    `,
    [organizationId]
  );

  return result.rows.map((row) => row.id);
}

const registrationRoleRequestSelect = `
  select
    local_registration_role_requests.id,
    local_registration_role_requests.organization_id,
    organizations.name as organization_name,
    local_registration_role_requests.user_id,
    users.name as user_name,
    user_password_credentials.username,
    local_registration_role_requests.current_role_id,
    local_registration_role_requests.requested_role_id,
    local_registration_role_requests.status,
    local_registration_role_requests.created_at::text as created_at,
    local_registration_role_requests.decided_at::text as decided_at,
    local_registration_role_requests.decided_by_user_id,
    local_registration_role_requests.account_changed_at::text as account_changed_at,
    (local_registration_role_requests.account_changed_at is not null or users.is_active or
      not exists(select 1 from user_role_bindings bindings
        where bindings.user_id = users.id and bindings.organization_id = users.organization_id
          and bindings.project_id is null and bindings.role_id = local_registration_role_requests.current_role_id) or
      exists(select 1 from user_role_bindings bindings
        where bindings.user_id = users.id and bindings.organization_id = users.organization_id
          and bindings.project_id is null and bindings.role_id not like 'catalog-capability-%'
          and bindings.role_id <> local_registration_role_requests.current_role_id)) as account_changed,
    local_registration_role_requests.decision_outcome,
    local_registration_role_requests.decision_can_login,
    local_registration_role_requests.decision_role_ids
  from local_registration_role_requests
  join organizations on organizations.id = local_registration_role_requests.organization_id
  join users on users.id = local_registration_role_requests.user_id
  left join user_password_credentials on user_password_credentials.user_id = users.id
`;

export async function listRegistrationRoleRequestsByScope(
  db: Queryable,
  input: { organizationId?: string; status: RegistrationRoleRequestListStatus }
) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    ${registrationRoleRequestSelect}
    where local_registration_role_requests.status ${input.status === "decided" ? "in ('approved', 'rejected')" : "= 'pending'"}
      ${input.organizationId === undefined ? "" : "and local_registration_role_requests.organization_id = $1"}
    order by ${input.status === "decided" ? "local_registration_role_requests.decided_at desc," : ""}
      local_registration_role_requests.created_at ${input.status === "decided" ? "desc" : "asc"}, local_registration_role_requests.id
    `,
    input.organizationId === undefined ? [] : [input.organizationId]
  );

  return result.rows.map(registrationRoleRequestToDto);
}

export async function getPendingRegistrationRoleRequestByIdForAdmin(db: Queryable, requestId: string, lock = false) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    ${registrationRoleRequestSelect}
    where local_registration_role_requests.id = $1
      and local_registration_role_requests.status = 'pending'
    limit 1
    ${lock ? "for update of local_registration_role_requests" : ""}
    `,
    [requestId]
  );

  return result.rows[0] ? registrationRoleRequestToDto(result.rows[0]) : null;
}

export async function getPendingRegistrationRoleRequestById(
  db: Queryable,
  input: { organizationId: string; requestId: string },
  lock = false
) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    ${registrationRoleRequestSelect}
    where local_registration_role_requests.organization_id = $1
      and local_registration_role_requests.id = $2
      and local_registration_role_requests.status = 'pending'
    limit 1
    ${lock ? "for update of local_registration_role_requests" : ""}
    `,
    [input.organizationId, input.requestId]
  );

  return result.rows[0] ? registrationRoleRequestToDto(result.rows[0]) : null;
}

export async function decideRegistrationRoleRequest(
  db: Queryable,
  input: {
    organizationId: string;
    requestId: string;
    status: Exclude<RegistrationRoleRequestStatus, "pending">;
    decidedByUserId: string;
    decidedAt: string;
    outcome: RegistrationDecisionOutcome;
    canLogin: boolean;
    roles: BackendRoleId[];
  }
) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    update local_registration_role_requests
    set status = $3,
        decided_by_user_id = $4,
        decided_at = $5,
        decision_outcome = $6,
        decision_can_login = $7,
        decision_role_ids = $8
    where organization_id = $1
      and id = $2
      and status = 'pending'
    returning
      id,
      organization_id,
      (select name from organizations where organizations.id = local_registration_role_requests.organization_id) as organization_name,
      user_id,
      (select name from users where users.id = local_registration_role_requests.user_id) as user_name,
      (select username from user_password_credentials where user_password_credentials.user_id = local_registration_role_requests.user_id) as username,
      current_role_id,
      requested_role_id,
      status,
      created_at::text as created_at,
      decided_at::text as decided_at,
      decided_by_user_id,
      account_changed_at::text as account_changed_at,
      decision_outcome,
      decision_can_login,
      decision_role_ids
    `,
    [input.organizationId, input.requestId, input.status, input.decidedByUserId, input.decidedAt, input.outcome, input.canLogin, input.roles]
  );

  return result.rows[0] ? registrationRoleRequestToDto(result.rows[0]) : null;
}

export async function checkProjectBelongsToOrg(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    "select id from projects where organization_id = $1 and id = $2 limit 1",
    [input.organizationId, input.projectId]
  );
  return result.rows.length > 0;
}

export async function getUserProjectWorkflowRoles(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string }
): Promise<ProjectWorkflowRoleId[]> {
  const result = await db.query<{ role_id: ProjectWorkflowRoleId }>(
    `
    select distinct role_id
    from user_role_bindings
    where organization_id = $1
      and project_id = $2
      and user_id = $3
      and role_id in ('hardware-committer', 'software-committer', 'software-user')
    order by role_id asc
    `,
    [input.organizationId, input.projectId, input.userId]
  );
  return result.rows.map((row) => row.role_id);
}

export async function getProjectWorkflowRoleBindings(
  db: Queryable,
  input: { organizationId: string; projectId: string }
): Promise<ProjectWorkflowRoleBindingItem[]> {
  const result = await db.query<{
    user_id: string;
    user_name: string;
    username: string | null;
    is_active: boolean;
    roles: ProjectWorkflowRoleId[];
  }>(
    `
    select
      users.id as user_id,
      users.name as user_name,
      user_password_credentials.username,
      users.is_active,
      coalesce(
        (
          select jsonb_agg(distinct urb2.role_id order by urb2.role_id)
          from user_role_bindings urb2
          where urb2.user_id = users.id
            and urb2.organization_id = $1
            and urb2.project_id = $2
            and urb2.role_id in ('hardware-committer', 'software-committer', 'software-user')
        ),
        '[]'::jsonb
      ) as roles
    from users
    join user_role_bindings on user_role_bindings.user_id = users.id
    left join user_password_credentials on user_password_credentials.user_id = users.id
    where users.organization_id = $1
      and user_role_bindings.organization_id = $1
      and user_role_bindings.project_id = $2
      and user_role_bindings.role_id in ('hardware-committer', 'software-committer', 'software-user')
    group by users.id, user_password_credentials.username
    order by users.name asc, users.id asc
    `,
    [input.organizationId, input.projectId]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    userName: row.user_name,
    username: row.username,
    isActive: row.is_active,
    roles: Array.isArray(row.roles) ? row.roles : []
  }));
}

export async function updateProjectWorkflowRoles(
  db: Queryable,
  input: { organizationId: string; projectId: string; userId: string; roles: ProjectWorkflowRoleId[] }
): Promise<void> {
  await db.query(
    `
    delete from user_role_bindings
    where organization_id = $1
      and project_id = $2
      and user_id = $3
      and role_id in ('hardware-committer', 'software-committer', 'software-user')
    `,
    [input.organizationId, input.projectId, input.userId]
  );

  const uniqueRoles = [...new Set(input.roles)].sort();
  for (const roleId of uniqueRoles) {
    await db.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, $4, $5)
      `,
      [randomUUID(), input.userId, input.organizationId, input.projectId, roleId]
    );
  }
}

export async function getUserOrganizationRoles(
  db: Queryable,
  input: { organizationId: string; userId: string }
): Promise<BackendRoleId[]> {
  const result = await db.query<{ role_id: BackendRoleId }>(
    `
    select distinct role_id
    from user_role_bindings
    where organization_id = $1
      and user_id = $2
      and project_id is null
      and role_id not like 'catalog-capability-%'
    order by role_id asc
    `,
    [input.organizationId, input.userId]
  );
  return result.rows.map((row) => row.role_id);
}

export async function updateOrganizationRoles(
  db: Queryable,
  input: { organizationId: string; userId: string; roles: BackendRoleId[] }
): Promise<void> {
  await db.query(
    `
    delete from user_role_bindings
    where organization_id = $1
      and user_id = $2
      and project_id is null
      and role_id not like 'catalog-capability-%'
    `,
    [input.organizationId, input.userId]
  );

  const uniqueRoles = [...new Set(input.roles)].sort();
  for (const roleId of uniqueRoles) {
    await db.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, $4, $5)
      `,
      [randomUUID(), input.userId, input.organizationId, null, roleId]
    );
  }
}
