import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Page, TestInfo } from "playwright/test";
import { acceptanceOperations, type AcceptanceOperationAssertion } from "../operationMatrix";

export type OperationEvidenceStatus = "passed" | "failed" | "skipped";

export type OperationEvidenceApiSummary = {
  method: string;
  path: string;
  status: number;
  requestId?: string;
  responseSummary?: string;
};

export type OperationEvidenceDbSummary = {
  table: string;
  predicate: string;
  observed: string;
  rowCount?: number;
};

export type OperationEvidenceAuditSummary = {
  id?: string;
  kind: string;
  action?: string;
  targetId?: string | null;
  requestId?: string;
  metadataSummary?: string;
};

export type OperationEvidenceTraceSummary = {
  mode: "retain-on-failure" | "on" | "off";
  path?: string;
  note?: string;
};

export type OperationEvidenceReportSummary = {
  path: string;
  format: "html" | "json" | "markdown";
};

export type OperationEvidenceRuntimeSummary = {
  mode: string;
  apiBaseUrl: string;
  seed?: string;
  envSummary?: Record<string, string>;
};

export type OperationEvidenceReproductionSummary = {
  steps: string[];
  seed?: string;
};

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
  api?: OperationEvidenceApiSummary[];
  db?: OperationEvidenceDbSummary[];
  audit?: OperationEvidenceAuditSummary[];
  trace?: OperationEvidenceTraceSummary;
  report?: OperationEvidenceReportSummary;
  runtime?: OperationEvidenceRuntimeSummary;
  reproduction?: OperationEvidenceReproductionSummary;
};

const evidenceRoot = "test-results/acceptance-operation-evidence";

export function operationEvidenceFileName(operationId: string, title: string) {
  const titleSlug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${operationId}-${titleSlug || "operation-evidence"}.json`;
}

export async function writeOperationJsonArtifact(
  testInfo: TestInfo,
  fileName: string,
  observed: unknown
) {
  const artifactPath = testInfo.outputPath(fileName);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(observed, null, 2)}\n`, "utf8");
  await testInfo.attach("operation-json-evidence", {
    path: artifactPath,
    contentType: "application/json"
  });
  return artifactPath;
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
    api: sanitizeApiSummaries(input.api),
    db: sanitizeDbSummaries(input.db),
    audit: sanitizeAuditSummaries(input.audit),
    trace: input.trace ?? defaultTraceSummary(),
    report: input.report ?? defaultReportSummary(),
    runtime: input.runtime ?? defaultRuntimeSummary(),
    reproduction: input.reproduction ?? defaultReproductionSummary(input, operation?.route ?? "unknown", artifacts),
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

export function summarizeApiResponse(
  response: { status(): number; headers(): Record<string, string> },
  input: { method: string; path: string; responseSummary?: string }
): OperationEvidenceApiSummary {
  const headers = response.headers();

  return {
    method: input.method,
    path: input.path,
    status: response.status(),
    requestId: headers["x-request-id"] || headers["X-Request-Id"],
    responseSummary: input.responseSummary ? redactSensitiveText(input.responseSummary) : undefined
  };
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\bauthorization\s+Bearer\s+\S+/gi, "authorization [redacted]")
    .replace(/\b(authorization|token|key|secret|api_key|apikey)(\s*[:=]?\s*)\S+/gi, (_match, label: string, separator: string) => {
      const normalizedSeparator = separator.includes("=") ? "=" : " ";
      return `${label}${normalizedSeparator}[redacted]`;
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [redacted]");
}

function operationForEvidence(operationId: string) {
  const parentId = operationId.split(":")[0];
  return acceptanceOperations.find((operation) => operation.id === parentId);
}

function sanitizeApiSummaries(summaries: OperationEvidenceApiSummary[] | undefined) {
  return summaries?.map((summary) => ({
    ...summary,
    responseSummary: summary.responseSummary ? redactSensitiveText(summary.responseSummary) : undefined
  }));
}

function sanitizeDbSummaries(summaries: OperationEvidenceDbSummary[] | undefined) {
  return summaries?.map((summary) => ({
    ...summary,
    observed: redactSensitiveText(summary.observed)
  }));
}

function sanitizeAuditSummaries(summaries: OperationEvidenceAuditSummary[] | undefined) {
  return summaries?.map((summary) => ({
    ...summary,
    metadataSummary: summary.metadataSummary ? redactSensitiveText(summary.metadataSummary) : undefined
  }));
}

function defaultTraceSummary(): OperationEvidenceTraceSummary {
  return {
    mode: "retain-on-failure",
    path: "test-results/acceptance",
    note: "Playwright acceptance traces are retained on failure; operation JSON and screenshots are always recorded."
  };
}

function defaultReportSummary(): OperationEvidenceReportSummary {
  return {
    path: "playwright-report/acceptance/index.html",
    format: "html"
  };
}

function defaultRuntimeSummary(): OperationEvidenceRuntimeSummary {
  return {
    mode: process.env.VITE_WISEEFF_RUNTIME_MODE?.trim() || "api",
    apiBaseUrl:
      process.env.VITE_WISEEFF_API_BASE_URL?.trim() ||
      process.env.WISEEFF_API_BASE_URL?.trim() ||
      "http://127.0.0.1:8787",
    seed: process.env.WISEEFF_ACCEPTANCE_SEED?.trim() || undefined,
    envSummary: {
      DATABASE_URL: process.env.DATABASE_URL ? "set" : "unset",
      OBJECT_STORE_MODE: process.env.OBJECT_STORE_MODE?.trim() || "local",
      DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE?.trim() || "simulator",
      XIAOZE_DETERMINISTIC: process.env.XIAOZE_DETERMINISTIC === "true" ? "true" : "false",
      WISEEFF_ACCEPTANCE_NO_START_RUNTIME: process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true" ? "true" : "false"
    }
  };
}

function defaultReproductionSummary(
  input: RecordOperationEvidenceInput,
  route: string,
  artifacts: string[]
): OperationEvidenceReproductionSummary {
  return {
    seed: process.env.WISEEFF_ACCEPTANCE_SEED?.trim() || undefined,
    steps: [
      `Open route ${input.route ?? route}.`,
      `Run operation ${input.operationId}: ${input.title}.`,
      `Review operation artifacts: ${artifacts.length > 0 ? artifacts.join(", ") : "none"}.`
    ]
  };
}
