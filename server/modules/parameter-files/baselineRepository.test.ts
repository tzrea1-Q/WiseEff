import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  getReleaseBaselineByConfigSetAndName,
  getReleaseBaselineById,
  insertReleaseBaseline,
  insertReleaseBaselineMember,
  listConfigSetMemberFiles,
  listReleaseBaselineMembers,
  listReleaseBaselinesByConfigSet
} from "./baselineRepository";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = Record<string, unknown> | unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(rowsOrQueue: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const queueMode = rowsOrQueue.some((item) => typeof item === "function" || Array.isArray(item));
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      calls.push(call);
      if (queueMode) {
        const next = rowsOrQueue.shift() ?? [];
        const rows = typeof next === "function" ? next(call) : Array.isArray(next) ? next : [next];
        return { rows: rows as Row[], rowCount: rows.length };
      }

      const rows = rowsOrQueue as unknown[];
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };

  return { db, calls };
}

function baselineRow(overrides: Record<string, unknown> = {}) {
  const timestamp = new Date("2026-07-14T09:00:00.000Z");
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

describe("baseline repository", () => {
  it("insertReleaseBaseline inserts and maps a baseline row", async () => {
    const { db, calls } = createFakeDb([baselineRow()]);

    const baseline = await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0",
      createdByUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into dts_release_baseline");
    expect(calls[0].values).toEqual(["baseline-1", "org-1", "dcs-1", "release-1.0", null, "user-1"]);
    expect(baseline).toEqual({
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0",
      status: "draft",
      createdBy: "user-1",
      createdAt: "2026-07-14T09:00:00.000Z"
    });
  });

  it("insertReleaseBaseline persists notes", async () => {
    const { db, calls } = createFakeDb([baselineRow({ notes: "pre-release snapshot" })]);

    const baseline = await insertReleaseBaseline(db, {
      id: "baseline-1",
      organizationId: "org-1",
      configSetId: "dcs-1",
      name: "release-1.0",
      notes: "pre-release snapshot"
    });

    expect(calls[0].values).toEqual(["baseline-1", "org-1", "dcs-1", "release-1.0", "pre-release snapshot", null]);
    expect(baseline.notes).toBe("pre-release snapshot");
  });

  it("getReleaseBaselineByConfigSetAndName returns null when no row matches", async () => {
    const { db, calls } = createFakeDb([[]]);

    const baseline = await getReleaseBaselineByConfigSetAndName(db, { configSetId: "dcs-1", name: "missing" });

    expect(calls[0].text).toContain("from dts_release_baseline");
    expect(calls[0].values).toEqual(["dcs-1", "missing"]);
    expect(baseline).toBeNull();
  });

  it("getReleaseBaselineByConfigSetAndName finds an existing baseline by name", async () => {
    const { db } = createFakeDb([[baselineRow({ name: "release-1.0" })]]);

    const baseline = await getReleaseBaselineByConfigSetAndName(db, { configSetId: "dcs-1", name: "release-1.0" });

    expect(baseline?.name).toBe("release-1.0");
  });

  it("getReleaseBaselineById scopes lookup to organization", async () => {
    const { db, calls } = createFakeDb([[baselineRow()]]);

    const baseline = await getReleaseBaselineById(db, { organizationId: "org-1", baselineId: "baseline-1" });

    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].values).toEqual(["org-1", "baseline-1"]);
    expect(baseline?.id).toBe("baseline-1");
  });

  it("getReleaseBaselineById returns null when missing", async () => {
    const { db } = createFakeDb([[]]);

    const baseline = await getReleaseBaselineById(db, { organizationId: "org-1", baselineId: "missing" });

    expect(baseline).toBeNull();
  });

  it("listReleaseBaselinesByConfigSet scopes to the config set", async () => {
    const { db, calls } = createFakeDb([
      [baselineRow(), baselineRow({ id: "baseline-2", name: "release-1.1" })]
    ]);

    const baselines = await listReleaseBaselinesByConfigSet(db, { configSetId: "dcs-1" });

    expect(calls[0].text).toContain("from dts_release_baseline");
    expect(calls[0].values).toEqual(["dcs-1"]);
    expect(baselines).toHaveLength(2);
    expect(baselines[1].name).toBe("release-1.1");
  });

  it("insertReleaseBaselineMember inserts and maps a member row", async () => {
    const { db, calls } = createFakeDb([baselineMemberRow()]);

    const member = await insertReleaseBaselineMember(db, {
      id: "bm-1",
      baselineId: "baseline-1",
      fileId: "file-1",
      fileVersionId: "fv-1",
      versionNumber: 3
    });

    expect(calls[0].text).toContain("insert into dts_release_baseline_members");
    expect(calls[0].values).toEqual(["bm-1", "baseline-1", "file-1", "fv-1", 3]);
    expect(member).toEqual({
      baselineId: "baseline-1",
      fileId: "file-1",
      fileVersionId: "fv-1",
      versionNumber: 3
    });
  });

  it("listReleaseBaselineMembers lists all members pinned to a baseline", async () => {
    const { db, calls } = createFakeDb([
      [baselineMemberRow(), baselineMemberRow({ id: "bm-2", file_id: "file-2", version_number: 1 })]
    ]);

    const members = await listReleaseBaselineMembers(db, { baselineId: "baseline-1" });

    expect(calls[0].text).toContain("from dts_release_baseline_members");
    expect(calls[0].values).toEqual(["baseline-1"]);
    expect(members).toHaveLength(2);
    expect(members[1]).toEqual({
      baselineId: "baseline-1",
      fileId: "file-2",
      fileVersionId: "fv-1",
      versionNumber: 1
    });
  });

  it("listConfigSetMemberFiles joins current version info for each member file", async () => {
    const { db, calls } = createFakeDb([
      [
        { file_id: "file-1", file_name: "board-a.dts", current_version_id: "fv-1", version_number: 3 },
        { file_id: "file-2", file_name: "board-a.overlay.dts", current_version_id: "fv-9", version_number: 1 }
      ]
    ]);

    const members = await listConfigSetMemberFiles(db, "dcs-1");

    expect(calls[0].text).toContain("from project_parameter_files ppf");
    expect(calls[0].text).toContain("left join project_parameter_file_versions");
    expect(calls[0].values).toEqual(["dcs-1"]);
    expect(members).toEqual([
      { fileId: "file-1", fileName: "board-a.dts", currentVersionId: "fv-1", currentVersionNumber: 3 },
      { fileId: "file-2", fileName: "board-a.overlay.dts", currentVersionId: "fv-9", currentVersionNumber: 1 }
    ]);
  });

  it("listConfigSetMemberFiles reports members with no current version as undefined", async () => {
    const { db } = createFakeDb([
      [{ file_id: "file-1", file_name: "board-a.dts", current_version_id: null, version_number: null }]
    ]);

    const members = await listConfigSetMemberFiles(db, "dcs-1");

    expect(members).toEqual([
      { fileId: "file-1", fileName: "board-a.dts", currentVersionId: undefined, currentVersionNumber: undefined }
    ]);
  });
});
