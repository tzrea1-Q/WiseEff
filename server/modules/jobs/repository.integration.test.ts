import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import {
  claimJobById,
  claimNextJob,
  completeJob,
  createLogAnalysisJob,
  failJob,
  getJobSnapshot,
  markJobDeadLettered,
  markJobRetryScheduled,
  updateJobProgress
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG = "org-jobs";
const WORKER_A = "worker-a";
const WORKER_B = "worker-b";

type JobStateRow = {
  status: string;
  progress: number;
  current_stage: string | null;
  error_message: string | null;
  lease_owner: string | null;
  next_run_at: string | Date | null;
  dead_letter_reason: string | null;
  dead_lettered_at: string | Date | null;
  attempt_count: number;
};

describe.skipIf(!databaseAvailable)("jobs repository (behavior)", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'Jobs Org')`, [ORG]);
  });

  afterEach(async () => {
    await db.rollback();
  });

  async function seedJob(id: string, overrides: { nextRunAt?: string; createdAt?: string } = {}) {
    const job = await createLogAnalysisJob(db, {
      id,
      organizationId: ORG,
      logId: `log-${id}`,
      runId: `run-${id}`
    });
    if (overrides.nextRunAt) {
      await db.query(`update jobs set next_run_at = $2 where id = $1`, [id, overrides.nextRunAt]);
    }
    if (overrides.createdAt) {
      await db.query(`update jobs set created_at = $2 where id = $1`, [id, overrides.createdAt]);
    }
    return job;
  }

  async function jobState(id: string): Promise<JobStateRow> {
    const result = await db.query<JobStateRow>(
      `select status, progress, current_stage, error_message, lease_owner,
              next_run_at, dead_letter_reason, dead_lettered_at, attempt_count
       from jobs where id = $1`,
      [id]
    );
    return result.rows[0]!;
  }

  it("creates a queued job and claims only due jobs in FIFO order", async () => {
    await seedJob("job-later", { createdAt: "2026-05-25T00:00:10Z" });
    await seedJob("job-earlier", { createdAt: "2026-05-25T00:00:00Z" });
    await seedJob("job-future", {
      createdAt: "2026-05-24T00:00:00Z",
      nextRunAt: "2999-01-01T00:00:00Z"
    });

    const first = await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A });
    // job-future is oldest but not due; FIFO falls to job-earlier.
    expect(first?.id).toBe("job-earlier");
    expect(first).toMatchObject({ status: "processing", leaseOwner: WORKER_A, attemptCount: 1 });
    expect(first?.leaseExpiresAt).not.toBeNull();

    const second = await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A });
    expect(second?.id).toBe("job-later");

    // Nothing else is due: the not-yet-due job stays unclaimed.
    expect(await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A })).toBeNull();
    expect((await jobState("job-future")).status).toBe("queued");
  });

  it("does not steal a live lease but reclaims an expired one, incrementing attempts", async () => {
    await seedJob("job-1");
    const claimed = await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A, leaseTtlMs: 60_000 });
    expect(claimed?.id).toBe("job-1");

    // Live lease: no job is claimable.
    expect(await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_B })).toBeNull();

    // Expired lease: the job is reclaimable by another worker.
    await db.query(`update jobs set lease_expires_at = now() - interval '1 second' where id = 'job-1'`);
    const reclaimed = await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_B });
    expect(reclaimed).toMatchObject({ id: "job-1", leaseOwner: WORKER_B, attemptCount: 2 });
  });

  it("claimJobById targets one job under the same lease guard as polling", async () => {
    await seedJob("job-a");
    await seedJob("job-b");

    const claimed = await claimJobById(db, { kind: "log-analysis", jobId: "job-b", leaseOwner: WORKER_A });
    expect(claimed?.id).toBe("job-b");
    expect((await jobState("job-a")).status).toBe("queued");

    // A live lease refuses a second claim of the same job.
    expect(await claimJobById(db, { kind: "log-analysis", jobId: "job-b", leaseOwner: WORKER_B })).toBeNull();
    expect((await jobState("job-b")).lease_owner).toBe(WORKER_A);
  });

  it("fences progress and completion writes by the active lease owner", async () => {
    await seedJob("job-1");
    await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A });

    // A non-owner cannot write progress.
    expect(
      await updateJobProgress(db, { organizationId: ORG, jobId: "job-1", progress: 40, currentStage: "extract", leaseOwner: WORKER_B })
    ).toBe(false);
    expect(await jobState("job-1")).toMatchObject({ progress: 0, current_stage: "parse" });

    expect(
      await updateJobProgress(db, { organizationId: ORG, jobId: "job-1", progress: 40, currentStage: "extract", leaseOwner: WORKER_A })
    ).toBe(true);
    expect(await jobState("job-1")).toMatchObject({ progress: 40, current_stage: "extract" });

    // A non-owner cannot complete; the owner can.
    expect(await completeJob(db, { organizationId: ORG, jobId: "job-1", leaseOwner: WORKER_B })).toBe(false);
    expect(await completeJob(db, { organizationId: ORG, jobId: "job-1", leaseOwner: WORKER_A })).toBe(true);
    expect(await jobState("job-1")).toMatchObject({ status: "complete", progress: 100, current_stage: "report" });
  });

  it("fences writes once the lease expires, even for the previous owner", async () => {
    await seedJob("job-1");
    await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A });
    await db.query(`update jobs set lease_expires_at = now() - interval '1 second' where id = 'job-1'`);

    expect(
      await updateJobProgress(db, { organizationId: ORG, jobId: "job-1", progress: 80, currentStage: "report", leaseOwner: WORKER_A })
    ).toBe(false);
    expect(await completeJob(db, { organizationId: ORG, jobId: "job-1", leaseOwner: WORKER_A })).toBe(false);
    expect(await failJob(db, { organizationId: ORG, jobId: "job-1", error: "late", leaseOwner: WORKER_A })).toBe(false);
    expect(await jobState("job-1")).toMatchObject({ status: "processing", progress: 0 });
  });

  it("failJob records the error and releases the lease", async () => {
    await seedJob("job-1");
    await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A });

    expect(
      await failJob(db, { organizationId: ORG, jobId: "job-1", error: "parse exploded", currentStage: "parse", leaseOwner: WORKER_A })
    ).toBe(true);
    expect(await jobState("job-1")).toMatchObject({
      status: "failed",
      error_message: "parse exploded",
      lease_owner: null
    });
  });

  it("retry scheduling requeues with next-run metadata and the job stays unclaimable until due", async () => {
    await seedJob("job-1");
    await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A });

    // Only the lease owner may schedule the retry.
    expect(
      await markJobRetryScheduled(db, {
        organizationId: ORG,
        jobId: "job-1",
        error: "transient provider error",
        nextRunAt: "2999-01-01T00:00:00Z",
        reason: "retryable",
        leaseOwner: WORKER_B
      })
    ).toBe(false);

    expect(
      await markJobRetryScheduled(db, {
        organizationId: ORG,
        jobId: "job-1",
        error: "transient provider error",
        currentStage: "extract",
        nextRunAt: "2999-01-01T00:00:00Z",
        reason: "retryable",
        leaseOwner: WORKER_A
      })
    ).toBe(true);

    expect(await jobState("job-1")).toMatchObject({
      status: "queued",
      error_message: "transient provider error",
      current_stage: "extract",
      dead_letter_reason: "retryable",
      dead_lettered_at: null,
      lease_owner: null
    });

    // Not due yet: polling skips it. Once due, the retry is claimable again.
    expect(await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_B })).toBeNull();
    await db.query(`update jobs set next_run_at = now() - interval '1 second' where id = 'job-1'`);
    const retried = await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_B });
    expect(retried).toMatchObject({ id: "job-1", attemptCount: 2 });
  });

  it("dead-letters a job terminally: failed, stamped, never claimable again", async () => {
    await seedJob("job-1");
    await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_A });

    expect(
      await markJobDeadLettered(db, {
        organizationId: ORG,
        jobId: "job-1",
        error: "exhausted retries",
        reason: "max-attempts",
        leaseOwner: WORKER_A
      })
    ).toBe(true);

    const state = await jobState("job-1");
    expect(state).toMatchObject({
      status: "failed",
      error_message: "exhausted retries",
      dead_letter_reason: "max-attempts",
      lease_owner: null,
      next_run_at: null
    });
    expect(state.dead_lettered_at).not.toBeNull();

    expect(await claimNextJob(db, { kind: "log-analysis", leaseOwner: WORKER_B })).toBeNull();
  });

  it("getJobSnapshot joins the run and log record to expose the owning log", async () => {
    await db.query(
      `insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
       values ('file-1', $1, 'org/file-1', 'pack.log', 'text/plain', 10, 'sum')`,
      [ORG]
    );
    await db.query(
      `insert into log_records (id, organization_id, file_object_id, file_name, source, status)
       values ('log-1', $1, 'file-1', 'pack.log', 'upload', 'processing')`,
      [ORG]
    );
    await db.query(
      `insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage)
       values ('run-1', $1, 'log-1', 'queued', 'parse')`,
      [ORG]
    );
    await createLogAnalysisJob(db, { id: "job-1", organizationId: ORG, logId: "log-1", runId: "run-1" });

    const snapshot = await getJobSnapshot(db, "job-1");
    expect(snapshot).toMatchObject({
      id: "job-1",
      organizationId: ORG,
      logId: "log-1",
      runId: "run-1",
      status: "queued"
    });

    expect(await getJobSnapshot(db, "missing-job")).toBeNull();
  });
});
