import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import {
  appendFeedback,
  archiveLog,
  completeLogAnalysisJobWithReport,
  completeRun,
  createFileObject,
  createLogRecordWithRunAndJob,
  failRun,
  getFileObjectById,
  getLogDetail,
  listLogs,
  listRuns,
  persistLogAnalysisReport,
  unarchiveLog,
  updateRunStageProgress
} from "./repository";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const transactions: QueryCall[][] = [];

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
    query: (text, values = []) => runQuery(calls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => {
      const result = await fn(tx);
      transactions.push([...txCalls]);
      return result;
    }
  };

  return { calls, txCalls, transactions, db };
}

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "software-user" }],
    permissions: ["logs:view", "logs:upload", "logs:feedback"],
    ...overrides
  };
}

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    report_id: null,
    file_name: "pack-controller.log",
    source: "upload",
    file_size_bytes: 2048,
    status: "processing",
    archive_state: "active",
    stage: "parse",
    confidence: null,
    conclusion: null,
    impact: null,
    suggested_actions: null,
    severity: null,
    raw_lines: null,
    captured_at: "2026-05-25T02:00:00.000Z",
    updated_at: "2026-05-25T02:01:00.000Z",
    submitted_by: "Riley Chen",
    related_parameter_id: null,
    failure_reason: null,
    analysis_question: null,
    ...overrides
  };
}

