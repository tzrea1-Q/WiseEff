import { loadLegacyLogFile, loadLogFiles } from "./filesRepository";
import { compileSkillFiles } from "../../../src/domain/logs/fileApplicability";
import { createLogFileReader, ensureStoredLogIndex } from "./fileReader";
import { createPrefilterBudget, prefilterLogStream } from "./prefilter";
import { createHash } from "node:crypto";
import { decodeLogFilesCooperatively, gzipDecodedEvents, indexDecodedEvents, logDecodeLimits } from "./parsing/workerDecoding";
import type { DecodeCounts } from "./parsing/spec";
import { claimJobById, claimNextJob, failJob, getJobSnapshot, markJobDeadLettered, markJobRetryScheduled, updateJobProgress } from "../jobs/repository";
import { admittedLogArtifactWriter, admittedLogCompletionDatabase } from "./admittedCompletion";
import type { ClaimedLogAnalysisJobDto } from "../jobs/types";
import type { Database } from "../../shared/database/client";
import { decideRetry } from "../jobs/retryPolicy";
import type { LogAnalysisJobFailureReason, MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet, type AnalyzeLogInput, type AnalyzeLogOutput, type LogAnalysisAdapter } from "./analyzer";
import { extractLogSignalsCooperatively, logSignalLimits } from "./genericSignals";
import { LogAnalysisProviderError, LOG_ANALYSIS_PROMPT_VERSION } from "./analyzer/llmAnalyzer";
import { readStoredLogFormatProfile } from "./formatProfile";
import { sanitizeFileName, sanitizePathSegment, type ObjectStore } from "./objectStore";
import { parseLogText } from "./parser";
import { createSignalEvaluationBudget, withSignalFields } from "./signalRules";
import {
  completeLogAnalysisJobWithReport,
  persistLogDecodedArtifact,
  failRun,
  getLogWorkerRunSnapshot as getActiveLogWorkerRunSnapshot,
  updateRunStageProgress
} from "./repository";
import { notifyLogAnalysisCompleted, notifyLogAnalysisFailed } from "../notifications/producers";
import type { LogArtifactWriter } from "./artifactObjects";
import type { LogWebhookDeliverer } from "./webhookDelivery";
import type { LogStage } from "./status";
import { requireRelatedParameterRunSnapshot } from "./relatedParameter";
import { JobLeaseLostError, keepLogJobLease, logJobLimits, type LogJobLease } from "./jobLease";
import { emitLogTrace, withLogTrace } from "./traceTypes";
import { persistLogTraceStep } from "./traceRepository";

type LogWorkerMetrics = Pick<MetricsRegistry, "recordLogAnalysisJobResult"> &
  Partial<Pick<MetricsRegistry, "recordLogAnalysisDegraded">>;

/** Wake-up hook only; terminal-state repositories enqueue durably in their transaction. */
export type LogWorkerWebhooks = Pick<LogWebhookDeliverer, "notifyAnalysisTerminal">;

export type ProcessLogWorkerOptions = {
  db: Database;
  objectStore: ObjectStore;
  analyzer?: LogAnalysisAdapter;
  workerId?: string;
  leaseTtlMs?: number;
  maxJobMs?: number;
  preprocessingMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  now?: () => Date;
  metrics?: LogWorkerMetrics;
  tracing?: Pick<TracingBoundary, "withSpan">;
  webhooks?: LogWorkerWebhooks;
};

export type ProcessLogWorkerByIdOptions = ProcessLogWorkerOptions & {
  jobId: string;
};

export type ProcessLogWorkerResult =
  | { status: "processed" }
  | { status: "idle" }
  | { status: "retry"; reason: string; nextRunAt: string }
  | { status: "dead-lettered"; reason: string };

type StageStatus = "processing" | "complete" | "failed";

async function traceLogAnalysisJob(
  tracing: Pick<TracingBoundary, "withSpan"> | undefined,
  trigger: "polling" | "queue",
  fn: () => Promise<ProcessLogWorkerResult>
): Promise<ProcessLogWorkerResult> {
  const attributes: Record<string, string | number | boolean> = { trigger };
  const execute = async () => {
    try {
      const result = await fn();
      attributes.status = result.status;
      return result;
    } catch (error) {
      attributes.status = "failed";
      attributes.errorType = error instanceof Error ? error.name : "unknown";
      throw error;
    }
  };

  return tracing ? tracing.withSpan("log_analysis.job", attributes, execute) : execute();
}

