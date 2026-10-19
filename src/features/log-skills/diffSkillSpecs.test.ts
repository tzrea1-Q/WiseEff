import { describe, expect, it } from "vitest";
import { diffSkillSpecs } from "./diffSkillSpecs";
import type { SkillSpec } from "./types";

const base: SkillSpec = { schemaVersion: "skill/v1" };
const defaults = { conclusion: "结论", impact: "影响", severity: "Info" as const, confidence: 0.5, suggestedActions: [] };
const rule = (id: string, inference = "推断") => ({ id, inference, stageId: "pattern" as const, suggestedAction: "检查",
  anyOf: [{ type: "text" as const, pattern: "ERROR" }], analysis: { suggestedActions: [] } });
describe("diffSkillSpecs", () => {
  it("groups model and budget additions, changes and resets under integration", () => {
    const before = { ...base, modelOverride: "old-model", stepBudget: 4, tokenBudget: 4000 };
    const after = { ...base, stepBudget: 5, tokenBudget: 5000 };
    const diff = diffSkillSpecs(before, after);
    expect(diff.overview).toEqual([]);
    expect(diff.integration).toEqual([
      { field: "modelOverride", before: "old-model", after: undefined },
      { field: "stepBudget", before: 4, after: 5 },
      { field: "tokenBudget", before: 4000, after: 5000 }
    ]);
    expect(diff.counts.integration).toBe(3);
    expect(diffSkillSpecs(base, after).integration).toHaveLength(2);
    expect(diffSkillSpecs(after, structuredClone(after)).integration).toEqual([]);
  });
  it.each([
    [undefined, "## Steps\nCheck context."],
    ["Old procedure", "New procedure"],
    ["Old procedure", undefined]
  ])("groups procedure changes separately from overview: %s → %s", (before, after) => {
    const diff = diffSkillSpecs({ ...base, procedure: before }, { ...base, procedure: after });
    expect(diff.procedure).toEqual([{ field: "procedure", before, after }]);
    expect(diff.overview).toEqual([]);
    expect(diff.counts).toMatchObject({ overview: 0, procedure: 1 });
    expect(diffSkillSpecs({ ...base, procedure: after }, { ...base, procedure: after }).procedure).toEqual([]);
  });
  it("groups extractors added, changed and removed by id", () => {
    const extractor = (id: string, pattern = "(?P<value>.+)") => ({ id, pattern, fields: { value: { type: "string" as const } } });
    const before: SkillSpec = { ...base, parsing: { schemaVersion: "parsing/v1", extractors: [extractor("a"), extractor("b")] } };
    const after: SkillSpec = { ...base, parsing: { schemaVersion: "parsing/v1", extractors: [extractor("b", "(?P<value>.*)"), extractor("c")] } };
    expect(diffSkillSpecs(before, after).parsing).toMatchObject([{ id: "a", kind: "removed" }, { id: "b", kind: "changed" }, { id: "c", kind: "added" }]);
    expect(diffSkillSpecs(before, structuredClone(before)).parsing).toEqual([]);
  });
  it("includes default source snapshot changes in the publication review", () => {
    expect(diffSkillSpecs(base, { ...base, defaultSourceSnapshotId: "snapshot" }).source)
      .toEqual([{ field: "defaultSourceSnapshotId", before: undefined, after: "snapshot" }]);
    expect(diffSkillSpecs(base, { ...base, source: { statementPatterns: ["MY_LOG"] } }).source)
      .toEqual([{ field: "statementPatterns", before: undefined, after: ["MY_LOG"] }]);
  });
  it("reports overview and pretty-printed format line changes without mutating input", () => {
    const after = { ...base, description: "诊断", modelOverride: "m", formatProfile: { severityMap: { error: ["ALERT"] } } };
    const saved = structuredClone(after);
    const diff = diffSkillSpecs(base, after);
    expect(diff.overview).toEqual([{ field: "description", before: undefined, after: "诊断" }]);
    expect(diff.integration).toEqual([{ field: "modelOverride", before: undefined, after: "m" }]);
    expect(diff.format).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "add", value: '      "ALERT"' })]));
    expect(after).toEqual(saved);
  });
  it("matches rules by id and includes field changes, defaults, and rule order", () => {
    const before = { ...base, signalRules: { rules: [rule("a"), rule("b")], noHit: defaults, hitDefaults: defaults } };
    const after = { ...base, signalRules: { rules: [rule("b", "新推断"), rule("c")], noHit: { ...defaults, conclusion: "新默认" }, hitDefaults: defaults } };
    const diff = diffSkillSpecs(before, after);
    expect(diff.counts).toMatchObject({ added: 1, removed: 1, changed: 1 });
    expect(diff.rules.find((r) => r.id === "b")?.fields).toEqual([{ field: "inference", before: "推断", after: "新推断" }]);
    expect(diff.signalSettings.map((f) => f.field)).toEqual(["noHit", "rulesOrder"]);
    expect(diffSkillSpecs(base, { ...base, signalRules: { rules: [], noHit: defaults, hitDefaults: defaults } }).signalSettings)
      .toContainEqual({ field: "mode", before: "default", after: "custom" });
  });
  it("ignores object key order, retains array order, and detects removals", () => {
    const a = { ...base, description: "旧描述", formatProfile: { severityMap: { info: ["A", "B"], error: ["E"] } } };
    const b = { ...base, description: "旧描述", formatProfile: { severityMap: { error: ["E"], info: ["A", "B"] } } };
    expect(Object.values(diffSkillSpecs(a, b).counts).every((value) => value === 0)).toBe(true);
    expect(diffSkillSpecs(a, base).overview).toContainEqual({ field: "description", before: "旧描述", after: undefined });
    expect(diffSkillSpecs(a, { ...b, formatProfile: { severityMap: { info: ["B", "A"], error: ["E"] } } }).counts.format).toBeGreaterThan(0);
    const rules = [rule("a"), rule("b")];
    expect(diffSkillSpecs({ ...base, signalRules: { rules, noHit: defaults, hitDefaults: defaults } },
      { ...base, signalRules: { rules: [...rules].reverse(), noHit: defaults, hitDefaults: defaults } }).signalSettings.map((f) => f.field)).toEqual(["rulesOrder"]);
  });
});
