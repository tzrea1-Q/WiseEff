import { describe, expect, it } from "vitest";
import { seedM2Logs } from "../../scripts/seed-m2-logs";
import type { Database, QueryResult, Queryable } from "../shared/database/client";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createFakeDb() {
  const txCalls: QueryCall[] = [];
  const tx: Queryable = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      txCalls.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
  };
  const db: Database = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      txCalls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
    async transaction<T>(fn: (queryable: Queryable) => Promise<T>): Promise<T> {
      return fn(tx);
    }
  };

  return { db, txCalls };
}

describe("M2 log seed contract", () => {
  it("seeds completed jobs against log-analysis-run targets and does not seed unsupported jobs", async () => {
    const { db, txCalls } = createFakeDb();

    await seedM2Logs(db);

    const jobInserts = txCalls.filter((call) => call.text.includes("insert into jobs"));
    const completedJob = jobInserts.find((call) => call.values.includes("job-aurora-charging-foldback-unassociated"));

    expect(completedJob?.text).toContain("'log-analysis-run'");
    expect(completedJob?.values).toContain("run-aurora-charging-foldback-unassociated");
    expect(jobInserts.some((call) => call.values.includes("job-aurora-unsupported"))).toBe(false);
    const completedLog = txCalls.find((call) => call.text.includes("insert into log_records") && call.values.includes("log-aurora-charging-foldback-unassociated"));
    expect(completedLog?.text).toContain("related_parameter_id");
    expect(completedLog?.text).toContain("related_parameter_project_id = null");
    expect(completedLog?.values[5]).toBeNull();
  });
});
