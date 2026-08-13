import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { claimJobById } from "../jobs/repository";
import { insertLogDomain } from "./domainsRepository";
import {
  aggregateFeedbackInsights,
  appendFeedback,
  archiveLog,
  completeLogAnalysisJobWithReport,
  completeRun,
  createFileObject,
  createLogRecordWithRunAndJob,
  createRerunWithJob,
  failRun,
  getFileObjectById,
  getLogDetail,
  listLogs,
  listRuns,
  persistLogAnalysisReport,
  unarchiveLog,
  updateRunStageProgress
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      organizationName: "ChargeLab",
      roles: [{ projectId: "project-1", roleId: "software-user" }],
      permissions: ["logs:view", "logs:upload", "logs:feedback"]
    }),
    ...overrides
  };
}

const sampleReport = {
  confidence: 0.91,
  conclusion: "Charge current derated after thermal warning.",
  impact: "Fast charge throughput reduced.",
  severity: "Warning" as const,
  suggestedActions: ["Inspect coolant loop"],
  rawLines: ["12 WARN temp=74", "21 INFO derate=1"]
};

const sampleEvidence = [
  {
    stageId: "rootcause" as const,
    lineNumbers: [12, 21],
    inference: "Thermal warnings cluster before derating.",
    suggestedAction: "Check pack coolant loop.",
    ruleHit: "thermal-foldback"
  }
];

