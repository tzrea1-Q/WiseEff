import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { getFileConfigSetMembership } from "./configSetRepository";
import { insertProjectParameterFile } from "./repository";
import {
  addConfigSetFile,
  createConfigSet,
  ensureDefaultConfigSet,
  listConfigSets,
  removeConfigSetFile,
  updateConfigSet
} from "./configSetService";

const databaseAvailable = await isTestDatabaseAvailable();

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      organizationName: "ChargeLab",
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["admin:access"]
    }),
    ...overrides
  };
}

function viewerAuth(): AuthContext {
  return adminAuth({
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions: ["parameter:view"]
  });
}

describe.skipIf(!databaseAvailable)("configSet service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [
        { id: "project-1", name: "Aurora", code: "AUR" },
        { id: "project-2", name: "Borealis", code: "BOR" }
      ]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedFile(fileId: string, fileName: string, projectId = "project-1") {
    return insertProjectParameterFile(db, {
      id: fileId,
      organizationId: "org-1",
      projectId,
      fileName,
      format: "dts"
    });
  }

  async function configSetAudits(action?: string) {
    const result = await db.query<{
      action: string;
      target_type: string | null;
      target_id: string | null;
      project_id: string | null;
      metadata: Record<string, unknown>;
    }>(
      `select action, target_type, target_id, project_id, metadata
       from audit_events
       where organization_id = $1 and kind = 'config-set'
       order by id asc`,
      ["org-1"]
    );
    return action ? result.rows.filter((row) => row.action === action) : result.rows;
  }

  describe("configSet service authorization", () => {
    it("createConfigSet rejects non-admin auth with 403", async () => {
      await expect(
        createConfigSet(db, viewerAuth(), { projectId: "project-1", name: "board-a" })
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

      const rows = await db.query<{ count: string }>(
        "select count(*)::text as count from dts_config_set where organization_id = $1",
        ["org-1"]
      );
      expect(rows.rows[0].count).toBe("0");
    });

    it("listConfigSets allows parameter viewers and keeps organization/project scope", async () => {
      const created = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await createConfigSet(db, adminAuth(), { projectId: "project-2", name: "board-x" });

      const items = await listConfigSets(db, viewerAuth(), "project-1");

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: created.id, projectId: "project-1", name: "board-a" });
    });
  });

  describe("createConfigSet", () => {
    it("creates a new config set and writes an audit event", async () => {
      const configSet = await createConfigSet(db, adminAuth(), {
        projectId: "project-1",
        name: "board-a"
      });

      expect(configSet.name).toBe("board-a");
      expect(configSet.projectId).toBe("project-1");
      expect((await listConfigSets(db, adminAuth(), "project-1")).map((item) => item.id)).toEqual([configSet.id]);

      const audits = await configSetAudits("created");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "created",
        target_type: "dts-config-set",
        target_id: configSet.id,
        project_id: "project-1"
      });
      expect(audits[0].metadata).toMatchObject({ name: "board-a" });
    });

    it("rejects a duplicate name within the same project with 409 conflict", async () => {
      await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });

      await expect(
        createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" })
      ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

      expect(await listConfigSets(db, adminAuth(), "project-1")).toHaveLength(1);
      expect(await configSetAudits("created")).toHaveLength(1);
    });

    it("persists derivedFromId for variant relationships", async () => {
      const base = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });

      const configSet = await createConfigSet(db, adminAuth(), {
        projectId: "project-1",
        name: "board-b",
        derivedFromId: base.id
      });

      expect(configSet.derivedFromId).toBe(base.id);
      const reloaded = (await listConfigSets(db, adminAuth(), "project-1")).find((item) => item.id === configSet.id);
      expect(reloaded?.derivedFromId).toBe(base.id);
    });
  });

  describe("listConfigSets", () => {
    it("lists config sets scoped to the project for admin auth", async () => {
      await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-b" });
      await createConfigSet(db, adminAuth(), { projectId: "project-2", name: "board-x" });

      const items = await listConfigSets(db, adminAuth(), "project-1");

      expect(items).toHaveLength(2);
      expect(items.map((item) => item.name).sort()).toEqual(["board-a", "board-b"]);
    });
  });

  describe("ensureDefaultConfigSet", () => {
    it("creates the implicit default config set when none exists", async () => {
      const configSet = await ensureDefaultConfigSet(db, adminAuth(), "project-1");

      expect(configSet.name).toBe("default");
      expect(configSet.projectId).toBe("project-1");

      const audits = await configSetAudits("created");
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata).toMatchObject({ name: "default", ensuredDefault: true });
    });

    it("is idempotent and returns the existing default config set without creating a duplicate", async () => {
      const first = await ensureDefaultConfigSet(db, adminAuth(), "project-1");

      const second = await ensureDefaultConfigSet(db, adminAuth(), "project-1");

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("default");
      expect(await listConfigSets(db, adminAuth(), "project-1")).toHaveLength(1);
      expect(await configSetAudits("created")).toHaveLength(1);
    });

    it("finds a migration-backfilled default config set by its deterministic id", async () => {
      // Migration 0043 backfilled defaults under 'dcs-default-<projectId>'; the service
      // interface cannot mint that deterministic id, so recreate the migration state directly.
      await db.query(
        `insert into dts_config_set (id, organization_id, project_id, name, description)
         values ('dcs-default-project-1', 'org-1', 'project-1', 'default', 'Auto-created default configuration set (backfill from 0043).')`
      );

      const configSet = await ensureDefaultConfigSet(db, adminAuth(), "project-1");

      expect(configSet.id).toBe("dcs-default-project-1");
      expect(configSet.name).toBe("default");
      expect(await configSetAudits()).toHaveLength(0);
    });
  });

  describe("addConfigSetFile", () => {
    it("adds a file to a config set with a role and writes a member_changed audit event", async () => {
      const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await seedFile("file-1", "board-a.dts");

      const membership = await addConfigSetFile(db, adminAuth(), {
        configSetId: configSet.id,
        fileId: "file-1",
        role: "base",
        sortOrder: 1
      });

      expect(membership).toEqual({ configSetId: configSet.id, fileId: "file-1", role: "base", sortOrder: 1 });

      const stored = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
      expect(stored).toMatchObject({
        fileId: "file-1",
        configSetId: configSet.id,
        configSetRole: "base",
        configSetSortOrder: 1
      });

      const audits = await configSetAudits("member_changed");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ target_id: configSet.id, target_type: "dts-config-set" });
      expect(audits[0].metadata).toMatchObject({ fileId: "file-1", role: "base", sortOrder: 1, change: "added" });
    });

    it("rejects adding a file already claimed by a different config set (409 conflict)", async () => {
      const first = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      const second = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-b" });
      await seedFile("file-1", "board-a.dts");
      await addConfigSetFile(db, adminAuth(), { configSetId: first.id, fileId: "file-1", role: "base" });

      await expect(
        addConfigSetFile(db, adminAuth(), { configSetId: second.id, fileId: "file-1", role: "overlay" })
      ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

      const stored = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
      expect(stored?.configSetId).toBe(first.id);
      expect(stored?.configSetRole).toBe("base");
    });

    it("allows re-adding a file already in the same config set (no-op conflict)", async () => {
      const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await seedFile("file-1", "board-a.dts");
      await addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: "file-1", role: "base", sortOrder: 1 });

      const membership = await addConfigSetFile(db, adminAuth(), {
        configSetId: configSet.id,
        fileId: "file-1",
        role: "overlay",
        sortOrder: 5
      });

      expect(membership.role).toBe("overlay");
      expect(membership.sortOrder).toBe(5);

      const stored = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
      expect(stored).toMatchObject({ configSetId: configSet.id, configSetRole: "overlay", configSetSortOrder: 5 });
    });

    it("returns 404 when the config set does not exist", async () => {
      await seedFile("file-1", "board-a.dts");

      await expect(
        addConfigSetFile(db, adminAuth(), { configSetId: "missing", fileId: "file-1", role: "base" })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });

    it("returns 404 when the file does not exist", async () => {
      const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });

      await expect(
        addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: "missing", role: "base" })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });

    it("rejects adding a file from a different project (400 validation)", async () => {
      const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await seedFile("file-1", "board-x.dts", "project-2");

      await expect(
        addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: "file-1", role: "base" })
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });

      const stored = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
      expect(stored?.configSetId).toBeUndefined();
    });
  });

  describe("removeConfigSetFile", () => {
    it("removes a file from a config set and writes an audit event", async () => {
      const configSet = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await seedFile("file-1", "board-a.dts");
      await addConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: "file-1", role: "base" });

      await removeConfigSetFile(db, adminAuth(), { configSetId: configSet.id, fileId: "file-1" });

      const stored = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
      expect(stored).toMatchObject({
        fileId: "file-1",
        configSetId: undefined,
        configSetRole: undefined,
        configSetSortOrder: 0
      });

      // created_at is frozen in the rollback transaction and ids are random UUIDs,
      // so pick the removal event by its metadata rather than by ordering.
      const audits = await configSetAudits("member_changed");
      expect(audits).toHaveLength(2);
      const removed = audits.find((row) => (row.metadata as { change?: string }).change === "removed");
      expect(removed?.metadata).toMatchObject({ fileId: "file-1", previousRole: "base", change: "removed" });
    });

    it("returns 404 when the file is not a member of the given config set", async () => {
      const owner = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-other" });
      const target = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await seedFile("file-1", "board-a.dts");
      await addConfigSetFile(db, adminAuth(), { configSetId: owner.id, fileId: "file-1", role: "base" });

      await expect(
        removeConfigSetFile(db, adminAuth(), { configSetId: target.id, fileId: "file-1" })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

      const stored = await getFileConfigSetMembership(db, { organizationId: "org-1", fileId: "file-1" });
      expect(stored?.configSetId).toBe(owner.id);
    });
  });

  describe("updateConfigSet", () => {
    it("updates description and writes an audit event", async () => {
      const created = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });

      const configSet = await updateConfigSet(db, adminAuth(), {
        configSetId: created.id,
        description: "updated"
      });

      expect(configSet.description).toBe("updated");
      expect(configSet.name).toBe("board-a");

      const audits = await configSetAudits("updated");
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ target_id: created.id });
      expect(audits[0].metadata).toMatchObject({ description: "updated" });
    });

    it("persists and reads back derivedFromId when set via update", async () => {
      const base = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-base" });
      const created = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });

      const configSet = await updateConfigSet(db, adminAuth(), {
        configSetId: created.id,
        derivedFromId: base.id
      });

      expect(configSet.derivedFromId).toBe(base.id);
      const reloaded = (await listConfigSets(db, adminAuth(), "project-1")).find((item) => item.id === created.id);
      expect(reloaded?.derivedFromId).toBe(base.id);
    });

    it("returns 404 when the config set does not exist", async () => {
      await expect(
        updateConfigSet(db, adminAuth(), { configSetId: "missing", description: "x" })
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });

    it("rejects renaming to a name already used in the project (409 conflict)", async () => {
      const boardA = await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" });
      await createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-b" });

      await expect(
        updateConfigSet(db, adminAuth(), { configSetId: boardA.id, name: "board-b" })
      ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

      const reloaded = (await listConfigSets(db, adminAuth(), "project-1")).find((item) => item.id === boardA.id);
      expect(reloaded?.name).toBe("board-a");
    });
  });
});
