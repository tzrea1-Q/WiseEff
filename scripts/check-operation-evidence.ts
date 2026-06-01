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
  records: OperationEvidenceRecord[];
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
  const invalidEvidenceIds = input.records
    .filter((record) => record.status === "passed")
    .filter((record) => !hasReviewMetadata(record))
    .map((record) => record.operationId)
    .sort();

  return {
    status: missingOperationIds.length === 0 && invalidEvidenceIds.length === 0 ? "passed" : "failed",
    coveredOperationIds,
    missingOperationIds,
    invalidEvidenceIds,
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
            )} | ${escapeMarkdownTableCell(record.artifacts.join(", "))} |`
        )
      : ["| _none_ | _none_ | _none_ | _none_ | _none_ | _none_ |"];

  return [
    "# Operation Evidence Index",
    "",
    `- Status: \`${evaluation.status}\``,
    `- Covered operations: \`${evaluation.coveredOperationIds.length}\``,
    `- Missing operations: ${formatInlineCodeList(evaluation.missingOperationIds)}`,
    `- Invalid evidence records: ${formatInlineCodeList(evaluation.invalidEvidenceIds)}`,
    "",
    "| Operation ID | Status | Role | Route | Assertions | Artifacts |",
    "| --- | --- | --- | --- | --- | --- |",
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

function hasReviewMetadata(record: OperationEvidenceRecord) {
  return (
    Boolean(record.role?.trim()) &&
    Boolean(record.route?.trim()) &&
    Boolean(record.assertions?.length) &&
    record.artifacts.length > 0 &&
    record.artifacts.every((artifactPath) => existsSync(artifactPath))
  );
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function formatInlineCodeList(values: string[]) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "_none_";
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
