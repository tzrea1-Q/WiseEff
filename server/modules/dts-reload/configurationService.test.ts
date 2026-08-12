import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { SEEDED_RELOAD_CONFIGURATION } from "./configurationTypes";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

import { createAuditEvent } from "../audit/repository";
import { upsertOrganisationDefault } from "./configurationRepository";
import {
  getReloadConfigurationAdminView,
  updateOrganisationReloadConfiguration
} from "./configurationService";

const databaseAvailable = await isTestDatabaseAvailable();

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["debugging:admin"],
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("reload configuration service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    vi.mocked(createAuditEvent).mockClear();
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function storedRowCount(): Promise<number> {
    const result = await db.query<{ count: string }>(
      "select count(*)::text as count from dts_reload_org_defaults where organization_id = $1",
      ["org-1"]
    );
    return Number(result.rows[0].count);
  }

  it("refuses viewers without debugging:admin", async () => {
    await expect(
      getReloadConfigurationAdminView(db, auth({ permissions: ["debugging:view"] }))
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:admin" }
    });
    await expect(
      updateOrganisationReloadConfiguration(db, auth({ permissions: ["debugging:view"] }), SEEDED_RELOAD_CONFIGURATION)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "debugging:admin" }
    });
  });

  it("refuses an agent actor on configuration write and audits dts-reload-agent-refused", async () => {
    await expect(
      updateOrganisationReloadConfiguration(db, auth(), SEEDED_RELOAD_CONFIGURATION, {
        actorType: "agent",
        requestId: "req-config-agent"
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: {
        code: "dts-reload-agent-refused",
        reason: "agent-refused",
        requireHuman: true,
        action: "configure"
      }
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "agent",
        kind: "dts-reload-agent-refused",
        action: "deny",
        metadata: expect.objectContaining({
          code: "dts-reload-agent-refused",
          reason: "agent-refused",
          requireHuman: true,
          action: "configure"
        })
      })
    );
    expect(createAuditEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "dts-reload-configuration-update" })
    );
    expect(await storedRowCount()).toBe(0);
  });

  it("returns seeded organisation defaults when no row exists", async () => {
    const view = await getReloadConfigurationAdminView(db, auth());
    expect(view.organisation).toMatchObject({
      scope: "organisation",
      source: "seeded-default",
      ...SEEDED_RELOAD_CONFIGURATION,
      updatedAt: null
    });
  });

  it("updates organisation defaults, validates the log command, and writes audit evidence", async () => {
    await upsertOrganisationDefault(db, {
      organizationId: "org-1",
      contract: { ...SEEDED_RELOAD_CONFIGURATION },
      updatedByUserId: "user-1"
    });

    const next = await updateOrganisationReloadConfiguration(
      db,
      auth(),
      {
        destinationDirectory: "/oem/firmware/",
        destinationFilename: "power_dts_overlay.dtbo",
        triggerNodePath: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
        triggerPayload: "1",
        kernelLogCommand: "hilog"
      },
      { requestId: "req-1" }
    );

    expect(next.source).toBe("organisation");
    expect(next.destinationDirectory).toBe("/oem/firmware/");
    expect(next.kernelLogCommand).toBe("hilog");
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "dts-reload-configuration-update",
        action: "update",
        actorUserId: "user-1",
        targetType: "dts-reload-configuration",
        metadata: expect.objectContaining({
          scope: "organisation",
          previous: expect.objectContaining({ kernelLogCommand: "dmesg" }),
          next: expect.objectContaining({ kernelLogCommand: "hilog" })
        })
      })
    );

    // The saved row is what admins and later runs read back.
    const view = await getReloadConfigurationAdminView(db, auth());
    expect(view.organisation).toMatchObject({
      source: "organisation",
      destinationDirectory: "/oem/firmware/",
      kernelLogCommand: "hilog",
      updatedByUserId: "user-1"
    });
    expect(view.organisation.updatedAt).not.toBeNull();
  });

  it("rejects a disallowed kernel log command on save", async () => {
    await expect(
      updateOrganisationReloadConfiguration(db, auth(), {
        ...SEEDED_RELOAD_CONFIGURATION,
        kernelLogCommand: "bash -c id"
      })
    ).rejects.toBeInstanceOf(ApiError);
    expect(createAuditEvent).not.toHaveBeenCalled();
    expect(await storedRowCount()).toBe(0);
  });
});
