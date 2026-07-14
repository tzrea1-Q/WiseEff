import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { createBaseline, getBaseline, listBaselines } from "./baselineService";

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

function memberFileRow(overrides: Record<string, unknown> = {}) {
  return {
    file_id: "file-1",
    file_name: "board-a.dts",
    current_version_id: "fv-1",
    version_number: 3,
    ...overrides
  };
}

function baselineRow(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-07-14T09:00:00.000Z";
  return {
    id: "baseline-1",
    organization_id: "org-1",
    config_set_id: "dcs-1",
    name: "release-1.0",
    notes: null,
    status: "draft",
    created_by_user_id: "user-1",
    created_at: timestamp,
    ...overrides
  };
}

function baselineMemberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bm-1",
    baseline_id: "baseline-1",
    file_id: "file-1",
    file_version_id: "fv-1",
    version_number: 3,
    ...overrides
  };
}

describe("baseline service authorization", () => {
  it("createBaseline rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(
      createBaseline(db, viewerAuth(), { configSetId: "dcs-1", name: "release-1.0" })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("listBaselines rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(listBaselines(db, viewerAuth(), "dcs-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("getBaseline rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(getBaseline(db, viewerAuth(), "baseline-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });
});

describe("createBaseline", () => {
  it("pins every member's current version into the baseline and writes an audit event", async () => {
    const { db, txCalls } = createFakeDb([
      [configSetRow()],
      [],
      [memberFileRow(), memberFileRow({ file_id: "file-2", file_name: "board-a.overlay.dts", version_number: 1 })],
      [baselineRow()],
      [baselineMemberRow()],
      [baselineMemberRow({ id: "bm-2", file_id: "file-2", version_number: 1 })],
      []
    ]);

    const baseline = await createBaseline(db, adminAuth(), {
      configSetId: "dcs-1",
      name: "release-1.0"
    });

    expect(baseline.id).toBe("baseline-1");
    expect(baseline.status).toBe("draft");

    const memberInserts = txCalls.filter((call) => call.text.includes("insert into dts_release_baseline_members"));
    expect(memberInserts).toHaveLength(2);
    expect(memberInserts[0].values).toEqual(expect.arrayContaining(["file-1", "fv-1", 3]));
    expect(memberInserts[1].values).toEqual(expect.arrayContaining(["file-2", "fv-1", 1]));

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values[6]).toBe("baseline");
    expect(auditCall?.values[7]).toBe("created");
    expect(auditCall?.values[9]).toBe("dts-release-baseline");
    expect(auditCall?.values[10]).toBe("baseline-1");
  });

  it("allows creating an empty baseline when the config set has no members", async () => {
    const { db, txCalls } = createFakeDb([[configSetRow()], [], [], [baselineRow()], []]);

    const baseline = await createBaseline(db, adminAuth(), {
      configSetId: "dcs-1",
      name: "release-1.0"
    });

    expect(baseline.id).toBe("baseline-1");
    expect(txCalls.find((call) => call.text.includes("insert into dts_release_baseline_members"))).toBeFalsy();
  });

  it("rejects with 409 conflict when a member file has no current version", async () => {
    const { db, txCalls } = createFakeDb([
      [configSetRow()],
      [],
      [memberFileRow({ current_version_id: null, version_number: null })]
    ]);

    await expect(
      createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(txCalls.find((call) => call.text.includes("insert into dts_release_baseline"))).toBeFalsy();
  });

  it("rejects a duplicate baseline name for the same config set with 409 conflict", async () => {
    const { db, txCalls } = createFakeDb([[configSetRow()], [baselineRow({ name: "release-1.0" })]]);

    await expect(
      createBaseline(db, adminAuth(), { configSetId: "dcs-1", name: "release-1.0" })
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(txCalls.find((call) => call.text.includes("insert into dts_release_baseline"))).toBeFalsy();
  });

  it("returns 404 when the config set does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      createBaseline(db, adminAuth(), { configSetId: "missing", name: "release-1.0" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("getBaseline", () => {
  it("returns a baseline with its pinned members", async () => {
    const { db } = createFakeDb([[baselineRow()], [baselineMemberRow()]]);

    const result = await getBaseline(db, adminAuth(), "baseline-1");

    expect(result.baseline.id).toBe("baseline-1");
    expect(result.members).toHaveLength(1);
    expect(result.members[0].versionNumber).toBe(3);
  });

  it("returns 404 when the baseline does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(getBaseline(db, adminAuth(), "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
  });
});

describe("listBaselines", () => {
  it("lists baselines scoped to the config set", async () => {
    const { db, txCalls } = createFakeDb([
      [baselineRow(), baselineRow({ id: "baseline-2", name: "release-1.1" })]
    ]);

    const baselines = await listBaselines(db, adminAuth(), "dcs-1");

    expect(baselines).toHaveLength(2);
    expect(txCalls[0].text).toContain("from dts_release_baseline");
    expect(txCalls[0].values).toEqual(["dcs-1"]);
  });
});
