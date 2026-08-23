import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceOperations, type AcceptanceOperationAssertion } from "../e2e/acceptance/operationMatrix";
import {
  defaultEvidenceRunsRoot,
  readLatestFullEvidenceRun
} from "../e2e/acceptance/helpers/evidenceRun";

export type OperationEvidenceStatus = "passed" | "failed" | "skipped";

export type OperationEvidenceRecord = {
  runId?: string;
  sourceCommit?: string;
  runKind?: "full" | "focused";
  operationId: string;
  status: OperationEvidenceStatus;
  title?: string;
  role?: string;
  route?: string;
  assertions?: AcceptanceOperationAssertion[];
  notes?: string;
  artifacts: string[];
  recordedAt?: string;
  api?: Array<{
    method: string;
    path: string;
    status: number;
    requestId?: string;
    responseSummary?: string;
  }>;
  db?: Array<{
    table: string;
    predicate: string;
    observed: string;
    rowCount?: number;
  }>;
  audit?: Array<{
    id?: string;
    kind: string;
    action?: string;
    targetId?: string | null;
    requestId?: string;
    metadataSummary?: string;
  }>;
  trace?: {
    mode: "retain-on-failure" | "on" | "off";
    path?: string;
    note?: string;
  };
  report?: {
    path: string;
    format: "html" | "json" | "markdown";
  };
  runtime?: {
    mode: string;
    apiBaseUrl: string;
    seed?: string;
    envSummary?: Record<string, string>;
    ownedRuntime?: {
      runRoot: string;
      descriptorPath: string;
      descriptorSnapshotPath: string;
      descriptorSnapshotSha256: string;
      runId: string;
      sourceCommit: string;
      databaseName: string;
      objectMarkerSha256: string;
      apiUrl: string;
      frontendUrl: string;
      apiPid: number;
      frontendPid: number;
    };
  };
  reproduction?: {
    steps: string[];
    seed?: string;
  };
};

export type OperationEvidenceOperation = {
  id: string;
  priority: string;
  coverage: string;
  assertions?: AcceptanceOperationAssertion[];
};

export type OperationEvidenceEvaluation = {
  status: "passed" | "failed";
  runId?: string;
  sourceCommit?: string;
  coveredOperationIds: string[];
  missingOperationIds: string[];
  invalidEvidenceIds: string[];
  validationErrors: OperationEvidenceValidationError[];
  records: OperationEvidenceRecord[];
};

export type OperationEvidenceValidationError = {
  operationId: string;
  field: "run" | "role" | "route" | "assertions" | "artifacts" | "api" | "db" | "audit" | "runtime" | "report" | "trace" | "reproduction";
  message: string;
};

export type EvaluateOperationEvidenceInput = {
  operations: OperationEvidenceOperation[];
  records: OperationEvidenceRecord[];
  expectedRun?: { runId: string; sourceCommit: string };
};

const defaultEvidenceRoot = "test-results/acceptance-operation-evidence";
const defaultMarkdownOut = "docs/generated/acceptance-operation-evidence.md";
const defaultJsonOut = "docs/generated/acceptance-operation-evidence/index.json";
const requiredPriorities = new Set(["P0", "P1"]);

export function evaluateOperationEvidence(input: EvaluateOperationEvidenceInput): OperationEvidenceEvaluation {
  const passedRecordIds = new Set(
    input.records.filter((record) => record.status === "passed").map((record) => record.operationId)
  );
  const coveredOperationIds = input.operations
    .filter((operation) => hasEvidenceForOperation(operation.id, passedRecordIds))
    .map((operation) => operation.id)
    .sort();
  const coveredSet = new Set(coveredOperationIds);
  const missingOperationIds = input.operations
    .filter((operation) => isRequiredAutomatedOperation(operation) && !coveredSet.has(operation.id))
    .map((operation) => operation.id)
    .sort();
  const operationById = new Map(input.operations.map((operation) => [operation.id, operation]));
  const runValidationErrors = input.expectedRun
    ? input.records.flatMap((record) => validateRunIdentity(record, input.expectedRun!))
    : [];
  const validationErrors = [
    ...runValidationErrors,
    ...input.records
    .filter((record) => record.status === "passed")
    .flatMap((record) => validateReviewMetadata(
      record,
      operationById.get(parentOperationId(record.operationId)),
      input.expectedRun,
    ))
  ];
  const invalidEvidenceIds = Array.from(new Set(validationErrors.map((error) => error.operationId))).sort();

  return {
    status: missingOperationIds.length === 0 && validationErrors.length === 0 ? "passed" : "failed",
    runId: input.expectedRun?.runId,
    sourceCommit: input.expectedRun?.sourceCommit,
    coveredOperationIds,
    missingOperationIds,
    invalidEvidenceIds,
    validationErrors,
    records: input.records
  };
}

