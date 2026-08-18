import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../../server/testing/testDatabase";
import { bootstrapLocalAdmin } from "../../../server/modules/auth/bootstrapLocalAdmin";
import { attachLocalAdminToSeedOrganization, ensureIpLabAdmin } from "./provision-ip-lab";
import { ipLabSeedOrganizationId } from "./ip-lab-profile";

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
      organization: "硬件部"
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
      organization: "硬件部"
    });
    expect(bootstrapped.organizationId).toBe("org-hardware-department");

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
});
