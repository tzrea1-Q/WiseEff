/**
 * Behavior-level integration coverage for local admin bootstrap: first-admin
 * creation with its organization/credential/role-binding/audit rows, and the
 * one-admin guard, against a real database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { bootstrapLocalAdmin, countLocalAdminBindings } from "./bootstrapLocalAdmin";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("bootstrapLocalAdmin", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("creates the first local admin when none exist", async () => {
    await expect(countLocalAdminBindings(db)).resolves.toBe(0);

    const result = await bootstrapLocalAdmin(db, {
      name: "Platform Admin",
      username: "admin.ops",
      password: "WiseEff@2026",
      organization: "硬件部"
    });

    expect(result.username).toBe("admin.ops");
    expect(result.organizationId).toBe("org-hardware-department");
    // The user, credential, org-wide admin binding, and audit trail are all durable.
    const user = await db.query<{ organization_id: string; name: string; is_active: boolean }>(
      `select organization_id, name, is_active from users where id = $1`,
      [result.userId]
    );
    expect(user.rows).toEqual([{ organization_id: "org-hardware-department", name: "Platform Admin", is_active: true }]);
    const credential = await db.query<{ username: string; password_hash: string }>(
      `select username, password_hash from user_password_credentials where user_id = $1`,
      [result.userId]
    );
    expect(credential.rows[0].username).toBe("admin.ops");
    expect(credential.rows[0].password_hash).toMatch(/^scrypt\$/);
    const binding = await db.query<{ role_id: string; project_id: string | null }>(
      `select role_id, project_id from user_role_bindings where user_id = $1`,
      [result.userId]
    );
    expect(binding.rows).toEqual([{ role_id: "admin", project_id: null }]);
    const audit = await db.query<{ kind: string; action: string }>(
      `select kind, action from audit_events where organization_id = 'org-hardware-department'`
    );
    expect(audit.rows).toEqual([{ kind: "auth-event", action: "bootstrap-admin" }]);
  });

  it("rejects bootstrap when an admin already exists", async () => {
    await bootstrapLocalAdmin(db, {
      name: "Platform Admin",
      username: "admin.ops",
      password: "WiseEff@2026"
    });

    await expect(
      bootstrapLocalAdmin(db, {
        name: "Second Admin",
        username: "admin.second",
        password: "WiseEff@2026"
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // The refused bootstrap wrote no second user.
    const credentials = await db.query<{ username: string }>(`select username from user_password_credentials`);
    expect(credentials.rows).toEqual([{ username: "admin.ops" }]);
  });

  it("counts existing admin bindings", async () => {
    await expect(countLocalAdminBindings(db)).resolves.toBe(0);
    await bootstrapLocalAdmin(db, {
      name: "Platform Admin",
      username: "admin.ops",
      password: "WiseEff@2026"
    });
    await expect(countLocalAdminBindings(db)).resolves.toBe(1);
  });
});
