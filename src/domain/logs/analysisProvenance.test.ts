import { describe, expect, it } from "vitest";

import { classifyAnalysisDegradation } from "./analysisProvenance";

describe("classifyAnalysisDegradation", () => {
  it("classifies rules-fallback with a provider outage reason", () => {
    expect(classifyAnalysisDegradation({ analysisSource: "rules-fallback", degradedReason: "provider-unavailable" })).toEqual({
      kind: "rules-fallback",
      label: "降级分析 · 规则回退",
      reason: "AI 分析服务不可用，本结论由规则引擎回退生成"
    });
  });

  it("classifies rules-fallback with an exhausted budget reason", () => {
    expect(classifyAnalysisDegradation({ analysisSource: "rules-fallback", degradedReason: "token-budget-exhausted" })).toEqual({
      kind: "rules-fallback",
      label: "降级分析 · 规则回退",
      reason: "预算内未能得到有效接地结论，本结论由规则引擎回退生成"
    });
  });

  it("classifies rules-fallback without a reason using the generic sentence", () => {
    expect(classifyAnalysisDegradation({ analysisSource: "rules-fallback" })).toEqual({
      kind: "rules-fallback",
      label: "降级分析 · 规则回退",
      reason: "本结论由规则引擎回退生成"
    });
  });

  it("classifies an agent analysis carrying a degraded reason as early convergence", () => {
    for (const degradedReason of ["provider-unavailable", "token-budget-exhausted"] as const) {
      expect(classifyAnalysisDegradation({ analysisSource: "agent", degradedReason })).toEqual({
        kind: "early-convergence",
        label: "降级分析 · 提前收敛",
        reason: "分析步数或 token 预算耗尽，Agent 基于已读证据提前收敛为低置信结论"
      });
    }
  });

  it("does not mark a full agent analysis or a legacy report as degraded", () => {
    expect(classifyAnalysisDegradation({ analysisSource: "agent" })).toBeNull();
    expect(classifyAnalysisDegradation({})).toBeNull();
    expect(classifyAnalysisDegradation({ analysisSource: null })).toBeNull();
    // A stray reason on a legacy report without a source is not a degraded analysis.
    expect(classifyAnalysisDegradation({ degradedReason: "provider-unavailable" })).toBeNull();
  });
});
