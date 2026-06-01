import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acceptanceOperations,
  type AcceptanceOperation
} from "../e2e/acceptance/operationMatrix";
import { acceptanceRequirements } from "../e2e/acceptance/requirements";
import type { AcceptanceSpecInput } from "./check-acceptance-coverage";

export type { AcceptanceOperation } from "../e2e/acceptance/operationMatrix";

export type OperationMatrixInput = {
  operations: AcceptanceOperation[];
  specFiles: AcceptanceSpecInput[];
  knownAcceptanceIds: string[];
};

export type OperationMatrixResult = {
  status: "passed" | "failed";
  coveredOperationIds: string[];
  missingAutomatedOperationIds: string[];
  deferredOperationIdsMissingReason: string[];
  operationsMissingAssertions: string[];
  unknownOperationIds: string[];
  unknownAcceptanceIds: string[];
};

const operationMarkerPattern = /@operation\s+([A-Z]+-[A-Z0-9-]+)/g;
const defaultMatrixOut = "docs/developer/user-operation-coverage-matrix.md";

export function parseOperationIdsFromSpec(content: string) {
  return Array.from(content.matchAll(operationMarkerPattern), (match) => match[1]);
}

export function evaluateOperationMatrix(input: OperationMatrixInput): OperationMatrixResult {
  const requiredOperations = input.operations.filter((operation) => operation.priority !== "P2");
  const knownOperationIds = new Set(input.operations.map((operation) => operation.id));
  const knownAcceptanceIds = new Set(input.knownAcceptanceIds);
  const coveredOperationIds = Array.from(
    new Set(input.specFiles.flatMap((specFile) => parseOperationIdsFromSpec(specFile.content)))
  ).sort();
  const coveredOperationIdSet = new Set(coveredOperationIds);

  const missingAutomatedOperationIds = requiredOperations
    .filter((operation) => operation.coverage === "automated" && !coveredOperationIdSet.has(operation.id))
    .map((operation) => operation.id);
  const deferredOperationIdsMissingReason = requiredOperations
    .filter((operation) => operation.coverage !== "automated" && !operation.deferralReason?.trim())
    .map((operation) => operation.id);
  const operationsMissingAssertions = requiredOperations
    .filter((operation) => operation.assertions.length === 0)
    .map((operation) => operation.id);
  const unknownOperationIds = coveredOperationIds.filter((id) => !knownOperationIds.has(id));
  const unknownAcceptanceIds = Array.from(
    new Set(
      input.operations
        .flatMap((operation) => operation.acceptanceIds)
        .filter((acceptanceId) => !knownAcceptanceIds.has(acceptanceId))
    )
  ).sort();

  const status =
    missingAutomatedOperationIds.length === 0 &&
    deferredOperationIdsMissingReason.length === 0 &&
    operationsMissingAssertions.length === 0 &&
    unknownOperationIds.length === 0 &&
    unknownAcceptanceIds.length === 0
      ? "passed"
      : "failed";

  return {
    status,
    coveredOperationIds,
    missingAutomatedOperationIds,
    deferredOperationIdsMissingReason,
    operationsMissingAssertions,
    unknownOperationIds,
    unknownAcceptanceIds
  };
}

export function readOperationSpecFiles(root = "e2e/acceptance"): AcceptanceSpecInput[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root)
    .filter((name) => name.endsWith(".acceptance.spec.ts"))
    .map((name) => {
      const file = join(root, name);

      return {
        file,
        content: readFileSync(file, "utf8")
      };
    });
}

export function renderOperationMatrixMarkdown(operations: AcceptanceOperation[]) {
  return [
    "# User Operation Coverage Matrix",
    "",
    "This file is generated from `e2e/acceptance/operationMatrix.ts`.",
    "",
    "| Operation ID | Priority | Area | Coverage | Route | Roles | Assertions | Specs |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...operations.map((operation) =>
      [
        `| \`${operation.id}\``,
        operation.priority,
        operation.area,
        operation.coverage,
        `\`${operation.route}\``,
        escapeMarkdownTableCell(operation.roles.join(", ")),
        operation.assertions.join(", "),
        `${operation.specFiles.map((file) => `\`${file}\``).join("<br>")} |`
      ].join(" | ")
    ),
    "",
    "## Deferred Or Conditional Operations",
    "",
    ...operations
      .filter((operation) => operation.coverage !== "automated")
      .map((operation) => `- \`${operation.id}\`: ${operation.deferralReason ?? "_missing reason_"}`),
    ""
  ].join("\n");
}

export function writeOperationMatrixMarkdown(
  operations: AcceptanceOperation[] = acceptanceOperations,
  outputPath = defaultMatrixOut
) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderOperationMatrixMarkdown(operations), "utf8");
}

export function runOperationMatrixCheck() {
  const result = evaluateOperationMatrix({
    operations: acceptanceOperations,
    specFiles: readOperationSpecFiles(),
    knownAcceptanceIds: acceptanceRequirements.map((requirement) => requirement.id)
  });

  writeOperationMatrixMarkdown();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function escapeMarkdownTableCell(value: string) {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runOperationMatrixCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
