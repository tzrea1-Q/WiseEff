import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createAuditEvent } from "../audit/repository";
import {
  defaultLocalRegistrationOrganizationResolver,
  hashLocalAccountPassword,
  validateLocalAccountPassword,
  validateLocalAccountUsername
} from "./localAccountCredentials";
import { seedBaselineAuthCatalog } from "./baselineCatalog";

export type BootstrapLocalAdminInput = {
  name: string;
  username: string;
  password: string;
  organization?: string;
  organizationName?: string;
  title?: string;
};

export type BootstrapLocalAdminResult = {
  userId: string;
  username: string;
  organizationId: string;
  organizationName: string;
};

export async function countLocalAdminBindings(db: Database) {
  const result = await db.query<{ count: string }>(
    `
    select count(*)::text as count
    from user_role_bindings
    where role_id = 'admin'
    `
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

export async function bootstrapLocalAdmin(
  db: Database,
  input: BootstrapLocalAdminInput,
  context: { requestId: string } = { requestId: "bootstrap-local-admin" }
): Promise<BootstrapLocalAdminResult> {
  await seedBaselineAuthCatalog(db);

  const existingAdmins = await countLocalAdminBindings(db);
  if (existingAdmins > 0) {
    throw new ApiError(
      "CONFLICT",
      "A local admin account already exists. Use the user governance UI or create additional admins through an existing admin.",
      409
    );
  }

  const username = input.username.trim().toLowerCase();
  validateLocalAccountUsername(username);
  validateLocalAccountPassword(input.password);

  const organizationName = (input.organization ?? input.organizationName ?? "硬件部").trim();
  const name = input.name.trim();
  const title = input.title?.trim() || "Platform Admin";

  if (!name) {
    throw new ApiError("VALIDATION_FAILED", "Admin name is required.", 400);
  }

  const organization = defaultLocalRegistrationOrganizationResolver(organizationName);
  const userId = `u-${randomUUID()}`;

  return db.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(
      `
      select user_id as id
      from user_password_credentials
      where lower(username) = lower($1)
      limit 1
      `,
      [username]
    );
    if (existing.rows.length > 0) {
      throw new ApiError("CONFLICT", "Username is already registered.", 409, { username });
    }

    await tx.query(
      `
      insert into organizations (id, name)
      values ($1, $2)
      on conflict (id) do update set name = excluded.name
      `,
      [organization.id, organization.name]
    );
    await tx.query(
      `
      insert into users (id, organization_id, name, title, is_active, last_active_at)
      values ($1, $2, $3, $4, true, now())
      `,
      [userId, organization.id, name, title]
    );
    await tx.query("insert into user_password_credentials (user_id, username, password_hash) values ($1, $2, $3)", [
      userId,
      username,
      await hashLocalAccountPassword(input.password)
    ]);
    await tx.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, null, 'admin')
      `,
      [randomUUID(), userId, organization.id]
    );
    await createAuditEvent(tx, {
      id: randomUUID(),
      organizationId: organization.id,
      projectId: null,
      actorUserId: userId,
      actorType: "system",
      app: "auth",
      kind: "auth-event",
      action: "bootstrap-admin",
      severity: "High",
      targetType: "user",
      targetId: userId,
      metadata: { username, organization: organization.name },
      traceId: context.requestId
    });

    return {
      userId,
      username,
      organizationId: organization.id,
      organizationName: organization.name
    };
  });
}
