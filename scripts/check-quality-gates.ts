import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const requiredQualityGateScripts = [
  "acceptance:consistency",
  "acceptance:compact",
  "acceptance:a11y",
  "acceptance:visual",
  "acceptance:responsive"
] as const;

export const requiredQualityGateSpecFiles = [
  "e2e/quality/consistency.quality.spec.ts",
  "e2e/quality/consistency.collector.spec.ts",
  "e2e/quality/compact.quality.spec.ts",
  "e2e/quality/a11y.quality.spec.ts",
  "e2e/quality/visual.quality.spec.ts",
  "e2e/quality/responsive.quality.spec.ts"
] as const;

export type QualityGateConfigurationInput = {
  packageJson: {
    scripts?: Record<string, string>;
  };
  existingFiles: Set<string>;
  qualityConfigSource: string;
};

export type QualityGateConfigurationResult = {
  status: "passed" | "failed";
  missingScripts: string[];
  missingSpecFiles: string[];
  missingProjects: string[];
};

export function evaluateQualityGateConfiguration(
  input: QualityGateConfigurationInput
): QualityGateConfigurationResult {
  const scripts = input.packageJson.scripts ?? {};
  const missingScripts = requiredQualityGateScripts.filter((scriptName) => !scripts[scriptName]);
  const missingSpecFiles = requiredQualityGateSpecFiles.filter((file) => !input.existingFiles.has(file));
  const registeredProjects = new Set<string>();
  const config = ts.createSourceFile("playwright.quality.config.ts", input.qualityConfigSource, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "selectQualityProjects") {
      const projects = node.arguments[0];
      if (projects && ts.isArrayLiteralExpression(projects)) {
        for (const project of projects.elements) {
          if (!ts.isObjectLiteralExpression(project)) continue;
          for (const property of project.properties) {
            if (ts.isPropertyAssignment(property) &&
                (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
                property.name.text === "name" && ts.isStringLiteral(property.initializer)) {
              registeredProjects.add(property.initializer.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(config);
  const missingProjects = requiredQualityGateScripts.map((script) => script.slice("acceptance:".length))
    .filter((project) => !registeredProjects.has(project));

  return {
    status: missingScripts.length === 0 && missingSpecFiles.length === 0 && missingProjects.length === 0 ? "passed" : "failed",
    missingScripts,
    missingSpecFiles,
    missingProjects
  };
}

export function runQualityGateConfigurationCheck() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as QualityGateConfigurationInput["packageJson"];
  const existingFiles = new Set(requiredQualityGateSpecFiles.filter((file) => existsSync(file)));
  const qualityConfigSource = readFileSync("playwright.quality.config.ts", "utf8");
  const result = evaluateQualityGateConfiguration({ packageJson, existingFiles, qualityConfigSource });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runQualityGateConfigurationCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
