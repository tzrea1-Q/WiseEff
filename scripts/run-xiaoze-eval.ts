import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEvalReportMarkdown, runAllEvals } from "../server/modules/agent/xiaoze/eval/runEval";

async function main() {
  const report = await runAllEvals();
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const generatedDir = join(root, "docs/generated");
  mkdirSync(generatedDir, { recursive: true });

  writeFileSync(join(generatedDir, "xiaoze-eval.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(generatedDir, "xiaoze-eval.md"), `${formatEvalReportMarkdown(report)}\n`, "utf8");

  console.log(formatEvalReportMarkdown(report));
  console.log("");
  console.log(`Wrote docs/generated/xiaoze-eval.{json,md}`);

  const scenarioFailures = report.scenarios.filter((scenario) => !scenario.pass);
  const metaFailures = report.metaChecks.filter((check) => !check.pass);
  if (scenarioFailures.length > 0 || metaFailures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
