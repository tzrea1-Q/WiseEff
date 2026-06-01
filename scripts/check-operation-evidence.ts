import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceOperations, type AcceptanceOperationAssertion } from "../e2e/acceptance/operationMatrix";

export type OperationEvidenceStatus = "passed" | "failed" | "skipped";

export type OperationEvidenceRecord = {
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
};

export type OperationEvidenceEvaluation = {
  status: "passed" | "failed";
  coveredOperationIds: string[];
  missingOperationIds: string[];
  invalidEvidenceIds: string[];
  validationErrors: OperationEvidenceValidationError[];
  records: OperationEvidenceRecord[];
};

export type OperationEvidenceValidationError = {
  operationId: string;
  field: "role" | "route" | "assertions" | "artifacts" | "api" | "db" | "audit" | "runtime" | "report" | "trace" | "reproduction";
  message: string;
};

export type EvaluateOperationEvidenceInput = {
  operations: OperationEvidenceOperation[];
  records: OperationEvidenceRecord[];
};

const defaultEvidenceRoot = "test-results/acceptance/operation-evidence";
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
  const validationErrors = input.records
    .filter((record) => record.status === "passed")
    .flatMap((record) => validateReviewMetadata(record));
  const invalidEvidenceIds = Array.from(new Set(validationErrors.map((error) => error.operationId))).sort();

  return {
    status: missingOperationIds.length === 0 && validationErrors.length === 0 ? "passed" : "failed",
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

function validateReviewMetadata(record: OperationEvidenceRecord): OperationEvidenceValidationError[] {
  const errors: OperationEvidenceValidationError[] = [];
  const assertions = record.assertions ?? [];

  if (!record.role?.trim()) {
    errors.push({ operationId: record.operationId, field: "role", message: "Evidence requires a role summary." });
  }
  if (!record.route?.trim()) {
    errors.push({ operationId: record.operationId, field: "route", message: "Evidence requires a route summary." });
  }
  if (assertions.length === 0) {
    errors.push({ operationId: record.operationId, field: "assertions", message: "Evidence requires assertion metadata." });
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
  const evaluation = evaluateOperationEvidence({
    operations: acceptanceOperations,
    records: readOperationEvidenceRecords()
  });

  writeOperationEvidenceIndex({
    evaluation,
    markdownOut: defaultMarkdownOut,
    jsonOut: defaultJsonOut
  });
  console.log(JSON.stringify(evaluation, null, 2));
  return evaluation;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runOperationEvidenceCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