describe("log repository", () => {
  it("createFileObject inserts checksum, storage key, file size, and user", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          storage_key: "org-1/checksum-pack-controller.log",
          file_name: "pack-controller.log",
          content_type: "text/plain",
          file_size_bytes: 2048,
          checksum_sha256: "checksum",
          uploaded_by_user_id: "user-1",
          created_at: "2026-05-25T02:00:00.000Z"
        }
      ]
    ]);

    await createFileObject(db, {
      id: "file-1",
      organizationId: "org-1",
      storageKey: "org-1/checksum-pack-controller.log",
      fileName: "pack-controller.log",
      contentType: "text/plain",
      fileSizeBytes: 2048,
      checksumSha256: "checksum",
      uploadedByUserId: "user-1"
    });

    expect(calls[0].text).toContain("insert into log_file_objects");
    expect(calls[0].values).toEqual([
      "file-1",
      "org-1",
      "org-1/checksum-pack-controller.log",
      "pack-controller.log",
      "text/plain",
      2048,
      "checksum",
      "user-1"
    ]);
  });

  it("createLogRecordWithRunAndJob creates log_records, log_analysis_runs, and jobs in one transaction", async () => {
    const { db, txCalls, transactions } = createFakeDb([
      [logRow()],
      [{ id: "run-1", log_record_id: "log-1", status: "queued", current_stage: "parse", progress: 0, error_message: null, updated_at: "2026-05-25T02:00:00.000Z" }],
      [{ id: "job-1", kind: "log-analysis", target_id: "run-1", status: "queued", progress: 0, current_stage: "parse", error_message: null, updated_at: "2026-05-25T02:00:00.000Z" }],
      [logRow()]
    ]);

    await createLogRecordWithRunAndJob(db, {
      logId: "log-1",
      runId: "run-1",
      jobId: "job-1",
      organizationId: "org-1",
      fileObjectId: "file-1",
      fileName: "pack-controller.log",
      source: "upload",
      submittedByUserId: "user-1",
      analysisQuestion: "Why did current drop?"
    });

    expect(transactions).toHaveLength(1);
    expect(txCalls[0].text).toContain("insert into log_records");
    expect(txCalls[1].text).toContain("insert into log_analysis_runs");
    expect(txCalls[2].text).toContain("insert into jobs");
    expect(txCalls[3].text).toContain("current_run_id = $3");
  });

  it("listLogs excludes archived logs by default and includes them with includeArchived=true", async () => {
    const { db, calls } = createFakeDb([[logRow()], [logRow({ archive_state: "archived" })]]);

    await listLogs(db, auth(), {});
    await listLogs(db, auth(), { includeArchived: true });

    expect(calls[0].text).toContain("lr.archive_state = 'active'");
    expect(calls[0].values).toEqual(["org-1"]);
    expect(calls[1].text).not.toContain("lr.archive_state = 'active'");
  });

  it("getLogDetail joins current report, evidence, and raw lines", async () => {
    const { db, calls } = createFakeDb([
      [
        logRow({
          report_id: "report-1",
          status: "complete",
          stage: "report",
          confidence: "0.91",
          conclusion: "Charge current derated after thermal warning.",
          impact: "Fast charge throughput reduced.",
          severity: "Warning",
          suggested_actions: ["Inspect coolant loop"],
          raw_lines: ["12 WARN temp=74", "21 INFO derate=1"]
        })
      ],
      [
        {
          id: "evidence-1",
          stage: "pattern",
          line_numbers: [12, 21],
          inference: "Thermal warnings cluster before derating.",
          suggested_action: "Check pack coolant loop.",
          rule_hit: "thermal-foldback"
        }
      ]
    ]);

    const detail = await getLogDetail(db, auth(), "log-1");

    expect(calls[0].text).toContain("left join log_analysis_reports");
    expect(calls[0].text).toContain("current_run_id");
    expect(calls[1].text).toContain("from log_evidence");
    expect(detail).toMatchObject({
      id: "log-1",
      reportId: "report-1",
      status: "complete",
      confidence: 0.91,
      evidence: [
        {
          id: "evidence-1",
          stageId: "pattern",
          lineNumbers: [12, 21],
          ruleHit: "thermal-foldback"
        }
      ],
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"]
    });
  });

  it("listRuns returns newest run first", async () => {
    const { db, calls } = createFakeDb([
      [
        { id: "run-new", log_record_id: "log-1", status: "queued", current_stage: "parse", progress: 0, error_message: null, updated_at: "2026-05-25T03:00:00.000Z" },
        { id: "run-old", log_record_id: "log-1", status: "complete", current_stage: "report", progress: 100, error_message: null, updated_at: "2026-05-25T02:00:00.000Z" }
      ]
    ]);

    const runs = await listRuns(db, auth(), "log-1");

    expect(calls[0].text).toContain("order by lar.created_at desc");
    expect(calls[0].values).toEqual(["org-1", "log-1"]);
    expect(runs.map((run) => run.id)).toEqual(["run-new", "run-old"]);
  });

  it("appendFeedback persists rating and note", async () => {
    const { db, calls } = createFakeDb([[]]);

    await appendFeedback(db, auth(), {
      id: "feedback-1",
      logId: "log-1",
      rating: "helpful",
      note: "This matched the incident."
    });

    expect(calls[0].text).toContain("insert into log_feedback");
    expect(calls[0].values).toEqual(["feedback-1", "org-1", "log-1", "user-1", "helpful", "This matched the incident."]);
  });

  it("archive and unarchive return full log detail including report, evidence, and raw lines", async () => {
    const completeDetail = logRow({
      current_run_id: "run-1",
      report_id: "report-1",
      status: "complete",
      stage: "report",
      confidence: "0.91",
      conclusion: "Charge current derated after thermal warning.",
      impact: "Fast charge throughput reduced.",
      severity: "Warning",
      suggested_actions: ["Inspect coolant loop"],
      raw_lines: ["12 WARN temp=74", "21 INFO derate=1"]
    });
    const evidence = [
      {
        id: "evidence-1",
        stage: "rootcause",
        line_numbers: [12, 21],
        inference: "Thermal warnings cluster before derating.",
        suggested_action: "Check pack coolant loop.",
        rule_hit: "thermal-foldback"
      }
    ];
    const { db, calls } = createFakeDb([
      [],
      [logRow({ ...completeDetail, archive_state: "archived" })],
      evidence,
      [],
      [logRow({ ...completeDetail, archive_state: "active" })],
      evidence
    ]);

    const archived = await archiveLog(db, auth(), "log-1");
    const unarchived = await unarchiveLog(db, auth(), "log-1");

    expect(calls[0].text).toContain("update log_records");
    expect(calls[0].values).toEqual(["org-1", "log-1", "archived"]);
    expect(calls[1].text).toContain("left join log_analysis_reports");
    expect(calls[2].text).toContain("from log_evidence");
    expect(calls[3].text).toContain("update log_records");
    expect(calls[3].values).toEqual(["org-1", "log-1", "active"]);
    expect(calls[4].text).toContain("left join log_analysis_reports");
    expect(calls[5].text).toContain("from log_evidence");
    expect(archived).toMatchObject({
      reportId: "report-1",
      archiveState: "archived",
      conclusion: "Charge current derated after thermal warning.",
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [{ id: "evidence-1", stageId: "rootcause", lineNumbers: [12, 21] }]
    });
    expect(unarchived).toMatchObject({
      reportId: "report-1",
      archiveState: "active",
      conclusion: "Charge current derated after thermal warning.",
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [{ id: "evidence-1", stageId: "rootcause", lineNumbers: [12, 21] }]
    });
  });

  it("loads file objects by organization and id for ownership validation", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "file-1",
          organization_id: "org-1",
          storage_key: "org-1/checksum-pack-controller.log",
          file_name: "pack-controller.log",
          content_type: "text/plain",
          file_size_bytes: 2048,
          checksum_sha256: "checksum",
          uploaded_by_user_id: "user-1",
          created_at: "2026-05-25T02:00:00.000Z"
        }
      ]
    ]);

    const fileObject = await getFileObjectById(db, { organizationId: "org-1", fileObjectId: "file-1" });

    expect(calls[0].text).toContain("from log_file_objects");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].values).toEqual(["org-1", "file-1"]);
    expect(fileObject).toMatchObject({ id: "file-1", fileName: "pack-controller.log" });
  });

  it("completeRun is transactional and only updates the log when the run is still current", async () => {
    const { db, txCalls, transactions } = createFakeDb([[], []]);

    await completeRun(db, {
      organizationId: "org-1",
      logId: "log-1",
      runId: "run-old"
    });

    expect(transactions).toHaveLength(1);
    expect(txCalls[0].text).toContain("update log_analysis_runs");
    expect(txCalls[0].text).toContain("log_record_id = $3");
    expect(txCalls[0].values).toEqual(["org-1", "run-old", "log-1", "report"]);
    expect(txCalls[1].text).toContain("update log_records");
    expect(txCalls[1].text).toContain("current_run_id = $3");
    expect(txCalls[1].values).toEqual(["org-1", "log-1", "run-old"]);
  });

  it("failRun is transactional and only updates the log when the run is still current", async () => {
    const { db, txCalls, transactions } = createFakeDb([[], []]);

    await failRun(db, {
      organizationId: "org-1",
      logId: "log-1",
      runId: "run-old",
      error: "Parser failed."
    });

    expect(transactions).toHaveLength(1);
    expect(txCalls[0].text).toContain("update log_analysis_runs");
    expect(txCalls[0].text).toContain("log_record_id = $3");
    expect(txCalls[0].values).toEqual(["org-1", "run-old", "log-1", "parse", "Parser failed."]);
    expect(txCalls[1].text).toContain("update log_records");
    expect(txCalls[1].text).toContain("current_run_id = $3");
    expect(txCalls[1].values).toEqual(["org-1", "log-1", "run-old", "Parser failed."]);
  });

  it("updateRunStageProgress records visible stage progress for a run", async () => {
    const { db, calls } = createFakeDb([[], []]);

    await updateRunStageProgress(db, {
      organizationId: "org-1",
      runId: "run-1",
      status: "processing",
      stage: "pattern",
      progress: 40,
      message: "Finding known patterns."
    });

    expect(calls[0].text).toContain("update log_analysis_runs");
    expect(calls[0].values).toEqual(["org-1", "run-1", "processing", "pattern", 40]);
    expect(calls[1].text).toContain("insert into log_analysis_stages");
    expect(calls[1].text).toContain("on conflict (run_id, stage)");
    expect(calls[1].values).toEqual(["stage-run-1-pattern", "org-1", "run-1", "pattern", "processing", 40, "Finding known patterns."]);
  });

  it("persistLogAnalysisReport replaces existing evidence for stable reruns", async () => {
    const { db, txCalls, transactions } = createFakeDb([[], [], []]);

    await persistLogAnalysisReport(db, {
      organizationId: "org-1",
      logId: "log-1",
      runId: "run-1",
      report: {
        confidence: 0.85,
        conclusion: "Charging behavior is consistent with thermal foldback protection.",
        impact: "Charging throughput may be reduced.",
        severity: "Warning",
        suggestedActions: ["Inspect pack temperature."],
        rawLines: ["WARN thermal foldback"]
      },
      evidence: [
        {
          stageId: "rootcause",
          lineNumbers: [1],
          inference: "Thermal protection reduced charging output.",
          suggestedAction: "Inspect pack temperature.",
          ruleHit: "thermal-foldback"
        }
      ]
    });

    expect(transactions).toHaveLength(1);
    expect(txCalls[0].text).toContain("insert into log_analysis_reports");
    expect(txCalls[0].text).toContain("on conflict (id) do update");
    expect(txCalls[0].values[0]).toBe("report-run-1");
    expect(txCalls[0].values[8]).toBe(JSON.stringify(["Inspect pack temperature."]));
    expect(txCalls[0].values[9]).toBe(JSON.stringify(["WARN thermal foldback"]));
    expect(txCalls[1].text).toContain("delete from log_evidence");
    expect(txCalls[1].values).toEqual(["org-1", "run-1"]);
    expect(txCalls[2].text).toContain("insert into log_evidence");
    expect(txCalls[2].values).toEqual([
      "evidence-run-1-0",
      "org-1",
      "log-1",
      "run-1",
      "rootcause",
      [1],
      "Thermal protection reduced charging output.",
      "Inspect pack temperature.",
      "thermal-foldback"
    ]);
  });

  it("serializes completed worker report arrays for PostgreSQL jsonb columns", async () => {
    const { db, txCalls } = createFakeDb([[{}], [], [], [], [], [{}], [], []]);

    await completeLogAnalysisJobWithReport(db, {
      organizationId: "org-1",
      logId: "log-1",
      runId: "run-1",
      jobId: "job-1",
      leaseOwner: "worker-1",
      report: {
        confidence: 0.91,
        conclusion: "Charge current derated after thermal warning.",
        impact: "Fast charge throughput reduced.",
        severity: "Warning",
        suggestedActions: ["Inspect coolant loop"],
        rawLines: ["12 WARN temp=74", "21 INFO derate=1"]
      },
      evidence: [
        {
          stageId: "rootcause",
          lineNumbers: [12, 21],
          inference: "Thermal warnings cluster before derating.",
          suggestedAction: "Check pack coolant loop.",
          ruleHit: "thermal-foldback"
        }
      ]
    });

    expect(txCalls[1].text).toContain("insert into log_analysis_reports");
    expect(txCalls[1].values[8]).toBe(JSON.stringify(["Inspect coolant loop"]));
    expect(txCalls[1].values[9]).toBe(JSON.stringify(["12 WARN temp=74", "21 INFO derate=1"]));
  });
});
