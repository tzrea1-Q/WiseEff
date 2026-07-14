import type { Database } from "../../shared/database/client";

export type BaselineRoleSeed = readonly [id: string, name: string, level: string, permissions: readonly string[]];

export const baselinePlatformRoles: BaselineRoleSeed[] = [
  ["guest", "Guest", "guest", ["parameter:view", "logs:view"]],
  [
    "hardware-user",
    "Hardware User",
    "user",
    [
      "parameter:view",
      "parameter:edit",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "logs:view",
      "logs:upload",
      "logs:feedback"
    ]
  ],
  [
    "software-user",
    "Software User",
    "user",
    [
      "parameter:view",
      "parameter:edit",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "logs:view",
      "logs:upload",
      "logs:feedback"
    ]
  ],
  [
    "hardware-committer",
    "Hardware Committer",
    "committer",
    [
      "parameter:view",
      "parameter:edit",
      "parameter:edit-critical",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "debugging:write",
      "debugging:rollback",
      "logs:view",
      "logs:upload",
      "logs:feedback",
      "parameter:review"
    ]
  ],
  [
    "software-committer",
    "Software Committer",
    "committer",
    [
      "parameter:view",
      "parameter:edit",
      "parameter:edit-critical",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "debugging:write",
      "debugging:rollback",
      "logs:view",
      "logs:upload",
      "logs:feedback",
      "parameter:review"
    ]
  ],
  [
    "admin",
    "Admin",
    "admin",
    [
      "parameter:view",
      "parameter:edit",
      "parameter:edit-critical",
      "debugging:use",
      "debugging:view",
      "debugging:read",
      "debugging:write",
      "debugging:rollback",
      "debugging:admin",
      "logs:view",
      "logs:upload",
      "logs:feedback",
      "logs:analyze",
      "logs:archive",
      "parameter:review",
      "admin:access",
      "users:manage"
    ]
  ]
] as const;

export const baselineRegistrationOrganizations = [
  ["org-hardware-department", "硬件部"],
  ["org-software-department", "软件部"]
] as const;

export async function seedBaselinePlatformRoles(db: Database) {
  for (const [id, name, level, permissions] of baselinePlatformRoles) {
    await db.query(
      `
      insert into roles (id, name, level, permissions)
      values ($1, $2, $3, $4)
      on conflict (id) do update set name = excluded.name, level = excluded.level, permissions = excluded.permissions
      `,
      [id, name, level, permissions]
    );
  }
}

export async function seedBaselineRegistrationOrganizations(db: Database) {
  for (const [id, name] of baselineRegistrationOrganizations) {
    await db.query(
      `
      insert into organizations (id, name)
      values ($1, $2)
      on conflict (id) do update set name = excluded.name
      `,
      [id, name]
    );
  }
}

export async function seedBaselineAuthCatalog(db: Database) {
  await seedBaselineRegistrationOrganizations(db);
  await seedBaselinePlatformRoles(db);
}
