import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  reasons,
  scanParameterCatalogBoundaries,
  type BoundaryRuleId,
  type BoundaryViolation,
} from "./parameter-catalog-boundaries/scan";

export const baselinePath = "scripts/parameter-catalog-boundaries/baseline.json";
export type BoundaryCounts = Record<string, Partial<Record<BoundaryRuleId, number>>>;
const baselineSchema = z.object({
  schemaVersion: z.literal(1),
  counts: z.record(
    z.string().min(1).refine((file) =>
      file === file.trim() && !file.startsWith("/") && !file.includes("\\") &&
      file.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    ),
    z.record(
      z.string().refine((rule) => Object.hasOwn(reasons, rule)),
      z.number().int().nonnegative().safe(),
    ),
  ),
}).strict();

export function aggregateCounts(violations: readonly BoundaryViolation[]): BoundaryCounts {
  const counts = new Map<string, Map<BoundaryRuleId, number>>();
  for (const violation of violations) {
    const rules = counts.get(violation.file) ?? new Map<BoundaryRuleId, number>();
    rules.set(violation.rule, (rules.get(violation.rule) ?? 0) + 1);
    counts.set(violation.file, rules);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => compareText(left, right))
    .map(([file, rules]) => [file, Object.fromEntries([...rules].sort(([left], [right]) => compareText(left, right)))]));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function runCli(
  args: readonly string[],
  repoRoot = process.cwd(),
  print: (message: string) => void = console.log,
): Promise<number> {
  for (const argument of args) {
    if (argument !== "--update" && argument !== "--allow-increase") {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  const update = args.includes("--update");
  const allowIncrease = args.includes("--allow-increase");
  if (allowIncrease && !update) throw new Error("--allow-increase requires --update.");
  const path = resolve(repoRoot, baselinePath);
  let baseline: BoundaryCounts;
  try {
    baseline = baselineSchema.parse(JSON.parse(await readFile(path, "utf8"))).counts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !update || !allowIncrease) throw error;
    baseline = {};
  }
  const violations = await scanParameterCatalogBoundaries(repoRoot);
  const actual = aggregateCounts(violations);
  let growth = false;
  let stale = false;
  for (const file of [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort(compareText)) {
    const baselineRules = Object.hasOwn(baseline, file) ? baseline[file] : {};
    const actualRules = Object.hasOwn(actual, file) ? actual[file] : {};
    for (const rule of [...new Set([...Object.keys(baselineRules), ...Object.keys(actualRules)])].sort(compareText) as BoundaryRuleId[]) {
      const previous = baselineRules[rule] ?? 0;
      const current = actualRules[rule] ?? 0;
      if (current === previous) continue;
      if (current > previous) growth = true;
      else stale = true;
      print(`${current > previous ? "Boundary growth" : "Stale baseline"}: ${file} ${rule} baseline=${previous} actual=${current}`);
      if (current > previous) {
        for (const violation of violations.filter((entry) => entry.file === file && entry.rule === rule)) {
          print(`  ${file}:${violation.line} ${violation.evidence}`);
        }
      }
    }
  }
  if (update) {
    if (growth && !allowIncrease) {
      print("Baseline update refused: counts would increase. Review growth before using --update --allow-increase.");
      return 1;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ schemaVersion: 1, counts: actual }, null, 2)}\n`, "utf8");
    print(`Parameter Catalog boundary baseline updated: ${violations.length} occurrences, ${Object.keys(actual).length} files.`);
    return 0;
  }
  if (stale) print("Run npm run parameter-catalog-boundaries:check -- --update to lock in the improvement.");
  if (growth || stale) return 1;
  print(`Parameter Catalog boundary baseline: ${violations.length} occurrences, ${Object.keys(actual).length} files.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
