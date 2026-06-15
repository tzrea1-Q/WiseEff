import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type { BackendRoleId, RoleBinding } from "../auth/types";
import type { CreateUserInput, RegistrationRoleRequestDto, RegistrationRoleRequestStatus, UserGovernanceDto } from "./types";

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
};

type RegistrationRoleRequestRow = {
  id: string;
  organization_id: string;
  user_id: string;
  user_name: string;
  username: string | null;
  current_role_id: BackendRoleId;
  requested_role_id: BackendRoleId;
  status: RegistrationRoleRequestStatus;
  created_at: string;
  decided_at: string | null;
  decided_by_user_id: string | null;
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
    roles: parseRoles(row.roles)
  };
}

function registrationRoleRequestToDto(row: RegistrationRoleRequestRow): RegistrationRoleRequestDto {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    userName: row.user_name,
    username: row.username,
    currentRoleId: row.current_role_id,
    requestedRoleId: row.requested_role_id,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedByUserId: row.decided_by_user_id
  };
}

const userWithRolesSelect = `
  select
    users.id,
    users.organization_id,
    users.name,
    users.email,
    user_password_credentials.username,
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
`;

export async function listUsers(db: Queryable, organizationId: string) {
  const result = await db.query<UserGovernanceRow>(
    `
    ${userWithRolesSelect}
    where users.organization_id = $1
    group by users.id, user_password_credentials.username
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
    group by users.id, user_password_credentials.username
    `,
    [input.organizationId, input.userId]
  );

  return result.rows[0] ? toDto(result.rows[0]) : null;
}

export async function insertUser(db: Queryable, input: Pick<CreateUserInput, "name" | "title"> & { id: string; organizationId: string }) {
  const result = await db.query<UserGovernanceRow>(
    `
    insert into users (id, organization_id, name, title, is_active)
    values ($1, $2, $3, $4, true)
    returning id, organization_id, name, email, title, is_active, created_at::text as created_at, last_active_at::text as last_active_at
    `,
    [input.id, input.organizationId, input.name, input.title]
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

  return toDto({ ...result.rows[0], username: current.username, roles: current.roles });
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

  return toDto({ ...result.rows[0], username: current.username, roles: current.roles });
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

export async function countActiveAdmins(db: Queryable, organizationId: string) {
  const result = await db.query<{ count: string }>(
    `
    select count(distinct users.id)::text as count
    from users
    join user_role_bindings on user_role_bindings.user_id = users.id
    where users.organization_id = $1
      and users.is_active = true
      and user_role_bindings.role_id = 'admin'
    `,
    [organizationId]
  );

  return Number(result.rows[0]?.count ?? 0);
}

const registrationRoleRequestSelect = `
  select
    local_registration_role_requests.id,
    local_registration_role_requests.organization_id,
    local_registration_role_requests.user_id,
    users.name as user_name,
    user_password_credentials.username,
    local_registration_role_requests.current_role_id,
    local_registration_role_requests.requested_role_id,
    local_registration_role_requests.status,
    local_registration_role_requests.created_at::text as created_at,
    local_registration_role_requests.decided_at::text as decided_at,
    local_registration_role_requests.decided_by_user_id
  from local_registration_role_requests
  join users on users.id = local_registration_role_requests.user_id
  left join user_password_credentials on user_password_credentials.user_id = users.id
`;

export async function listPendingRegistrationRoleRequests(db: Queryable, organizationId: string) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    ${registrationRoleRequestSelect}
    where local_registration_role_requests.organization_id = $1
      and local_registration_role_requests.status = 'pending'
    order by local_registration_role_requests.created_at asc
    `,
    [organizationId]
  );

  return result.rows.map(registrationRoleRequestToDto);
}

export async function listAllPendingRegistrationRoleRequests(db: Queryable) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    ${registrationRoleRequestSelect}
    where local_registration_role_requests.status = 'pending'
    order by local_registration_role_requests.created_at asc
    `,
    []
  );

  return result.rows.map(registrationRoleRequestToDto);
}

export async function getPendingRegistrationRoleRequestByIdForAdmin(db: Queryable, requestId: string) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    ${registrationRoleRequestSelect}
    where local_registration_role_requests.id = $1
      and local_registration_role_requests.status = 'pending'
    limit 1
    `,
    [requestId]
  );

  return result.rows[0] ? registrationRoleRequestToDto(result.rows[0]) : null;
}

export async function getPendingRegistrationRoleRequestById(
  db: Queryable,
  input: { organizationId: string; requestId: string }
) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    ${registrationRoleRequestSelect}
    where local_registration_role_requests.organization_id = $1
      and local_registration_role_requests.id = $2
      and local_registration_role_requests.status = 'pending'
    limit 1
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
  }
) {
  const result = await db.query<RegistrationRoleRequestRow>(
    `
    update local_registration_role_requests
    set status = $3,
        decided_by_user_id = $4,
        decided_at = $5
    where organization_id = $1
      and id = $2
      and status = 'pending'
    returning
      id,
      organization_id,
      user_id,
      (select name from users where users.id = local_registration_role_requests.user_id) as user_name,
      (select username from user_password_credentials where user_password_credentials.user_id = local_registration_role_requests.user_id) as username,
      current_role_id,
      requested_role_id,
      status,
      created_at::text as created_at,
      decided_at::text as decided_at,
      decided_by_user_id
    `,
    [input.organizationId, input.requestId, input.status, input.decidedByUserId, input.decidedAt]
  );

  return result.rows[0] ? registrationRoleRequestToDto(result.rows[0]) : null;
}