function assertActiveJobLease(updated: boolean) {
  if (!updated) {
    throw new JobLeaseLostError();
  }
}

async function markProgress(
  options: ProcessLogWorkerOptions & { lease: LogJobLease },
  input: {
    organizationId: string;
    jobId: string;
    runId: string;
    stage: LogStage;
    status: StageStatus;
    progress: number;
    message: string;
    leaseOwner: string;
  }
) {
  assertActiveJobLease(
    await options.lease.run(() => updateJobProgress(options.db, {
      organizationId: input.organizationId,
      jobId: input.jobId,
      progress: input.progress,
      currentStage: input.stage,
      leaseOwner: input.leaseOwner
    }))
  );
  await options.lease.run(() => updateRunStageProgress(options.db, {
    organizationId: input.organizationId,
    runId: input.runId,
    status: input.status === "failed" ? "failed" : "processing",
    stageStatus: input.status === "failed" ? "failed" : input.status,
    stage: input.stage,
    progress: input.progress,
    message: input.message
  }));
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Honest degradation (glossary: Degraded analysis): a transient provider failure keeps
 * riding the existing job retry/backoff; the retry-exhausting final attempt falls back
 * to the deterministic rule analyzer with explicit provenance instead of dead-lettering.
 * Only a failing fallback continues into the existing failure/dead-letter path.
 * Exported for the behavior-layer eval harness, which exercises the same chain.
 */
export async function analyzeWithDegradation(input: {
  analyzer: LogAnalysisAdapter;
  analyzeInput: AnalyzeLogInput;
  job: Pick<ClaimedLogAnalysisJobDto, "attemptCount">;
  maxAttempts: number;
  retryBaseDelayMs: number;
  now: () => Date;
  metrics?: LogWorkerMetrics;
}): Promise<AnalyzeLogOutput> {
  input = { ...input, analyzeInput: withLogTrace(input.analyzeInput) };
  try {
    return await input.analyzer.analyze(input.analyzeInput);
  } catch (error) {
    input.analyzeInput.signal?.throwIfAborted();
    if (!(error instanceof LogAnalysisProviderError)) {
      throw error;
    }
    const decision = decideRetry({
      attemptCount: input.job.attemptCount,
      maxAttempts: input.maxAttempts,
      baseDelayMs: input.retryBaseDelayMs,
      now: input.now()
    });
    if (decision.action === "retry") {
      throw error;
    }

    input.metrics?.recordLogAnalysisDegraded?.({
      reason: "provider-unavailable",
      model: error.modelLabel ?? "unknown"
    });
    await emitLogTrace(input.analyzeInput, { kind: "degradation", reason: "provider-unavailable" });
    const fallback = await createRuleBasedLogAnalyzer().analyze(input.analyzeInput);
    return {
      ...fallback,
      analysisSource: "rules-fallback",
      degradedReason: "provider-unavailable",
      promptVersion: LOG_ANALYSIS_PROMPT_VERSION,
      model: error.modelLabel
    };
  }
}

async function processClaimedLogAnalysisJob(
  {
    db,
    objectStore,
    analyzer,
    workerId,
    maxAttempts,
    retryBaseDelayMs,
    preprocessingMs,
    now,
    metrics,
    webhooks,
    lease,
    writeArtifact,
    notificationDb = db
  }: Required<Pick<ProcessLogWorkerOptions, "analyzer" | "workerId" | "maxAttempts" | "retryBaseDelayMs" | "preprocessingMs" | "now">> &
    Pick<ProcessLogWorkerOptions, "db" | "objectStore" | "metrics" | "webhooks"> & { lease: LogJobLease; writeArtifact: LogArtifactWriter; notificationDb?: Database },
  job: ClaimedLogAnalysisJobDto
): Promise<ProcessLogWorkerResult> {
  const leaseOwner = job.leaseOwner ?? workerId;
  const startedAtMs = now().getTime();

  const options = { db, objectStore, analyzer, lease };
  const recordMetric = (input: {
    status: "complete" | "retry" | "dead_lettered" | "failed";
    stage: LogStage;
    failureReason?: LogAnalysisJobFailureReason;
    endedAt?: Date;
  }) => {
    metrics?.recordLogAnalysisJobResult({
      status: input.status,
      stage: input.stage,
      durationMs: Math.max(0, (input.endedAt ?? now()).getTime() - startedAtMs),
      ...(input.failureReason ? { failureReason: input.failureReason } : {})
    });
  };

  let currentStage: LogStage = "parse";
  let currentProgress = 0;
  let currentFailureReason: LogAnalysisJobFailureReason = "unknown";
  let failedSnapshot: Awaited<ReturnType<typeof getActiveLogWorkerRunSnapshot>> = null;
  let failureLogId = job.logId;

  try {
    const jobSnapshot = await lease.run(() => getJobSnapshot(db, job.id));
    failureLogId = jobSnapshot?.logId ?? failureLogId;
    const snapshot = await lease.run(() => getActiveLogWorkerRunSnapshot(db, job.id));
    failedSnapshot = snapshot;
    if (!snapshot) {
      const staleReason = jobSnapshot
        ? "已有更新的分析，本次分析已停止。"
        : "无法读取待分析的日志。";

      const failed = await db.transaction(async (tx) => {
        const failedJob = await failJob(tx, {
          organizationId: job.organizationId,
          jobId: job.id,
          currentStage: "parse",
          error: staleReason,
          leaseOwner
        });
        if (!failedJob) return false;

        if (jobSnapshot) {
          await updateRunStageProgress(tx, {
            organizationId: jobSnapshot.organizationId,
            runId: jobSnapshot.runId,
            status: "failed",
            stageStatus: "failed",
            stage: jobSnapshot.currentStage,
            progress: jobSnapshot.progress,
            message: staleReason
          });
          await failRun(tx, {
            organizationId: jobSnapshot.organizationId,
            logId: jobSnapshot.logId,
            runId: jobSnapshot.runId,
            currentStage: jobSnapshot.currentStage,
            error: staleReason
          });
        }
        return true;
      });
      if (!failed) return { status: "idle" };
      recordMetric({ status: "failed", stage: jobSnapshot?.currentStage ?? "parse", failureReason: "stale_run" });
      return { status: "processed" };
    }

    let relatedParameterSnapshot: AnalyzeLogInput["relatedParameterSnapshot"];
    if (snapshot.relatedParameterId) {
      if (!snapshot.relatedParameterProjectId) {
        throw new Error("关联参数缺少项目信息，请重新选择参数。");
      }
      relatedParameterSnapshot = requireRelatedParameterRunSnapshot(snapshot.relatedParameterSnapshot, {
        organizationId: snapshot.organizationId,
        projectId: snapshot.relatedParameterProjectId,
        bindingId: snapshot.relatedParameterId
      });
    } else if (snapshot.relatedParameterProjectId || snapshot.relatedParameterSnapshot != null) {
      throw new Error("关联参数信息不一致，请重新选择参数。");
    }
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "parse",
      status: "processing",
      progress: 10,
      message: "正在读取并解析上传的日志。",
      leaseOwner
    });
    currentProgress = 10;

    currentFailureReason = "object_store_error";
    if (snapshot.logDomain && !snapshot.skillRevisionId) throw new Error("分析技能版本缺失，请重新发起分析。");
    const formatProfile = readStoredLogFormatProfile(snapshot.logDomain?.formatProfile ?? undefined);
    const inventory = await lease.run(() => loadLogFiles(db, snapshot.organizationId, snapshot.logId));
    const hadInventory = inventory.length > 0;
    // Unclassified uploads retain the legacy prefilter. A pinned skill without
    // rules stays explicitly empty instead of inheriting charging rules.
    const signalRules = snapshot.signalRules ?? (snapshot.skillRevisionId ? genericSignalRuleSet : undefined);
    const files: NonNullable<AnalyzeLogInput["files"]> = [];
    if (!inventory.length && objectStore.getStream) {
      const legacy = await lease.run(() => loadLegacyLogFile(db, snapshot.organizationId, snapshot.logId, snapshot.fileName));
      if (legacy) inventory.push(legacy);
    }
    if (!inventory.length) inventory.push({ path: snapshot.fileName, objectKey: snapshot.storageKey,
      sizeBytes: 0, lineCount: 0, status: "analyzed", encoding: "utf-8", lossy: false, skipReason: null });
    const assignFile = compileSkillFiles(snapshot.files);
    for (const file of inventory) Object.assign(file, assignFile(file.path));
    // One allowance includes the initial prefilter, decoding, and signal extraction.
    const preprocessingDeadline = performance.now() + Math.min(preprocessingMs, lease.remainingMs());
    const prefilterBudget = createPrefilterBudget(createSignalEvaluationBudget(preprocessingDeadline));
    const prepare = (file: typeof inventory[number]) => {
      const reader = createLogFileReader(objectStore, file, file.skillMatched === false ? undefined : formatProfile,
        () => lease.run(() => ensureStoredLogIndex(db, lease.rawObjectStore, snapshot.organizationId, snapshot.logId, file, writeArtifact)));
      const entries = reader.entries({ deadline: preprocessingDeadline });
      const first = entries.next();
      // A later file may fail while the current file is still being consumed.
      void first.catch(() => undefined);
      return { reader, entries, first };
    };
    const pending = new Map<number, ReturnType<typeof prepare>>();
    let nextFile = 0;
    const prefetch = () => {
      if (!objectStore.getStream) return;
      // Start at most eight GET streams, but consume in inventory order so the
      // shared reference budget and resulting evidence stay deterministic.
      while (pending.size < 8 && nextFile < inventory.length) {
        const index = nextFile++;
        if (inventory[index].status !== "skipped") pending.set(index, prepare(inventory[index]));
      }
    };
    prefetch();
    let readPreview = false;
    try { for (const [fileIndex, file] of inventory.entries()) {
      const { objectKey: _objectKey, lineIndexKey: _indexKey, ...entry } = file;
      const fileRules = file.skillMatched === false ? genericSignalRuleSet : signalRules;
      const fileProfile = file.skillMatched === false ? undefined : formatProfile;
      if (file.status === "skipped") { files.push(entry); continue; }
      if (!objectStore.getStream) {
        // Compatibility for small offline adapters; production local/S3 stores always stream.
        const content = await objectStore.get(file.objectKey!);
        currentFailureReason = "parse_error";
        const legacy = parseLogText({ fileName: hadInventory ? "decoded.log" : snapshot.fileName,
          content }, { profile: fileProfile });
        if (!legacy.ok) throw new Error(legacy.reason);
        const prefilter = await prefilterLogStream((async function* () { yield* legacy.entries; })(), fileRules, prefilterBudget);
        files.push({ ...entry, lineCount: legacy.rawLines.length, parsed: legacy, prefilter });
        continue;
      }
      const { reader, entries, first } = pending.get(fileIndex)!;
      currentFailureReason = "parse_error";
      const prefilter = await prefilterLogStream((async function* () {
        const initial = await first;
        if (!initial.done) yield initial.value;
        yield* entries;
      })(), fileRules, prefilterBudget);
      pending.delete(fileIndex);
      const preview: string[] = [];
      if (!readPreview) {
        readPreview = true;
        let previewBudget = 128 * 1024;
        for await (const line of reader.lines()) {
          const cost = Buffer.byteLength(line.content);
          if (preview.length >= 400 || cost > previewBudget) break;
          preview.push(line.content); previewBudget -= cost;
        }
      }
      prefetch();
      const parsedFile = parseLogText({ fileName: "decoded.log", content: preview.join("\n") }, { profile: fileProfile });
      if (!parsedFile.ok) throw new Error(parsedFile.reason);
      parsedFile.rawLines = preview;
      files.push({ ...entry, lineCount: reader.lineCount, reader, prefilter, parsed: parsedFile });
      currentFailureReason = "object_store_error";
    } } finally {
      await Promise.all([...pending.values()].map(({ entries }) => entries.return(undefined)));
    }
    const analyzed = files.filter((file) => file.parsed);
    if (!analyzed.length) throw new Error("日志包中没有可分析的文本文件");
    const parsed = analyzed[0].parsed!;
    const stats = { lineCount: analyzed.reduce((sum, file) => sum + file.lineCount, 0),
      entryCount: analyzed.reduce((sum, file) => sum + (file.prefilter ? Object.values(file.prefilter.severityCounts).reduce((a, b) => a + b, 0) : file.parsed!.entries.length), 0) };
    currentFailureReason = "unknown";

    lease.signal.throwIfAborted();
    let decoding: AnalyzeLogInput["decoding"];
    let decodedArtifact: { objectKey: string | null; counts: DecodeCounts } | undefined;
    if (snapshot.parsing?.extractors.length) {
      const parsing = snapshot.parsing;
      const maxMs = Math.min(logDecodeLimits().maxMs, Math.max(0, preprocessingDeadline - performance.now()), lease.remainingMs());
      decodedArtifact = { objectKey: null, counts: { total: 0,
        byExtractor: Object.fromEntries(snapshot.parsing.extractors.map(({ id }) => [id, 0])), errors: {} } };
      let cleanupKey: string | undefined;
      let failureCode = "decode_error";
      try {
        decoding = { spec: parsing, ...await lease.run(() => decodeLogFilesCooperatively(parsing,
          analyzed.filter((file) => file.skillMatched !== false).map((file) => file.reader ? { file: file.path, reader: file.reader } : { file: file.path, lines: file.parsed!.rawLines }), { maxMs })) };
        decodedArtifact.counts = decoding.counts;
        failureCode = "artifact_error";
        const bytes = await lease.run(() => gzipDecodedEvents(decoding!.events));
        const fileName = sanitizeFileName(`${snapshot.runId}-decoded-events.jsonl.gz`);
        // Shipped local/S3 stores use this content-addressed key. Retain it before
        // the write so even an upload with a lost response can be cleaned up.
        cleanupKey = `${sanitizePathSegment(snapshot.organizationId, "organization id")}/${createHash("sha256").update(bytes).digest("hex")}-${fileName}`;
        decodedArtifact.objectKey = (await lease.run(() => writeArtifact(lease.rawObjectStore, snapshot.logId,
          { organizationId: snapshot.organizationId, fileName, contentType: "application/gzip", bytes }))).storageKey;
      } catch {
        decodedArtifact.counts.errors[failureCode] = (decodedArtifact.counts.errors[failureCode] ?? 0) + 1;
        decoding = undefined;
        if (cleanupKey) await objectStore.delete?.(cleanupKey).catch(() => undefined);
        lease.signal.throwIfAborted();
      }
    }

    if (decodedArtifact) assertActiveJobLease(await lease.run(() => persistLogDecodedArtifact(db, {
      ...decodedArtifact, organizationId: snapshot.organizationId, runId: snapshot.runId, jobId: snapshot.jobId, leaseOwner
    })));

    // Query cursors require extractor/completion order; evidence needs direct file/line lookup.
    // The array and index share event objects (no field/raw-value copies).
    const eventsByLine = indexDecodedEvents(decoding?.events ?? []);
    const usesFields = signalRules?.rules.some((rule) => rule.anyOf.some((condition) =>
      condition.type === "field" || condition.type === "window" && condition.condition.type === "field"));
    if (usesFields) {
      const budget = createPrefilterBudget(prefilterBudget.evaluation);
      for (const file of analyzed) {
        if (file.skillMatched === false) continue;
        const enrich = (entry: Parameters<typeof withSignalFields>[0]) => withSignalFields(entry, eventsByLine.get(JSON.stringify([file.path, entry.lineNumber])));
        file.parsed!.entries = file.parsed!.entries.map(enrich);
        {
          const complete = file.prefilter!;
          const refined = await lease.run(() => prefilterLogStream((async function* () {
            if (file.reader) for await (const entry of file.reader.entries({ deadline: preprocessingDeadline })) yield enrich(entry);
            else yield* file.parsed!.entries;
          })(), signalRules, budget));
          // A bounded second pass must not erase text evidence collected before decoding.
          const evidence = signalRules!.rules.flatMap((rule) => {
            const before = complete.evidence.find((item) => item.ruleHit === rule.id);
            const after = refined.evidence.find((item) => item.ruleHit === rule.id);
            const item = after ?? before;
            return item ? [{ ...item, lineNumbers: [...new Set([...(before?.lineNumbers ?? []), ...(after?.lineNumbers ?? [])])].sort((a, b) => a - b).slice(0, 2000) }] : [];
          });
          file.prefilter = { ...complete, evidence, ruleHits: evidence.map((item) => item.ruleHit!),
            anomalyLineNumbers: [...new Set([...complete.anomalyLineNumbers, ...refined.anomalyLineNumbers])].sort((a, b) => a - b).slice(0, 2000),
            hasErrorEvidence: complete.hasErrorEvidence || refined.hasErrorEvidence, truncated: complete.truncated || refined.truncated };
        }
      }
    }
    let signalSummary: NonNullable<AnalyzeLogInput["signalSummary"]>;
    try {
      signalSummary = await lease.run(() => extractLogSignalsCooperatively(files, signalRules,
        { eventsByLine, evaluation: prefilterBudget.evaluation, maxMs: Math.min(logSignalLimits().maxMs, Math.max(0, preprocessingDeadline - performance.now())) }));
    } catch {
      lease.signal.throwIfAborted();
      signalSummary = { signals: [], templates: [], truncatedSignals: false, truncatedTemplates: false, truncated: true, reason: "extraction_error" };
    }
    if (analyzed.some((file) => file.prefilter?.truncated)) {
      signalSummary.truncated = true;
      signalSummary.reason ??= performance.now() >= preprocessingDeadline ? "time_cap" : "extraction_error";
    }
    if (usesFields && (!decoding || ["time_cap", "line_cap", "match_input_cap", "event_cap"].some((code) => decoding.counts.errors[code]))) {
      signalSummary.truncated = true;
      signalSummary.reason = decoding?.counts.errors.time_cap ? "time_cap" : decoding?.counts.errors.line_cap || decoding?.counts.errors.match_input_cap ? "line_cap" : "extraction_error";
    }

    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "parse",
      status: "complete",
      progress: 30,
      message: "日志解析完成。",
      leaseOwner
    });
    currentProgress = 30;

    currentStage = "pattern";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "pattern",
      status: "processing",
      progress: 40,
      message: "正在查找已知异常。",
      leaseOwner
    });
    currentProgress = 40;

    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "pattern",
      status: "complete",
      progress: 55,
      message: "异常识别完成。",
      leaseOwner
    });
    currentProgress = 55;

    currentStage = "rootcause";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "rootcause",
      status: "processing",
      progress: 65,
      message: "正在根据证据分析可能原因。",
      leaseOwner
    });
    currentProgress = 65;

    // P2: the analysis kernel runs inside the rootcause stage (the agent loop's
    // natural home); loop steps advance the progress bar inside the 65→80 range.
    const knowledgeRevisions = new Map<string, { entryId: string; revisionId: string; pages?: number[] }>();
    const analysis = await lease.run(() => analyzeWithDegradation({
      analyzer,
      analyzeInput: {
        signal: lease.signal,
        knowledgeEntryIds: snapshot.knowledgeEntryIds,
        onKnowledgeRetrieved: (revisions) => {
          for (const revision of revisions) {
            const key = `${revision.entryId}:${revision.revisionId}`;
            const pages = [...new Set([...(knowledgeRevisions.get(key)?.pages ?? []), ...(revision.pages ?? [])])].sort((a, b) => a - b);
            knowledgeRevisions.set(key, { entryId: revision.entryId, revisionId: revision.revisionId,
              ...(pages.length ? { pages } : {}) });
          }
        },
        signalSummary,
        stats,
        procedure: snapshot.procedure,
        decoding,
        sourceSnapshot: snapshot.sourceSnapshot,
        files,
        filePath: analyzed[0].path,
        signalRules,
        parsed,
        analysisQuestion: snapshot.analysisQuestion ?? undefined,
        logDomain: snapshot.logDomain
          ? {
              name: snapshot.logDomain.name,
              description: snapshot.logDomain.description ?? undefined,
              modelOverride: snapshot.logDomain.modelOverride ?? undefined,
              stepBudget: snapshot.logDomain.stepBudget,
              tokenBudget: snapshot.logDomain.tokenBudget
            }
          : undefined,
        organizationId: snapshot.organizationId,
        logDomainId: snapshot.logDomain?.id,
        relatedParameterId: snapshot.relatedParameterId ?? undefined,
        relatedParameterSnapshot,
        onTrace: (step) => lease.run(async () => {
          lease.signal.throwIfAborted();
          if (!await persistLogTraceStep(db, { organizationId: snapshot.organizationId, runId: snapshot.runId, step, jobId: snapshot.jobId, leaseOwner })) throw new JobLeaseLostError();
        }),
        onProgress: async ({ step, maxSteps }) => {
          const boundedStep = Math.min(Math.max(step, 1), Math.max(maxSteps, 1));
          const progress = 65 + Math.min(14, Math.floor(((boundedStep - 1) / Math.max(maxSteps, 1)) * 15));
          if (progress <= currentProgress) {
            return;
          }
          await markProgress(options, {
            organizationId: snapshot.organizationId,
            jobId: snapshot.jobId,
            runId: snapshot.runId,
            stage: "rootcause",
            status: "processing",
            progress,
            message: `正在分析，第 ${boundedStep}/${maxSteps} 步。`,
            leaseOwner
          });
          currentProgress = progress;
        }
      },
      job,
      maxAttempts,
      retryBaseDelayMs,
      now,
      metrics
    }));

    if (snapshot.sourceSnapshot && snapshot.sourceSnapshot.status !== "ready") {
      const reason = { queued: "仍在排队", indexing: "仍在索引", failed: "索引失败", archived: "已归档" }[snapshot.sourceSnapshot.status];
      analysis.conclusion += `\n\n源码快照${reason}，本次分析未使用源码`;
    }

    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "rootcause",
      status: "complete",
      progress: 80,
      message: "原因分析与证据已整理。",
      leaseOwner
    });
    currentProgress = 80;

    currentStage = "report";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "report",
      status: "processing",
      progress: 90,
      message: "正在生成报告并保存证据。",
      leaseOwner
    });
    currentProgress = 90;

    const completed = await completeLogAnalysisJobWithReport(db, {
      signal: lease.signal,
      organizationId: snapshot.organizationId,
      logId: snapshot.logId,
      runId: snapshot.runId,
      jobId: snapshot.jobId,
      leaseOwner,
      sourceSnapshot: snapshot.sourceSnapshot,
      sourceSnapshotSelection: snapshot.sourceSnapshotSelection,
      files,
      report: {
        knowledgeRevisions: [...knowledgeRevisions.values()],
        signalSummary,
        confidence: analysis.confidence,
        conclusion: analysis.conclusion,
        impact: analysis.impact,
        severity: analysis.severity,
        suggestedActions: analysis.suggestedActions,
        rawLines: (files.find((file) => file.parsed)?.parsed ?? parsed).rawLines,
        analysisSource: analysis.analysisSource,
        degradedReason: analysis.degradedReason,
        promptVersion: analysis.promptVersion,
        model: analysis.model
      },
      evidence: analysis.evidence.map((evidence) => {
        const file = evidence.filePath ?? files.find((file) => file.parsed)?.path ?? snapshot.fileName;
        const decodedFields = [...new Set(evidence.lineNumbers)].flatMap((line) => eventsByLine.get(JSON.stringify([file, line])) ?? []);
        return { ...evidence, decodedFields: decodedFields.length ? decodedFields : undefined };
      })
    });
    if (!completed) return { status: "idle" };
    lease.stop();

    if (snapshot.submittedByUserId) {
      await notifyLogAnalysisCompleted(notificationDb, {
        organizationId: snapshot.organizationId,
        logId: snapshot.logId,
        runId: snapshot.runId,
        fileName: snapshot.fileName,
        recipientUserId: snapshot.submittedByUserId,
        conclusion: relatedParameterSnapshot ? undefined : analysis.conclusion
      });
    }

    // Wake the outbox after the terminal transaction commits.
    if (snapshot.logDomain && webhooks) {
      webhooks.notifyAnalysisTerminal({
        organizationId: snapshot.organizationId,
        logDomainId: snapshot.logDomain.id,
        logId: snapshot.logId,
        runId: snapshot.runId,
        fileName: snapshot.fileName,
        status: "complete",
        analysisSource: analysis.analysisSource,
        degradedReason: analysis.degradedReason,
        severity: analysis.severity,
        confidence: analysis.confidence,
        conclusion: relatedParameterSnapshot ? undefined : analysis.conclusion,
        occurredAt: now().toISOString()
      });
    }

    recordMetric({ status: "complete", stage: "report" });
    return { status: "processed" };
  } catch (error) {
    const snapshot = failedSnapshot;
    if (lease.signal.aborted) error = lease.signal.reason;
    if (error instanceof JobLeaseLostError) {
      return { status: "idle" };
    }
    const message = readableError(error);
    const endedAt = now();
    const decision = decideRetry({ attemptCount: job.attemptCount, maxAttempts, baseDelayMs: retryBaseDelayMs, now: endedAt });
    if (decision.action === "retry") {
      const scheduled = await markJobRetryScheduled(db, {
        organizationId: job.organizationId,
        jobId: job.id,
        currentStage,
        error: message,
        nextRunAt: decision.nextRunAt,
        reason: decision.reason,
        leaseOwner
      });
      if (!scheduled) return { status: "idle" };
      recordMetric({ status: "retry", stage: currentStage, failureReason: currentFailureReason, endedAt });
      return { status: "retry", reason: decision.reason, nextRunAt: decision.nextRunAt };
    }

    const failureReason = `日志分析已尝试 ${maxAttempts} 次，仍未完成。${message}`;
    const deadLettered = await db.transaction(async (tx) => {
      const deadLettered = await markJobDeadLettered(tx, {
        organizationId: job.organizationId,
        jobId: job.id,
        currentStage,
        error: message,
        reason: decision.reason,
        leaseOwner
      });
      if (!deadLettered) return false;

      await updateRunStageProgress(tx, {
        organizationId: job.organizationId,
        runId: job.runId,
        status: "failed",
        stageStatus: "failed",
        stage: currentStage,
        progress: currentProgress,
        message
      });
      await failRun(tx, {
        organizationId: job.organizationId,
        logId: failureLogId,
        runId: job.runId,
        currentStage,
        error: failureReason
      });
      return true;
    });
    if (!deadLettered) return { status: "idle" };
    if (snapshot?.submittedByUserId) {
      await notifyLogAnalysisFailed(db, {
        organizationId: snapshot.organizationId,
        logId: snapshot.logId,
        runId: snapshot.runId,
        fileName: snapshot.fileName,
        recipientUserId: snapshot.submittedByUserId,
        failureReason
      });
    }
    if (snapshot?.logDomain && webhooks) {
      webhooks.notifyAnalysisTerminal({
        organizationId: snapshot.organizationId,
        logDomainId: snapshot.logDomain.id,
        logId: snapshot.logId,
        runId: snapshot.runId,
        fileName: snapshot.fileName,
        status: "failed",
        conclusion: failureReason,
        occurredAt: endedAt.toISOString()
      });
    }
    recordMetric({ status: "dead_lettered", stage: currentStage, failureReason: currentFailureReason, endedAt });
    return { status: "dead-lettered", reason: decision.reason };
  }
}

