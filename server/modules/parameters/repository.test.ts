import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  getParameterById,
  listParameterHistory,
  listParameters,
  listProjects
} from "./repository";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createFakeDb(rows: unknown[] = []) {
  const calls: QueryCall[] = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      calls.push({ text, values });
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };

  return { db, calls };
}

describe("parameter repository", () => {
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

  it("listParameters accepts project, module, risk, query, and limit filters", async () => {
    const updatedAt = new Date("2026-05-25T02:00:00.000Z");
    const { db, calls } = createFakeDb([
      {
        id: "aurora-fast-charge-current",
        project_id: "aurora",
        name: "fast_charge_current_limit_ma",
        description: "Limit fast charge current.",
        explanation: "Controls fast charging current.",
        config_format: "ENV: FAST_CHARGE_CURRENT=number",
        module: "Charging Policy",
        default_range: "1000 - 5000",
        unit: "mA",
        risk: "High",
        current_value: "3200",
        recommended_value: "3000",
        updated_at: updatedAt
      }
    ]);

    const rows = await listParameters(db, {
      organizationId: "org-chargelab",
      projectId: "aurora",
      module: "Charging Policy",
      risk: ["High", "Medium"],
      q: "fast charge",
      limit: 25
    });

    expect(calls[0].text).toContain("ppv.project_id = $2");
    expect(calls[0].text).toContain("pd.module = $3");
    expect(calls[0].text).toContain("pd.risk = any($4::text[])");
    expect(calls[0].text).toContain("pd.name ilike $5");
    expect(calls[0].text).toContain("limit $6");
    expect(calls[0].values).toEqual([
      "org-chargelab",
      "aurora",
      "Charging Policy",
      ["High", "Medium"],
      "%fast charge%",
      25
    ]);
    expect(rows[0]).toMatchObject({
      id: "aurora-fast-charge-current",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      currentValue: "3200",
      recommendedValue: "3000",
      risk: "High",
      updatedAt: "2026-05-25T02:00:00.000Z",
      updatedAtTs: "2026-05-25T02:00:00.000Z",
      history: []
    });
  });

  it("getParameterById returns null when no rows match", async () => {
    const { db, calls } = createFakeDb([]);

    const row = await getParameterById(db, {
      organizationId: "org-chargelab",
      parameterId: "missing"
    });

    expect(calls[0].text).toContain("ppv.id = $2");
    expect(calls[0].values).toEqual(["org-chargelab", "missing"]);
    expect(row).toBeNull();
  });

  it("listParameterHistory orders entries by changed time descending", async () => {
    const { db, calls } = createFakeDb([
      {
        version: 2,
        value: "3300",
        changed_at: "2026-05-25T04:00:00.000Z",
        changed_by: "Xu Yun",
        request_id: "req-1"
      },
      {
        version: 1,
        value: "3200",
        changed_at: "2026-05-25T01:00:00.000Z",
        changed_by: null,
        request_id: null
      }
    ]);

    const rows = await listParameterHistory(db, {
      organizationId: "org-chargelab",
      parameterId: "aurora-fast-charge-current"
    });

    expect(calls[0].text).toContain("from parameter_history_entries phe");
    expect(calls[0].text).toContain("ppv.id = $2");
    expect(calls[0].text).toContain("order by phe.changed_at desc");
    expect(calls[0].values).toEqual(["org-chargelab", "aurora-fast-charge-current"]);
    expect(rows).toEqual([
      {
        version: "2",
        value: "3300",
        changedAt: "2026-05-25T04:00:00.000Z",
        changedBy: "Xu Yun",
        requestId: "req-1"
      },
      {
        version: "1",
        value: "3200",
        changedAt: "2026-05-25T01:00:00.000Z",
        changedBy: "",
        requestId: undefined
      }
    ]);
  });
});
