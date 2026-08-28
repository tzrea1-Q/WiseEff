import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import { deleteUser } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

const accountOwnedReferences = new Set([
  "auth_sessions.user_id",
  "debug_device_leases.lease_owner_user_id",
  "local_registration_role_requests.user_id",
  "parameter_drafts.user_id",
  "user_notifications.recipient_user_id",
  "user_password_credentials.user_id",
  "user_role_bindings.user_id"
]);

type UserForeignKeyRow = {
  table_name: string;
  constraint_name: string;
  column_names: string;
  delete_action: "CASCADE" | "NO ACTION" | "RESTRICT" | "SET DEFAULT" | "SET NULL";
  all_columns_nullable: boolean;
};

const adminAuth: AuthContext = {
  user: {
    id: "u-admin",
    organizationId: "org-chargelab",
    name: "Admin",
    email: "admin@example.com",
    title: "Admin",
    isActive: true
  },
  organization: { id: "org-chargelab", name: "ChargeLab" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["users:manage", "admin:access"]
};

async function insertDeletionFixture(db: InMemoryTestDatabase) {
  await db.query("insert into organizations (id, name) values ('org-chargelab', 'ChargeLab')");
  await db.query(
    `
    insert into roles (id, name, level, permissions) values
      ('admin', 'Admin', 'platform', array['users:manage', 'admin:access']),
      ('hardware-user', 'Hardware User', 'platform', array['parameter:view']),
      ('hardware-committer', 'Hardware Committer', 'platform', array['parameter:view', 'parameter:review'])
    on conflict (id) do nothing
    `
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active) values
      ('u-admin', 'org-chargelab', 'Admin', 'admin@example.com', 'Admin', true),
      ('u-target', 'org-chargelab', 'Target User', 'target@example.com', 'Engineer', true)
    `
  );
  await db.query(
    `
    insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values
      ('urb-admin', 'u-admin', 'org-chargelab', null, 'admin'),
      ('urb-target', 'u-target', 'org-chargelab', null, 'hardware-user')
    `
  );
  await db.query(
    `insert into user_password_credentials (user_id, password_hash, username)
     values ('u-target', 'scrypt$redacted$hash', 'target.user')`
  );
  await db.query(
    `insert into auth_sessions (id, user_id, organization_id, token_hash, expires_at)
     values ('session-target', 'u-target', 'org-chargelab', 'token-hash-target', now() + interval '1 day')`
  );
  await db.query(
    `
    insert into local_registration_role_requests (
      id, organization_id, user_id, current_role_id, requested_role_id, status
    ) values (
      'registration-target', 'org-chargelab', 'u-target', 'hardware-user', 'hardware-committer', 'pending'
    )
    `
  );
  await db.query(
    `
    insert into user_notifications (
      id, organization_id, recipient_user_id, category, title, body
    ) values (
      '00000000-0000-4000-8000-000000000001', 'org-chargelab', 'u-target', 'test', 'Target notice', 'Target body'
    )
    `
  );
  await db.query(
    `
    insert into audit_events (
      id, organization_id, actor_user_id, actor_type, app, kind, action, severity,
      target_type, target_id, metadata, trace_id
    ) values (
      'audit-target-history', 'org-chargelab', 'u-target', 'user', 'parameters',
      'parameter-update', 'update', 'Medium', 'parameter', 'parameter-1', '{}', 'historical-request'
    )
    `
  );
}

describe.skipIf(!databaseAvailable)("user account deletion PostgreSQL contract", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("gives every users foreign key an explicit cascade or nullable history policy", async () => {
    const result = await db.query<UserForeignKeyRow>(
      `
      select
        child.relname as table_name,
        constraint_row.conname as constraint_name,
        string_agg(attribute_row.attname, ',' order by key_row.ordinality) as column_names,
        case constraint_row.confdeltype
          when 'a' then 'NO ACTION'
          when 'r' then 'RESTRICT'
          when 'c' then 'CASCADE'
          when 'n' then 'SET NULL'
          when 'd' then 'SET DEFAULT'
        end as delete_action,
        bool_and(not attribute_row.attnotnull) as all_columns_nullable
      from pg_constraint constraint_row
      join pg_class child on child.oid = constraint_row.conrelid
      join unnest(constraint_row.conkey) with ordinality as key_row(attnum, ordinality) on true
      join pg_attribute attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = key_row.attnum
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'users'::regclass
      group by child.relname, constraint_row.conname, constraint_row.confdeltype
      order by child.relname, constraint_row.conname
      `
    );

    expect(result.rows.length).toBeGreaterThan(0);
    const violations = result.rows.flatMap((row) => {
      const reference = `${row.table_name}.${row.column_names}`;
      if (accountOwnedReferences.has(reference)) {
        return row.delete_action === "CASCADE" ? [] : [`${row.table_name}.${row.constraint_name}: expected CASCADE, got ${row.delete_action}`];
      }
      if (row.delete_action !== "SET NULL") {
        return [`${row.table_name}.${row.constraint_name}: expected SET NULL, got ${row.delete_action}`];
      }
      return row.all_columns_nullable
        ? []
        : [`${row.table_name}.${row.constraint_name}: SET NULL columns must be nullable (${row.column_names})`];
    });

    expect(violations).toEqual([]);
  });

  it("deletes account-owned rows, nulls retained history, and writes a non-PII audit", async () => {
    await insertDeletionFixture(db);

    await expect(deleteUser(db, adminAuth, "u-target", { requestId: "delete-request" })).resolves.toBeUndefined();

    const deletedUser = await db.query("select id from users where id = 'u-target'");
    expect(deletedUser.rows).toEqual([]);

    for (const table of [
      "auth_sessions",
      "local_registration_role_requests",
      "user_notifications",
      "user_password_credentials",
      "user_role_bindings"
    ]) {
      const accountRows = await db.query(`select * from ${table} where ${
        table === "user_notifications" ? "recipient_user_id" : "user_id"
      } = 'u-target'`);
      expect(accountRows.rows, table).toEqual([]);
    }

    const retainedHistory = await db.query<{ actor_user_id: string | null }>(
      "select actor_user_id from audit_events where id = 'audit-target-history'"
    );
    expect(retainedHistory.rows).toEqual([{ actor_user_id: null }]);

    const deletionAudit = await db.query<{
      actor_user_id: string | null;
      kind: string;
      action: string;
      target_id: string | null;
      metadata: Record<string, unknown>;
      trace_id: string;
    }>(
      `
      select actor_user_id, kind, action, target_id, metadata, trace_id
      from audit_events
      where kind = 'user-delete' and target_id = 'u-target'
      `
    );
    expect(deletionAudit.rows).toEqual([
      {
        actor_user_id: "u-admin",
        kind: "user-delete",
        action: "delete",
        target_id: "u-target",
        metadata: { isActive: true, roles: [{ projectId: null, roleId: "hardware-user" }] },
        trace_id: "delete-request"
      }
    ]);
    expect(JSON.stringify(deletionAudit.rows)).not.toContain("Target User");
    expect(JSON.stringify(deletionAudit.rows)).not.toContain("target.user");
    expect(JSON.stringify(deletionAudit.rows)).not.toContain("target@example.com");
  });
});
