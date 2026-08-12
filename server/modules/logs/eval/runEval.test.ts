import { describe, expect, it } from "vitest";

import { LOG_ANALYSIS_PROMPT_VERSION } from "../analyzer/llmAnalyzer";
import { formatLogEvalReportMarkdown, runAllLogEvals, runLogEvalMetaChecks } from "./runEval";

describe("log analysis behavior eval harness", () => {
  it("passes every scenario and meta check with the committed scripted models", async () => {
    const report = await runAllLogEvals();

    expect(report.promptVersion).toBe(LOG_ANALYSIS_PROMPT_VERSION);
    expect(report.failed).toBe(0);
    expect(report.scenarios.length).toBeGreaterThanOrEqual(6);
    expect(report.scenarios.every((scenario) => scenario.pass)).toBe(true);
    expect(report.metaChecks.every((check) => check.pass)).toBe(true);
  });

  it("meta checks flag known-bad results", () => {
    const metaChecks = runLogEvalMetaChecks();

    expect(metaChecks).toHaveLength(2);
    expect(metaChecks.every((check) => check.pass)).toBe(true);
  });

  it("renders a markdown report with scenario and meta sections", async () => {
    const report = await runAllLogEvals();
    const markdown = formatLogEvalReportMarkdown(report);

    expect(markdown).toContain("# Log Analysis Behavior Eval Report");
    expect(markdown).toContain("grounded-normal-conclusion");
    expect(markdown).toContain("meta-hallucinated-citation-detector");
  });
});
