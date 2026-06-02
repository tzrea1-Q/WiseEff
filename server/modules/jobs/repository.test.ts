import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { claimJobById, claimNextJob, completeJob, failJob, markJobDeadLettered, markJobRetryScheduled, updateJobProgress } from "./repository";

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
  it("only claims queued jobs whose next run time is due", async () => {
    const { db, calls } = createFakeDb(0);

    const claimed = await claimNextJob(db, { kind: "log-analysis", leaseOwner: "worker-a", leaseTtlMs: 30000 });

    expect(claimed).toBeNull();
    expect(calls[0].text).toContain("(next_run_at is null or next_run_at <= now())");
    expect(calls[0].values).toEqual(["log-analysis", "worker-a", 30000]);
  });

  it("claims a specific queue-delivered job with the same lease guard as polling", async () => {
    const { db, calls } = createFakeDb(0);

    const claimed = await claimJobById(db, {
      kind: "log-analysis",
      jobId: "job-from-queue",
      leaseOwner: "worker-a",
      leaseTtlMs: 30000
    });

    expect(claimed).toBeNull();
    expect(calls[0].text).toContain("and id = $4");
    expect(calls[0].text).toContain("(next_run_at is null or next_run_at <= now())");
    expect(calls[0].text).toContain("for update skip locked");
    expect(calls[0].values).toEqual(["log-analysis", "worker-a", 30000, "job-from-queue"]);
  });

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
    expect(calls[1].text).toContain("lease_owner = null");
    expect(calls[1].text).toContain("lease_expires_at = null");
    expect(calls[1].values).toEqual(["org-1", "job-2", "parser failed", "parse", "worker-b"]);
  });

  it("schedules retries by requeueing, clearing lease, and storing next run metadata", async () => {
    const { db, calls } = createFakeDb(1);

    await expect(
      markJobRetryScheduled(db, {
        organizationId: "org-1",
        jobId: "job-1",
        currentStage: "parse",
        error: "object store timeout",
        reason: "Retry 2 of 4 after 2000ms.",
        nextRunAt: "2026-05-28T00:00:02.000Z",
        leaseOwner: "worker-a"
      })
    ).resolves.toBe(true);

    expect(calls[0].text).toContain("set status = 'queued'");
    expect(calls[0].text).toContain("lease_owner = null");
    expect(calls[0].text).toContain("lease_expires_at = null");
    expect(calls[0].text).toContain("next_run_at = $5");
    expect(calls[0].text).toContain("dead_letter_reason = $6");
    expect(calls[0].text).toContain("and lease_owner = $7");
    expect(calls[0].values).toEqual([
      "org-1",
      "job-1",
      "object store timeout",
      "parse",
      "2026-05-28T00:00:02.000Z",
      "Retry 2 of 4 after 2000ms.",
      "worker-a"
    ]);
  });

  it("dead-letters jobs by failing, clearing lease, and storing dead-letter metadata", async () => {
    const { db, calls } = createFakeDb(1);

    await expect(
      markJobDeadLettered(db, {
        organizationId: "org-1",
        jobId: "job-1",
        currentStage: "parse",
        error: "parser failed",
        reason: "Job exhausted 4 attempts.",
        leaseOwner: "worker-a"
      })
    ).resolves.toBe(true);

    expect(calls[0].text).toContain("set status = 'failed'");
    expect(calls[0].text).toContain("lease_owner = null");
    expect(calls[0].text).toContain("lease_expires_at = null");
    expect(calls[0].text).toContain("dead_lettered_at = now()");
    expect(calls[0].text).toContain("dead_letter_reason = $5");
    expect(calls[0].text).toContain("and lease_owner = $6");
    expect(calls[0].values).toEqual(["org-1", "job-1", "parser failed", "parse", "Job exhausted 4 attempts.", "worker-a"]);
  });
});
