import { describe, expect, it } from "vitest";

import { LOG_ANALYSIS_LOOP_PROMPT_VERSION } from "../analyzer/agentLoop";
import { LOG_ANALYSIS_PROMPT_VERSION } from "../analyzer/llmAnalyzer";
import { formatLogEvalReportMarkdown, runAllLogEvals, runLogEvalMetaChecks } from "./runEval";

describe("log analysis behavior eval harness", () => {
  it("passes every scenario and meta check with the committed scripted models", async () => {
    const report = await runAllLogEvals();

    expect(report.promptVersion).toBe(LOG_ANALYSIS_PROMPT_VERSION);
    expect(report.loopPromptVersion).toBe(LOG_ANALYSIS_LOOP_PROMPT_VERSION);
    expect(report.failed).toBe(0);
    expect(report.scenarios.length).toBeGreaterThanOrEqual(14);
    expect(report.scenarios.filter((scenario) => scenario.kernel === "loop").length).toBeGreaterThanOrEqual(8);
    expect(report.scenarios.every((scenario) => scenario.pass)).toBe(true);
    expect(report.metaChecks.every((check) => check.pass)).toBe(true);
  });

  it("meta checks flag known-bad results, including loop-specific bad behaviors", () => {
    const metaChecks = runLogEvalMetaChecks();

    expect(metaChecks).toHaveLength(4);
    expect(metaChecks.map((check) => check.name)).toEqual([
      "meta-hallucinated-citation-detector",
      "meta-silent-degradation-detector",
      "meta-loop-overconfident-convergence-detector",
      "meta-loop-silent-illegal-tool-detector"
    ]);
    expect(metaChecks.every((check) => check.pass)).toBe(true);
  });

  it("renders a markdown report with scenario and meta sections", async () => {
    const report = await runAllLogEvals();
    const markdown = formatLogEvalReportMarkdown(report);

    expect(markdown).toContain("# Log Analysis Behavior Eval Report");
    expect(markdown).toContain("grounded-normal-conclusion");
    expect(markdown).toContain("loop-illegal-tool-name-rejected-and-corrected");
    expect(markdown).toContain("meta-loop-overconfident-convergence-detector");
  });
});
