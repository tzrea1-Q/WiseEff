import { describe, expect, it } from "vitest";

import {
  applyResidueForDeployTerminal,
  clearDeviceResidue,
  getDeviceResidue,
  parametersFromTargets,
  residueActionForTerminal,
  upsertDeviceResidue
} from "./residue";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";

type QueryCall = { text: string; values: unknown[] };

function createResidueDb(seed: {
  residue?: Record<string, unknown> | null;
} = {}) {
  const calls: QueryCall[] = [];
  let residue = seed.residue ?? null;

  const runQuery = async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    calls.push({ text, values });
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.includes("insert into dts_reload_device_residue")) {
      residue = {
        organization_id: values[0],
        device_id: values[1],
        project_id: values[2],
        source_run_id: values[3],
        parameters: JSON.parse(String(values[4])),
        recorded_at: values[5]
      };
      return { rows: [residue] as Row[], rowCount: 1 };
    }

    if (normalized.includes("delete from dts_reload_device_residue")) {
      const had = residue !== null;
      residue = null;
      return { rows: [] as Row[], rowCount: had ? 1 : 0 };
    }

    if (normalized.includes("from dts_reload_device_residue")) {
      return {
        rows: (residue ? [residue] : []) as Row[],
        rowCount: residue ? 1 : 0
      };
    }

    return { rows: [] as Row[], rowCount: 0 };
  };

  const db: Database = {
    query: (text, values = []) => runQuery(text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) =>
      fn({ query: (text, values = []) => runQuery(text, values) })
  };

  return {
    db,
    calls,
    getResidue: () => residue
  };
}

describe("residueActionForTerminal", () => {
  it("sets residue for ordinary post-device-write terminals", () => {
    expect(residueActionForTerminal({ purpose: "ordinary", status: "unverifiable" })).toBe("set");
    expect(residueActionForTerminal({ purpose: "ordinary", status: "verified" })).toBe("set");
    expect(residueActionForTerminal({ purpose: "ordinary", status: "contradicted" })).toBe("set");
  });

  it("clears residue for restore-baseline post-device-write terminals", () => {
    expect(residueActionForTerminal({ purpose: "restore-baseline", status: "unverifiable" })).toBe("clear");
    expect(residueActionForTerminal({ purpose: "restore-baseline", status: "verified" })).toBe("clear");
    expect(residueActionForTerminal({ purpose: "restore-baseline", status: "contradicted" })).toBe("clear");
  });

  it("does not mutate residue for blocked or failed-before-write terminals", () => {
    expect(residueActionForTerminal({ purpose: "ordinary", status: "blocked" })).toBe("none");
    expect(residueActionForTerminal({ purpose: "ordinary", status: "failed" })).toBe("none");
    expect(residueActionForTerminal({ purpose: "ordinary", status: "validated" })).toBe("none");
    expect(residueActionForTerminal({ purpose: "restore-baseline", status: "failed" })).toBe("none");
  });
});

describe("dts-reload residue persistence", () => {
  it("upserts residue naming the source run and parameters", async () => {
    const { db, getResidue } = createResidueDb();
    const dto = await upsertDeviceResidue(db, {
      organizationId: "org-1",
      deviceId: "bridge:lab-1",
      projectId: "project-1",
      sourceRunId: "run-debug-1",
      parameters: parametersFromTargets([
        {
          bindingId: "binding-1",
          propertyKey: "watchdog_time",
          nodePath: "/amba/i2c@1/dev@6E",
          baselineValue: "<6000>",
          debugValue: "<7000>"
        }
      ]),
      recordedAt: "2026-08-10T12:00:00.000Z"
    });

    expect(dto).toEqual({
      deviceId: "bridge:lab-1",
      projectId: "project-1",
      sourceRunId: "run-debug-1",
      parameters: [
        {
          bindingId: "binding-1",
          propertyKey: "watchdog_time",
          nodePath: "/amba/i2c@1/dev@6E",
          baselineValue: "<6000>",
          debugValue: "<7000>"
        }
      ],
      recordedAt: "2026-08-10T12:00:00.000Z"
    });
    expect(getResidue()?.source_run_id).toBe("run-debug-1");

    const loaded = await getDeviceResidue(db, {
      organizationId: "org-1",
      deviceId: "bridge:lab-1"
    });
    expect(loaded?.sourceRunId).toBe("run-debug-1");
  });

  it("applyResidueForDeployTerminal sets on ordinary success and clears on restore success", async () => {
    const { db, getResidue } = createResidueDb();
    const targets = [
      {
        bindingId: "binding-1",
        propertyKey: "watchdog_time",
        nodePath: "/amba/i2c@1/dev@6E",
        baselineValue: "<6000>",
        debugValue: "<7000>"
      }
    ];

    expect(
      await applyResidueForDeployTerminal(db, {
        organizationId: "org-1",
        deviceId: "dev-1",
        projectId: "project-1",
        runId: "run-ordinary",
        purpose: "ordinary",
        status: "verified",
        targets
      })
    ).toBe("set");
    expect(getResidue()?.source_run_id).toBe("run-ordinary");

    expect(
      await applyResidueForDeployTerminal(db, {
        organizationId: "org-1",
        deviceId: "dev-1",
        projectId: "project-1",
        runId: "run-restore",
        purpose: "restore-baseline",
        status: "failed",
        targets: targets.map((t) => ({ ...t, debugValue: t.baselineValue! }))
      })
    ).toBe("none");
    expect(getResidue()?.source_run_id).toBe("run-ordinary");

    expect(
      await applyResidueForDeployTerminal(db, {
        organizationId: "org-1",
        deviceId: "dev-1",
        projectId: "project-1",
        runId: "run-restore",
        purpose: "restore-baseline",
        status: "unverifiable",
        targets: targets.map((t) => ({ ...t, debugValue: t.baselineValue! }))
      })
    ).toBe("clear");
    expect(getResidue()).toBeNull();
    expect(await clearDeviceResidue(db, { organizationId: "org-1", deviceId: "dev-1" })).toBe(false);
  });
});
