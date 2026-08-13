import { describe, expect, it } from "vitest";

import {
  buildEvalCaseDraft,
  evalCaseDomainSlug,
  evalCaseId,
  splitConclusionIntoPoints,
  type EvalCaseDraftSource
} from "./evalCaseDraft";

function makeRecord(overrides: Partial<EvalCaseDraftSource> = {}): EvalCaseDraftSource {
  return {
    id: "log-4f2c9b1a-77aa-4d17-a3f1-0d5f7e6b2c1d",
    reportId: "RPT-2093",
    fileName: "charging-foldback.log",
    conclusion: "电池包温度越过 50C 阈值。热保护将充电电流从 6A 降至 2A。",
    suggestedActions: ["检查散热路径", "复核热保护阈值配置"],
    rawLines: ["line 1", "line 2 WARN temp=51C", "line 3 foldback"],
    analysisQuestion: "为什么充电变慢？",
    logDomainName: "Charging Power",
    evidence: [
      { lineNumbers: [2, 3] },
      { lineNumbers: [2] }
    ],
    ...overrides
  };
}

describe("evalCaseDraft", () => {
  it("splits a conclusion into root-cause points on Chinese and English sentence breaks", () => {
    expect(splitConclusionIntoPoints("温度越限。热保护触发；电流下降。\n重试失败")).toEqual([
      "温度越限",
      "热保护触发",
      "电流下降",
      "重试失败"
    ]);
    expect(splitConclusionIntoPoints("Temp crossed limit. Foldback engaged! Current dropped?")).toEqual([
      "Temp crossed limit.",
      "Foldback engaged!",
      "Current dropped?"
    ]);
  });

  it("slugifies the bound domain and falls back to uncategorized", () => {
    expect(evalCaseDomainSlug({ logDomainName: "Charging Power" })).toBe("charging-power");
    expect(evalCaseDomainSlug({ logDomainName: undefined })).toBe("uncategorized");
  });

  it("derives a stable case id from file name stem and record id", () => {
    expect(evalCaseId({ fileName: "charging-foldback.log", id: "log-4f2c9b1a-x" })).toBe(
      "charging-foldback-log-4f2c"
    );
  });

  it("assembles a schema-aligned draft with deIdentified: false and a TODO category", () => {
    const draft = buildEvalCaseDraft(makeRecord(), new Date("2026-08-13T00:00:00.000Z"));

    expect(draft.domainSlug).toBe("charging-power");
    expect(draft.caseYaml).toContain("domain: charging-power");
    expect(draft.caseYaml).toContain("realLog: true");
    expect(draft.caseYaml).toContain("deIdentified: false");
    expect(draft.caseYaml).toContain("rootCauseCategory: TODO");
    expect(draft.caseYaml).toContain('- "电池包温度越过 50C 阈值"');
    expect(draft.caseYaml).toContain("keyEvidenceLines: [2, 3]");
    expect(draft.caseYaml).toContain('- "检查散热路径"');
    expect(draft.caseYaml).toContain('analysisQuestion: "为什么充电变慢？"');
    expect(draft.caseYaml).toContain("RPT-2093");
    expect(draft.logText).toBe("line 1\nline 2 WARN temp=51C\nline 3 foldback\n");
  });

  it("keeps evidence line numbers unique and sorted", () => {
    const draft = buildEvalCaseDraft(
      makeRecord({ evidence: [{ lineNumbers: [9, 2] }, { lineNumbers: [2, 5] }] })
    );

    expect(draft.caseYaml).toContain("keyEvidenceLines: [2, 5, 9]");
  });

  it("emits TODO placeholders when the record has no conclusion points or actions", () => {
    const draft = buildEvalCaseDraft(
      makeRecord({ conclusion: "", suggestedActions: [], analysisQuestion: undefined })
    );

    expect(draft.caseYaml).toContain("TODO：补充专家确认的根因要点");
    expect(draft.caseYaml).toContain("TODO：补充专家期望的处置动作");
    expect(draft.caseYaml).not.toContain("analysisQuestion:");
  });

  it("escapes YAML-hostile characters through JSON string quoting", () => {
    const draft = buildEvalCaseDraft(
      makeRecord({ conclusion: 'value: "quoted" # not-a-comment', suggestedActions: ["a: b"] })
    );

    expect(draft.caseYaml).toContain('- "value: \\"quoted\\" # not-a-comment"');
    expect(draft.caseYaml).toContain('- "a: b"');
  });
});
