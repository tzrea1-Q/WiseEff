import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const requiredQualityGateScripts = [
  "acceptance:a11y",
  "acceptance:visual",
  "acceptance:responsive"
] as const;

export const requiredQualityGateSpecFiles = [
  "e2e/quality/a11y.quality.spec.ts",
  "e2e/quality/visual.quality.spec.ts",
  "e2e/quality/responsive.quality.spec.ts"
] as const;

export type QualityGateConfigurationInput = {
  packageJson: {
    scripts?: Record<string, string>;
  };
  existingFiles: Set<string>;
};

export type QualityGateConfigurationResult = {
  status: "passed" | "failed";
  missingScripts: string[];
  missingSpecFiles: string[];
};

export function evaluateQualityGateConfiguration(
  input: QualityGateConfigurationInput
): QualityGateConfigurationResult {
  const scripts = input.packageJson.scripts ?? {};
  const missingScripts = requiredQualityGateScripts.filter((scriptName) => !scripts[scriptName]);
  const missingSpecFiles = requiredQualityGateSpecFiles.filter((file) => !input.existingFiles.has(file));

  return {
    status: missingScripts.length === 0 && missingSpecFiles.length === 0 ? "passed" : "failed",
    missingScripts,
    missingSpecFiles
  };
}

export function runQualityGateConfigurationCheck() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as QualityGateConfigurationInput["packageJson"];
  const existingFiles = new Set(requiredQualityGateSpecFiles.filter((file) => existsSync(file)));
  const result = evaluateQualityGateConfiguration({ packageJson, existingFiles });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runQualityGateConfigurationCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