export function renderOperationEvidenceMarkdown(evaluation: OperationEvidenceEvaluation) {
  const rows =
    evaluation.records.length > 0
      ? evaluation.records.map(
          (record) =>
            `| \`${escapeMarkdownTableCell(record.operationId)}\` | ${record.status} | ${escapeMarkdownTableCell(
              record.role ?? ""
            )} | \`${escapeMarkdownTableCell(record.route ?? "")}\` | ${escapeMarkdownTableCell(
              (record.assertions ?? []).join(", ")
            )} | ${escapeMarkdownTableCell(formatApiSummaries(record))} | ${escapeMarkdownTableCell(formatDbSummaries(
              record
            ))} | ${escapeMarkdownTableCell(formatAuditSummaries(record))} | ${escapeMarkdownTableCell(
              formatReplaySummary(record)
            )} | ${escapeMarkdownTableCell(record.artifacts.join(", "))} |`
        )
      : ["| _none_ | _none_ | _none_ | _none_ | _none_ | _none_ | _none_ | _none_ | _none_ | _none_ |"];

  return [
    "# Operation Evidence Index",
    "",
    `- Status: \`${evaluation.status}\``,
    `- Run ID: ${evaluation.runId ? `\`${evaluation.runId}\`` : "_legacy / unscoped_"}`,
    `- Source commit: ${evaluation.sourceCommit ? `\`${evaluation.sourceCommit}\`` : "_legacy / unscoped_"}`,
    `- Covered operations: \`${evaluation.coveredOperationIds.length}\``,
    `- Missing operations: ${formatInlineCodeList(evaluation.missingOperationIds)}`,
    `- Invalid evidence records: ${formatInlineCodeList(evaluation.invalidEvidenceIds)}`,
    `- Validation errors: \`${evaluation.validationErrors.length}\``,
    "",
    "| Operation ID | Status | Role | Route | Assertions | API | DB | Audit | Replay | Artifacts |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
}

function validateRunIdentity(
  record: OperationEvidenceRecord,
  expectedRun: { runId: string; sourceCommit: string }
): OperationEvidenceValidationError[] {
  if (record.runId === expectedRun.runId && record.sourceCommit === expectedRun.sourceCommit && record.runKind === "full") {
    return [];
  }

  return [
    {
      operationId: record.operationId,
      field: "run",
      message: `Evidence belongs to run ${record.runId ?? "missing"} at ${record.sourceCommit ?? "missing"}; expected full run ${expectedRun.runId} at ${expectedRun.sourceCommit}.`
    }
  ];
}

export function writeOperationEvidenceIndex(input: {
  outputPath?: string;
  markdownOut?: string;
  jsonOut?: string;
  evaluation: OperationEvidenceEvaluation;
}) {
  const markdownOut = input.markdownOut ?? input.outputPath ?? defaultMarkdownOut;
  const jsonOut = input.jsonOut;
  mkdirSync(dirname(markdownOut), { recursive: true });
  writeFileSync(markdownOut, renderOperationEvidenceMarkdown(input.evaluation), "utf8");

  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, `${JSON.stringify(input.evaluation, null, 2)}\n`, "utf8");
  }

  return markdownOut;
}

export function readOperationEvidenceRecords(root = defaultEvidenceRoot): OperationEvidenceRecord[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(root, name), "utf8")) as OperationEvidenceRecord);
}

