import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { posix } from "node:path";
import { z } from "zod";
import { stringify as stringifyYaml } from "yaml";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditedWriteContext } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { logAnalysisCaseExpectationsSchema, logAnalysisCaseSchema, logAnalysisCaseRunSchema, logTraceStepSchema, logDryRunReportSchema } from "../contracts/dtoSchemas/logs";
import { requireLogAdminDomains } from "./policy";
import { getLogRecord } from "./service";
import { lockSkill, listSkillRevisions } from "./skillsRepository";
import type { ObjectStore } from "./objectStore";
import { intakeLogBundle, bundleFileUtf8Bytes, type BundleFile } from "./bundleIntake";
import { acquireDryRunOwner, assertDryRunCapacity, activeDryRunWork, LOG_DRY_RUN_ADMISSION_LOCK, LOG_DRY_RUN_INTERRUPTED, recoverInterruptedDryRuns } from "./dryRunAdmission";
import { genericSignalRuleSet, type AnalyzeLogInput, type LogAnalysisAdapter } from "./analyzer";
import { parseLogText } from "./parser";
import { readStoredLogFormatProfile, validateLogFormatProfile } from "./formatProfile";
import { createLogFileReader } from "./fileReader";
import { prefilterLogStream, createPrefilterBudget } from "./prefilter";
import { extractLogSignalsCooperatively } from "./genericSignals";
import { decodeLogFilesCooperatively, indexDecodedEvents } from "./parsing/workerDecoding";
import { analyzeWithDegradation } from "./worker";
import { evaluateQualityCaseOutput } from "./eval/qualityEval";
import { resolveQualityJudge } from "./eval/judgeFromEnv";
import type { GoldenLogCase } from "./eval/goldenCases";
import type { LogSkillSpec } from "./skillSpec";
import type { LogAnalysisTraceStep } from "./traceTypes";
import { compileLogPattern } from "./adminPattern";
import { importAnalysisCaseArchive, exportAnalysisCaseArchive, AnalysisCaseArchiveError, type ArchivedAnalysisCase } from "./analysisCaseArchive";

