import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { createStubDtcValidator } from "./dtcValidator";
import {
  compareBaseline,
  createBaseline,
  getBaseline,
  listBaselines,
  releaseBaseline,
  rollbackToBaseline
} from "./baselineService";

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

function fileRow(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-07-14T09:00:00.000Z";
  return {
    id: "file-1",
    organization_id: "org-1",
    project_id: "project-1",
    file_name: "board-a.dts",
    format: "dts",
    module_hint: null,
    current_version_id: "fv-1",
    enabled: true,
    created_at: timestamp,
    updated_at: timestamp,
    current_version_number: 3,
    ...overrides
  };
}

function fileVersionRow(overrides: Record<string, unknown> = {}) {
  const timestamp = "2026-07-14T09:00:00.000Z";
  return {
    id: "fv-1",
    file_id: "file-1",
    version_number: 1,
    storage_key: "sk-1",
    checksum: "checksum-1",
    size_bytes: 100,
    parsed_index: {},
    origin: "upload",
    created_by_user_id: null,
    created_at: timestamp,
    ...overrides
  };
}

function fakeObjectStore(contents: Record<string, string>): ObjectStore {
  return {
    put: async () => {
      throw new Error("not used in these tests");
    },
    get: async (storageKey: string) => {
      const content = contents[storageKey];
      if (content === undefined) {
        throw new Error(`no fake content for storage key ${storageKey}`);
      }
      return Buffer.from(content, "utf8");
    }
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

describe("compareBaseline", () => {
  it("rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(compareBaseline(db, viewerAuth(), "baseline-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("returns 404 when the baseline does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(compareBaseline(db, adminAuth(), "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
  });

  it("classifies members as unchanged, file_removed, and file_added", async () => {
    const { db, txCalls } = createFakeDb([
      [baselineRow()],
      [baselineMemberRow(), baselineMemberRow({ id: "bm-2", file_id: "file-2", file_version_id: "fv-2", version_number: 1 })],
      [
        memberFileRow(),
        memberFileRow({ file_id: "file-3", file_name: "board-a.charging.dts", current_version_id: "fv-3", version_number: 1 })
      ]
    ]);

    const result = await compareBaseline(db, adminAuth(), "baseline-1");

    expect(result.baselineId).toBe("baseline-1");
    expect(result.members).toEqual([
      {
        fileId: "file-1",
        fileName: "board-a.dts",
        status: "unchanged",
        baselineVersionId: "fv-1",
        currentVersionId: "fv-1"
      },
      {
        fileId: "file-2",
        status: "file_removed",
        baselineVersionId: "fv-2"
      },
      {
        fileId: "file-3",
        fileName: "board-a.charging.dts",
        status: "file_added",
        currentVersionId: "fv-3"
      }
    ]);
    expect(txCalls[0].text).toContain("from dts_release_baseline");
    expect(txCalls[1].text).toContain("from dts_release_baseline_members");
    expect(txCalls[2].text).toContain("from project_parameter_files ppf");
  });

  it("does not attempt a structural diff when no objectStore is injected", async () => {
    const { db } = createFakeDb([
      [baselineRow()],
      [baselineMemberRow()],
      [memberFileRow({ current_version_id: "fv-2", version_number: 2 })]
    ]);

    const result = await compareBaseline(db, adminAuth(), "baseline-1");

    expect(result.members).toEqual([
      {
        fileId: "file-1",
        fileName: "board-a.dts",
        status: "version_changed",
        baselineVersionId: "fv-1",
        currentVersionId: "fv-2"
      }
    ]);
  });

  it("computes a structural diff for a changed dts member using normalizedValue", async () => {
    const objectStore = fakeObjectStore({
      "sk-1": "&demo_integer {\n\tsingle_value = <42>;\n};\n",
      "sk-2": "&demo_integer {\n\tsingle_value = <43>;\n};\n"
    });

    const pinned = fileVersionRow({ id: "fv-1", storage_key: "sk-1" });
    const changed = fileVersionRow({ id: "fv-2", storage_key: "sk-2", version_number: 2 });
    const { db } = createFakeDb([
      [baselineRow()],
      [baselineMemberRow()],
      [memberFileRow({ current_version_id: "fv-2", version_number: 2 })],
      // storageKey equivalence check
      [pinned],
      [changed],
      // structural diff load
      [fileRow({ current_version_id: "fv-2", current_version_number: 2 })],
      [pinned],
      [changed]
    ]);

    const result = await compareBaseline(db, adminAuth(), "baseline-1", { objectStore });

    expect(result.members).toEqual([
      {
        fileId: "file-1",
        fileName: "board-a.dts",
        status: "version_changed",
        baselineVersionId: "fv-1",
        currentVersionId: "fv-2",
        structuralDiff: [
          { kind: "prop_changed", nodePath: "demo_integer", prop: "single_value", before: "<42>", after: "<43>" }
        ]
      }
    ]);
  });

  it("reports an empty structural diff when normalized content is equivalent despite a version bump", async () => {
    const objectStore = fakeObjectStore({
      "sk-1": "&demo_byte_array {\n\treg_config = /bits/ 8 <0x4B>;\n};\n",
      "sk-2": "&demo_byte_array {\n\treg_config = /bits/ 8 <0x4b>;\n};\n"
    });

    const pinned = fileVersionRow({ id: "fv-1", storage_key: "sk-1" });
    const rewritten = fileVersionRow({ id: "fv-2", storage_key: "sk-2", version_number: 2 });
    const { db } = createFakeDb([
      [baselineRow()],
      [baselineMemberRow()],
      [memberFileRow({ current_version_id: "fv-2", version_number: 2 })],
      [pinned],
      [rewritten],
      [fileRow({ current_version_id: "fv-2", current_version_number: 2 })],
      [pinned],
      [rewritten]
    ]);

    const result = await compareBaseline(db, adminAuth(), "baseline-1", { objectStore });

    expect(result.members[0].status).toBe("version_changed");
    expect(result.members[0].structuralDiff).toEqual([]);
  });

  it("treats a rollback pointer that reuses the baseline blob storageKey as unchanged", async () => {
    const { db } = createFakeDb([
      [baselineRow()],
      [baselineMemberRow({ file_version_id: "fv-1" })],
      [memberFileRow({ current_version_id: "fv-3-rollback", version_number: 3 })],
      [fileVersionRow({ id: "fv-1", storage_key: "sk-pinned", version_number: 1 })],
      [
        fileVersionRow({
          id: "fv-3-rollback",
          storage_key: "sk-pinned",
          version_number: 3,
          origin: "rollback"
        })
      ]
    ]);

    const result = await compareBaseline(db, adminAuth(), "baseline-1");

    expect(result.members).toEqual([
      {
        fileId: "file-1",
        fileName: "board-a.dts",
        status: "unchanged",
        baselineVersionId: "fv-1",
        currentVersionId: "fv-3-rollback"
      }
    ]);
  });
});

describe("rollbackToBaseline", () => {
  it("rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(rollbackToBaseline(db, viewerAuth(), "baseline-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("returns 404 when the baseline does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(rollbackToBaseline(db, adminAuth(), "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
  });

  it("skips members already pinned to the baseline version and restores drifted members atomically", async () => {
    const { db, txCalls } = createFakeDb([
      [baselineRow()],
      [configSetRow()],
      [
        baselineMemberRow(),
        baselineMemberRow({ id: "bm-2", file_id: "file-2", file_version_id: "fv-2", version_number: 1 })
      ],
      [fileRow()],
      [
        fileRow({
          id: "file-2",
          file_name: "board-a.overlay.dts",
          current_version_id: "fv-2-new",
          current_version_number: 2
        })
      ],
      [fileVersionRow({ id: "fv-2", file_id: "file-2", storage_key: "sk-2", checksum: "checksum-2", size_bytes: 55 })],
      [{ id: "fv-2-rollback", file_id: "file-2", version_number: 3, storage_key: "sk-2", checksum: "checksum-2", size_bytes: 55, parsed_index: {}, origin: "rollback", created_by_user_id: "user-1", created_at: "2026-07-14T09:00:00.000Z" }],
      [],
      []
    ]);

    const result = await rollbackToBaseline(db, adminAuth(), "baseline-1");

    expect(result).toEqual({ baselineId: "baseline-1", restored: 1 });

    const versionInserts = txCalls.filter((call) => call.text.includes("insert into project_parameter_file_versions"));
    expect(versionInserts).toHaveLength(1);
    expect(versionInserts[0].text).toContain("coalesce");
    expect(versionInserts[0].values).toEqual(
      expect.arrayContaining(["file-2", "sk-2", "checksum-2", 55, "{}", "rollback", "user-1"])
    );

    const currentVersionUpdates = txCalls.filter(
      (call) => call.text.includes("update project_parameter_files") && call.text.includes("current_version_id")
    );
    expect(currentVersionUpdates).toHaveLength(1);
    expect(currentVersionUpdates[0].values).toEqual(["file-2", "fv-2-rollback"]);

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeTruthy();
    expect(auditCall?.values[6]).toBe("baseline");
    expect(auditCall?.values[7]).toBe("rolled_back");
    expect(auditCall?.values[10]).toBe("baseline-1");
  });

  it("fails the whole rollback atomically when a pinned file no longer exists", async () => {
    const { db, txCalls } = createFakeDb([
      [baselineRow()],
      [configSetRow()],
      [baselineMemberRow(), baselineMemberRow({ id: "bm-2", file_id: "file-2", file_version_id: "fv-2", version_number: 1 })],
      [], // getProjectParameterFileById for file-1 returns no row: file was deleted entirely
    ]);

    await expect(rollbackToBaseline(db, adminAuth(), "baseline-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    expect(txCalls.find((call) => call.text.includes("insert into project_parameter_file_versions"))).toBeFalsy();
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))).toBeFalsy();
  });
});

describe("releaseBaseline", () => {
  it("rejects non-admin auth with 403", async () => {
    const { db } = createFakeDb();

    await expect(
      releaseBaseline(db, viewerAuth(), "baseline-1", { objectStore: fakeObjectStore({}) })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("returns 404 when the baseline does not exist", async () => {
    const { db } = createFakeDb([[]]);

    await expect(
      releaseBaseline(db, adminAuth(), "missing", { objectStore: fakeObjectStore({}) })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("blocks release when validation gate fails in block mode", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: false,
      mode: "block",
      compiler: "dtc",
      diagnostics: [{ file: "board-a.dts", severity: "error", message: "syntax error" }]
    }));

    const { db, txCalls } = createFakeDb([
      [baselineRow()],
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [fileVersionRow()],
      []
    ]);

    await expect(
      releaseBaseline(
        db,
        adminAuth(),
        "baseline-1",
        { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator },
        { requestId: "req-1" }
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: { code: "dts-validation-failed" }
    });

    expect(txCalls.find((call) => call.text.includes("update dts_release_baseline") && call.text.includes("released"))).toBeFalsy();

    const gateAudit = txCalls.find(
      (call) => call.text.includes("insert into audit_events") && call.values[6] === "validation.gate"
    );
    expect(gateAudit).toBeTruthy();
  });

  it("releases a draft baseline when validation passes and writes released audit", async () => {
    const validator = createStubDtcValidator(() => ({
      ok: true,
      mode: "block",
      compiler: "dtc",
      diagnostics: []
    }));

    const { db, txCalls } = createFakeDb([
      [baselineRow()],
      [configSetRow()],
      [memberFileRow()],
      [fileRow()],
      [fileVersionRow()],
      [],
      [configSetRow()],
      [baselineRow({ status: "released" })],
      []
    ]);

    const result = await releaseBaseline(
      db,
      adminAuth(),
      "baseline-1",
      { objectStore: fakeObjectStore({ "sk-1": "/dts-v1/; / { };" }), validator },
      { requestId: "req-1" }
    );

    expect(result.baseline.status).toBe("released");
    expect(result.gate.ok).toBe(true);
    expect(result.gate.requiresConfirmation).toBe(false);

    const statusUpdate = txCalls.find(
      (call) => call.text.includes("update dts_release_baseline") && call.text.includes("status")
    );
    expect(statusUpdate).toBeTruthy();
    expect(statusUpdate?.values).toEqual(expect.arrayContaining(["released", "baseline-1"]));

    const releasedAudit = txCalls.find(
      (call) =>
        call.text.includes("insert into audit_events") &&
        call.values[6] === "baseline" &&
        call.values[7] === "released"
    );
    expect(releasedAudit).toBeTruthy();
    expect(releasedAudit?.values[10]).toBe("baseline-1");
  });
});