function hasEvidenceForOperation(operationId: string, evidenceIds: Set<string>) {
  if (evidenceIds.has(operationId)) {
    return true;
  }

  const childPrefix = `${operationId}:`;
  return Array.from(evidenceIds).some((evidenceId) => evidenceId.startsWith(childPrefix));
}

function isRequiredAutomatedOperation(operation: OperationEvidenceOperation) {
  return operation.coverage === "automated" && requiredPriorities.has(operation.priority);
}

function validateReviewMetadata(
  record: OperationEvidenceRecord,
  operation?: OperationEvidenceOperation,
  expectedRun?: { runId: string; sourceCommit: string },
): OperationEvidenceValidationError[] {
  const errors: OperationEvidenceValidationError[] = [];
  const recordAssertions = record.assertions ?? [];
  const requiredAssertions = operation?.assertions ?? [];
  const assertions = Array.from(new Set([...recordAssertions, ...requiredAssertions]));

  if (!record.role?.trim()) {
    errors.push({ operationId: record.operationId, field: "role", message: "Evidence requires a role summary." });
  }
  if (!record.route?.trim()) {
    errors.push({ operationId: record.operationId, field: "route", message: "Evidence requires a route summary." });
  }
  if (recordAssertions.length === 0) {
    errors.push({ operationId: record.operationId, field: "assertions", message: "Evidence requires assertion metadata." });
  }
  const missingAssertions = requiredAssertions.filter((assertion) => !recordAssertions.includes(assertion));
  if (missingAssertions.length > 0) {
    errors.push({
      operationId: record.operationId,
      field: "assertions",
      message: `Evidence is missing required operation assertions: ${missingAssertions.join(", ")}.`
    });
  }
  if (record.artifacts.length === 0) {
    errors.push({ operationId: record.operationId, field: "artifacts", message: "Evidence requires at least one artifact." });
  }
  for (const artifactPath of record.artifacts) {
    if (!existsSync(artifactPath)) {
      errors.push({
        operationId: record.operationId,
        field: "artifacts",
        message: `Evidence artifact does not exist: ${artifactPath}.`
      });
    }
  }
  if (assertions.includes("api") && !record.api?.length) {
    errors.push({
      operationId: record.operationId,
      field: "api",
      message: "API assertions require at least one API request/response summary."
    });
  }
  if (assertions.includes("db") && !record.db?.length) {
    errors.push({
      operationId: record.operationId,
      field: "db",
      message: "DB assertions require at least one database assertion summary."
    });
  }
  if (assertions.includes("audit") && !record.audit?.length) {
    errors.push({
      operationId: record.operationId,
      field: "audit",
      message: "Audit assertions require at least one audit event summary."
    });
  }
  if (!record.runtime?.mode?.trim() || !record.runtime.apiBaseUrl?.trim()) {
    errors.push({
      operationId: record.operationId,
      field: "runtime",
      message: "Evidence requires runtime mode and API base URL metadata."
    });
  }
  if (expectedRun && !record.runtime?.ownedRuntime) {
    errors.push({
      operationId: record.operationId,
      field: "runtime",
      message: "Expected full-run evidence requires owned runtime proof and an immutable runtime snapshot.",
    });
  } else if (record.runtime?.ownedRuntime) {
    errors.push(...validateOwnedRuntimeEvidence(record, expectedRun));
  }
  if (!record.report?.path?.trim() || !record.report.format?.trim()) {
    errors.push({
      operationId: record.operationId,
      field: "report",
      message: "Evidence requires a Playwright report path."
    });
  }
  if (!record.trace?.mode?.trim()) {
    errors.push({
      operationId: record.operationId,
      field: "trace",
      message: "Evidence requires trace retention metadata."
    });
  }
  if (!record.reproduction?.steps?.length) {
    errors.push({
      operationId: record.operationId,
      field: "reproduction",
      message: "Evidence requires reproduction steps."
    });
  }

  return errors;
}

