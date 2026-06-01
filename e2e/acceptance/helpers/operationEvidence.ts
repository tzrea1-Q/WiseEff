import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, TestInfo } from "playwright/test";
import { acceptanceOperations, type AcceptanceOperationAssertion } from "../operationMatrix";

export type OperationEvidenceStatus = "passed" | "failed" | "skipped";

export type RecordOperationEvidenceInput = {
  operationId: string;
  title: string;
  status: OperationEvidenceStatus;
  role?: string;
  route?: string;
  assertions?: AcceptanceOperationAssertion[];
  notes?: string;
  page?: Page;
  testInfo?: TestInfo;
  artifacts?: string[];
};

const evidenceRoot = "test-results/acceptance/operation-evidence";

export function operationEvidenceFileName(operationId: string, title: string) {
  const titleSlug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${operationId}-${titleSlug || "operation-evidence"}.json`;
}

export async function recordOperationEvidence(input: RecordOperationEvidenceInput) {
  mkdirSync(evidenceRoot, { recursive: true });

  const fileName = operationEvidenceFileName(input.operationId, input.title);
  const jsonPath = join(evidenceRoot, fileName);
  const artifacts = [...(input.artifacts ?? [])];
  const operation = operationForEvidence(input.operationId);

  if (input.page) {
    const screenshotPath = jsonPath.replace(/\.json$/, ".png");
    await input.page.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.push(screenshotPath);
  }

  const record = {
    operationId: input.operationId,
    title: input.title,
    status: input.status,
    role: input.role ?? operation?.roles.join(", ") ?? "unknown",
    route: input.route ?? operation?.route ?? "unknown",
    assertions: input.assertions ?? operation?.assertions ?? [],
    notes: input.notes ? redactSensitiveText(input.notes) : undefined,
    artifacts,
    recordedAt: new Date().toISOString()
  };

  writeFileSync(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  if (input.testInfo) {
    await input.testInfo.attach("operation-evidence", {
      path: jsonPath,
      contentType: "application/json"
    });
  }

  return {
    path: jsonPath,
    record
  };
}

function redactSensitiveText(value: string) {
  return value.replace(/\b(token|key)(\s*[:=]?\s*)\S+/gi, (_match, label: string, separator: string) => {
    const normalizedSeparator = separator.includes("=") ? "=" : " ";
    return `${label}${normalizedSeparator}[redacted]`;
  });
}

function operationForEvidence(operationId: string) {
  const parentId = operationId.split(":")[0];
  return acceptanceOperations.find((operation) => operation.id === parentId);
}
