import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { acceptanceRequirements, type AcceptanceRequirement } from "../e2e/acceptance/requirements";

export type AcceptanceSpecInput = {
  file: string;
  content: string;
};

export type AcceptanceCoverageInput = {
  requirements: AcceptanceRequirement[];
  specFiles: AcceptanceSpecInput[];
  /** IDs found in the human coverage map; when provided, both directions must reconcile. */
  coverageMapIds?: string[];
  /** Playwright JSON report (`results.json`). When present, skipped required tests fail coverage. */
  playwrightResults?: unknown;
};

export type PlaywrightAcceptanceOutcome = {
  file: string;
  title: string;
  status: "passed" | "failed" | "skipped";
};

export type AcceptanceIdBinding = {
  id: string;
  testTitle: string | null;
};

export type AcceptanceCoverageCliOptions = {
  resultsPath?: string;
};

export type AcceptanceCoverageResult = {
  status: "passed" | "failed";
  coveredIds: string[];
  /** Declared-but-not-automated coverage: `@acceptance-planned` markers (skip stubs). */
  plannedIds: string[];
  missingRequiredIds: string[];
  unknownIds: string[];
  /** Required IDs whose bound Playwright tests ran and were skipped. */
  skippedRequiredIds: string[];
  /** Requirements missing a row in docs/developer/browser-acceptance-coverage-map.md. */
  coverageMapMissingIds: string[];
  /** Coverage-map rows whose ID no longer exists in the requirements registry. */
  coverageMapOrphanIds: string[];
};

// `@acceptance <ID>` claims automated coverage; `@acceptance-planned <ID>` declares
// intended coverage carried by a skip stub and never satisfies a required requirement.
const acceptanceMarkerPattern = /@acceptance\s+([A-Z]+-[A-Z0-9-]+)/g;
const plannedMarkerPattern = /@acceptance-planned\s+([A-Z]+-[A-Z0-9-]+)/g;

export function parseAcceptanceIdsFromSpec(content: string) {
  return Array.from(content.matchAll(acceptanceMarkerPattern), (match) => match[1]);
}

export function parsePlannedAcceptanceIdsFromSpec(content: string) {
  return Array.from(content.matchAll(plannedMarkerPattern), (match) => match[1]);
}