describe.skipIf(!databaseAvailable)("log repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedUploadedLog(suffix: string, options: { analysisQuestion?: string } = {}) {
    const fileId = `file-${suffix}`;
    const logId = `log-${suffix}`;
    const runId = `run-${suffix}`;
    const jobId = `job-${suffix}`;
    await createFileObject(db, {
      id: fileId,
      organizationId: "org-1",
      storageKey: `org-1/checksum-${suffix}.log`,
      fileName: `pack-controller-${suffix}.log`,
      contentType: "text/plain",
      fileSizeBytes: 2048,
      checksumSha256: `checksum-${suffix}`,
      uploadedByUserId: "user-1"
    });
    const created = await createLogRecordWithRunAndJob(db, {
      logId,
      runId,
      jobId,
      organizationId: "org-1",
      fileObjectId: fileId,
      fileName: `pack-controller-${suffix}.log`,
      source: "upload",
      submittedByUserId: "user-1",
      analysisQuestion: options.analysisQuestion
    });
    return { fileId, logId, runId, jobId, created };
  }

  it("createFileObject persists checksum, storage key, file size, and uploader", async () => {
    const dto = await createFileObject(db, {
      id: "file-1",
      organizationId: "org-1",
      storageKey: "org-1/checksum-pack-controller.log",
      fileName: "pack-controller.log",
      contentType: "text/plain",
      fileSizeBytes: 2048,
      checksumSha256: "checksum",
      uploadedByUserId: "user-1"
    });

    expect(dto).toMatchObject({
      id: "file-1",
      organizationId: "org-1",
      storageKey: "org-1/checksum-pack-controller.log",
      fileName: "pack-controller.log",
      contentType: "text/plain",
      fileSizeBytes: 2048,
      checksumSha256: "checksum",
      uploadedByUserId: "user-1"
    });

    const reloaded = await getFileObjectById(db, { organizationId: "org-1", fileObjectId: "file-1" });
    expect(reloaded).toMatchObject({ id: "file-1", fileName: "pack-controller.log", fileSizeBytes: 2048 });
  });

  it("createLogRecordWithRunAndJob creates the record, run, and job and marks the run current", async () => {
    const { created, logId, runId, jobId } = await seedUploadedLog("1", {
      analysisQuestion: "Why did current drop?"
    });

    expect(created.log).toMatchObject({
      id: logId,
      status: "processing",
      stage: "parse",
      fileSizeBytes: 2048,
      submittedBy: "Riley Chen",
      analysisQuestion: "Why did current drop?"
    });
    expect(created.job).toMatchObject({ id: jobId, status: "queued" });

    const runs = await listRuns(db, auth(), logId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: runId, logId, status: "queued", currentStage: "parse" });

    // The run is current: a persisted report becomes visible on the detail read.
    await persistLogAnalysisReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      report: sampleReport,
      evidence: sampleEvidence
    });
    const detail = await getLogDetail(db, auth(), logId);
    expect(detail?.reportId).toBe(`report-${runId}`);
  });

  it("listLogs excludes archived logs by default and includes them with includeArchived=true", async () => {
    const { logId: activeId } = await seedUploadedLog("active");
    const { logId: archivedId } = await seedUploadedLog("archived");
    await archiveLog(db, auth(), archivedId);

    const defaultList = await listLogs(db, auth(), {});
    const fullList = await listLogs(db, auth(), { includeArchived: true });

    expect(defaultList.map((log) => log.id)).toEqual([activeId]);
    expect(fullList.map((log) => log.id).sort()).toEqual([activeId, archivedId].sort());
    expect(fullList.find((log) => log.id === archivedId)?.archiveState).toBe("archived");
  });

  it("getLogDetail assembles the current run's report, evidence, and raw lines", async () => {
    const { logId, runId } = await seedUploadedLog("detail");
    await persistLogAnalysisReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      report: sampleReport,
      evidence: sampleEvidence
    });
    await completeRun(db, { organizationId: "org-1", logId, runId });

    const detail = await getLogDetail(db, auth(), logId);

    expect(detail).toMatchObject({
      id: logId,
      reportId: `report-${runId}`,
      status: "complete",
      stage: "report",
      confidence: 0.91,
      conclusion: "Charge current derated after thermal warning.",
      impact: "Fast charge throughput reduced.",
      severity: "Warning",
      suggestedActions: ["Inspect coolant loop"],
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [
        {
          id: `evidence-${runId}-0`,
          stageId: "rootcause",
          lineNumbers: [12, 21],
          ruleHit: "thermal-foldback"
        }
      ]
    });
  });

  it("listRuns returns the newest run first after a rerun", async () => {
    const { logId } = await seedUploadedLog("reruns");
    await createRerunWithJob(db, {
      runId: "run-reruns-2",
      jobId: "job-reruns-2",
      organizationId: "org-1",
      logId
    });

    const runs = await listRuns(db, auth(), logId);

    expect(runs.map((run) => run.id)).toEqual(["run-reruns-2", "run-reruns"]);
  });

  it("appendFeedback persists rating and note for the acting user", async () => {
    const { logId } = await seedUploadedLog("feedback");

    await appendFeedback(db, auth(), {
      id: "feedback-1",
      logId,
      rating: "helpful",
      note: "This matched the incident."
    });

    const stored = await db.query<{ user_id: string; rating: string; note: string | null }>(
      "select user_id, rating, note from log_feedback where organization_id = $1 and log_record_id = $2",
      ["org-1", logId]
    );
    expect(stored.rows).toEqual([
      { user_id: "user-1", rating: "helpful", note: "This matched the incident." }
    ]);
  });

  it("aggregateFeedbackInsights groups by domain, analysis source, and prompt version with org isolation and time window", async () => {
    await insertLogDomain(db, { id: "domain-charging", organizationId: "org-1", name: "charging-power" });

    async function seedAnalyzedLog(
      suffix: string,
      options: { logDomainId?: string; analysisSource?: "agent" | "rules-fallback"; promptVersion?: string } = {}
    ) {
      const ids = { fileId: `file-${suffix}`, logId: `log-${suffix}`, runId: `run-${suffix}`, jobId: `job-${suffix}` };
      await createFileObject(db, {
        id: ids.fileId,
        organizationId: "org-1",
        storageKey: `org-1/checksum-${suffix}.log`,
        fileName: `pack-${suffix}.log`,
        contentType: "text/plain",
        fileSizeBytes: 1024,
        checksumSha256: `checksum-${suffix}`,
        uploadedByUserId: "user-1"
      });
      await createLogRecordWithRunAndJob(db, {
        logId: ids.logId,
        runId: ids.runId,
        jobId: ids.jobId,
        organizationId: "org-1",
        fileObjectId: ids.fileId,
        fileName: `pack-${suffix}.log`,
        source: "upload",
        submittedByUserId: "user-1",
        logDomainId: options.logDomainId
      });
      await persistLogAnalysisReport(db, {
        organizationId: "org-1",
        logId: ids.logId,
        runId: ids.runId,
        report: {
          ...sampleReport,
          analysisSource: options.analysisSource,
          promptVersion: options.promptVersion
        },
        evidence: sampleEvidence
      });
      return ids;
    }

    const agentLog = await seedAnalyzedLog("insight-agent", {
      logDomainId: "domain-charging",
      analysisSource: "agent",
      promptVersion: "log-analysis/v2"
    });
    const fallbackLog = await seedAnalyzedLog("insight-fallback", {
      analysisSource: "rules-fallback",
      promptVersion: "log-analysis/v2"
    });

    await appendFeedback(db, auth(), { id: "fb-1", logId: agentLog.logId, rating: "helpful" });
    await appendFeedback(db, auth(), { id: "fb-2", logId: agentLog.logId, rating: "helpful" });
    await appendFeedback(db, auth(), { id: "fb-3", logId: agentLog.logId, rating: "not_helpful" });
    await appendFeedback(db, auth(), { id: "fb-4", logId: fallbackLog.logId, rating: "not_helpful" });
    // Aged feedback drops out of the 7d window but stays in the unbounded aggregation.
    await appendFeedback(db, auth(), { id: "fb-old", logId: agentLog.logId, rating: "not_helpful" });
    await db.query("update log_feedback set created_at = now() - interval '20 days' where id = 'fb-old'");

    // Another organization's feedback must never leak into org-1 insights.
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "OtherOrg" },
      users: [{ id: "user-2", name: "Mo Fan", email: "mo@example.com" }]
    });
    const foreignAuth = auth({
      ...makeTestAuthContext({
        userId: "user-2",
        organizationId: "org-2",
        name: "Mo Fan",
        email: "mo@example.com",
        title: "Software User",
        organizationName: "OtherOrg",
        roles: [],
        permissions: ["logs:view", "logs:feedback"]
      })
    });
    await createFileObject(db, {
      id: "file-foreign",
      organizationId: "org-2",
      storageKey: "org-2/checksum-foreign.log",
      fileName: "foreign.log",
      contentType: "text/plain",
      fileSizeBytes: 128,
      checksumSha256: "checksum-foreign",
      uploadedByUserId: "user-2"
    });
    await createLogRecordWithRunAndJob(db, {
      logId: "log-foreign",
      runId: "run-foreign",
      jobId: "job-foreign",
      organizationId: "org-2",
      fileObjectId: "file-foreign",
      fileName: "foreign.log",
      source: "upload",
      submittedByUserId: "user-2"
    });
    await appendFeedback(db, foreignAuth, { id: "fb-foreign", logId: "log-foreign", rating: "helpful" });

    const allTime = await aggregateFeedbackInsights(db, auth());
    expect(allTime).toEqual([
      {
        logDomainId: "domain-charging",
        logDomainName: "charging-power",
        analysisSource: "agent",
        promptVersion: "log-analysis/v2",
        totalCount: 4,
        helpfulCount: 2,
        helpfulRate: 0.5,
        lastFeedbackAt: expect.any(String)
      },
      {
        logDomainId: null,
        logDomainName: null,
        analysisSource: "rules-fallback",
        promptVersion: "log-analysis/v2",
        totalCount: 1,
        helpfulCount: 0,
        helpfulRate: 0,
        lastFeedbackAt: expect.any(String)
      }
    ]);

    const window7d = await aggregateFeedbackInsights(db, auth(), { timeWindow: "7d" });
    expect(window7d.find((row) => row.analysisSource === "agent")).toMatchObject({
      totalCount: 3,
      helpfulCount: 2,
      helpfulRate: 2 / 3
    });

    const foreign = await aggregateFeedbackInsights(db, foreignAuth);
    expect(foreign).toEqual([
      expect.objectContaining({ logDomainId: null, analysisSource: null, promptVersion: null, totalCount: 1, helpfulCount: 1 })
    ]);
  });

  it("archive and unarchive return full log detail including report, evidence, and raw lines", async () => {
    const { logId, runId } = await seedUploadedLog("archive");
    await persistLogAnalysisReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      report: sampleReport,
      evidence: sampleEvidence
    });
    await completeRun(db, { organizationId: "org-1", logId, runId });

    const archived = await archiveLog(db, auth(), logId);
    const unarchived = await unarchiveLog(db, auth(), logId);

    expect(archived).toMatchObject({
      reportId: `report-${runId}`,
      archiveState: "archived",
      conclusion: "Charge current derated after thermal warning.",
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [{ id: `evidence-${runId}-0`, stageId: "rootcause", lineNumbers: [12, 21] }]
    });
    expect(unarchived).toMatchObject({
      reportId: `report-${runId}`,
      archiveState: "active",
      conclusion: "Charge current derated after thermal warning.",
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [{ id: `evidence-${runId}-0`, stageId: "rootcause", lineNumbers: [12, 21] }]
    });
  });

  it("getFileObjectById scopes lookups to the owning organization", async () => {
    const { fileId } = await seedUploadedLog("ownership");

    const owned = await getFileObjectById(db, { organizationId: "org-1", fileObjectId: fileId });
    const foreign = await getFileObjectById(db, { organizationId: "org-other", fileObjectId: fileId });

    expect(owned).toMatchObject({ id: fileId });
    expect(foreign).toBeNull();
  });

  it("completeRun only updates the log when the run is still current", async () => {
    const { logId, runId: staleRunId } = await seedUploadedLog("complete-guard");
    await createRerunWithJob(db, {
      runId: "run-complete-guard-2",
      jobId: "job-complete-guard-2",
      organizationId: "org-1",
      logId
    });

    await completeRun(db, { organizationId: "org-1", logId, runId: staleRunId });
    const afterStale = await getLogDetail(db, auth(), logId);
    expect(afterStale?.status).toBe("processing");

    await completeRun(db, { organizationId: "org-1", logId, runId: "run-complete-guard-2" });
    const afterCurrent = await getLogDetail(db, auth(), logId);
    expect(afterCurrent?.status).toBe("complete");

    const runs = await listRuns(db, auth(), logId);
    expect(runs.find((run) => run.id === staleRunId)?.status).toBe("complete");
  });

  it("failRun only marks the log failed when the run is still current", async () => {
    const { logId, runId: staleRunId } = await seedUploadedLog("fail-guard");
    await createRerunWithJob(db, {
      runId: "run-fail-guard-2",
      jobId: "job-fail-guard-2",
      organizationId: "org-1",
      logId
    });

    await failRun(db, { organizationId: "org-1", logId, runId: staleRunId, error: "Stale parser failed." });
    const afterStale = await getLogDetail(db, auth(), logId);
    expect(afterStale?.status).toBe("processing");
    expect(afterStale?.failureReason).toBeUndefined();

    await failRun(db, {
      organizationId: "org-1",
      logId,
      runId: "run-fail-guard-2",
      error: "Parser failed."
    });
    const afterCurrent = await getLogDetail(db, auth(), logId);
    expect(afterCurrent?.status).toBe("failed");
    expect(afterCurrent?.failureReason).toBe("Parser failed.");
  });

  it("updateRunStageProgress upserts one stage row per run and stage", async () => {
    const { logId, runId } = await seedUploadedLog("stages");

    await updateRunStageProgress(db, {
      organizationId: "org-1",
      runId,
      status: "processing",
      stage: "pattern",
      progress: 40,
      message: "Finding known patterns."
    });
    await updateRunStageProgress(db, {
      organizationId: "org-1",
      runId,
      status: "processing",
      stageStatus: "complete",
      stage: "pattern",
      progress: 70,
      message: "Patterns identified."
    });

    const stages = await db.query<{
      id: string;
      status: string;
      progress: number;
      message: string;
      started_at: string | Date | null;
      completed_at: string | Date | null;
    }>(
      "select id, status, progress, message, started_at, completed_at from log_analysis_stages where organization_id = $1 and run_id = $2 and stage = $3",
      ["org-1", runId, "pattern"]
    );
    expect(stages.rows).toHaveLength(1);
    expect(stages.rows[0]).toMatchObject({
      id: `stage-${runId}-pattern`,
      status: "complete",
      progress: 70,
      message: "Patterns identified."
    });
    expect(stages.rows[0].started_at).not.toBeNull();
    expect(stages.rows[0].completed_at).not.toBeNull();

    const runs = await listRuns(db, auth(), logId);
    expect(runs[0]).toMatchObject({ id: runId, currentStage: "pattern", progress: 70 });
  });

  it("persistLogAnalysisReport replaces existing evidence for stable reruns", async () => {
    const { logId, runId } = await seedUploadedLog("rerun-report");
    await persistLogAnalysisReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      report: { ...sampleReport, confidence: 0.5 },
      evidence: [
        sampleEvidence[0],
        {
          stageId: "pattern",
          lineNumbers: [3],
          inference: "Preliminary pattern.",
          suggestedAction: "Ignore.",
          ruleHit: "preliminary"
        }
      ]
    });

    await persistLogAnalysisReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      report: sampleReport,
      evidence: sampleEvidence
    });

    const detail = await getLogDetail(db, auth(), logId);
    expect(detail?.confidence).toBe(0.91);
    expect(detail?.evidence).toHaveLength(1);
    expect(detail?.evidence[0]).toMatchObject({
      id: `evidence-${runId}-0`,
      stageId: "rootcause",
      inference: "Thermal warnings cluster before derating."
    });
  });

  it("completeLogAnalysisJobWithReport persists the report only while holding the job lease", async () => {
    const { logId, runId, jobId } = await seedUploadedLog("lease");

    // Nobody leased the job: the write reports lease loss and persists nothing.
    const withoutLease = await completeLogAnalysisJobWithReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      jobId,
      leaseOwner: "worker-1",
      report: sampleReport,
      evidence: sampleEvidence
    });
    expect(withoutLease).toBe(false);
    expect((await getLogDetail(db, auth(), logId))?.status).toBe("processing");

    const claimed = await claimJobById(db, { kind: "log-analysis", jobId, leaseOwner: "worker-1" });
    expect(claimed).not.toBeNull();

    const withLease = await completeLogAnalysisJobWithReport(db, {
      organizationId: "org-1",
      logId,
      runId,
      jobId,
      leaseOwner: "worker-1",
      report: sampleReport,
      evidence: sampleEvidence
    });
    expect(withLease).toBe(true);

    const detail = await getLogDetail(db, auth(), logId);
    expect(detail).toMatchObject({
      status: "complete",
      stage: "report",
      // jsonb arrays round-trip as arrays, not JSON strings.
      suggestedActions: ["Inspect coolant loop"],
      rawLines: ["12 WARN temp=74", "21 INFO derate=1"],
      evidence: [{ id: `evidence-${runId}-0`, stageId: "rootcause" }]
    });
  });
});
