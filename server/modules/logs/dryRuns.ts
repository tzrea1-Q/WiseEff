import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { compileSkillFiles } from "../../../src/domain/logs/fileApplicability";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { logTraceStepSchema, logDryRunReportSchema, logSkillDryRunSchema } from "../contracts/dtoSchemas/logs";
import { genericSignalRuleSet, type AnalyzeLogInput, type LogAnalysisAdapter } from "./analyzer";
import { requireLogAdminDomains } from "./policy";
import { getLogRecord } from "./service";
import { listSkillRevisions, lockSkill } from "./skillsRepository";
import { readStoredLogFormatProfile } from "./formatProfile";
import { parseLogText } from "./parser";
import { extractLogSignalsCooperatively, logSignalLimits } from "./genericSignals";
import { decodeLogFilesCooperatively, indexDecodedEvents, logDecodeLimits } from "./parsing/workerDecoding";
import { analyzeWithDegradation } from "./worker";
import { logJobLimits } from "./jobLease";
import { logLineRangeQuerySchema } from "./schemas";
import { buildLogLineIndex, createLogFileReader, readStoredLogRange } from "./fileReader";
import { createPrefilterBudget, prefilterLogStream } from "./prefilter";
import { acquireDryRunOwner, assertDryRunCapacity, activeDryRunWork, LOG_DRY_RUN_ADMISSION_LOCK, LOG_DRY_RUN_INTERRUPTED, recoverInterruptedDryRuns } from "./dryRunAdmission";
import type { StoredLogFile } from "./filesRepository";
import type { ObjectStore } from "./objectStore";
import { readStoredSkillSampleBundle } from "./skillSamplesService";
import { createSignalEvaluationBudget, withSignalFields } from "./signalRules";
import { readLogTraceSteps } from "./traceRepository";
import type { LogSkillSpec } from "./skillSpec";
import type { z } from "zod";

export const LOG_DRY_RUN_KEEP = 10;
export const LOG_DRY_RUN_TIMEOUT_MS = 120_000;
// Keep counting non-cancellable tool/provider work even after its deadline or DB connection is lost.
const activeWork = activeDryRunWork;
type DryRun = z.infer<typeof logSkillDryRunSchema>;
function withSampleContents(store: ObjectStore, contents: Map<string, Buffer>): ObjectStore {
  return { ...store,
    get: async (key) => contents.get(key) ?? store.get(key),
    getStream: async (key, range) => {
      const bytes = contents.get(key);
      if (bytes) return Readable.from([bytes.subarray(range?.start ?? 0, range?.end === undefined ? undefined : range.end + 1)]);
      return store.getStream ? store.getStream(key, range)
        : Readable.from([(await store.get(key)).subarray(range?.start ?? 0, range?.end === undefined ? undefined : range.end + 1)]);
    }
  };
}
function requireAdmin(auth: AuthContext) {
  requireLogAdminDomains(auth);
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "无权访问此组织的日志。");
}
export async function getLogTrace(db: Database, auth: AuthContext, logId: string) {
  requireAdmin(auth);
  // Preserve the record's related-parameter visibility boundary as well as tenancy.
  await getLogRecord(db, auth, logId);
  const row = (await db.query<{ current_run_id: string }>("select current_run_id from log_records where organization_id = $1 and id = $2", [auth.organization.id, logId])).rows[0];
  return { steps: row?.current_run_id ? await readLogTraceSteps(db, auth.organization.id, { runId: row.current_run_id }) : [] };
}
export async function getSkillDryRun(db: Database, auth: AuthContext, skillId: string, id: string) {
  requireAdmin(auth);
  await recoverInterruptedDryRuns(db, auth.organization.id);
  const row = (await db.query<DryRun>(`select id, skill_revision_id as "skillRevisionId", status, progress, report, error, created_at as "createdAt"
    from log_skill_dry_runs where organization_id = $1 and skill_id = $2 and id = $3`, [auth.organization.id, skillId, id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "试运行记录不存在。");
  const run = logSkillDryRunSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString() });
  return { run, steps: await readLogTraceSteps(db, auth.organization.id, { dryRunId: id }) };
}
export async function getSkillDryRunLines(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, id: string,
  input: { file: string; startLine: number; endLine: number }) {
  requireAdmin(auth);
  const range = logLineRangeQuerySchema.safeParse(input);
  if (!range.success) throw new ApiError("VALIDATION_FAILED", "每次最多查看 400 行日志（含起止行）。");
  const row = (await db.query<{ sample_file_name: string; sample_object_key: string }>(`select sample_file_name, sample_object_key from log_skill_dry_runs
    where organization_id = $1 and skill_id = $2 and id = $3`, [auth.organization.id, skillId, id])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "试运行样本不存在。");
  const bundle = await readStoredSkillSampleBundle(store, row.sample_file_name, row.sample_object_key);
  const file = bundle?.find((file) => file.path === input.file && file.status === "analyzed");
  if (bundle ? !file : row.sample_file_name !== input.file) throw new ApiError("NOT_FOUND", "试运行样本不存在。");
  const source = file ? withSampleContents(store, new Map([[row.sample_object_key, Buffer.from(file.content!)]])) : store;
  const lineCount = (await buildLogLineIndex(source, row.sample_object_key)).readUInt32LE(4);
  if (input.startLine > Math.max(1, lineCount)) throw new ApiError("VALIDATION_FAILED", "起始行超出样本范围。");
  const endLine = Math.min(lineCount, input.endLine);
  return { file: input.file, startLine: input.startLine, endLine, totalLines: lineCount,
    lines: endLine < input.startLine ? [] : await readStoredLogRange(source, {
      path: input.file, objectKey: row.sample_object_key, sizeBytes: 0, lineCount,
      encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null
    }, input.startLine, endLine) };
}