function validateOwnedRuntimeEvidence(
  record: OperationEvidenceRecord,
  expectedRun?: { runId: string; sourceCommit: string },
): OperationEvidenceValidationError[] {
  const errors: OperationEvidenceValidationError[] = [];
  const owned = record.runtime!.ownedRuntime!;
  const runRoot = owned.runRoot;
  if (!isExistingRegularDirectory(runRoot)) {
    return [{
      operationId: record.operationId,
      field: "runtime",
      message: `Owned evidence run root does not exist as a regular directory: ${runRoot}.`,
    }];
  }
  if (
    owned.runId !== record.runId ||
    owned.sourceCommit !== record.sourceCommit ||
    (expectedRun && (owned.runId !== expectedRun.runId || owned.sourceCommit !== expectedRun.sourceCommit))
  ) {
    errors.push({
      operationId: record.operationId,
      field: "runtime",
      message: "Owned runtime identity must match the top-level record and expected run.",
    });
  }
  const snapshotError = validateRuntimeSnapshot(record, runRoot, expectedRun);
  if (snapshotError) errors.push(snapshotError);
  const descriptorError = validateOwnedDescendant(
    record.operationId,
    "runtime",
    runRoot,
    owned.descriptorPath,
    "runtime descriptor",
    "file",
  );
  if (descriptorError) errors.push(descriptorError);
  const reportError = validateOwnedDescendant(
    record.operationId,
    "report",
    runRoot,
    record.report?.path,
    "Playwright report",
    "file",
  );
  if (reportError) errors.push(reportError);
  const traceError = validateOwnedDescendant(
    record.operationId,
    "trace",
    runRoot,
    record.trace?.path,
    "Playwright trace/output root",
    "directory",
  );
  if (traceError) errors.push(traceError);
  return errors;
}

function validateRuntimeSnapshot(
  record: OperationEvidenceRecord,
  runRoot: string,
  expectedRun?: { runId: string; sourceCommit: string },
): OperationEvidenceValidationError | undefined {
  const owned = record.runtime!.ownedRuntime!;
  const pathError = validateOwnedDescendant(
    record.operationId,
    "runtime",
    runRoot,
    owned.descriptorSnapshotPath,
    "immutable runtime snapshot",
    "file",
  );
  if (pathError) return pathError;
  const bytes = Buffer.from(readFileSync(owned.descriptorSnapshotPath, "base64"), "base64");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== owned.descriptorSnapshotSha256) {
    return {
      operationId: record.operationId,
      field: "runtime",
      message: "Owned immutable runtime snapshot SHA256 digest does not match the evidence record.",
    };
  }
  try {
    const snapshot = JSON.parse(bytes.toString("utf8")) as {
      kind?: string;
      run?: { id?: string; sourceCommit?: string };
      artifacts?: { runRoot?: string; descriptor?: string };
    };
    if (
      snapshot.kind !== "wiseeff-owned-local-acceptance-operation-evidence-runtime" ||
      snapshot.run?.id !== owned.runId ||
      snapshot.run?.sourceCommit !== owned.sourceCommit ||
      snapshot.run?.id !== record.runId ||
      snapshot.run?.sourceCommit !== record.sourceCommit ||
      (expectedRun !== undefined && (
        snapshot.run?.id !== expectedRun.runId ||
        snapshot.run?.sourceCommit !== expectedRun.sourceCommit
      )) ||
      resolve(snapshot.artifacts?.runRoot ?? "") !== resolve(runRoot) ||
      resolve(snapshot.artifacts?.descriptor ?? "") !== resolve(owned.descriptorPath)
    ) {
      throw new Error("identity mismatch");
    }
  } catch {
    return {
      operationId: record.operationId,
      field: "runtime",
      message: "Owned immutable runtime snapshot identity does not match its run, source, or descriptor.",
    };
  }
  return undefined;
}

function validateOwnedDescendant(
  operationId: string,
  field: OperationEvidenceValidationError["field"],
  runRoot: string,
  candidate: string | undefined,
  label: string,
  kind: "file" | "directory",
): OperationEvidenceValidationError | undefined {
  if (!candidate?.trim() || !isAbsolute(candidate)) {
    return { operationId, field, message: `Owned ${label} must be an absolute descendant of the run root.` };
  }
  const resolvedRoot = realpathSync(runRoot);
  const resolvedCandidate = resolve(candidate);
  const lexicalRelative = relative(resolve(runRoot), resolvedCandidate);
  if (!lexicalRelative || lexicalRelative.startsWith("..") || isAbsolute(lexicalRelative) || !existsSync(resolvedCandidate)) {
    return { operationId, field, message: `Owned ${label} must exist beneath the run root.` };
  }
  const stat = lstatSync(resolvedCandidate);
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
    return { operationId, field, message: `Owned ${label} must be a regular ${kind} beneath the run root.` };
  }
  const actualRelative = relative(resolvedRoot, realpathSync(resolvedCandidate));
  if (!actualRelative || actualRelative.startsWith("..") || isAbsolute(actualRelative)) {
    return { operationId, field, message: `Owned ${label} resolves outside the run root.` };
  }
  return undefined;
}

