import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Page, TestInfo } from "playwright/test";
import { acceptanceOperations, type AcceptanceOperationAssertion } from "../operationMatrix";
import { resolveEvidenceRunContext } from "./evidenceRun";
import {
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV,
  loadOwnedRuntimeDescriptor,
  loadOwnedRuntimeDescriptorFromEnv,
  sha256,
} from "./ownedRuntimeDescriptor";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV,
  readNestedRuntimeManifest,
  type NestedRuntimeProcessIdentity,
} from "./nestedRuntimeManifest";

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
  nestedRuntime?: {
    id: string;
    manifestPath: string;
    parentRunId: string;
    sourceCommit: string;
    databaseName: string;
    markerPurpose: string;
    migrationRunId: string;
    objectStoreRoot: string;
    apiUrl: string;
    frontendUrl: string;
    state: "running";
    apiPid: number;
    frontendPid: number;
    apiProcessIdentity: NestedRuntimeProcessIdentity;
    frontendProcessIdentity: NestedRuntimeProcessIdentity;
    startedAt: string;
  };
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
  const run = resolveEvidenceRunContext();
  const testIdentity = testInfo as TestInfo & { file?: string; titlePath?: string[] };
  const identity = [testIdentity.file ?? "unknown-spec", ...(testIdentity.titlePath ?? []), fileName].join("\0");
  const identityHash = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  const artifactPath = join(run.artifactsRoot, identityHash, basename(fileName));
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(observed, null, 2)}\n`, "utf8");
  await testInfo.attach("operation-json-evidence", {
    path: artifactPath,
    contentType: "application/json"
  });
  return artifactPath;
}

export async function recordOperationEvidence(input: RecordOperationEvidenceInput) {
  const run = resolveEvidenceRunContext();
  mkdirSync(run.recordsRoot, { recursive: true });
  mkdirSync(run.artifactsRoot, { recursive: true });

  const fileName = operationEvidenceFileName(input.operationId, input.title);
  const jsonPath = join(run.recordsRoot, fileName);
  const artifacts = [...(input.artifacts ?? [])];
  const operation = operationForEvidence(input.operationId);

  if (input.page) {
    const screenshotPath = join(run.artifactsRoot, fileName.replace(/\.json$/, ".png"));
    await input.page.screenshot({ path: screenshotPath, fullPage: true });
    artifacts.push(screenshotPath);
  }

  artifacts.push(jsonPath);

  const record = {
    runId: run.runId,
    sourceCommit: run.sourceCommit,
    runKind: run.runKind,
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
    trace: input.trace ?? defaultTraceSummary(process.env),
    report: input.report ?? defaultReportSummary(process.env),
    runtime: mergeRuntimeSummary(defaultRuntimeSummary(run), input.runtime),
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

function defaultTraceSummary(env: NodeJS.ProcessEnv): OperationEvidenceTraceSummary {
  return {
    mode: "retain-on-failure",
    path: env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR?.trim() || "test-results/acceptance",
    note: "Playwright acceptance traces are retained on failure; operation JSON and screenshots are always recorded."
  };
}

function defaultReportSummary(env: NodeJS.ProcessEnv): OperationEvidenceReportSummary {
  const reportRoot = env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR?.trim();
  return {
    path: reportRoot ? join(reportRoot, "index.html") : "playwright-report/acceptance/index.html",
    format: "html"
  };
}

function defaultRuntimeSummary(
  evidenceRun: { runId: string; sourceCommit: string },
): OperationEvidenceRuntimeSummary {
  const nestedRuntimeId = process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]?.trim();
  const parentDescriptorPath = process.env[OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV]?.trim();
  const ownedDescriptorPath = process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]?.trim();
  const gate0NestedBinding = Boolean(nestedRuntimeId && parentDescriptorPath);
  if ((!nestedRuntimeId && parentDescriptorPath && !ownedDescriptorPath) || (nestedRuntimeId && !parentDescriptorPath && ownedDescriptorPath)) {
    throw new Error("Gate0 nested operation evidence has an incomplete parent runtime binding.");
  }
  const descriptorPath = gate0NestedBinding
    ? parentDescriptorPath
    : nestedRuntimeId
      ? undefined
      : ownedDescriptorPath;
  const ownedRuntime = gate0NestedBinding
    ? loadOwnedRuntimeDescriptor(descriptorPath)
    : nestedRuntimeId
      ? undefined
      : loadOwnedRuntimeDescriptorFromEnv();
  if (ownedRuntime && (
    ownedRuntime.run.id !== evidenceRun.runId ||
    ownedRuntime.run.sourceCommit !== evidenceRun.sourceCommit
  )) {
    throw new Error("Operation evidence parent runtime identity does not match its evidence run.");
  }
  const apiBaseUrl =
    process.env.VITE_WISEEFF_API_BASE_URL?.trim() ||
    process.env.WISEEFF_API_BASE_URL?.trim() ||
    "http://127.0.0.1:8787";
  const nestedRuntime = gate0NestedBinding && nestedRuntimeId && ownedRuntime && descriptorPath
    ? resolveNestedRuntimeEvidence(ownedRuntime, nestedRuntimeId, apiBaseUrl)
    : undefined;
  return {
    mode: process.env.VITE_WISEEFF_RUNTIME_MODE?.trim() || "api",
    apiBaseUrl,
    seed: process.env.WISEEFF_ACCEPTANCE_SEED?.trim() || undefined,
    envSummary: {
      DATABASE_URL: process.env.DATABASE_URL ? "set" : "unset",
      OBJECT_STORE_MODE: process.env.OBJECT_STORE_MODE?.trim() || "local",
      DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE?.trim() || "simulator",
      XIAOZE_DETERMINISTIC: process.env.XIAOZE_DETERMINISTIC === "true" ? "true" : "false",
      WISEEFF_ACCEPTANCE_NO_START_RUNTIME: process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME === "true" ? "true" : "false"
    },
    ...(ownedRuntime && descriptorPath
      ? {
          ownedRuntime: {
            runRoot: ownedRuntime.artifacts.runRoot,
            descriptorPath,
            descriptorSnapshotPath: ownedRuntime.artifacts.operationEvidenceRuntimeSnapshot,
            descriptorSnapshotSha256: sha256(readFileSync(ownedRuntime.artifacts.operationEvidenceRuntimeSnapshot)),
            runId: ownedRuntime.run.id,
            sourceCommit: ownedRuntime.run.sourceCommit,
            databaseName: ownedRuntime.database.name,
            objectMarkerSha256: ownedRuntime.objectStore.markerSha256,
            apiUrl: ownedRuntime.endpoints.api.url,
            frontendUrl: ownedRuntime.endpoints.frontend.url,
            apiPid: ownedRuntime.processes.api.pid,
            frontendPid: ownedRuntime.processes.frontend.pid,
          },
        }
      : {}),
    ...(nestedRuntime ? { nestedRuntime } : {}),
  };
}

function mergeRuntimeSummary(
  trusted: OperationEvidenceRuntimeSummary,
  supplemental: OperationEvidenceRuntimeSummary | undefined,
): OperationEvidenceRuntimeSummary {
  if (!supplemental) return trusted;
  return {
    ...trusted,
    mode: supplemental.mode?.trim() || trusted.mode,
    seed: supplemental.seed ?? trusted.seed,
    envSummary: {
      ...trusted.envSummary,
      ...supplemental.envSummary,
    },
  };
}

function resolveNestedRuntimeEvidence(
  ownedRuntime: ReturnType<typeof loadOwnedRuntimeDescriptor>,
  nestedRuntimeId: string,
  apiBaseUrl: string,
): NonNullable<OperationEvidenceRuntimeSummary["nestedRuntime"]> {
  const manifestPath = ownedRuntime.artifacts.nestedRuntimeManifest;
  const manifest = readNestedRuntimeManifest(manifestPath);
  if (
    manifest.parentRunId !== ownedRuntime.run.id ||
    manifest.sourceCommit !== ownedRuntime.run.sourceCommit
  ) {
    throw new Error("Nested operation evidence manifest does not match its parent runtime identity.");
  }
  const child = manifest.children.find((candidate) => candidate.id === nestedRuntimeId);
  if (!child) throw new Error(`Nested operation evidence runtime ${nestedRuntimeId} is not present in its parent manifest.`);
  if (
    child.state !== "running" ||
    child.apiProcessState !== "running" ||
    child.frontendProcessState !== "running" ||
    !child.migrationRunId ||
    !child.apiPid ||
    !child.frontendPid ||
    !child.apiProcessIdentity ||
    !child.frontendProcessIdentity
  ) {
    throw new Error(`Nested operation evidence runtime ${nestedRuntimeId} is not fully running.`);
  }
  if (apiBaseUrl !== child.apiUrl) {
    throw new Error(`Nested operation evidence API URL does not match runtime ${nestedRuntimeId}.`);
  }
  if (databaseNameFromUrl(process.env.DATABASE_URL) !== child.databaseName) {
    throw new Error(`Nested operation evidence database does not match runtime ${nestedRuntimeId}.`);
  }
  return {
    id: child.id,
    manifestPath,
    parentRunId: manifest.parentRunId,
    sourceCommit: manifest.sourceCommit,
    databaseName: child.databaseName,
    markerPurpose: child.markerPurpose,
    migrationRunId: child.migrationRunId,
    objectStoreRoot: child.objectStoreRoot,
    apiUrl: child.apiUrl,
    frontendUrl: child.frontendUrl,
    state: "running",
    apiPid: child.apiPid,
    frontendPid: child.frontendPid,
    apiProcessIdentity: child.apiProcessIdentity,
    frontendProcessIdentity: child.frontendProcessIdentity,
    startedAt: child.startedAt,
  };
}

function databaseNameFromUrl(value: string | undefined) {
  try {
    const parsed = new URL(value ?? "");
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (!databaseName) throw new Error("missing database");
    return databaseName;
  } catch {
    throw new Error("Nested operation evidence requires a valid runtime database URL.");
  }
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
