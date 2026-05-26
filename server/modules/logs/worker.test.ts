import { describe, expect, it, vi } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import { processNextLogAnalysisJob, startLogWorkerLoop } from "./worker";

type JobRow = {
  id: string;
  organization_id: string;
  kind: "log-analysis";
  target_id: string;
  status: string;
  progress: number;
  current_stage: string | null;
  error_message: string | null;
  updated_at: string;
};

type Fixture = {
  job: JobRow;
  run: {
    id: string;
    organization_id: string;
    log_record_id: string;
    status: string;
    current_stage: string;
    progress: number;
    error_message: string | null;
    updated_at: string;
  };
  log: {
    id: string;
    organization_id: string;
    project_id: string;
    file_object_id: string;
    file_name: string;
    status: string;
    current_run_id: string;
    analysis_question: string | null;
    failure_reason: string | null;
  };
  file: {
    id: string;
    organization_id: string;
    project_id: string;
    storage_key: string;
    file_name: string;
    content_type: string;
    file_size_bytes: number;
    checksum_sha256: string;
    uploaded_by_user_id: string | null;
    created_at: string;
  };
  stages: Array<{ stage: string; status: string; progress: number; message: string }>;
  reports: Array<Record<string, unknown>>;
  evidence: Array<{ id: string; stage: string; line_numbers: number[]; inference: string; suggested_action: string; rule_hit: string | null }>;
};

function createFixture(overrides: Partial<Fixture> = {}): Fixture {
  const fixture: Fixture = {
    job: {
      id: "job-1",
      organization_id: "org-1",
      kind: "log-analysis",
      target_id: "run-1",
      status: "queued",
      progress: 0,
      current_stage: "parse",
      error_message: null,
      updated_at: "2026-05-25T02:00:00.000Z"
    },
    run: {
      id: "run-1",
      organization_id: "org-1",
      log_record_id: "log-1",
      status: "queued",
      current_stage: "parse",
      progress: 0,
      error_message: null,
      updated_at: "2026-05-25T02:00:00.000Z"
    },
    log: {
      id: "log-1",
      organization_id: "org-1",
      project_id: "project-1",
      file_object_id: "file-1",
      file_name: "pack-controller.log",
      status: "processing",
      current_run_id: "run-1",
      analysis_question: "Why was current reduced?",
      failure_reason: null
    },
    file: {
      id: "file-1",
      organization_id: "org-1",
      project_id: "project-1",
      storage_key: "org-1/pack-controller.log",
      file_name: "pack-controller.log",
      content_type: "text/plain",
      file_size_bytes: 128,
      checksum_sha256: "checksum",
      uploaded_by_user_id: "user-1",
      created_at: "2026-05-25T02:00:00.000Z"
    },
    stages: [],
    reports: [],
    evidence: [],
    ...overrides
  };
  return fixture;
}

function createObjectStore(bytes: Buffer): ObjectStore {
  return {
    async put() {
      throw new Error("put is not used by the worker");
    },
    async get() {
      return bytes;
    }
  };
}