function isExistingRegularDirectory(value: string) {
  if (!isAbsolute(value) || !existsSync(value)) return false;
  const stat = lstatSync(value);
  return !stat.isSymbolicLink() && stat.isDirectory();
}

function parentOperationId(operationId: string) {
  return operationId.split(":")[0];
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function formatInlineCodeList(values: string[]) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "_none_";
}

function formatApiSummaries(record: OperationEvidenceRecord) {
  return record.api?.length
    ? record.api
        .map((item) =>
          [
            `${item.method.toUpperCase()} ${item.path} -> ${item.status}`,
            item.requestId ? `requestId=${item.requestId}` : "",
            item.responseSummary ?? ""
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("<br>")
    : "";
}

function formatDbSummaries(record: OperationEvidenceRecord) {
  return record.db?.length
    ? record.db
        .map((item) =>
          [
            item.table,
            item.predicate,
            item.observed,
            typeof item.rowCount === "number" ? `rows=${item.rowCount}` : ""
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("<br>")
    : "";
}

function formatAuditSummaries(record: OperationEvidenceRecord) {
  return record.audit?.length
    ? record.audit
        .map((item) =>
          [
            item.id ? `id=${item.id}` : "",
            `kind=${item.kind}`,
            item.action ? `action=${item.action}` : "",
            item.targetId ? `target=${item.targetId}` : "",
            item.requestId ? `requestId=${item.requestId}` : "",
            item.metadataSummary ?? ""
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("<br>")
    : "";
}

function formatReplaySummary(record: OperationEvidenceRecord) {
  return [
    record.report ? `report=${record.report.path}` : "",
    record.trace ? `trace=${record.trace.mode}${record.trace.path ? `:${record.trace.path}` : ""}` : "",
    record.runtime ? `runtime=${record.runtime.mode} ${record.runtime.apiBaseUrl}` : "",
    record.reproduction?.steps?.length ? `steps=${record.reproduction.steps.length}` : ""
  ]
    .filter(Boolean)
    .join("<br>");
}

export function runOperationEvidenceCheck() {
  const latestRun = readLatestFullEvidenceRun(defaultEvidenceRunsRoot);
  const evaluation = evaluateOperationEvidence({
    operations: acceptanceOperations,
    records: readOperationEvidenceRecords(latestRun?.recordsRoot ?? defaultEvidenceRoot),
    expectedRun: latestRun
      ? { runId: latestRun.runId, sourceCommit: latestRun.sourceCommit }
      : undefined
  });

  writeOperationEvidenceIndex({
    evaluation,
    markdownOut: defaultMarkdownOut,
    jsonOut: defaultJsonOut
  });
  console.log(JSON.stringify(evaluation, null, 2));
  return evaluation;
}

export type OperationEvidenceCheckCliOptions = {
  /** Focused-run mode (TD-088): validate the evidence records of one run directory. */
  runDir?: string;
  /** Operation ids that MUST be covered by the focused run (fails when absent). */
  requireOperationIds: string[];
};

export function parseOperationEvidenceCheckArgs(argv: readonly string[]): OperationEvidenceCheckCliOptions {
  const options: OperationEvidenceCheckCliOptions = { requireOperationIds: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--run" && next) {
      options.runDir = next;
      index += 1;
    } else if (arg.startsWith("--run=")) {
      options.runDir = arg.slice("--run=".length);
    } else if (arg === "--require" && next) {
      options.requireOperationIds.push(...splitOperationIdList(next));
      index += 1;
    } else if (arg.startsWith("--require=")) {
      options.requireOperationIds.push(...splitOperationIdList(arg.slice("--require=".length)));
    } else {
      throw new Error(`Unknown or incomplete check-operation-evidence argument: ${arg}`);
    }
  }

  if (!options.runDir && options.requireOperationIds.length > 0) {
    throw new Error("--require is only valid together with --run <dir>.");
  }

  return options;
}

function splitOperationIdList(value: string): string[] {
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export type FocusedRunEvidenceCheckInput = {
  runDir: string;
  requireOperationIds?: string[];
  /** Injectable for tests; defaults to the real acceptance operation matrix. */
  operations?: OperationEvidenceOperation[];
};

/**
 * Focused-run validation (TD-088): validate the evidence records inside ONE
 * run directory (a run root containing `records/`, or a records directory
 * itself). Scope: every operation that has a record in the directory plus any
 * `--require` ids must be covered by passed, forensically complete evidence.
 * Run-identity gating (latest-full manifest) deliberately stays a full-run
 * concern — focused runs get first-class record validation without it.
 */
export function runFocusedOperationEvidenceCheck(input: FocusedRunEvidenceCheckInput): OperationEvidenceEvaluation {
  const operations = input.operations ?? acceptanceOperations;
  const recordsRoot = existsSync(join(input.runDir, "records")) ? join(input.runDir, "records") : input.runDir;
  if (!existsSync(recordsRoot)) {
    throw new Error(`Evidence run directory does not exist: ${input.runDir}`);
  }

  const knownOperationIds = new Set(operations.map((operation) => operation.id));
  const unknownRequired = (input.requireOperationIds ?? []).filter((id) => !knownOperationIds.has(id));
  if (unknownRequired.length > 0) {
    throw new Error(`--require references unknown operation ids: ${unknownRequired.join(", ")}.`);
  }

  const records = readOperationEvidenceRecords(recordsRoot);
  const recordedParentIds = new Set(records.map((record) => parentOperationId(record.operationId)));
  const requiredIds = new Set(input.requireOperationIds ?? []);
  const scopedOperations = operations.filter(
    (operation) => recordedParentIds.has(operation.id) || requiredIds.has(operation.id)
  );

  const evaluation = evaluateOperationEvidence({ operations: scopedOperations, records });
  const coveredSet = new Set(evaluation.coveredOperationIds);
  const missingOperationIds = Array.from(
    new Set([...evaluation.missingOperationIds, ...[...requiredIds].filter((id) => !coveredSet.has(id))])
  ).sort();
  const runIdentity = singleRunIdentity(records);

  return {
    ...evaluation,
    status: missingOperationIds.length === 0 && evaluation.validationErrors.length === 0 ? "passed" : "failed",
    missingOperationIds,
    runId: runIdentity?.runId,
    sourceCommit: runIdentity?.sourceCommit
  };
}

function singleRunIdentity(records: OperationEvidenceRecord[]): { runId?: string; sourceCommit?: string } | null {
  const runIds = new Set(records.map((record) => record.runId).filter(Boolean));
  const commits = new Set(records.map((record) => record.sourceCommit).filter(Boolean));
  if (runIds.size !== 1 || commits.size !== 1) {
    return null;
  }
  return { runId: [...runIds][0], sourceCommit: [...commits][0] };
}

function runFocusedOperationEvidenceCheckCli(options: OperationEvidenceCheckCliOptions & { runDir: string }) {
  const evaluation = runFocusedOperationEvidenceCheck({
    runDir: options.runDir,
    requireOperationIds: options.requireOperationIds
  });
  // Focused checks report into the run directory; the docs/generated index
  // stays reserved for the latest FULL acceptance run.
  writeOperationEvidenceIndex({
    evaluation,
    markdownOut: join(options.runDir, "evidence-check.md"),
    jsonOut: join(options.runDir, "evidence-check.json")
  });
  console.log(JSON.stringify(evaluation, null, 2));
  return evaluation;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseOperationEvidenceCheckArgs(process.argv.slice(2));
  const result = options.runDir
    ? runFocusedOperationEvidenceCheckCli({ ...options, runDir: options.runDir })
    : runOperationEvidenceCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
