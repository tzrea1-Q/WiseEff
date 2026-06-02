import { randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import type { BackendRoleId, RoleBinding } from "../auth/types";
import type { CreateUserInput, UserGovernanceDto } from "./types";

type UserGovernanceRow = {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  title: string;
  is_active: boolean;
  created_at: string;
  last_active_at: string | null;
  roles?: unknown;
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
    email: row.email,
    title: row.title,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    roles: parseRoles(row.roles)
  };
}

const userWithRolesSelect = `
  select
    users.id,
    users.organization_id,
    users.name,
    users.email,
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
`;

export async function listUsers(db: Queryable, organizationId: string) {
  const result = await db.query<UserGovernanceRow>(
    `
    ${userWithRolesSelect}
    where users.organization_id = $1
    group by users.id
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
    group by users.id
    `,
    [input.organizationId, input.userId]
  );

  return result.rows[0] ? toDto(result.rows[0]) : null;
}

export async function insertUser(db: Queryable, input: CreateUserInput & { id: string; organizationId: string }) {
  const result = await db.query<UserGovernanceRow>(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, $3, $4, $5, true)
    returning id, organization_id, name, email, title, is_active, created_at::text as created_at, last_active_at::text as last_active_at
    `,
    [input.id, input.organizationId, input.name, input.email, input.title]
  );

  return toDto({ ...result.rows[0], roles: [] });
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

  return toDto({ ...result.rows[0], roles: current.roles });
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

  return toDto({ ...result.rows[0], roles: current.roles });
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
