import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type AcceptanceFailurePhase = "visual" | "browser";

export type AcceptanceFailure = {
  phase: AcceptanceFailurePhase;
  project: string;
  file: string;
  title: string;
  route: string;
  errorClass: string;
  message: string;
  attachments: string[];
};

export type AcceptanceFailureInventory = {
  version: 1;
  kind: "wiseeff-acceptance-gate0-failure-inventory";
  runId: string;
  sourceCommit: string;
  failureCount: number;
  failures: AcceptanceFailure[];
  reports: Array<{ phase: AcceptanceFailurePhase; path: string }>;
  recordedAt: string;
};

export type FailureInventoryReportInput = {
  phase: AcceptanceFailurePhase;
  reportPath: string;
  report?: unknown;
  error?: string;
};

export function buildAcceptanceFailureInventory(input: {
  runId: string;
  sourceCommit: string;
  reports: FailureInventoryReportInput[];
  now?: string;
}): AcceptanceFailureInventory {
  const failures = input.reports.flatMap((report) =>
    report.report
      ? collectReportFailures(report.phase, report.report)
      : [
          {
            phase: report.phase,
            project: "unknown",
            file: report.reportPath,
            title: "Playwright JSON report unavailable",
            route: "unknown",
            errorClass: "ReportUnavailable",
            message: report.error ?? `Report was not available at ${report.reportPath}.`,
            attachments: [],
          } satisfies AcceptanceFailure,
        ],
  );

  return {
    version: 1,
    kind: "wiseeff-acceptance-gate0-failure-inventory",
    runId: input.runId,
    sourceCommit: input.sourceCommit,
    failureCount: failures.length,
    failures,
    reports: input.reports.map((report) => ({ phase: report.phase, path: report.reportPath })),
    recordedAt: input.now ?? new Date().toISOString(),
  };
}

export function readFailureInventoryReport(
  phase: AcceptanceFailurePhase,
  reportPath: string,
): FailureInventoryReportInput {
  if (!existsSync(reportPath)) {
    return { phase, reportPath, error: `Report was not created at ${reportPath}.` };
  }
  try {
    return { phase, reportPath, report: JSON.parse(readFileSync(reportPath, "utf8")) as unknown };
  } catch (error) {
    return {
      phase,
      reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeAcceptanceFailureInventory(
  outputPath: string,
  inventory: AcceptanceFailureInventory,
) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  return outputPath;
}

function collectReportFailures(phase: AcceptanceFailurePhase, report: unknown) {
  const failures: AcceptanceFailure[] = [];

  function visitSuite(value: unknown, inheritedFile = "unknown") {
    if (!isRecord(value)) return;
    const file = typeof value.file === "string" ? value.file : inheritedFile;
    if (Array.isArray(value.specs)) {
      for (const specValue of value.specs) {
        if (!isRecord(specValue)) continue;
        const title = typeof specValue.title === "string" ? specValue.title : "unknown test";
        if (!Array.isArray(specValue.tests)) continue;
        for (const testValue of specValue.tests) {
          if (!isRecord(testValue)) continue;
          const project = typeof testValue.projectName === "string" ? testValue.projectName : "unknown";
          if (!Array.isArray(testValue.results)) continue;
          const resultValue = testValue.results.at(-1);
          if (isRecord(resultValue) && isFailureStatus(resultValue.status)) {
            const error = isRecord(resultValue.error) ? resultValue.error : {};
            const message =
              typeof error.message === "string"
                ? error.message
                : typeof resultValue.error === "string"
                  ? resultValue.error
                  : `Playwright result status: ${String(resultValue.status)}`;
            failures.push({
              phase,
              project,
              file,
              title,
              route: extractRoute(message, title),
              errorClass:
                typeof error.name === "string" && error.name.trim()
                  ? error.name
                  : "PlaywrightFailure",
              message,
              attachments: Array.isArray(resultValue.attachments)
                ? resultValue.attachments.flatMap((attachment) =>
                    isRecord(attachment) && typeof attachment.path === "string" ? [attachment.path] : [],
                  )
                : [],
            });
          }
        }
      }
    }
    if (Array.isArray(value.suites)) {
      for (const child of value.suites) visitSuite(child, file);
    }
  }

  if (isRecord(report) && Array.isArray(report.suites)) {
    for (const suite of report.suites) visitSuite(suite);
  }
  return failures;
}

function isFailureStatus(value: unknown) {
  return ["failed", "timedOut", "interrupted"].includes(String(value));
}

function extractRoute(message: string, title: string) {
  const route = /(?:route|at|for)\s+(\/[A-Za-z0-9_/?=&%.-]+)/u.exec(`${message}\n${title}`)?.[1];
  return route ?? "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
