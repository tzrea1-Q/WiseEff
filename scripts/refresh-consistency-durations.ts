import path from "node:path";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function requireDurationReport(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid consistency duration report: expected unique measured consistency fixtures.");
}

export function consistencyDurationsFromReports(reports: unknown[]): Record<string, number> {
  const durations: Record<string, number> = Object.create(null);
  function visit(suites: unknown) {
    requireDurationReport(Array.isArray(suites));
    for (const suite of suites) {
      requireDurationReport(suite !== null && typeof suite === "object");
      requireDurationReport(suite.specs === undefined || Array.isArray(suite.specs));
      for (const spec of suite.specs ?? []) {
        requireDurationReport(spec !== null && typeof spec === "object" && typeof spec.file === "string");
        if (!/(^|[\\/])consistency\.quality\.spec\.ts$/.test(spec.file)) continue;
        requireDurationReport(typeof spec.title === "string" && spec.title.length > 0 && Array.isArray(spec.tests));
        for (const test of spec.tests) {
          requireDurationReport(test !== null && typeof test === "object");
          if (test.projectName !== "consistency") continue;
          requireDurationReport(Array.isArray(test.results));
          let durationMs = 0;
          let measured = false;
          for (const result of test.results) {
            requireDurationReport(result !== null && typeof result === "object"
              && ["passed", "failed", "timedOut", "interrupted", "skipped"].includes(result.status)
              && typeof result.duration === "number" && Number.isFinite(result.duration) && result.duration >= 0);
            if (result.status === "skipped") continue;
            measured = true;
            durationMs += result.duration;
          }
          if (!measured) continue;
          requireDurationReport(Number.isFinite(durationMs) && !Object.hasOwn(durations, spec.title));
          durations[spec.title] = Math.round(durationMs);
        }
      }
      visit(suite.suites ?? []);
    }
  }
  for (const report of reports) {
    requireDurationReport(report !== null && typeof report === "object" && "suites" in report);
    visit(report.suites);
  }
  requireDurationReport(Object.keys(durations).length > 0);
  return Object.fromEntries(Object.entries(durations).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const reportFiles = process.argv.slice(2);
  requireDurationReport(reportFiles.length > 0);
  const fixtureDurationMs = consistencyDurationsFromReports(reportFiles.map((file) => JSON.parse(readFileSync(file, "utf8"))));
  const snapshot = new URL("../e2e/quality/consistency-durations.json", import.meta.url);
  const source = `${reportFiles.map((file) => path.basename(file)).join(" + ")} (summed attempt durations, including failures/retries; skipped fixtures omitted)`;
  writeFileSync(snapshot, `${JSON.stringify({ source, fixtureDurationMs }, null, 2)}\n`);
  console.log(`Updated consistency-durations.json: ${Object.keys(fixtureDurationMs).length} measured fixtures; unknown fixtures use stable SHA-256 lane ownership.`);
}
