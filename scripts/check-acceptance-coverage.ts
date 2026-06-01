import { existsSync, readdirSync, readFileSync } from "node:fs";
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
};

export type AcceptanceCoverageResult = {
  status: "passed" | "failed";
  coveredIds: string[];
  missingRequiredIds: string[];
  unknownIds: string[];
};

const acceptanceMarkerPattern = /@acceptance\s+([A-Z]+-[A-Z0-9-]+)/g;

export function parseAcceptanceIdsFromSpec(content: string) {
  return Array.from(content.matchAll(acceptanceMarkerPattern), (match) => match[1]);
}

export function evaluateAcceptanceCoverage(input: AcceptanceCoverageInput): AcceptanceCoverageResult {
  const knownIds = new Set(input.requirements.map((requirement) => requirement.id));
  const coveredIds = Array.from(
    new Set(input.specFiles.flatMap((specFile) => parseAcceptanceIdsFromSpec(specFile.content)))
  ).sort();
  const coveredSet = new Set(coveredIds);
  const missingRequiredIds = input.requirements
    .filter((requirement) => requirement.required && !coveredSet.has(requirement.id))
    .map((requirement) => requirement.id);
  const unknownIds = coveredIds.filter((id) => !knownIds.has(id));

  return {
    status: missingRequiredIds.length === 0 && unknownIds.length === 0 ? "passed" : "failed",
    coveredIds,
    missingRequiredIds,
    unknownIds
  };
}

export function readAcceptanceSpecFiles(root = "e2e/acceptance"): AcceptanceSpecInput[] {
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

export function runAcceptanceCoverageCheck() {
  const result = evaluateAcceptanceCoverage({
    requirements: acceptanceRequirements,
    specFiles: readAcceptanceSpecFiles()
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceCoverageCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