const testDeclarationPattern = /\btest(?:\.(?:only|fixme|skip))?\(\s*(['"`])/g;

export function bindAcceptanceIdsFromSpec(content: string): AcceptanceIdBinding[] {
  const tests: Array<{ title: string; index: number }> = [];
  for (const match of content.matchAll(testDeclarationPattern)) {
    const quote = match[1];
    const titleStart = (match.index ?? 0) + match[0].length;
    const title = readQuotedString(content, titleStart, quote);
    if (title !== null) {
      tests.push({ title, index: match.index ?? 0 });
    }
  }

  return Array.from(content.matchAll(acceptanceMarkerPattern), (match) => {
    const preceding = [...tests].reverse().find((test) => test.index < (match.index ?? 0));
    return { id: match[1], testTitle: preceding?.title ?? null };
  });
}

export function parsePlaywrightAcceptanceOutcomes(report: unknown): PlaywrightAcceptanceOutcome[] {
  const outcomes: PlaywrightAcceptanceOutcome[] = [];

  const visitSuite = (value: unknown) => {
    if (!isRecord(value)) {
      return;
    }

    const fileName = typeof value.file === "string" ? normalizeSpecFile(value.file) : undefined;
    if (fileName && Array.isArray(value.specs)) {
      for (const spec of value.specs) {
        if (!isRecord(spec)) {
          continue;
        }
        const title = typeof spec.title === "string" ? spec.title : "";
        outcomes.push({
          file: fileName,
          title,
          status: summarizePlaywrightSpecStatus(spec)
        });
      }
    }

    if (Array.isArray(value.suites)) {
      for (const child of value.suites) {
        visitSuite(child);
      }
    }
  };

  if (isRecord(report) && Array.isArray(report.suites)) {
    for (const suite of report.suites) {
      visitSuite(suite);
    }
  }

  return outcomes;
}

export function parseAcceptanceCoverageArgs(args: readonly string[]): AcceptanceCoverageCliOptions {
  const options: AcceptanceCoverageCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--results" && next) {
      options.resultsPath = next;
      index += 1;
    }
  }
  return options;
}

export function evaluateAcceptanceCoverage(input: AcceptanceCoverageInput): AcceptanceCoverageResult {
  const knownIds = new Set(input.requirements.map((requirement) => requirement.id));
  const coveredIds = Array.from(
    new Set(input.specFiles.flatMap((specFile) => parseAcceptanceIdsFromSpec(specFile.content)))
  ).sort();
  const plannedIds = Array.from(
    new Set(input.specFiles.flatMap((specFile) => parsePlannedAcceptanceIdsFromSpec(specFile.content)))
  ).sort();
  const coveredSet = new Set(coveredIds);
  const missingRequiredIds = input.requirements
    .filter((requirement) => requirement.required && !coveredSet.has(requirement.id))
    .map((requirement) => requirement.id);
  const unknownIds = Array.from(new Set([...coveredIds, ...plannedIds]))
    .filter((id) => !knownIds.has(id))
    .sort();

  const mapIds = input.coverageMapIds ? new Set(input.coverageMapIds) : null;
  const coverageMapMissingIds = mapIds
    ? input.requirements.filter((requirement) => !mapIds.has(requirement.id)).map((requirement) => requirement.id)
    : [];
  const coverageMapOrphanIds = mapIds
    ? Array.from(mapIds).filter((id) => !knownIds.has(id)).sort()
    : [];
  const skippedRequiredIds = collectSkippedRequiredIds(input);

  const status =
    missingRequiredIds.length === 0 &&
    unknownIds.length === 0 &&
    coverageMapMissingIds.length === 0 &&
    coverageMapOrphanIds.length === 0 &&
    skippedRequiredIds.length === 0
      ? "passed"
      : "failed";

  return {
    status,
    coveredIds,
    plannedIds,
    missingRequiredIds,
    unknownIds,
    skippedRequiredIds,
    coverageMapMissingIds,
    coverageMapOrphanIds
  };
}

/** Recursively collect *.acceptance.spec.ts so specs moved into subdirectories stay counted. */
export function readAcceptanceSpecFiles(root = "e2e/acceptance"): AcceptanceSpecInput[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: AcceptanceSpecInput[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name.endsWith(".acceptance.spec.ts")) {
        files.push({ file: path, content: readFileSync(path, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}

const coverageMapPath = "docs/developer/browser-acceptance-coverage-map.md";
const coverageMapRowPattern = /^\| `([A-Z][A-Z0-9-]+)`/gm;

export function parseCoverageMapIds(content: string): string[] {
  return Array.from(content.matchAll(coverageMapRowPattern), (match) => match[1]);
}

export function readCoverageMapIds(path = coverageMapPath): string[] {
  if (!existsSync(path)) {
    return [];
  }
  return parseCoverageMapIds(readFileSync(path, "utf8"));
}

const defaultPlaywrightJsonReport = "test-results/acceptance/results.json";

export function readPlaywrightAcceptanceResults(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`Playwright results not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runAcceptanceCoverageCheck(options: AcceptanceCoverageCliOptions = {}) {
  const resultsPath = options.resultsPath ?? (existsSync(defaultPlaywrightJsonReport) ? defaultPlaywrightJsonReport : undefined);
  const result = evaluateAcceptanceCoverage({
    requirements: acceptanceRequirements,
    specFiles: readAcceptanceSpecFiles(),
    coverageMapIds: readCoverageMapIds(),
    playwrightResults: resultsPath ? readPlaywrightAcceptanceResults(resultsPath) : undefined
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceCoverageCheck(parseAcceptanceCoverageArgs(process.argv.slice(2)));
  process.exit(result.status === "passed" ? 0 : 1);
}

function collectSkippedRequiredIds(input: AcceptanceCoverageInput): string[] {
  if (input.playwrightResults === undefined) {
    return [];
  }

  const outcomes = parsePlaywrightAcceptanceOutcomes(input.playwrightResults);
  if (outcomes.length === 0) {
    return [];
  }

  const coveredSet = new Set(input.specFiles.flatMap((specFile) => parseAcceptanceIdsFromSpec(specFile.content)));
  const bindingsByFile = new Map(
    input.specFiles.map((specFile) => [normalizeSpecFile(specFile.file), bindAcceptanceIdsFromSpec(specFile.content)])
  );

  return input.requirements
    .filter((requirement) => requirement.required && coveredSet.has(requirement.id))
    .filter((requirement) => isRequiredIdSkipped(requirement.id, input.specFiles, bindingsByFile, outcomes))
    .map((requirement) => requirement.id);
}

function isRequiredIdSkipped(
  id: string,
  specFiles: AcceptanceSpecInput[],
  bindingsByFile: Map<string, AcceptanceIdBinding[]>,
  outcomes: PlaywrightAcceptanceOutcome[]
) {
  const bound: PlaywrightAcceptanceOutcome[] = [];

  for (const specFile of specFiles) {
    const file = normalizeSpecFile(specFile.file);
    const fileOutcomes = outcomes.filter((outcome) => outcome.file === file);
    if (fileOutcomes.length === 0) {
      continue;
    }

    const bindings = (bindingsByFile.get(file) ?? []).filter((binding) => binding.id === id);
    const inTestTitles = bindings
      .map((binding) => binding.testTitle)
      .filter((title): title is string => typeof title === "string");
    const fileScoped = bindings.some((binding) => binding.testTitle === null);

    if (inTestTitles.length > 0) {
      bound.push(...fileOutcomes.filter((outcome) => inTestTitles.includes(outcome.title)));
    }

    bound.push(...fileOutcomes.filter((outcome) => titleMentionsAcceptanceId(outcome.title, id)));

    if (bound.length === 0 && fileScoped) {
      bound.push(...fileOutcomes);
    }
  }

  const unique = uniqueOutcomes(bound);
  return unique.length > 0 && unique.every((outcome) => outcome.status === "skipped");
}

function uniqueOutcomes(outcomes: PlaywrightAcceptanceOutcome[]) {
  const seen = new Set<string>();
  return outcomes.filter((outcome) => {
    const key = `${outcome.file}\0${outcome.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function titleMentionsAcceptanceId(title: string, id: string) {
  return new RegExp(`(?:^|[^A-Z0-9-])${id}(?:[^A-Z0-9-]|$)`).test(title);
}

function summarizePlaywrightSpecStatus(spec: Record<string, unknown>): PlaywrightAcceptanceOutcome["status"] {
  const statuses: PlaywrightAcceptanceOutcome["status"][] = [];
  if (!Array.isArray(spec.tests)) {
    return "skipped";
  }

  for (const test of spec.tests) {
    if (!isRecord(test)) {
      continue;
    }
    if (test.status === "skipped") {
      statuses.push("skipped");
      continue;
    }
    if (Array.isArray(test.results)) {
      for (const result of test.results) {
        if (isRecord(result) && typeof result.status === "string") {
          statuses.push(mapPlaywrightOutcomeStatus(result.status));
        }
      }
    }
  }

  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("passed")) {
    return "passed";
  }
  return "skipped";
}

function mapPlaywrightOutcomeStatus(status: string): PlaywrightAcceptanceOutcome["status"] {
  if (status === "passed") {
    return "passed";
  }
  if (status === "skipped") {
    return "skipped";
  }
  return "failed";
}

function readQuotedString(content: string, start: number, quote: string) {
  let index = start;
  let value = "";
  while (index < content.length) {
    const character = content[index];
    if (character === "\\" && index + 1 < content.length) {
      value += content[index + 1];
      index += 2;
      continue;
    }
    if (character === quote) {
      return value;
    }
    value += character;
    index += 1;
  }
  return null;
}

function normalizeSpecFile(value: string) {
  return value.replace(/\\/g, "/").split("/").at(-1) ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
