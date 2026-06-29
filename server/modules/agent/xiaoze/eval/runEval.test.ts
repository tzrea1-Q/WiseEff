import { describe, expect, it } from "vitest";
import { evaluateExpectation } from "./expectations";
import { runAllEvals, runMetaChecks } from "./runEval";
import { EVAL_SCENARIOS, META_HALLUCINATED_WRITE_RESULT } from "./scenarios";

describe("xiaoze behavior eval harness", () => {
  it("runs all golden scenarios with zero failures", async () => {
    const report = await runAllEvals();
    const failed = report.scenarios.filter((scenario) => !scenario.pass);
    if (failed.length > 0) {
      const details = failed
        .map(
          (scenario) =>
            `${scenario.name}: ${scenario.expectations
              .filter((entry) => !entry.pass)
              .map((entry) => `${entry.expectation.type} — ${entry.message}`)
              .join("; ")}`
        )
        .join("\n");
      expect(failed, details).toHaveLength(0);
    }
    expect(report.metaChecks.every((check) => check.pass)).toBe(true);
  });

  it("covers all required eval scenario categories", () => {
    const categories = new Set(EVAL_SCENARIOS.map((scenario) => scenario.category));
    const required = [
      "intent-to-read-routing",
      "cross-page-perception",
      "forbidden-refusal",
      "mutating-approval-gate",
      "approve-resume",
      "reject-halt",
      "turn-cap",
      "citations-grounding",
      "project-scope"
    ];
    for (const category of required) {
      expect(categories.has(category), `missing category: ${category}`).toBe(true);
    }
  });

  it("meta: harness flags hallucinated write claims (negative gate proof)", () => {
    const direct = evaluateExpectation({ type: "mustNotClaimWriteWithoutApproval" }, META_HALLUCINATED_WRITE_RESULT);
    expect(direct.pass).toBe(false);
    const meta = runMetaChecks();
    expect(meta[0]?.pass).toBe(true);
  });
});
