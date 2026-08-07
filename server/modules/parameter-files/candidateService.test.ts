import { describe, expect, it } from "vitest";

import { buildUnifiedTextDiff, computeCandidateImpact } from "./candidateService";

describe("candidateService impact helpers", () => {
  it("buildUnifiedTextDiff marks changed lines", () => {
    const diff = buildUnifiedTextDiff("a\nb\n", "a\nc\n", "before", "after");
    expect(diff).toContain("--- before");
    expect(diff).toContain("+++ after");
    expect(diff).toContain("-b");
    expect(diff).toContain("+c");
  });

  it("marks parse failures as failed without blockers from conflicts", async () => {
    const result = await computeCandidateImpact({
      format: "json",
      candidateSource: "{not-json",
      baseSource: "{}",
      baseLabel: "base",
      candidateLabel: "cand",
      registeredCompatibles: [],
      openConflicts: []
    });
    expect(result.status).toBe("failed");
    expect(result.diagnostics.some((item) => item.code === "parse-failed")).toBe(true);
  });

  it("returns ready when DTS parses and has no blockers", async () => {
    const base = `/dts-v1/;
/ {
	board {
		model = "V1";
		compatible = "wiseeff,board";
	};
};
`;
    const next = `/dts-v1/;
/ {
	board {
		model = "V2";
		compatible = "wiseeff,board";
	};
};
`;
    const result = await computeCandidateImpact({
      format: "dts",
      candidateSource: next,
      baseSource: base,
      baseLabel: "base",
      candidateLabel: "cand",
      registeredCompatibles: ["wiseeff,board"],
      openConflicts: []
    });
    expect(result.status).toBe("ready");
    expect(result.impact.textDiff).toContain('-\t\tmodel = "V1";');
    expect(result.impact.textDiff).toContain('+\t\tmodel = "V2";');
    expect(result.impact.structuralDiff?.some((change) => change.kind === "prop_changed")).toBe(true);
    expect(result.impact.coverage?.matchedRegisteredCount).toBe(1);
  });

  it("returns blocked when open conflicts are present", async () => {
    const source = `/dts-v1/;
/ {
	board {
		model = "V1";
		compatible = "wiseeff,board";
	};
};
`;
    const result = await computeCandidateImpact({
      format: "dts",
      candidateSource: source,
      baseSource: source,
      baseLabel: "base",
      candidateLabel: "cand",
      registeredCompatibles: ["wiseeff,board"],
      openConflicts: [
        {
          id: "conflict-1",
          parameterName: "model",
          status: "open",
          fileValue: "V1",
          uiDraftValue: "V9"
        }
      ]
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers.some((item) => item.code === "open-conflict")).toBe(true);
  });
});