export async function processNextLogAnalysisJob({
  db,
  objectStore,
  analyzer = createRuleBasedLogAnalyzer(),
  workerId = "wiseeff-log-worker",
  leaseTtlMs = 60_000,
  maxJobMs = logJobLimits().maxJobMs,
  preprocessingMs = logJobLimits().preprocessingMs,
  maxAttempts = 4,
  retryBaseDelayMs = 1000,
  now = () => new Date(),
  metrics,
  tracing,
  webhooks
}: ProcessLogWorkerOptions): Promise<"processed" | "idle"> {
  const job = await claimNextJob(db, { kind: "log-analysis", leaseOwner: workerId, leaseTtlMs });
  if (!job) return "idle";
  const notificationDb = db;
  const writeArtifact = admittedLogArtifactWriter(db, job);
  db = admittedLogCompletionDatabase(db, job);
  const process = async () => {
    const lease = keepLogJobLease(db, objectStore, { jobId: job.id, leaseOwner: job.leaseOwner ?? workerId, leaseMs: leaseTtlMs, maxJobMs });
    try { return await processClaimedLogAnalysisJob({ db, notificationDb, objectStore: lease.objectStore, analyzer, workerId, maxAttempts, retryBaseDelayMs, preprocessingMs, now, metrics, webhooks, lease, writeArtifact }, job); }
    finally { lease.stop(); }
  };
  const result = await traceLogAnalysisJob(tracing, "polling", process);
  return result.status === "idle" ? "idle" : "processed";
}

