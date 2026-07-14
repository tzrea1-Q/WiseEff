import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  addConfigSetFile,
  createConfigSet,
  ensureDefaultConfigSet,
  listConfigSets,
  removeConfigSetFile,
  updateConfigSet
} from "./configSetService";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const txCalls: QueryCall[] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery(txCalls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => fn(tx)
  };

  return { db, txCalls };
}

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
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
    permissions: ["admin:access"],
    ...overrides
  };
}

function viewerAuth(): AuthContext {
  return adminAuth({ roles: [{ projectId: null, roleId: "hardware-user" }], permissions: ["parameter:view"] });
}

function configSetRow(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-07-14T09:00:00.000Z";
  return {
    id: "dcs-1",
    organization_id: "org-1",
    project_id: "project-1",
    name: "board-a",
    description: null,
    derived_from_id: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides
  };
}

function fileMembershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    organization_id: "org-1",
    project_id: "project-1",
    config_set_id: null,
    config_set_role: null,
    config_set_sort_order: 0,
    ...overrides
  };
}

describe("configSet service authorization", () => {
  it("createConfigSet rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(
      createConfigSet(db, viewerAuth(), { projectId: "project-1", name: "board-a" })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("listConfigSets rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(listConfigSets(db, viewerAuth(), "project-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });
});

describe("createConfigSet", () => {
  it("creates a new config set and writes an audit event", async () => {
    const { db, txCalls } = createFakeDb([[], [configSetRow()], []]);

    const configSet = await createConfigSet(db, adminAuth(), {
      projectId: "project-1",
      name: "board-a"
    });

    expect(configSet.id).toBe("dcs-1");
    expect(configSet.name).toBe("board-a");
    expect(txCalls.find((call) => call.text.includes("insert into dts_config_set"))).toBeTruthy();
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values[6]).toBe("config-set");
    expect(auditCall?.values[7]).toBe("created");
    expect(auditCall?.values[10]).toBe("dcs-1");
  });

  it("rejects a duplicate name within the same project with 409 conflict", async () => {
    const { db, txCalls } = createFakeDb([[configSetRow({ name: "board-a" })]]);

    await expect(
      createConfigSet(db, adminAuth(), { projectId: "project-1", name: "board-a" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(txCalls.find((call) => call.text.includes("insert into dts_config_set"))).toBeFalsy();
  });

  it("persists derivedFromId for variant relationships", async () => {
    const { db, txCalls } = createFakeDb([
      [],
      [configSetRow({ id: "dcs-2", name: "board-b", derived_from_id: "dcs-1" })],
      []
    ]);

    const configSet = await createConfigSet(db, adminAuth(), {
      projectId: "project-1",
      name: "board-b",
      derivedFromId: "dcs-1"
    });

    expect(configSet.derivedFromId).toBe("dcs-1");
    const insertCall = txCalls.find((call) => call.text.includes("insert into dts_config_set"));
    expect(insertCall?.values).toContain("dcs-1");
  });
});

describe("listConfigSets", () => {
  it("lists config sets scoped to the project for admin auth", async () => {
    const { db, txCalls } = createFakeDb([[configSetRow(), configSetRow({ id: "dcs-2", name: "board-b" })]]);

    const items = await listConfigSets(db, adminAuth(), "project-1");

    expect(items).toHaveLength(2);
    expect(txCalls[0].text).toContain("from dts_config_set");
    expect(txCalls[0].values).toEqual(["org-1", "project-1"]);
  });
});

describe("ensureDefaultConfigSet", () => {
  it("creates the implicit default config set when none exists", async () => {
    const { db, txCalls } = createFakeDb([[], [configSetRow({ name: "default" })], []]);

    const configSet = await ensureDefaultConfigSet(db, adminAuth(), "project-1");

    expect(configSet.name).toBe("default");
    expect(txCalls.find((call) => call.text.includes("insert into dts_config_set"))).toBeTruthy();
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))).toBeTruthy();
  });

  it("is idempotent and returns the existing default config set without creating a duplicate", async () => {
    const { db, txCalls } = createFakeDb([[configSetRow({ id: "dcs-default-project-1", name: "default" })]]);

    const configSet = await ensureDefaultConfigSet(db, adminAuth(), "project-1");

    expect(configSet.id).toBe("dcs-default-project-1");
    expect(configSet.name).toBe("default");
    expect(txCalls.find((call) => call.text.includes("insert into dts_config_set"))).toBeFalsy();
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))).toBeFalsy();
  });

  it("finds a migration-backfilled default config set by its deterministic id", async () => {
    const { db, txCalls } = createFakeDb([[configSetRow({ id: "dcs-default-project-1", name: "default" })]]);

    const configSet = await ensureDefaultConfigSet(db, adminAuth(), "project-1");

    expect(configSet.id).toBe("dcs-default-project-1");
    expect(txCalls[0].values).toEqual(["org-1", "project-1", "default"]);
  });
});