function createFakeWorkerDb(fixture = createFixture()) {
  const calls: string[] = [];

  const queryable: Queryable = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      const normalized = text.replace(/\s+/g, " ").trim();
      calls.push(normalized);

      if (normalized.startsWith("update jobs set status = 'processing'")) {
        if (fixture.job.status !== "queued") return { rows: [], rowCount: 0 };
        fixture.job.status = "processing";
        return { rows: [fixture.job as Row], rowCount: 1 };
      }
      if (
        normalized.startsWith("select") &&
        normalized.includes("job.target_id") &&
        normalized.includes("run.log_record_id as log_id")
      ) {
        return {
          rows: [
            {
              id: fixture.job.id,
              organization_id: fixture.job.organization_id,
              kind: fixture.job.kind,
              target_id: fixture.job.target_id,
              status: fixture.job.status,
              progress: fixture.job.progress,
              current_stage: fixture.job.current_stage,
              error_message: fixture.job.error_message,
              updated_at: fixture.job.updated_at,
              job_id: fixture.job.id,
              project_id: fixture.log.project_id,
              run_id: fixture.run.id,
              log_id: fixture.log.id,
              file_object_id: fixture.log.file_object_id,
              file_name: fixture.log.file_name,
              storage_key: fixture.file.storage_key,
              analysis_question: fixture.log.analysis_question,
              job_status: fixture.job.status,
              run_status: fixture.run.status,
              record_status: fixture.log.status
            } as Row
          ],
          rowCount: 1
        };
      }
      if (
        normalized.startsWith("select") &&
        normalized.includes("from jobs job") &&
        normalized.includes("lr.file_object_id")
      ) {
        if (fixture.log.current_run_id !== fixture.run.id) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              job_id: fixture.job.id,
              organization_id: fixture.job.organization_id,
              run_id: fixture.run.id,
              log_id: fixture.log.id,
              file_object_id: fixture.log.file_object_id,
              file_name: fixture.log.file_name,
              storage_key: fixture.file.storage_key,
              analysis_question: fixture.log.analysis_question,
              job_status: fixture.job.status,
              run_status: fixture.run.status,
              record_status: fixture.log.status
            } as Row
          ],
          rowCount: 1
        };
      }
      if (normalized.startsWith("update log_analysis_runs set status = 'complete'")) {
        fixture.run.status = "complete";
        fixture.run.current_stage = values[3] as string;
        fixture.run.progress = 100;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update log_analysis_runs set status = 'failed'")) {
        fixture.run.status = "failed";
        fixture.run.current_stage = values[3] as string;
        fixture.run.error_message = values[4] as string;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update log_analysis_runs")) {
        fixture.run.status = values[2] as string;
        fixture.run.current_stage = values[3] as string;
        fixture.run.progress = values[4] as number;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("insert into log_analysis_stages")) {
        fixture.stages.push({
          stage: values[3] as string,
          status: values[4] as string,
          progress: values[5] as number,
          message: values[6] as string
        });
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update jobs set progress")) {
        fixture.job.progress = values[2] as number;
        fixture.job.current_stage = values[3] as string;
        fixture.job.error_message = null;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("insert into log_analysis_reports")) {
        fixture.reports = [
          {
            id: values[0],
            organization_id: values[1],
            log_record_id: values[2],
            run_id: values[3],
            confidence: values[4],
            conclusion: values[5],
            impact: values[6],
            severity: values[7],
            suggested_actions: values[8],
            raw_lines: values[9]
          }
        ];
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("delete from log_evidence")) {
        fixture.evidence = [];
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("insert into log_evidence")) {
        fixture.evidence.push({
          id: values[0] as string,
          stage: values[4] as string,
          line_numbers: values[5] as number[],
          inference: values[6] as string,
          suggested_action: values[7] as string,
          rule_hit: values[8] as string | null
        });
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update jobs set status = 'complete'")) {
        fixture.job.status = "complete";
        fixture.job.progress = 100;
        fixture.job.current_stage = values[2] as string;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update jobs set status = 'failed'")) {
        fixture.job.status = "failed";
        fixture.job.error_message = values[2] as string;
        fixture.job.current_stage = values[3] as string;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update log_records set status = 'failed'")) {
        fixture.log.status = "failed";
        fixture.log.failure_reason = values[3] as string;
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update log_records set status = 'complete'")) {
        fixture.log.status = "complete";
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }
  };

  const db: Database = {
    query: queryable.query,
    transaction: async (fn) => fn(queryable)
  };

  return { db, fixture, calls };
}

