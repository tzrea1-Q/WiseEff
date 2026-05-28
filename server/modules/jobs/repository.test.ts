import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { completeJob, failJob, updateJobProgress } from "./repository";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createFakeDb(rowCount: number | null = 1) {
  const calls: QueryCall[] = [];
  const db: Queryable = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), values });
      return { rows: [], rowCount };
    }
  };

  return { db, calls };
}

describe("jobs repository", () => {
  it("fences progress writes by active lease owner", async () => {
    const { db, calls } = createFakeDb(0);

    const updated = await updateJobProgress(db, {
      organizationId: "org-1",
      jobId: "job-1",
      progress: 40,
      currentStage: "pattern",
      leaseOwner: "worker-a"
    });

    expect(updated).toBe(false);
    expect(calls[0].text).toContain("and lease_owner = $5");
    expect(calls[0].text).toContain("and lease_expires_at > now()");
    expect(calls[0].values).toEqual(["org-1", "job-1", 40, "pattern", "worker-a"]);
  });

  it("fences terminal job writes by active lease owner", async () => {
    const { db, calls } = createFakeDb(1);

    await expect(
      completeJob(db, {
        organizationId: "org-1",
        jobId: "job-1",
        currentStage: "report",
        leaseOwner: "worker-a"
      })
    ).resolves.toBe(true);
    await expect(
      failJob(db, {
        organizationId: "org-1",
        jobId: "job-2",
        currentStage: "parse",
        error: "parser failed",
        leaseOwner: "worker-b"
      })
    ).resolves.toBe(true);

    expect(calls[0].text).toContain("and lease_owner = $4");
    expect(calls[0].text).toContain("and lease_expires_at > now()");
    expect(calls[0].values).toEqual(["org-1", "job-1", "report", "worker-a"]);
    expect(calls[1].text).toContain("and lease_owner = $5");
    expect(calls[1].text).toContain("and lease_expires_at > now()");
    expect(calls[1].values).toEqual(["org-1", "job-2", "parser failed", "parse", "worker-b"]);
  });
});