export const ANALYSIS_CASE_MAX = 20;
export const ANALYSIS_CASE_MAX_BYTES = 10 * 1024 * 1024;
export const ANALYSIS_CASE_RUN_TIMEOUT_MS = 120_000;
const KEEP_RUNS = 10;
const limits = { maxCompressedBytes: ANALYSIS_CASE_MAX_BYTES, maxUnpackedBytes: ANALYSIS_CASE_MAX_BYTES, maxFiles: 100, maxFileBytes: ANALYSIS_CASE_MAX_BYTES };
type Expectations = z.infer<typeof logAnalysisCaseExpectationsSchema>;
type Upload = { fileName: string; objectKey: string; sizeBytes: number };
export type StoredAnalysisCase = z.infer<typeof logAnalysisCaseSchema> & { uploads: Upload[]; archivePath: string | null; sourceYaml: string | null };
type Outcome = z.infer<typeof logAnalysisCaseRunSchema>["results"][number]["draft"] & { steps: LogAnalysisTraceStep[] };
type Result = { caseId: string; name: string; draft: Outcome; published: Outcome | null; delta: number | null };
function requireAdmin(auth: AuthContext) {
  requireLogAdminDomains(auth);
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "Log organization access is required.");
}
function audit(skillId: string, kind: string, metadata: Record<string, unknown> = {}) {
  return { app: "log-analysis", kind, action: kind, severity: "Medium" as const, projectId: null, targetType: "log-skill", targetId: skillId, metadata };
}
function parseExpectations(value: unknown) {
  const parsed = logAnalysisCaseExpectationsSchema.safeParse(value);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Invalid analysis case expectations.", { issues: parsed.error.issues });
  const result = parsed.data;
  if (result.formatProfile !== undefined) {
    const profile = validateLogFormatProfile(result.formatProfile);
    if (!profile.ok) throw new ApiError("VALIDATION_FAILED", "expectations.formatProfile: invalid log format profile.", {
      issues: profile.issues.map((message) => ({ path: ["expectations", "formatProfile"], message }))
    });
  }
  if (Buffer.byteLength(stringifyYaml(result)) > 1024 * 1024) throw new ApiError("VALIDATION_FAILED", "expectations: serialized YAML exceeds the 1 MiB metadata limit.", {
    issues: [{ path: ["expectations"], message: "Serialized expectations must fit within 1 MiB." }]
  });
  if (result.realLog && result.deIdentified !== true) throw new ApiError("VALIDATION_FAILED", "expectations.deIdentified must be true for real logs.");
  if (!result.expectRefusal && (!result.rootCausePoints.length || !result.expectedActions.length || !(result.keyEvidenceLines.length || result.keyEvidence?.length))) {
    throw new ApiError("VALIDATION_FAILED", "Non-refusal cases require rootCausePoints, keyEvidenceLines or keyEvidence, and expectedActions.");
  }
  for (const [index, anchor] of (result.keyEvidence ?? []).entries()) {
    if (!anchor.line && !anchor.pattern) throw new ApiError("VALIDATION_FAILED", `expectations.keyEvidence[${index}] requires line or pattern.`);
    if (anchor.pattern) try { compileLogPattern(anchor.pattern); } catch { throw new ApiError("VALIDATION_FAILED", `expectations.keyEvidence[${index}].pattern: invalid or oversized pattern.`, {
      issues: [{ path: ["expectations", "keyEvidence", index, "pattern"], message: "Invalid or oversized pattern." }]
    }); }
  }
  return result;
}
export async function readAnalysisCases(db: Queryable, organizationId: string, skillId: string) {
  const rows = (await db.query<StoredAnalysisCase>(`select id, name, expectations, uploads, files, archive_path as "archivePath", source_yaml as "sourceYaml", created_at as "createdAt", updated_at as "updatedAt"
    from log_skill_analysis_cases where organization_id = $1 and skill_id = $2 order by created_at, id`, [organizationId, skillId])).rows;
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() }));
}
function fingerprint(cases: StoredAnalysisCase[]) {
  return createHash("sha256").update(JSON.stringify(cases.map((item) => [item.id, item.name, item.expectations, item.uploads]))).digest("hex");
}
function validateAnchors(expectations: Expectations, files: BundleFile[]) {
  const linesByFile = new Map<string, string[]>();
  const readLines = (file: BundleFile) => {
    let lines = linesByFile.get(file.path);
    if (!lines) { lines = bundleFileUtf8Bytes(file).toString("utf8").split(/\r\n|\r|\n/); linesByFile.set(file.path, lines); }
    return lines;
  };
  for (const [index, anchor] of (expectations.keyEvidence ?? []).entries()) {
    const file = files.find((item) => item.path === anchor.file) ?? files.find((item) => `fixtures/${item.path}` === anchor.file);
    if (!file || file.status !== "analyzed" || anchor.line && anchor.line > file.lineCount) throw new ApiError("VALIDATION_FAILED", `expectations.keyEvidence[${index}]: file or line does not exist.`, {
      issues: [{ path: ["expectations", "keyEvidence", index, !file || file.status !== "analyzed" ? "file" : "line"], message: "File or line does not exist." }]
    });
    const lines = readLines(file);
    if (anchor.line && !lines[anchor.line - 1]?.trim()) throw new ApiError("VALIDATION_FAILED", `expectations.keyEvidence[${index}].line: selected line is blank or missing.`, {
      issues: [{ path: ["expectations", "keyEvidence", index, "line"], message: "Selected line is blank or missing." }]
    });
    if (anchor.pattern) {
      const pattern = compileLogPattern(anchor.pattern);
      const matched = anchor.line ? pattern.test(lines[anchor.line - 1]) : lines.some((line) => line.trim() && pattern.test(line));
      if (!matched) throw new ApiError("VALIDATION_FAILED", `expectations.keyEvidence[${index}].pattern: pattern does not match the selected nonempty input line.`,
        { issues: [{ path: ["expectations", "keyEvidence", index, "pattern"], message: "Pattern must match a nonempty line in the selected file." }] });
    }
  }
  const first = files.find((file) => file.status === "analyzed");
  if (!expectations.keyEvidence?.length) for (const [index, line] of expectations.keyEvidenceLines.entries()) {
    if (!first || line > first.lineCount || !readLines(first)[line - 1]?.trim()) throw new ApiError("VALIDATION_FAILED", `expectations.keyEvidenceLines[${index}]: line is blank or missing.`);
  }
}
function validateNormalizedBytes(files: BundleFile[]) {
  let total = 0;
  for (const file of files) if (file.status === "analyzed") {
    total += bundleFileUtf8Bytes(file).length;
    if (total > ANALYSIS_CASE_MAX_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "Normalized case logs are limited to 10 MiB.");
  }
}
export async function listAnalysisCases(db: Database, auth: AuthContext, skillId: string) {
  requireAdmin(auth);
  const revisions = await listSkillRevisions(db, auth.organization.id, skillId);
  if (!revisions.length) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  await recoverInterruptedDryRuns(db, auth.organization.id);
  const items = await readAnalysisCases(db, auth.organization.id, skillId);
  const row = (await db.query<z.infer<typeof logAnalysisCaseRunSchema> & { caseFingerprint: string }>(`select id, skill_revision_id as "skillRevisionId", published_revision_id as "publishedRevisionId", case_fingerprint as "caseFingerprint", status, progress, results, error, created_at as "createdAt"
    from log_skill_analysis_case_runs where organization_id = $1 and skill_id = $2 order by created_at desc, id desc limit 1`, [auth.organization.id, skillId])).rows[0];
  const history = (await db.query<{ id: string; results: Result[] }>(`select id, results from log_skill_analysis_case_runs
    where organization_id = $1 and skill_id = $2 order by created_at desc, id desc limit 10`, [auth.organization.id, skillId])).rows;
  const lastResults = new Map<string, { runId: string; result: z.infer<typeof logAnalysisCaseRunSchema>["results"][number] }>();
  for (const run of history) for (const result of run.results) if (!lastResults.has(result.caseId)) {
    lastResults.set(result.caseId, { runId: run.id, result: logAnalysisCaseRunSchema.shape.results.element.parse(result) });
  }
  return { items: items.map((item) => logAnalysisCaseSchema.parse(item)),
    lastResults: [...lastResults.values()],
    latestRun: row ? logAnalysisCaseRunSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString() }) : null,
    current: Boolean(row && row.status === "complete" && row.skillRevisionId === revisions.find((r) => r.status === "draft")?.id
      && row.publishedRevisionId === (revisions.find((r) => r.status === "published")?.id ?? null)
      && row.caseFingerprint === fingerprint(items) && row.results.length === items.length) };
}
export async function getAnalysisCasePrefill(db: Database, auth: AuthContext, logId: string) {
  requireAdmin(auth);
  const report = await getLogRecord(db, auth, logId);
  if (report.status !== "complete" || !report.logDomainId) throw new ApiError("CONFLICT", "Only completed reports bound to a skill can be saved as cases.");
  const originalUploads = (await db.query<{ fileName: string; sizeBytes: number }>(`select file_name as "fileName", size_bytes::float8 as "sizeBytes"
    from log_original_uploads where organization_id = $1 and record_id = $2 order by position`, [auth.organization.id, logId])).rows;
  const expectRefusal = report.analysisSource === "agent" && !report.degradedReason && report.confidence <= 0.5
    && /insufficient evidence|evidence (?:is |was )?insufficient|not enough evidence|inconclusive|(?:cannot|unable to) (?:determine|diagnose)|证据不足|信息不足|无法(?:判断|确定|诊断)|不足以(?:判断|确定|诊断)/i.test(report.conclusion);
  return { skillId: report.logDomainId, name: report.fileName.slice(0, 200), originalUploads,
    files: (report.files ?? []).filter((file) => file.status === "analyzed"),
    ...(report.degradedReason ? { sourceDegradation: { reason: report.degradedReason, source: report.analysisSource } } : {}), expectations: logAnalysisCaseExpectationsSchema.parse({
    domain: "generic", summary: report.conclusion.slice(0, 2000) || report.fileName, realLog: false,
    rootCauseCategory: expectRefusal ? "insufficient-evidence" : "software-fault", rootCausePoints: report.conclusion ? [report.conclusion] : [],
    keyEvidenceLines: report.evidence.flatMap((e) => e.lineNumbers),
    keyEvidence: report.evidence.flatMap((e) => e.lineNumbers.map((line) => ({ file: e.filePath ?? report.files?.[0]?.path ?? report.fileName, line }))),
    expectedActions: report.suggestedActions, expectRefusal,
    analysisQuestion: report.analysisQuestion
  }) };
}
async function sourceUploads(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, logId: string) {
  const prefill = await getAnalysisCasePrefill(db, auth, logId);
  if (prefill.skillId !== skillId) throw new ApiError("VALIDATION_FAILED", "Report belongs to a different skill.");
  const rows = (await db.query<Upload>(`select file_name as "fileName", object_key as "objectKey", size_bytes::float8 as "sizeBytes" from log_original_uploads where organization_id = $1 and record_id = $2 order by position`, [auth.organization.id, logId])).rows;
  if (!rows.length) throw new ApiError("CONFLICT", "Original upload bytes are unavailable for this historical report. Upload the original bundle to create a case.");
  if (rows.reduce((sum, row) => sum + row.sizeBytes, 0) > ANALYSIS_CASE_MAX_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "Case bundles are limited to 10 MiB.");
  return Promise.all(rows.map(async (row) => ({ fileName: row.fileName, bytes: await boundedGet(store, row.objectKey) })));
}
async function boundedGet(store: ObjectStore, key: string) {
  const bytes = store.getBounded ? await store.getBounded(key, ANALYSIS_CASE_MAX_BYTES) : await store.get(key);
  if (bytes.length > ANALYSIS_CASE_MAX_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "Case bundles are limited to 10 MiB.");
  return bytes;
}
async function readCaseUploads(store: ObjectStore, item: StoredAnalysisCase) {
  const selected = item.expectations.bundleFiles;
  return Promise.all(item.uploads.filter((upload) => !selected || selected.includes(upload.fileName)).map(async (upload) => ({
    fileName: upload.fileName.replace(/^fixtures\//, ""), bytes: await boundedGet(store, upload.objectKey)
  })));
}
export async function createAnalysisCase(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, input: {
  name: string; expectations: unknown; files?: Array<{ fileName: string; bytes: Buffer }>; sourceRecordId?: string; archivePath?: string; sourceYaml?: Buffer;
}, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Create analysis case");
  requireAdmin(auth);
  const name = z.string().trim().min(1).max(200).parse(input.name);
  const expectations = parseExpectations(input.expectations);
  if (expectations.bundleFiles !== undefined) throw new ApiError("VALIDATION_FAILED", "bundleFiles is reserved for imported case archives.");
  // Reject invisible skills before reading object storage.
  if (!(await listSkillRevisions(db, auth.organization.id, skillId)).length) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  const files = input.sourceRecordId ? await sourceUploads(db, store, auth, skillId, input.sourceRecordId) : input.files;
  if (!files?.length) throw new ApiError("VALIDATION_FAILED", "A log bundle is required.");
  const intake = intakeLogBundle(files, limits);
  if (!intake.ok) throw new ApiError("VALIDATION_FAILED", intake.reason);
  if (!intake.files.some((f) => f.status === "analyzed")) throw new ApiError("VALIDATION_FAILED", "The bundle has no analyzable files.");
  validateNormalizedBytes(intake.files);
  validateAnchors(expectations, intake.files);
  const uploads: Upload[] = [];
  const id = randomUUID();
  let rollbackConfirmed = false;
  try {
    return await db.transaction((transaction) => withAuditedWrite(transaction, invocation, context, async (tx) => {
      await lockSkill(tx, auth.organization.id, skillId);
      if ((await readAnalysisCases(tx, auth.organization.id, skillId)).length >= ANALYSIS_CASE_MAX) throw new ApiError("CONFLICT", "A skill can contain at most 20 analysis cases.");
      for (const file of files) uploads.push({ fileName: posix.normalize(file.fileName.replaceAll("\\", "/")), sizeBytes: file.bytes.length,
        objectKey: (await store.put({ organizationId: auth.organization.id, fileName: `case-${randomUUID()}.bin`, contentType: "application/octet-stream", bytes: file.bytes })).storageKey });
      await tx.query(`insert into log_skill_analysis_cases (id, organization_id, skill_id, name, expectations, uploads, files, archive_path, source_yaml)
        values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)`, [id, auth.organization.id, skillId, name, JSON.stringify(expectations), JSON.stringify(uploads),
        JSON.stringify(intake.files.map(({ bytes: _bytes, sha256: _sha256, ...file }) => file)), input.archivePath ?? null, input.sourceYaml?.toString("base64") ?? null]);
      return { result: logAnalysisCaseSchema.parse((await readAnalysisCases(tx, auth.organization.id, skillId)).find((item) => item.id === id)),
        audit: audit(skillId, "log-analysis-case-create", { caseId: id, sourceRecordId: input.sourceRecordId ?? null }) };
    }), { onConfirmedRollback: () => { rollbackConfirmed = true; } });
  } catch (error) {
    if (rollbackConfirmed) await Promise.all(uploads.map((upload) => store.delete?.(upload.objectKey).catch(() => undefined)));
    throw error;
  }
}
export async function updateAnalysisCase(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, caseId: string, input: { name: string; expectations: unknown }, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Update analysis case");
  requireAdmin(auth);
  const name = z.string().trim().min(1).max(200).parse(input.name), expectations = parseExpectations(input.expectations);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    const existing = (await readAnalysisCases(tx, auth.organization.id, skillId)).find((item) => item.id === caseId);
    if (!existing) throw new ApiError("NOT_FOUND", "Analysis case was not found.");
    if (JSON.stringify(expectations.bundleFiles) !== JSON.stringify(existing.expectations.bundleFiles)) throw new ApiError("VALIDATION_FAILED", "Original bundle file selection cannot be edited.");
    const intake = intakeLogBundle(await readCaseUploads(store, existing), limits);
    if (!intake.ok) throw new ApiError("VALIDATION_FAILED", "Stored analysis case bundle could not be read.");
    validateAnchors(expectations, intake.files);
    const result = await tx.query(`update log_skill_analysis_cases set name = $4, expectations = $5::jsonb, source_yaml = null, archive_path = $6, updated_at = clock_timestamp()
      where organization_id = $1 and skill_id = $2 and id = $3 returning id`, [auth.organization.id, skillId, caseId, name, JSON.stringify(expectations), expectations.domain === existing.expectations.domain ? existing.archivePath : null]);
    if (!result.rows.length) throw new ApiError("NOT_FOUND", "Analysis case was not found.");
    return { result: logAnalysisCaseSchema.parse((await readAnalysisCases(tx, auth.organization.id, skillId)).find((item) => item.id === caseId)), audit: audit(skillId, "log-analysis-case-update", { caseId }) };
  });
}
export async function deleteAnalysisCase(db: Database, auth: AuthContext, skillId: string, caseId: string, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Delete analysis case");
  requireAdmin(auth);
  return withAuditedWrite(db, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    // ponytail: retain original objects for admitted runs; add reference-aware GC if storage retention is needed.
    const result = await tx.query("delete from log_skill_analysis_cases where organization_id = $1 and skill_id = $2 and id = $3 returning id", [auth.organization.id, skillId, caseId]);
    if (!result.rows.length) throw new ApiError("NOT_FOUND", "Analysis case was not found.");
    return { result: { ok: true }, audit: audit(skillId, "log-analysis-case-delete", { caseId }) };
  });
}

