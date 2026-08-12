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
};

export type AcceptanceCoverageResult = {
  status: "passed" | "failed";
  coveredIds: string[];
  /** Declared-but-not-automated coverage: `@acceptance-planned` markers (skip stubs). */
  plannedIds: string[];
  missingRequiredIds: string[];
  unknownIds: string[];
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

  const status =
    missingRequiredIds.length === 0 &&
    unknownIds.length === 0 &&
    coverageMapMissingIds.length === 0 &&
    coverageMapOrphanIds.length === 0
      ? "passed"
      : "failed";

  return {
    status,
    coveredIds,
    plannedIds,
    missingRequiredIds,
    unknownIds,
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

export function runAcceptanceCoverageCheck() {
  const result = evaluateAcceptanceCoverage({
    requirements: acceptanceRequirements,
    specFiles: readAcceptanceSpecFiles(),
    coverageMapIds: readCoverageMapIds()
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceCoverageCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
