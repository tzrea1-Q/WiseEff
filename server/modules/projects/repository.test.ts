import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  deleteProject,
  getProjectById,
  listProjects
} from "./repository";

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
      // Cutover probes must not consume the test SQL queue.
      if (text.includes("parameter_identity_cutovers")) {
        return { rows: [{ c: "0" } as Row], rowCount: 1 };
      }
      if (text.includes("information_schema.tables") && text.includes("parameter_definitions")) {
        return { rows: [{ c: "1" } as Row], rowCount: 1 };
      }
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

describe("project repository", () => {
  it("listProjects filters by organization", async () => {
    const { db, calls } = createFakeDb([
      { id: "aurora", name: "Aurora", code: "AUR" },
      { id: "zephyr", name: "Zephyr", code: "ZEP" }
    ]);

    const rows = await listProjects(db, { organizationId: "org-chargelab" });

    expect(calls[0].text).toContain("from projects");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].values).toEqual(["org-chargelab"]);
    expect(rows).toEqual([
      { id: "aurora", name: "Aurora", code: "AUR" },
      { id: "zephyr", name: "Zephyr", code: "ZEP" }
    ]);
  });

  it("getProjectById scopes project ownership to organization", async () => {
    const { db, calls } = createFakeDb([[{ id: "aurora", name: "Aurora", code: "AUR" }]]);

    const row = await getProjectById(db, { organizationId: "org-chargelab", projectId: "aurora" });

    expect(calls[0].text).toContain("from projects");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].values).toEqual(["org-chargelab", "aurora"]);
    expect(row).toEqual({ id: "aurora", name: "Aurora", code: "AUR" });
  });

  it("deleteProject cascades parameter data and removes the project", async () => {
    const { db, calls } = createFakeDb([
      [{ id: "aurora" }],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [{ id: "aurora" }]
    ]);

    const deleted = await deleteProject(db, { organizationId: "org-chargelab", projectId: "aurora" });

    expect(deleted).toEqual({ deleted: true });
    expect(calls.some((call) => call.text.includes("delete from parameter_review_decisions"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from project_parameter_values"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from project_modules"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from projects"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from parameter_definitions"))).toBe(false);

    const { db: missingDb } = createFakeDb([[]]);
    const missing = await deleteProject(missingDb, { organizationId: "org-chargelab", projectId: "missing" });
    expect(missing).toEqual({ deleted: false, reason: "not_found" });
  });
});