/** Admission is serialized in PostgreSQL; execution shares the configured read-only analyzer. */
export async function startSkillDryRun(db: Database, store: ObjectStore, analyzer: LogAnalysisAdapter,
  auth: AuthContext, skillId: string) {
  requireAdmin(auth);
  const timeoutMs = Math.min(LOG_DRY_RUN_TIMEOUT_MS, logJobLimits().maxJobMs);
  const owner = await acquireDryRunOwner(db);
  try {
    const admitted = await owner.db.transaction(async (tx) => {
      // One transaction lock covers counts and insertion across all API instances.
      await tx.query("select pg_advisory_xact_lock($1)", [LOG_DRY_RUN_ADMISSION_LOCK]);
      await lockSkill(tx, auth.organization.id, skillId);
      await recoverInterruptedDryRuns(tx);
      await assertDryRunCapacity(tx, auth.organization.id);
      const draft = (await listSkillRevisions(tx, auth.organization.id, skillId)).find((revision) => revision.status === "draft");
      if (!draft) throw new ApiError("CONFLICT", "请先保存草稿，再开始试运行。");
      const sample = (await tx.query<{ object_key: string; file_name: string; size_bytes: string; line_count: number; name: string; description: string | null }>(
        `select sample.object_key, sample.file_name, sample.size_bytes, sample.line_count, skill.name, skill.description from log_skill_samples sample
          join log_domains skill on skill.id = sample.skill_id and skill.organization_id = sample.organization_id
          where sample.organization_id = $1 and sample.skill_id = $2`, [auth.organization.id, skillId])).rows[0];
      if (!sample) throw new ApiError("CONFLICT", "请先上传样本，再开始试运行。");
      const id = randomUUID();
      await tx.query(`insert into log_skill_dry_runs (id, organization_id, skill_id, skill_revision_id, status, deadline_at, sample_file_name, sample_object_key, owner_pid, owner_key)
        values ($1, $2, $3, $4, 'processing', now() + $5 * interval '1 millisecond', $6, $7, $8, $9)`, [id, auth.organization.id, skillId, draft.id, timeoutMs, sample.file_name, sample.object_key, owner.pid, owner.key]);
      // Cascading trace deletion bounds retained history without touching user logs.
      await tx.query(`delete from log_skill_dry_runs where organization_id = $1 and skill_id = $2 and id in
        (select id from log_skill_dry_runs where organization_id = $1 and skill_id = $2 order by created_at desc, id desc offset $3)`,
      [auth.organization.id, skillId, LOG_DRY_RUN_KEEP]);
      return { id, spec: draft.spec, sample };
    });
    const initial = await getSkillDryRun(owner.db, auth, skillId, admitted.id);
    if (initial.run.status !== "processing") { await owner.close(); return { run: initial.run }; }
    void executeDryRun(db, store, analyzer, auth.organization.id, skillId, admitted, timeoutMs, owner);
    return { run: initial.run };
  } catch (error) { await owner.close(); throw error; }
}

