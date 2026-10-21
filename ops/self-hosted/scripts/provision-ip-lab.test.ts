import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../../server/testing/testDatabase";
import { bootstrapLocalAdmin } from "../../../server/modules/auth/bootstrapLocalAdmin";
import { attachLocalAdminToSeedOrganization, ensureIpLabAdmin } from "./provision-ip-lab";
import { ipLabSeedOrganizationId } from "./ip-lab-profile";
import { applyTestMigrations, migrationsDir, withTempDatabase } from "../../../server/testing/tempDatabase";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("IP lab admin provision", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("creates a ChargeLab admin even when another admin already exists", async () => {
    await bootstrapLocalAdmin(db, {
      name: "Hardware Admin",
      username: "hardware.admin",
      password: "WiseEff@2026",
      organization: "Other Lab"
    });

    const created = await ensureIpLabAdmin(db, {
      username: "admin.ops",
      password: "WiseEffLab#2026",
      name: "Lab Admin"
    });

    expect(created.created).toBe(true);
    expect(created.organizationId).toBe(ipLabSeedOrganizationId);
    expect(created.roles).toEqual(["admin", "platform-admin"]);

    const user = await db.query<{ organization_id: string; name: string }>(
      `select organization_id, name from users where id = $1`,
      [created.userId]
    );
    expect(user.rows).toEqual([{ organization_id: ipLabSeedOrganizationId, name: "Lab Admin" }]);
  });

  it("moves an existing local admin into ChargeLab and is idempotent", async () => {
    const bootstrapped = await bootstrapLocalAdmin(db, {
      name: "Platform Admin",
      username: "admin.ops",
      password: "WiseEff@2026",
      organization: "Other Lab"
    });
    expect(bootstrapped.organizationId).not.toBe(ipLabSeedOrganizationId);

    const first = await attachLocalAdminToSeedOrganization(db, "admin.ops");
    const second = await ensureIpLabAdmin(db, {
      username: "admin.ops",
      password: "WiseEff@2026"
    });

    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(second.userId).toBe(bootstrapped.userId);
    expect(second.organizationId).toBe(ipLabSeedOrganizationId);

    const bindings = await db.query<{ role_id: string; organization_id: string }>(
      `select role_id, organization_id from user_role_bindings where user_id = $1 order by role_id`,
      [bootstrapped.userId]
    );
    expect(bindings.rows).toEqual([
      { role_id: "admin", organization_id: ipLabSeedOrganizationId },
      { role_id: "platform-admin", organization_id: ipLabSeedOrganizationId }
    ]);
  });

  it("moves a populated pre-0238 local admin after upgrade without changing its frozen legacy identity", async () => {
    await withTempDatabase({ prefix: "ip_lab_upgrade", migrate: false }, async ({ db: upgraded }) => {
      await applyTestMigrations(upgraded, migrationsDir, { before: "0238_oidc_member_identities.sql" });
      const admin = await bootstrapLocalAdmin(upgraded, { name: "Legacy local admin", username: "admin.ops", password: "WiseEff@2026", organization: "Old lab" });
      await upgraded.query("update users set email='legacy-admin@example.test' where id=$1", [admin.userId]);
      await applyTestMigrations(upgraded, migrationsDir);
      const before = (await upgraded.query("select user_id,legacy_email,legacy_subject,updated_at from user_oidc_identities where user_id=$1", [admin.userId])).rows;
      expect(before).toEqual([expect.objectContaining({ user_id: admin.userId, legacy_subject: true, legacy_email: "legacy-admin@example.test" })]);
      expect((await attachLocalAdminToSeedOrganization(upgraded, "admin.ops")).userId).toBe(admin.userId);
      expect((await ensureIpLabAdmin(upgraded, { username: "admin.ops", password: "WiseEff@2026" })).userId).toBe(admin.userId);
      expect((await upgraded.query("select user_id,legacy_email,legacy_subject,updated_at from user_oidc_identities where user_id=$1", [admin.userId])).rows).toEqual(before);
      expect((await upgraded.query("select organization_id,issuer,subject from user_oidc_identities where user_id=$1", [admin.userId])).rows)
        .toEqual([{ organization_id: ipLabSeedOrganizationId, issuer: null, subject: null }]);
    });
  }, 120_000);

  it.each(["bound", "conflict"])("rolls back a local account move when its OIDC identity is %s", async (kind) => {
    const admin = await bootstrapLocalAdmin(db, { name: "Local admin", username: "admin.ops", password: "WiseEff@2026", organization: "Other lab" });
    if (kind === "bound") await db.query("update user_oidc_identities set issuer='https://id.example',subject='bound-admin' where user_id=$1", [admin.userId]);
    else {
      await db.query("insert into organizations(id,name) values($1,'ChargeLab')", [ipLabSeedOrganizationId]);
      await db.query("insert into users(id,organization_id,name,title) values('other-member',$1,'Other member','Engineer')", [ipLabSeedOrganizationId]);
      await db.query("update user_oidc_identities set issuer='https://id.example',subject=$1 where user_id='other-member'", [admin.userId]);
    }
    const before = (await db.query("select * from user_oidc_identities where user_id=$1", [admin.userId])).rows;
    await expect(attachLocalAdminToSeedOrganization(db, "admin.ops")).rejects.toThrow(/OIDC/);
    expect((await db.query("select * from user_oidc_identities where user_id=$1", [admin.userId])).rows).toEqual(before);
    expect((await db.query("select organization_id from users where id=$1", [admin.userId])).rows).toEqual([{ organization_id: admin.organizationId }]);
    expect((await db.query("select distinct organization_id from user_role_bindings where user_id=$1", [admin.userId])).rows).toEqual([{ organization_id: admin.organizationId }]);
  });
});