export async function processLogAnalysisJobById({
  db,
  objectStore,
  jobId,
  analyzer = createRuleBasedLogAnalyzer(),
  workerId = "wiseeff-log-worker",
  leaseTtlMs = 60_000,
  maxJobMs = logJobLimits().maxJobMs,
  preprocessingMs = logJobLimits().preprocessingMs,
  maxAttempts = 4,
  retryBaseDelayMs = 1000,
  now = () => new Date(),
  metrics,
  tracing,
  webhooks
}: ProcessLogWorkerByIdOptions): Promise<ProcessLogWorkerResult> {
  const job = await claimJobById(db, { kind: "log-analysis", jobId, leaseOwner: workerId, leaseTtlMs });
  if (!job) return { status: "idle" };
  const notificationDb = db;
  const writeArtifact = admittedLogArtifactWriter(db, job);
  db = admittedLogCompletionDatabase(db, job);
  const process = async () => {
    const lease = keepLogJobLease(db, objectStore, { jobId: job.id, leaseOwner: job.leaseOwner ?? workerId, leaseMs: leaseTtlMs, maxJobMs });
    try { return await processClaimedLogAnalysisJob({ db, notificationDb, objectStore: lease.objectStore, analyzer, workerId, maxAttempts, retryBaseDelayMs, preprocessingMs, now, metrics, webhooks, lease, writeArtifact }, job); }
    finally { lease.stop(); }
  };
  return traceLogAnalysisJob(tracing, "queue", process);
}

export function startLogWorkerLoop(options: ProcessLogWorkerOptions, intervalMs = 1000): () => void {
  let stopped = false;
  let running = false;

  const tick = () => {
    if (stopped || running) return;
    running = true;
    void processNextLogAnalysisJob(options)
      .catch(() => {
        // Intentionally swallow unexpected loop-level failures after they have been surfaced by the worker tests.
      })
      .finally(() => {
        running = false;
      });
  };

  const interval = setInterval(tick, intervalMs);
  tick();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
