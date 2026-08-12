import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadServerEnv } from "../server/config/env";
import { createLogAnalyzerFromEnv, resolveLogAnalysisModelLabel } from "../server/modules/logs/analyzer/analyzerFromEnv";
import { defaultGoldenCasesRoot, loadGoldenLogCases } from "../server/modules/logs/eval/goldenCases";
import { resolveQualityJudge } from "../server/modules/logs/eval/judgeFromEnv";
import {
  formatQualityReportMarkdown,
  qualityBaselineFileSchema,
  runQualityEval,
  type QualityBaselineFile
} from "../server/modules/logs/eval/qualityEval";

/**
 * Quality-layer eval runner (`npm run logs:eval:quality`): runs the CURRENT
 * analysis kernel over the golden case set and writes gated reports to
 * `docs/generated/log-analysis-quality.{json,md}`.
 *
 * Modes:
 * - Deterministic demo: LOG_ANALYSIS_DETERMINISTIC=true (fake model + deterministic judge, zero API cost).
 * - Real model: LOG_ANALYSIS_API_* configured; judge uses LOG_ANALYSIS_JUDGE_* when set.
 * The exit code fails on loader problems or a failed baseline gate.
 */
async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const env = loadServerEnv(process.env);

  const casesRoot = defaultGoldenCasesRoot(root);
  const { cases, problems } = loadGoldenLogCases(casesRoot);

  const baselinePath = join(casesRoot, "baseline.json");
  let baseline: QualityBaselineFile | null = null;
  if (existsSync(baselinePath)) {
    const parsed = qualityBaselineFileSchema.safeParse(JSON.parse(readFileSync(baselinePath, "utf8")));
    if (!parsed.success) {
      console.error(`eval-cases/logs/baseline.json is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      process.exitCode = 1;
      return;
    }
    baseline = parsed.data;
  }

  // No db handle on purpose: read_domain_knowledge / get_related_parameter_context
  // honestly report themselves unavailable in offline quality runs.
  const analyzer = createLogAnalyzerFromEnv(env);
  const judge = resolveQualityJudge(env);

  const report = await runQualityEval({
    analyzer,
    judge,
    cases,
    problems,
    kernel: env.LOG_ANALYSIS_KERNEL,
    deterministic: env.LOG_ANALYSIS_DETERMINISTIC,
    modelLabel: resolveLogAnalysisModelLabel(env),
    baseline
  });

  const generatedDir = join(root, "docs/generated");
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(join(generatedDir, "log-analysis-quality.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(generatedDir, "log-analysis-quality.md"), `${formatQualityReportMarkdown(report)}\n`, "utf8");

  console.log(formatQualityReportMarkdown(report));
  console.log("");
  console.log("Wrote docs/generated/log-analysis-quality.{json,md}");

  if (report.problems.length > 0) {
    console.error(`Quality eval found ${report.problems.length} problem(s); failing the run.`);
    process.exitCode = 1;
    return;
  }
  if (report.baseline.status === "failed") {
    console.error("Quality baseline gate FAILED.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