export async function importSkillAnalysisCases(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, bytes: Buffer, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Import analysis cases");
  requireAdmin(auth);
  if (!(await listSkillRevisions(db, auth.organization.id, skillId)).length) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  let archived: ArchivedAnalysisCase[];
  try { archived = await importAnalysisCaseArchive(bytes); }
  catch (error) { throw new ApiError("VALIDATION_FAILED", "Invalid case archive.", { problems: error instanceof AnalysisCaseArchiveError ? error.problems : [error instanceof Error ? error.message : "archive.zip: invalid archive"] }); }
  return importArchivedSkillAnalysisCases(db, store, auth, skillId, archived, invocation, context);
}

/** Compose validated package cases into the caller's audited transaction. */
export async function importArchivedSkillAnalysisCases(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, archived: ArchivedAnalysisCase[], invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Import analysis cases");
  requireAdmin(auth);
  const prepared: Array<Omit<ArchivedAnalysisCase, "files"> & { id: string; fixtureFiles: ArchivedAnalysisCase["files"]; files: StoredAnalysisCase["files"] }> = [];
  const uploadsWritten: Upload[] = [];
  for (const item of archived) {
    const selected = item.annotation.bundleFiles ?? ["log.txt"];
    const inputs = selected.map((path) => ({ fileName: path.replace(/^fixtures\//, ""), bytes: item.files.find((file) => file.path === path)!.bytes }));
    const intake = intakeLogBundle(inputs, limits);
    if (!intake.ok) throw new ApiError("VALIDATION_FAILED", `${item.archivePath}: ${intake.reason}`);
    if (!intake.files.some((file) => file.status === "analyzed")) throw new ApiError("VALIDATION_FAILED", `${item.archivePath}: no analyzable files`);
    validateNormalizedBytes(intake.files);
    prepared.push({ ...item, id: randomUUID(), fixtureFiles: item.files, files: intake.files.map(({ bytes: _bytes, sha256: _sha256, ...file }) => file) });
  }
  let rollbackConfirmed = false;
  try {
  return await db.transaction((transaction) => withAuditedWrite(transaction, invocation, context, async (tx) => {
    await lockSkill(tx, auth.organization.id, skillId);
    const existing = await readAnalysisCases(tx, auth.organization.id, skillId);
    if (existing.length + prepared.length > ANALYSIS_CASE_MAX) throw new ApiError("CONFLICT", "A skill can contain at most 20 analysis cases.");
    const duplicate = prepared.find((entry) => existing.some((item) => item.archivePath === entry.archivePath));
    if (duplicate) throw new ApiError("CONFLICT", "An imported case already exists.", { problems: [`${duplicate.archivePath}/case.yaml: case archive path already exists`] });
    for (const item of prepared) {
      const uploads: Upload[] = [];
      for (const file of item.fixtureFiles) {
        const upload = { fileName: file.path, sizeBytes: file.bytes.length,
          objectKey: (await store.put({ organizationId: auth.organization.id, fileName: `case-${randomUUID()}.bin`, contentType: "application/octet-stream", bytes: file.bytes })).storageKey };
        uploads.push(upload); uploadsWritten.push(upload);
      }
      await tx.query(`insert into log_skill_analysis_cases (id, organization_id, skill_id, name, expectations, uploads, files, archive_path, source_yaml)
        values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)`, [item.id, auth.organization.id, skillId, item.annotation.caseName ?? item.annotation.summary.slice(0, 200), JSON.stringify(item.annotation), JSON.stringify(uploads), JSON.stringify(item.files), item.archivePath, item.sourceYaml?.toString("base64") ?? null]);
    }
    return { result: { items: (await readAnalysisCases(tx, auth.organization.id, skillId)).filter((item) => prepared.some((entry) => entry.id === item.id)).map((item) => logAnalysisCaseSchema.parse(item)) },
      audit: audit(skillId, "log-analysis-case-import", { caseIds: prepared.map((item) => item.id) }) };
  }), { onConfirmedRollback: () => { rollbackConfirmed = true; } });
  } catch (error) {
    if (rollbackConfirmed) await Promise.all(uploadsWritten.map((upload) => store.delete?.(upload.objectKey).catch(() => undefined)));
    throw error;
  }
}
export async function exportSkillAnalysisCases(db: Database, store: ObjectStore, auth: AuthContext, skillId: string) {
  requireAdmin(auth);
  if (!(await listSkillRevisions(db, auth.organization.id, skillId)).length) throw new ApiError("NOT_FOUND", "Analysis skill was not found.");
  const cases = await readAnalysisCases(db, auth.organization.id, skillId);
  const archived = await Promise.all(cases.map(async (item): Promise<ArchivedAnalysisCase> => {
    const preservePaths = Boolean(item.sourceYaml || item.expectations.bundleFiles);
    const fixturePath = (name: string) => preservePaths ? name : `fixtures/${name}`;
    return {
      archivePath: item.archivePath ?? `${item.expectations.domain}/${item.id}`,
      annotation: item.sourceYaml ? item.expectations : { ...item.expectations, caseName: item.name, bundleFiles: item.expectations.bundleFiles ?? item.uploads.map((upload) => fixturePath(upload.fileName)) },
      files: await Promise.all(item.uploads.map(async (upload) => ({ path: fixturePath(upload.fileName), bytes: await boundedGet(store, upload.objectKey) }))),
      ...(item.sourceYaml ? { sourceYaml: Buffer.from(item.sourceYaml, "base64") } : {})
    };
  }));
  return exportAnalysisCaseArchive(archived);
}

export async function getAnalysisCaseRun(db: Database, auth: AuthContext, skillId: string, runId: string) {
  requireAdmin(auth);
  await recoverInterruptedDryRuns(db, auth.organization.id);
  const row = (await db.query<z.infer<typeof logAnalysisCaseRunSchema>>(`select id, skill_revision_id as "skillRevisionId", published_revision_id as "publishedRevisionId", status, progress, results, error, created_at as "createdAt"
    from log_skill_analysis_case_runs where organization_id = $1 and skill_id = $2 and id = $3`, [auth.organization.id, skillId, runId])).rows[0];
  if (!row) throw new ApiError("NOT_FOUND", "Analysis case run was not found.");
  return { run: logAnalysisCaseRunSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString() }) };
}
export async function getAnalysisCaseTrace(db: Database, auth: AuthContext, skillId: string, runId: string, caseId: string, revision: "draft" | "published") {
  await getAnalysisCaseRun(db, auth, skillId, runId);
  const row = (await db.query<{ results: Result[] }>("select results from log_skill_analysis_case_runs where organization_id = $1 and skill_id = $2 and id = $3", [auth.organization.id, skillId, runId])).rows[0];
  const outcome = row.results.find((result) => result.caseId === caseId)?.[revision];
  if (!outcome) throw new ApiError("NOT_FOUND", "Case trace was not found.");
  return { steps: outcome.steps.map((step) => logTraceStepSchema.parse(step)) };
}

export async function startAnalysisCaseRun(db: Database, store: ObjectStore, analyzer: LogAnalysisAdapter, auth: AuthContext, skillId: string, caseIds: string[] | undefined, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  assertTrustedInvocationMatchesAuth(auth, invocation, "Run analysis cases");
  requireAdmin(auth);
  const owner = await acquireDryRunOwner(db);
  try {
    const admitted = await withAuditedWrite(owner.db, invocation, context, async (tx) => {
      await tx.query("select pg_advisory_xact_lock($1)", [LOG_DRY_RUN_ADMISSION_LOCK]);
      await lockSkill(tx, auth.organization.id, skillId);
      await recoverInterruptedDryRuns(tx);
      await assertDryRunCapacity(tx, auth.organization.id);
      const revisions = await listSkillRevisions(tx, auth.organization.id, skillId);
      const draft = revisions.find((r) => r.status === "draft"), published = revisions.find((r) => r.status === "published");
      if (!draft) throw new ApiError("CONFLICT", "Save a draft before running analysis cases.");
      const all = await readAnalysisCases(tx, auth.organization.id, skillId);
      const cases = caseIds ? all.filter((item) => caseIds.includes(item.id)) : all;
      if (!cases.length || caseIds && cases.length !== new Set(caseIds).size) throw new ApiError("VALIDATION_FAILED", "Select existing cases from this skill.");
      if (cases.length > ANALYSIS_CASE_MAX) throw new ApiError("VALIDATION_FAILED", "At most 20 cases can run at once.");
      const id = randomUUID();
      await tx.query(`insert into log_skill_analysis_case_runs (id, organization_id, skill_id, skill_revision_id, published_revision_id, case_fingerprint, status, deadline_at, owner_pid, owner_key)
        values ($1,$2,$3,$4,$5,$6,'processing',now()+$7*interval '1 millisecond',$8,$9)`, [id, auth.organization.id, skillId, draft.id, published?.id ?? null, fingerprint(all), ANALYSIS_CASE_RUN_TIMEOUT_MS, owner.pid, owner.key]);
      await tx.query(`delete from log_skill_analysis_case_runs where organization_id = $1 and skill_id = $2 and id in
        (select id from log_skill_analysis_case_runs where organization_id = $1 and skill_id = $2 order by created_at desc, id desc offset $3)`, [auth.organization.id, skillId, KEEP_RUNS]);
      return { result: { id, draft, published, cases }, audit: audit(skillId, "log-analysis-case-run-start", { runId: id, caseIds: cases.map((item) => item.id) }) };
    });
    const initial = await getAnalysisCaseRun(owner.db, auth, skillId, admitted.id);
    void executeCaseRun(db, store, analyzer, auth, skillId, admitted, owner, invocation, context);
    return initial;
  } catch (error) { await owner.close(); throw error; }
}

async function executeCaseRun(db: Database, store: ObjectStore, analyzer: LogAnalysisAdapter, auth: AuthContext, skillId: string,
  admitted: { id: string; draft: { spec: LogSkillSpec }; published?: { spec: LogSkillSpec }; cases: StoredAnalysisCase[] },
  owner: Awaited<ReturnType<typeof acquireDryRunOwner>>, invocation: TrustedInvocationContext, context: AuditedWriteContext) {
  const organizationId = auth.organization.id;
  activeDryRunWork.set(admitted.id, organizationId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  owner.signal.addEventListener("abort", abort, { once: true });
  if (owner.signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(abort, ANALYSIS_CASE_RUN_TIMEOUT_MS);
    controller.signal.addEventListener("abort", () => reject(new Error(LOG_DRY_RUN_INTERRUPTED)), { once: true });
    if (controller.signal.aborted) reject(new Error(LOG_DRY_RUN_INTERRUPTED));
  });
  const run = async () => {
    const results: Result[] = [];
    for (const item of admitted.cases) {
      controller.signal.throwIfAborted();
      const uploads = await readCaseUploads(store, item);
      const draft = await analyzeCase(db, store, analyzer, organizationId, skillId, admitted.id, item, uploads, admitted.draft.spec, "draft", controller.signal);
      const published = admitted.published ? await analyzeCase(db, store, analyzer, organizationId, skillId, admitted.id, item, uploads, admitted.published.spec, "published", controller.signal) : null;
      controller.signal.throwIfAborted();
      results.push({ caseId: item.id, name: item.name, draft, published, delta: published ? Math.round((draft.score - published.score) * 100) / 100 : null });
      await withAuditedWrite(db, invocation, context, async (tx) => {
        const updated = await tx.query(`update log_skill_analysis_case_runs set results = $3::jsonb, progress = $4
          where organization_id = $1 and id = $2 and status = 'processing' and deadline_at > now() returning id`,
        [organizationId, admitted.id, JSON.stringify(results), Math.floor(results.length / admitted.cases.length * 95)]);
        return { result: null, audit: updated.rows.length ? audit(skillId, "log-analysis-case-run-progress", {
          runId: admitted.id, completedCases: results.length, totalCases: admitted.cases.length
        }) : null };
      });
    }
    return results;
  };
  const work = run();
  try {
    const results = await Promise.race([work, timeout]);
    await withAuditedWrite(db, invocation, context, async (tx) => {
      const updated = await tx.query(`update log_skill_analysis_case_runs set status = 'complete', progress = 100, results = $3::jsonb where organization_id = $1 and id = $2 and status = 'processing' and deadline_at > now() returning id`, [organizationId, admitted.id, JSON.stringify(results)]);
      return { result: null, audit: audit(skillId, "log-analysis-case-run-complete", { runId: admitted.id, persisted: Boolean(updated.rows.length) }) };
    });
  } catch {
    await withAuditedWrite(db, invocation, context, async (tx) => {
      await tx.query(`update log_skill_analysis_case_runs set status = 'failed', error = $3 where organization_id = $1 and id = $2 and status = 'processing'`, [organizationId, admitted.id, controller.signal.aborted ? LOG_DRY_RUN_INTERRUPTED : "Analysis case run failed."]);
      return { result: null, audit: audit(skillId, "log-analysis-case-run-failed", { runId: admitted.id }) };
    }).catch(() => undefined);
  } finally {
    clearTimeout(timer!); owner.signal.removeEventListener("abort", abort);
    void work.then(() => owner.close(), () => owner.close()).finally(() => activeDryRunWork.delete(admitted.id)).catch(() => undefined);
  }
}

async function analyzeCase(db: Database, store: ObjectStore, analyzer: LogAnalysisAdapter, organizationId: string, skillId: string, runId: string, item: StoredAnalysisCase,
  uploads: Array<{ fileName: string; bytes: Buffer }>, spec: LogSkillSpec, revision: "draft" | "published", signal: AbortSignal): Promise<Outcome> {
  const intake = intakeLogBundle(uploads, limits);
  if (!intake.ok) throw new Error("Invalid stored case bundle");
  const profile = readStoredLogFormatProfile(spec.formatProfile), signalRules = spec.signalRules ?? genericSignalRuleSet;
  const deadline = performance.now() + 15_000;
  const files: Array<NonNullable<AnalyzeLogInput["files"]>[number] & { parsed: Extract<ReturnType<typeof parseLogText>, { ok: true }> }> = [];
  const rawByFile = new Map<string, string[]>();
  const normalized = new Map<string, Buffer>();
  const memoryStore: ObjectStore = { ...store,
    get: async (key) => normalized.get(key) ?? store.get(key),
    getStream: async (key, range) => {
      const bytes = normalized.get(key);
      if (bytes) return Readable.from([bytes.subarray(range?.start ?? 0, range?.end === undefined ? undefined : range.end + 1)]);
      return store.getStream ? store.getStream(key, range) : Readable.from([await store.get(key)]);
    }
  };
  for (const entry of intake.files.filter((file) => file.status === "analyzed")) {
    signal.throwIfAborted();
    const bytes = bundleFileUtf8Bytes(entry), content = bytes.toString("utf8");
    const rawLines = content.split(/\r\n|\n|\r/);
    if (rawLines.at(-1) === "") rawLines.pop();
    rawByFile.set(entry.path, rawLines);
    const preview: string[] = [];
    let previewBytes = 128 * 1024;
    for (const line of rawLines) {
      const cost = Buffer.byteLength(line) + (preview.length ? 1 : 0);
      if (preview.length >= 400 || cost > previewBytes) break;
      preview.push(line); previewBytes -= cost;
    }
    const parsed = parseLogText({ fileName: entry.path, content: preview.join("\n") }, { profile });
    if (!parsed.ok) throw new Error("Case log failed parsing");
    parsed.rawLines = preview;
    const objectKey = `case-memory/${randomUUID()}`;
    normalized.set(objectKey, bytes);
    const reader = createLogFileReader(memoryStore, { ...entry, objectKey, encoding: "utf-8", lossy: false }, profile);
    const prefilter = await prefilterLogStream(reader.entries({ deadline }), signalRules, createPrefilterBudget());
    files.push({ ...entry, parsed, reader, prefilter });
  }
  const first = files[0];
  if (!first) throw new Error("No analyzable case files");
  const signalSummary = await extractLogSignalsCooperatively(files, signalRules, { maxMs: Math.max(0, deadline - performance.now()) });
  const decoding = spec.parsing?.extractors.length ? { spec: spec.parsing, ...await decodeLogFilesCooperatively(spec.parsing, files.map((file) => ({ file: file.path, reader: file.reader! })), { maxMs: Math.max(0, deadline - performance.now()) }) } : undefined;
  const sourceSnapshot = spec.defaultSourceSnapshotId ? (await db.query<NonNullable<AnalyzeLogInput["sourceSnapshot"]>>(`select id, status from log_source_snapshots where organization_id = $1 and skill_id = $2 and id = $3`, [organizationId, skillId, spec.defaultSourceSnapshotId])).rows[0] : undefined;
  const steps: LogAnalysisTraceStep[] = [];
  let traceBytes = 0;
  const started = performance.now();
  const report = await analyzeWithDegradation({ analyzer, job: { attemptCount: 1 }, maxAttempts: 1, retryBaseDelayMs: 0, now: () => new Date(), analyzeInput: {
    signal, organizationId, logDomainId: skillId, parsed: first.parsed, files, filePath: first.path,
    stats: { lineCount: files.reduce((sum, file) => sum + file.reader!.lineCount, 0), entryCount: files.reduce((sum, file) => sum + Object.values(file.prefilter!.severityCounts).reduce((count, value) => count + value, 0), 0) },
    procedure: spec.procedure, signalRules, signalSummary, decoding, sourceSnapshot, knowledgeEntryIds: spec.knowledgeEntryIds ?? [], analysisQuestion: item.expectations.analysisQuestion,
    logDomain: { name: item.expectations.domain, description: spec.description, modelOverride: spec.modelOverride },
    onTrace: async (value) => { signal.throwIfAborted(); const step = logTraceStepSchema.parse(value); traceBytes += Buffer.byteLength(JSON.stringify(step)); if (traceBytes <= 2 * 1024 * 1024 && steps.length < 200) steps.push(step); }
  } });
  signal.throwIfAborted();
  const events = indexDecodedEvents(decoding?.events ?? []);
  for (const evidence of report.evidence) {
    evidence.filePath ??= first.path;
    const fields = evidence.lineNumbers.flatMap((line) => events.get(JSON.stringify([evidence.filePath, line])) ?? []);
    if (fields.length) evidence.decodedFields = fields;
  }
  const expectations = item.expectations;
  const rawLines = rawByFile.get(first.path)!;
  const golden: GoldenLogCase = { ...expectations, formatProfile: undefined, id: item.id, caseDir: "", logText: rawLines.join("\n"), rawLines };
  const judge = resolveQualityJudge({ LOG_ANALYSIS_DETERMINISTIC: process.env.LOG_ANALYSIS_DETERMINISTIC === "true", LOG_ANALYSIS_JUDGE_API_BASE_URL: process.env.LOG_ANALYSIS_JUDGE_API_BASE_URL,
    LOG_ANALYSIS_JUDGE_API_KEY: process.env.LOG_ANALYSIS_JUDGE_API_KEY, LOG_ANALYSIS_JUDGE_MODEL: process.env.LOG_ANALYSIS_JUDGE_MODEL, LOG_ANALYSIS_JUDGE_API_TIMEOUT_MS: 30_000 });
  const judged = expectations.expectRefusal ? null : await judge.score({ goldenCase: golden, output: report });
  signal.throwIfAborted();
  // The quality evaluator only queries cited lines; avoid allocating a set proportional to every input line.
  const citedExisting = new Set(report.evidence.flatMap((evidence) => evidence.lineNumbers.filter((line) => Boolean(rawByFile.get(evidence.filePath ?? first.path)?.[line - 1]?.trim()))));
  const quality = evaluateQualityCaseOutput(golden, report, { latencyMs: performance.now() - started, judge: judged, parsedLineNumbers: citedExisting });
  const anchors = expectations.keyEvidence;
  const citations = [...new Map(report.evidence.flatMap((evidence) => evidence.lineNumbers.map((line) => {
    const file = evidence.filePath ?? first.path;
    return [JSON.stringify([file, line]), { file, line }] as const;
  }))).values()];
  const anchorMatchers = anchors?.map((anchor) => ({ anchor,
    file: rawByFile.has(anchor.file) ? anchor.file : anchor.file.replace(/^fixtures\//, ""),
    pattern: anchor.pattern ? compileLogPattern(anchor.pattern) : undefined
  }));
  const matchesAnchor = (expected: NonNullable<typeof anchorMatchers>[number], cited: { file: string; line: number }) => {
    const content = rawByFile.get(cited.file)?.[cited.line - 1];
    return expected.file === cited.file && Boolean(content?.trim()) && (!expected.anchor.line || cited.line === expected.anchor.line)
      && (!expected.pattern || expected.pattern.test(content!));
  };
  const anchorHits = anchorMatchers?.filter((expected) => citations.some((cited) => matchesAnchor(expected, cited))).map(({ anchor }) => anchor);
  const recall = anchors?.length ? anchorHits!.length / anchors.length : quality.evidence?.recall ?? 1;
  const precision = citations.length ? citations.filter((cited) => anchorMatchers?.some((expected) => matchesAnchor(expected, cited))).length / citations.length : 0;
  const hallucinatedLines = citations.filter(({ file, line }) => !rawByFile.get(file)?.[line - 1]?.trim());
  const grounded = report.evidence.every((evidence) => evidence.lineNumbers.every((line) => line >= 1 && line <= (rawByFile.get(evidence.filePath ?? first.path)?.length ?? 0)));
  const factors = expectations.expectRefusal ? [quality.refusal.appropriate ? 1 : 0] : [judged?.rootCauseScore ?? 0, judged?.actionsScore ?? 0, recall];
  if (expectations.expectedDegradedReason) factors.push(report.degradedReason === expectations.expectedDegradedReason ? 1 : 0);
  const score = grounded ? Math.round(factors.reduce((sum, value) => sum + value, 0) / factors.length * 10000) / 100 : 0;
  return { score, passed: grounded && factors.every((value) => value >= 0.8), report: logDryRunReportSchema.parse(report),
    quality: anchors?.length ? { ...quality, anchorEvidence: { precision, recall, hits: anchorHits,
      hallucinatedLines, hallucinationRate: citations.length ? hallucinatedLines.length / citations.length : 0,
      misses: anchors.filter((anchor) => !anchorHits!.includes(anchor)) } } : quality,
    traceReference: `/api/v1/log-skills/${skillId}/analysis-case-runs/${runId}/cases/${item.id}/trace?revision=${revision}`, steps };
}