describe("log worker", () => {
  it("processes a queued supported log and updates stages in order", async () => {
    const { db, fixture } = createFakeWorkerDb();
    const objectStore = createObjectStore(
      Buffer.from(
        [
          "2026-05-25T02:00:00Z INFO charge requested_ma=200 delivered_ma=200",
          "2026-05-25T02:00:01Z WARN thermal foldback battery_temp=74",
          "2026-05-25T02:00:02Z WARN charge current reduced requested_ma=200 charge_current_ma=80"
        ].join("\n")
      )
    );

    const result = await processNextLogAnalysisJob({ db, objectStore });

    expect(result).toBe("processed");
    expect(fixture.stages.map((stage) => [stage.stage, stage.status, stage.progress])).toEqual([
      ["parse", "processing", 10],
      ["parse", "complete", 30],
      ["pattern", "processing", 40],
      ["pattern", "complete", 55],
      ["rootcause", "processing", 65],
      ["rootcause", "complete", 80],
      ["report", "processing", 90],
      ["report", "complete", 100]
    ]);
  });

  it("marks the job, run, and record complete at 100 progress", async () => {
    const { db, fixture } = createFakeWorkerDb();

    await processNextLogAnalysisJob({ db, objectStore: createObjectStore(Buffer.from("WARN thermal foldback\n")) });

    expect(fixture.job).toMatchObject({ status: "complete", progress: 100, current_stage: "report" });
    expect(fixture.run).toMatchObject({ status: "complete", progress: 100, current_stage: "report" });
    expect(fixture.log).toMatchObject({ status: "complete" });
    expect(fixture.stages.at(-1)).toMatchObject({ stage: "report", status: "complete", progress: 100 });
  });

  it("persists report and evidence rows with stable line numbers", async () => {
    const { db, fixture } = createFakeWorkerDb();
    const objectStore = createObjectStore(
      Buffer.from(
        [
          "2026-05-25T02:00:00Z INFO boot ok",
          "2026-05-25T02:00:01Z ERROR thermal foldback code=E_THERMAL_FOLDBACK",
          "2026-05-25T02:00:02Z WARN charge current reduced requested_ma=200 charge_current_ma=80"
        ].join("\n")
      )
    );

    await processNextLogAnalysisJob({ db, objectStore });

    expect(fixture.reports).toHaveLength(1);
    expect(fixture.reports[0]).toMatchObject({
      id: "report-run-1",
      log_record_id: "log-1",
      run_id: "run-1",
      severity: "Warning"
    });
    expect(fixture.evidence.map((item) => ({ id: item.id, stage: item.stage, lineNumbers: item.line_numbers }))).toEqual([
      { id: "evidence-run-1-0", stage: "rootcause", lineNumbers: [2] },
      { id: "evidence-run-1-1", stage: "pattern", lineNumbers: [3] },
      { id: "evidence-run-1-2", stage: "pattern", lineNumbers: [2] }
    ]);
  });

  it("marks run, job, and record failed with a readable parser error", async () => {
    const { db, fixture } = createFakeWorkerDb();

    await processNextLogAnalysisJob({ db, objectStore: createObjectStore(Buffer.from([0, 0, 0, 0, 1])) });

    expect(fixture.job).toMatchObject({
      status: "failed",
      error_message: "Input appears to be binary or null-byte-heavy content, not a UTF-8 text log."
    });
    expect(fixture.run).toMatchObject({ status: "failed", current_stage: "parse" });
    expect(fixture.log).toMatchObject({
      status: "failed",
      failure_reason: "Input appears to be binary or null-byte-heavy content, not a UTF-8 text log."
    });
    expect(fixture.stages.at(-1)).toMatchObject({
      stage: "parse",
      status: "failed",
      progress: 10,
      message: "Input appears to be binary or null-byte-heavy content, not a UTF-8 text log."
    });
  });

  it("does not duplicate evidence when the worker runs again after completion", async () => {
    const { db, fixture } = createFakeWorkerDb();
    const objectStore = createObjectStore(Buffer.from("WARN thermal foldback\n"));

    await processNextLogAnalysisJob({ db, objectStore });
    const evidenceAfterFirstRun = [...fixture.evidence];
    const secondResult = await processNextLogAnalysisJob({ db, objectStore });

    expect(secondResult).toBe("idle");
    expect(fixture.evidence).toEqual(evidenceAfterFirstRun);
  });

  it("fails a stale queued run when the job is no longer current", async () => {
    const fixture = createFixture({
      log: {
        id: "log-1",
        organization_id: "org-1",
        project_id: "project-1",
        file_object_id: "file-1",
        file_name: "pack-controller.log",
        status: "processing",
        current_run_id: "run-2",
        analysis_question: "Why was current reduced?",
        failure_reason: null
      }
    });
    const { db } = createFakeWorkerDb(fixture);

    const result = await processNextLogAnalysisJob({ db, objectStore: createObjectStore(Buffer.from("WARN thermal foldback\n")) });

    expect(result).toBe("processed");
    expect(fixture.run.status).toBe("failed");
    expect(fixture.job.status).toBe("failed");
    expect(fixture.job.error_message).toBe("Log analysis job is stale because its run is no longer current.");
    expect(fixture.log.current_run_id).toBe("run-2");
    expect(fixture.stages).toEqual([
      {
        stage: "parse",
        status: "failed",
        progress: 0,
        message: "Log analysis job is stale because its run is no longer current."
      }
    ]);
  });

  it("runs at most one job per tick and stops after cleanup", async () => {
    vi.useFakeTimers();
    try {
      let releaseParse = () => {};
      const parseGate = new Promise<void>((resolve) => {
        releaseParse = resolve;
      });
      const objectStore: ObjectStore = {
        async put() {
          throw new Error("put is not used by the worker");
        },
        async get() {
          await parseGate;
          return Buffer.from("WARN thermal foldback\n");
        }
      };
      const { db, calls } = createFakeWorkerDb();

      const stop = startLogWorkerLoop({ db, objectStore }, 10);

      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
      const claimCountWhileBlocked = calls.filter((call) => call.includes("update jobs set status = 'processing'")).length;
      expect(claimCountWhileBlocked).toBe(1);

      stop();
      releaseParse();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);

      const claimCountAfterCleanup = calls.filter((call) => call.includes("update jobs set status = 'processing'")).length;
      expect(claimCountAfterCleanup).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
