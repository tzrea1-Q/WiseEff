import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const { balanceAcceptanceShards }: typeof import("./acceptance-shard-plan") = await import(new URL("./acceptance-shard-plan.ts", import.meta.url).href);
const snapshotFile = fileURLToPath(new URL("./server-durations.json", import.meta.url));
const measurements: { source: string; fileDurationMs: Record<string, number> } = JSON.parse(readFileSync(snapshotFile, "utf8"));

function requireServerPlan(condition: unknown): asserts condition {
  if (!condition) throw new Error("CI_SERVER_SHARD_PLAN");
}
function serverFile(file: string): boolean {
  return file.startsWith("server/") && file.endsWith(".test.ts") && path.posix.normalize(file) === file && !file.includes("\\");
}

export function balanceServerShards(
  files: readonly string[],
  shardCount = 2,
  durations: Record<string, number> = measurements.fileDurationMs,
): Array<{ files: string[]; durationMs: number }> {
  requireServerPlan(files.every(serverFile) && durations !== null && typeof durations === "object" && !Array.isArray(durations)
    && Object.keys(durations).every(serverFile));
  const shards = balanceAcceptanceShards(files, shardCount, durations, 0);
  requireServerPlan(JSON.stringify(shards.flatMap((shard) => shard.files).sort()) === JSON.stringify([...files].sort()));
  return shards;
}

export function orderServerFiles(files: readonly string[], durations: Record<string, number> = measurements.fileDurationMs): string[] {
  if (!files.length) return [];
  // Reuse the inventory and weight guards; existing shard ownership is unchanged.
  balanceServerShards(files, 1, durations);
  const fallback = Math.max(1, ...Object.values(durations));
  return [...files].sort((left, right) => (durations[right] || fallback) - (durations[left] || fallback)
    || (left < right ? -1 : left > right ? 1 : 0));
}

export function serverDurationsFromReport(report: unknown, root: string): Record<string, number> {
  requireServerPlan(report !== null && typeof report === "object" && "testResults" in report);
  const results = report.testResults;
  requireServerPlan(Array.isArray(results) && results.length > 0);
  const durations: Record<string, number> = {};
  for (const result of results) {
    requireServerPlan(result !== null && typeof result === "object" && typeof result.name === "string"
      && typeof result.startTime === "number" && Number.isFinite(result.startTime)
      && typeof result.endTime === "number" && Number.isFinite(result.endTime) && result.endTime >= result.startTime);
    const file = (path.isAbsolute(result.name) ? path.relative(root, result.name) : result.name).replaceAll("\\", "/");
    requireServerPlan(serverFile(file) && !Object.hasOwn(durations, file) && Number.isFinite(result.endTime - result.startTime));
    durations[file] = Math.round(result.endTime - result.startTime);
  }
  return Object.fromEntries(Object.entries(durations).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [command, reportFile, root = process.cwd()] = process.argv.slice(2);
  requireServerPlan(command === "refresh" && typeof reportFile === "string" && process.argv.length <= 6);
  const bytes = readFileSync(reportFile, "utf8");
  const report = JSON.parse(bytes);
  const fileDurationMs = serverDurationsFromReport(report, path.resolve(root));
  const source = `${path.basename(reportFile)} (sha256 ${createHash("sha256").update(bytes).digest("hex")}; generated ${new Date().toISOString()}; success=${report.success === true}; includes failed results when present)`;
  writeFileSync(snapshotFile, `${JSON.stringify({ source, fileDurationMs }, null, 2)}\n`);
  console.log(`Updated server-durations.json: ${Object.keys(fileDurationMs).length} measured files; missing/zero-duration files use the slowest recorded weight.`);
}
