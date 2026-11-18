import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { loadServerEnv } from "../server/config/env";
import { createLogAnalyzerFromEnv, resolveLogAnalysisModelLabel } from "../server/modules/logs/analyzer/analyzerFromEnv";
import { createDeterministicLogAnalysisModel } from "../server/modules/logs/analyzer/deterministicModel";
import { defaultGoldenCasesRoot, loadGoldenLogCases, logEvalCaseMetadataSchema } from "../server/modules/logs/eval/goldenCases";
import {
  defaultHumanReviewsRoot,
  formatJudgeSampleMarkdown,
  loadHumanReviews,
  selectJudgeReviewSample
} from "../server/modules/logs/eval/judgeCalibration";
import { resolveQualityJudge } from "../server/modules/logs/eval/judgeFromEnv";
import {
  formatQualityComparisonMarkdown,
  formatQualityReportMarkdown,
  qualityBaselineFileSchema,
  runQualityEval,
  type QualityBaselineFile,
  type QualityEvalReport,
  type QualityEvalSelection
} from "../server/modules/logs/eval/qualityEval";

function readQualityReport(path: string): QualityEvalReport {
  const report = JSON.parse(readFileSync(path, "utf8")) as QualityEvalReport;
  if (!report?.selection || !report.aggregates?.byTag || !Array.isArray(report.caseResults) || !Array.isArray(report.problems)) {
    throw new Error(`${path} is not a multi-trial quality eval report.`);
  }
  return report;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { trials: { type: "string" }, tier: { type: "string" }, tags: { type: "string" }, compare: { type: "boolean" },
      "script-invalid-loop-output": { type: "boolean" } }
  });
  if (values.compare) {
    if (positionals.length !== 2 || Object.keys(values).length !== 1) {
      throw new Error("Usage: npm run --silent logs:eval:quality -- --compare <before.json> <after.json>");
    }
    console.log(formatQualityComparisonMarkdown(readQualityReport(positionals[0]), readQualityReport(positionals[1])));
    return;
  }
  if (positionals.length) throw new Error("Unexpected positional arguments. Use --trials, --tier, --tags, or --compare.");
  const trials = Number(values.trials ?? "1");
  if (values.trials !== undefined && (!/^\d+$/.test(values.trials) || !Number.isSafeInteger(trials) || trials < 1)) {
    throw new Error("--trials must be a positive integer.");
  }
  const tier: QualityEvalSelection["tier"] = values.tier === "all" ? "all"
    : logEvalCaseMetadataSchema.shape.tier.parse(values.tier) ?? "all";
  const tags = logEvalCaseMetadataSchema.shape.scenarioTags.parse(values.tags?.split(",").map((tag) => tag.trim())) ?? [];
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const env = loadServerEnv(process.env);
  const scripted = values["script-invalid-loop-output"] === true;
  if (scripted && env.LOG_ANALYSIS_KERNEL !== "loop") throw new Error("--script-invalid-loop-output requires LOG_ANALYSIS_KERNEL=loop.");
  const analysisEnv = {
    ...env,
    LOG_ANALYSIS_DETERMINISTIC: scripted || env.LOG_ANALYSIS_DETERMINISTIC
      || !(env.LOG_ANALYSIS_API_BASE_URL?.trim() && env.LOG_ANALYSIS_API_KEY?.trim()),
    LOG_ANALYSIS_PROTOCOL: scripted ? "tools" as const : env.LOG_ANALYSIS_PROTOCOL
  };

  const casesRoot = defaultGoldenCasesRoot(root);
  const { cases, problems } = loadGoldenLogCases(casesRoot);
  const { reviews, problems: reviewProblems } = loadHumanReviews(defaultHumanReviewsRoot(casesRoot));
  problems.push(...reviewProblems);

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
  const model = scripted ? {
    ...createDeterministicLogAnalysisModel(),
    async invokeTools() { return { content: "Invalid output", usage: { inputTokens: 100, outputTokens: 5 } }; }
  } : undefined;
  const analyzer = createLogAnalyzerFromEnv(analysisEnv, { model });
  const judge = resolveQualityJudge(analysisEnv);

  const report = await runQualityEval({
    analyzer,
    judge,
    cases,
    problems,
    trials,
    tier,
    tags: [...new Set(tags)],
    kernel: env.LOG_ANALYSIS_KERNEL,
    deterministic: analysisEnv.LOG_ANALYSIS_DETERMINISTIC,
    modelLabel: scripted ? "scripted-invalid-loop-output" : resolveLogAnalysisModelLabel(analysisEnv),
    baseline,
    judgeSampleRate: env.LOG_ANALYSIS_JUDGE_SAMPLE_RATE,
    humanReviews: reviews
  });

  const calibrationResults = report.caseResults.filter((result) => result.trial === 1);
  const sampleMarkdown = formatJudgeSampleMarkdown({
    runId: report.runId,
    judgeLabel: report.judgeLabel,
    sampleRate: report.judgeSampling.rate,
    sampled: selectJudgeReviewSample(calibrationResults, report.judgeSampling.rate),
    totalJudgedCases: calibrationResults.filter((result) => result.judge !== null).length
  });

  const generatedDir = join(root, "docs/generated");
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(join(generatedDir, "log-analysis-quality.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = formatQualityReportMarkdown(report);
  writeFileSync(join(generatedDir, "log-analysis-quality.md"), `${markdown}\n`, "utf8");
  writeFileSync(join(generatedDir, "log-analysis-judge-sample.md"), `${sampleMarkdown}\n`, "utf8");

  console.log(markdown);
  console.log("");
  console.log("Wrote docs/generated/log-analysis-quality.{json,md} and docs/generated/log-analysis-judge-sample.md");

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