async function executeDryRun(db: Database, store: ObjectStore, analyzer: LogAnalysisAdapter, organizationId: string, skillId: string,
  admitted: { id: string; spec: LogSkillSpec; sample: { object_key: string; file_name: string; size_bytes: string; line_count: number; name: string; description: string | null } }, timeoutMs: number,
  owner: Awaited<ReturnType<typeof acquireDryRunOwner>>) {
  activeWork.set(admitted.id, organizationId);
  const controller = new AbortController();
  const onOwnerLost = () => controller.abort();
  owner.signal.addEventListener("abort", onOwnerLost, { once: true });
  if (owner.signal.aborted) controller.abort();
  const streams = new Set<Readable>();
  const contents = new Map<string, Buffer>();
  const sampleStore = withSampleContents(store, contents);
  controller.signal.addEventListener("abort", () => { for (const stream of streams) stream.destroy(new Error(LOG_DRY_RUN_INTERRUPTED)); }, { once: true });
  const sourceStore: ObjectStore = { ...sampleStore, getStream: async (key: string, range?: { start: number; end?: number }) => {
    controller.signal.throwIfAborted();
    const stream = await sampleStore.getStream!(key, range);
    streams.add(stream); stream.once("close", () => streams.delete(stream));
    if (controller.signal.aborted) { stream.destroy(); controller.signal.throwIfAborted(); }
    return stream;
  } };
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    controller.signal.addEventListener("abort", () => reject(new Error(LOG_DRY_RUN_INTERRUPTED)), { once: true });
    if (controller.signal.aborted) reject(new Error(LOG_DRY_RUN_INTERRUPTED));
  });
  const run = async () => {
    controller.signal.throwIfAborted();
    const preprocessingDeadline = performance.now() + Math.min(logJobLimits().preprocessingMs, timeoutMs);
    const signalRules = admitted.spec.signalRules ?? genericSignalRuleSet;
    const matchFile = compileSkillFiles(admitted.spec.files);
    const bundle = await readStoredSkillSampleBundle(sourceStore, admitted.sample.file_name, admitted.sample.object_key);
    controller.signal.throwIfAborted();
    const inventory = bundle ?? [{ path: admitted.sample.file_name, sizeBytes: Number(admitted.sample.size_bytes),
      lineCount: admitted.sample.line_count, encoding: "utf-8" as const, lossy: false, status: "analyzed" as const, skipReason: null, content: undefined }];
    const files: NonNullable<AnalyzeLogInput["files"]> = [];
    const prefilterBudget = createPrefilterBudget(createSignalEvaluationBudget(preprocessingDeadline));
    for (const [index, sample] of inventory.entries()) {
      const { content, ...metadata } = sample;
      const assignment = matchFile(sample.path);
      const stored: StoredLogFile = { ...metadata, ...assignment,
        objectKey: bundle ? `${admitted.id}/${index}` : admitted.sample.object_key };
      if (sample.status === "skipped") { files.push(stored); continue; }
      if (content !== undefined) contents.set(stored.objectKey!, Buffer.from(content));
      const profile = assignment.skillMatched ? readStoredLogFormatProfile(admitted.spec.formatProfile) : undefined;
      const reader = createLogFileReader(sourceStore, stored, profile);
      const prefilter = await prefilterLogStream(reader.entries({ deadline: preprocessingDeadline }),
        assignment.skillMatched ? signalRules : genericSignalRuleSet, prefilterBudget);
      const preview: string[] = [];
      let previewBudget = 128 * 1024;
      if (!files.some((file) => file.parsed)) for await (const line of reader.lines({ deadline: preprocessingDeadline })) {
        const cost = Buffer.byteLength(line.content);
        if (preview.length >= 400 || cost > previewBudget) break;
        preview.push(line.content); previewBudget -= cost;
      }
      const parsed = parseLogText({ fileName: "sample.log", content: preview.join("\n") }, { profile });
      if (!parsed.ok) throw new Error("parse");
      parsed.rawLines = preview;
      files.push({ ...stored, lineCount: reader.lineCount, parsed, reader, prefilter });
    }
    const analyzed = files.filter((file) => file.parsed);
    if (!analyzed.length) throw new Error("Sample has no analyzable files.");
    const first = analyzed[0], parsed = first.parsed!;
    const decoding = admitted.spec.parsing?.extractors.length ? { spec: admitted.spec.parsing,
      ...await decodeLogFilesCooperatively(admitted.spec.parsing, analyzed.filter((file) => file.skillMatched !== false)
        .map((file) => ({ file: file.path, reader: file.reader! })),
        { maxMs: Math.min(logDecodeLimits().maxMs, Math.max(0, preprocessingDeadline - performance.now())) }) } : undefined;
    const events = indexDecodedEvents(decoding?.events ?? []);
    if (signalRules.rules.some((rule) => rule.anyOf.some((condition) => condition.type === "field" || condition.type === "window" && condition.condition.type === "field"))) {
      const refinementBudget = createPrefilterBudget(prefilterBudget.evaluation);
      for (const file of analyzed.filter((file) => file.skillMatched !== false)) {
        const enrich = (entry: Parameters<typeof withSignalFields>[0]) => withSignalFields(entry, events.get(JSON.stringify([file.path, entry.lineNumber])));
        file.parsed!.entries = file.parsed!.entries.map(enrich);
        const previous = file.prefilter!;
        const refined = await prefilterLogStream((async function* () {
          for await (const entry of file.reader!.entries({ deadline: preprocessingDeadline })) yield enrich(entry);
        })(), signalRules, refinementBudget);
        const evidence = signalRules.rules.flatMap((rule) => {
          const before = previous.evidence.find((item) => item.ruleHit === rule.id), after = refined.evidence.find((item) => item.ruleHit === rule.id);
          const item = after ?? before;
          return item ? [{ ...item, lineNumbers: [...new Set([...(before?.lineNumbers ?? []), ...(after?.lineNumbers ?? [])])].sort((a, b) => a - b).slice(0, 2000) }] : [];
        });
        file.prefilter = { ...previous, evidence, ruleHits: evidence.map((item) => item.ruleHit!),
          anomalyLineNumbers: [...new Set([...previous.anomalyLineNumbers, ...refined.anomalyLineNumbers])].sort((a, b) => a - b).slice(0, 2000),
          hasErrorEvidence: previous.hasErrorEvidence || refined.hasErrorEvidence, truncated: previous.truncated || refined.truncated };
      }
    }
    const signalSummary = await extractLogSignalsCooperatively(files, signalRules,
      { eventsByLine: events, evaluation: prefilterBudget.evaluation,
        maxMs: Math.min(logSignalLimits().maxMs, Math.max(0, preprocessingDeadline - performance.now())) });
    const sourceSnapshot = admitted.spec.defaultSourceSnapshotId
      ? (await db.query<NonNullable<AnalyzeLogInput["sourceSnapshot"]>>(`select id, status from log_source_snapshots where organization_id = $1 and skill_id = $2 and id = $3`,
        [organizationId, skillId, admitted.spec.defaultSourceSnapshotId])).rows[0] : undefined;
    const report = await analyzeWithDegradation({ analyzer, job: { attemptCount: 1 }, maxAttempts: 1,
      retryBaseDelayMs: 0, now: () => new Date(), analyzeInput: {
        signal: controller.signal, organizationId, logDomainId: skillId, parsed, files, filePath: first.path,
        stats: { lineCount: analyzed.reduce((sum, file) => sum + file.lineCount, 0),
          entryCount: analyzed.reduce((sum, file) => sum + Object.values(file.prefilter!.severityCounts).reduce((a, b) => a + b, 0), 0) },
        procedure: admitted.spec.procedure, signalRules, signalSummary, decoding, sourceSnapshot,
        logDomain: { name: admitted.sample.name, description: admitted.spec.description ?? admitted.sample.description ?? undefined,
          modelOverride: admitted.spec.modelOverride },
        onProgress: async ({ step, maxSteps }) => {
          controller.signal.throwIfAborted();
          await db.query(`update log_skill_dry_runs set progress = $3 where organization_id = $1 and id = $2 and status = 'processing'`,
          [organizationId, admitted.id, Math.min(95, Math.floor(10 + 85 * step / Math.max(1, maxSteps)))]);
        },
        onTrace: async (value) => {
          controller.signal.throwIfAborted();
          const step = logTraceStepSchema.parse(value);
          await db.query(`insert into log_analysis_trace_steps (organization_id, dry_run_id, step_index, step)
            select $1, id, $3, $4::jsonb from log_skill_dry_runs where organization_id = $1 and id = $2 and status = 'processing' and deadline_at > now()`,
          [organizationId, admitted.id, step.index, JSON.stringify(step)]);
        }
      } });
    if (sourceSnapshot && sourceSnapshot.status !== "ready") report.conclusion += "\n\n源码快照尚未就绪，本次分析未使用源码";
    for (const evidence of report.evidence) {
      evidence.filePath ??= first.path;
      const fields = evidence.lineNumbers.flatMap((line) => events.get(JSON.stringify([evidence.filePath ?? first.path, line])) ?? []);
      if (fields.length) evidence.decodedFields = fields;
    }
    return logDryRunReportSchema.parse(report);
  };
  const work = run();
  try {
    const report = await Promise.race([work, timeout]);
    await db.query(`update log_skill_dry_runs set status = 'complete', progress = 100, report = $3::jsonb
      where organization_id = $1 and id = $2 and status = 'processing' and deadline_at > now()`, [organizationId, admitted.id, JSON.stringify(report)]);
  } catch {
    // Provider exceptions can contain payloads. Persist only this fixed failure category.
    await db.query(`update log_skill_dry_runs set status = 'failed', error = $3
      where organization_id = $1 and id = $2 and status = 'processing'`,
    [organizationId, admitted.id, controller.signal.aborted ? LOG_DRY_RUN_INTERRUPTED : "试运行失败，请稍后重试。"]).catch(() => undefined);
  } finally {
    clearTimeout(timer!); owner.signal.removeEventListener("abort", onOwnerLost);
    // A timeout is a UI result, not proof that an uncooperative backend released its memory.
    void work.then(() => owner.close(), () => owner.close()).finally(() => activeWork.delete(admitted.id)).catch(() => undefined);
  }
}