describe("addConfigSetFile", () => {
  it("adds a file to a config set with a role and writes a member_changed audit event", async () => {
    const { db, txCalls } = createFakeDb([[configSetRow()], [fileMembershipRow()], [], []]);

    const membership = await addConfigSetFile(db, adminAuth(), {
      configSetId: "dcs-1",
      fileId: "file-1",
      role: "base",
      sortOrder: 1
    });

    expect(membership).toEqual({ configSetId: "dcs-1", fileId: "file-1", role: "base", sortOrder: 1 });
    const updateCall = txCalls.find((call) => call.text.includes("update project_parameter_files"));
    expect(updateCall?.values).toEqual(["file-1", "dcs-1", "base", 1]);
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values[6]).toBe("config-set");
    expect(auditCall?.values[7]).toBe("member_changed");
    expect(auditCall?.values[10]).toBe("dcs-1");
  });

  it("rejects adding a file already claimed by a different config set (409 conflict)", async () => {
    const { db, txCalls } = createFakeDb([
      [configSetRow({ id: "dcs-2", name: "board-b" })],
      [fileMembershipRow({ config_set_id: "dcs-1", config_set_role: "base" })]
    ]);

    await expect(
      addConfigSetFile(db, adminAuth(), { configSetId: "dcs-2", fileId: "file-1", role: "overlay" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(txCalls.find((call) => call.text.includes("update project_parameter_files"))).toBeFalsy();
  });

  it("allows re-adding a file already in the same config set (no-op conflict)", async () => {
    const { db } = createFakeDb([
      [configSetRow()],
      [fileMembershipRow({ config_set_id: "dcs-1", config_set_role: "base", config_set_sort_order: 1 })],
      [],
      []
    ]);

    const membership = await addConfigSetFile(db, adminAuth(), {
      configSetId: "dcs-1",
      fileId: "file-1",
      role: "overlay",
      sortOrder: 5
    });

    expect(membership.role).toBe("overlay");
    expect(membership.sortOrder).toBe(5);
  });

  it("returns 404 when the config set does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      addConfigSetFile(db, adminAuth(), { configSetId: "missing", fileId: "file-1", role: "base" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("returns 404 when the file does not exist", async () => {
    const { db } = createFakeDb([[configSetRow()], []]);

    await expect(
      addConfigSetFile(db, adminAuth(), { configSetId: "dcs-1", fileId: "missing", role: "base" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects adding a file from a different project (400 validation)", async () => {
    const { db } = createFakeDb([
      [configSetRow({ project_id: "project-1" })],
      [fileMembershipRow({ project_id: "project-2" })]
    ]);

    await expect(
      addConfigSetFile(db, adminAuth(), { configSetId: "dcs-1", fileId: "file-1", role: "base" })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });
});

describe("removeConfigSetFile", () => {
  it("removes a file from a config set and writes an audit event", async () => {
    const { db, txCalls } = createFakeDb([
      [fileMembershipRow({ config_set_id: "dcs-1", config_set_role: "base" })],
      [],
      []
    ]);

    await removeConfigSetFile(db, adminAuth(), { configSetId: "dcs-1", fileId: "file-1" });

    const clearCall = txCalls.find((call) => call.text.includes("update project_parameter_files"));
    expect(clearCall?.text).toContain("config_set_id = null");
    expect(clearCall?.values).toEqual(["file-1"]);
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values[7]).toBe("member_changed");
  });

  it("returns 404 when the file is not a member of the given config set", async () => {
    const { db } = createFakeDb([[fileMembershipRow({ config_set_id: "dcs-other" })]]);

    await expect(
      removeConfigSetFile(db, adminAuth(), { configSetId: "dcs-1", fileId: "file-1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("updateConfigSet", () => {
  it("updates description and writes an audit event", async () => {
    const { db, txCalls } = createFakeDb([
      [configSetRow()],
      [configSetRow({ description: "updated" })],
      []
    ]);

    const configSet = await updateConfigSet(db, adminAuth(), {
      configSetId: "dcs-1",
      description: "updated"
    });

    expect(configSet.description).toBe("updated");
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values[7]).toBe("updated");
  });

  it("persists and reads back derivedFromId when set via update", async () => {
    const { db } = createFakeDb([
      [configSetRow()],
      [configSetRow({ derived_from_id: "dcs-0" })],
      []
    ]);

    const configSet = await updateConfigSet(db, adminAuth(), {
      configSetId: "dcs-1",
      derivedFromId: "dcs-0"
    });

    expect(configSet.derivedFromId).toBe("dcs-0");
  });

  it("returns 404 when the config set does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      updateConfigSet(db, adminAuth(), { configSetId: "missing", description: "x" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects renaming to a name already used in the project (409 conflict)", async () => {
    const { db, txCalls } = createFakeDb([
      [configSetRow({ id: "dcs-1", name: "board-a" })],
      [configSetRow({ id: "dcs-2", name: "board-b" })]
    ]);

    await expect(
      updateConfigSet(db, adminAuth(), { configSetId: "dcs-1", name: "board-b" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(txCalls.find((call) => call.text.includes("update dts_config_set"))).toBeFalsy();
  });
});
