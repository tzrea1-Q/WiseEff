import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { RE2JS } from "re2js";
import { logSkillSpecSchema } from "./skillSpec";
import { parsingSpecSchema } from "./parsing/spec";
import { compileSignalRules, createSignalEvaluationBudget, signalRuleSetSchema } from "./signalRules";
import { createLogPatternCache } from "./adminPattern";
import { validateLogFormatProfile } from "./formatProfile";
import { previewLogFormat } from "./formatPreview";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { logSkillTemplates } from "./skillTemplates";

const attack = `(?:${"a".repeat(1000)}){1000}`;
const large = `(?:${"a".repeat(100)}){100}`;

describe("shared log pattern budgets", () => {
  it("rejects the reviewer's exact format attack in preview and save schemas under a 256 MiB heap", () => {
    const script = `
      import assert from 'node:assert/strict';
      import { previewLogFormat } from './server/modules/logs/formatPreview.ts';
      import { logSkillSpecSchema } from './server/modules/logs/skillSpec.ts';
      import { validateLogFormatProfile } from './server/modules/logs/formatProfile.ts';
      const pattern = '(?:' + 'a'.repeat(1000) + '){1000}';
      const profile = { severityMap: { error: Array(4).fill(pattern) } };
      const start = performance.now();
      for (let i = 0; i < 24; i++) {
        assert.throws(() => previewLogFormat({ sampleText: 'a', formatProfile: profile }), /severityMap.error\\[0\\].*100/);
        const result = logSkillSpecSchema.safeParse({ schemaVersion: 'skill/v1', formatProfile: profile });
        assert.equal(result.success, false);
        assert.deepEqual(result.error.issues[0].path, ['formatProfile', 'severityMap', 'error', 0]);
        assert.equal(validateLogFormatProfile(profile).ok, false);
      }
      assert.ok(performance.now() - start < 1000);
      console.log('bounded preview and save rejection');
    `;
    expect(execFileSync(process.execPath, ["--max-old-space-size=256", "--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 })).toContain("bounded preview and save rejection");
  });

  it("rejects dangerous format, extractor, timestamp and signal paths before RE2 compilation", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      const cases = [
        [{ formatProfile: { severityMap: { error: Array(4).fill(attack) } } }, ["formatProfile", "severityMap", "error", 0]],
        [{ parsing: { schemaVersion: "parsing/v1", extractors: [{ id: "bad", pattern: "(?P<v>(?:a{100}){100}){100}", fields: { v: { type: "string" } } }] } }, ["parsing", "extractors", 0, "pattern"]],
        [{ signalRules: { ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0], anyOf: [{ type: "text", pattern: attack }] }] } }, ["signalRules", "rules", 0, "anyOf", 0, "pattern"]],
        [{ signalRules: { ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0], anyOf: [{ type: "window", count: 2, seconds: 10, condition: { type: "text", pattern: attack } }] }] } }, ["signalRules", "rules", 0, "anyOf", 0, "condition", "pattern"]]
      ] as const;
      for (const [fields, path] of cases) {
        const result = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", ...fields });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0].path).toEqual(path);
      }
      expect(compile).not.toHaveBeenCalled();
    } finally { compile.mockRestore(); }
  });

  it("bounds aggregate declarations within formats, parsing, signals and across a whole skill", () => {
    const profile = { severityMap: { error: Array.from({ length: 7 }, (_, index) => `${large}${index}`) } };
    expect(validateLogFormatProfile(profile)).toMatchObject({ ok: false, details: expect.arrayContaining([expect.objectContaining({ path: ["severityMap", "error", 6] })]) });
    const extractors = Array.from({ length: 7 }, (_, index) => ({ id: `e${index}`, pattern: `(?P<v>${large}${index})`, fields: { v: { type: "string" } } }));
    const parsed = parsingSpecSchema.safeParse({ schemaVersion: "parsing/v1", extractors });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["extractors", 6, "pattern"]);
    const signals = { ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0], anyOf: Array.from({ length: 7 }, (_, index) => ({ type: "text", pattern: `${large}${index}` })) }] };
    const signal = signalRuleSetSchema.safeParse(signals);
    expect(signal.success).toBe(false);
    if (!signal.success) expect(signal.error.issues[0].path).toEqual(["rules", 0, "anyOf", 6, "pattern"]);
    const windows = signalRuleSetSchema.safeParse({ ...signals, rules: [{ ...signals.rules[0], anyOf: signals.rules[0].anyOf.map((condition) => ({ type: "window", count: 2, seconds: 10, condition })) }] });
    expect(windows.success).toBe(false);
    if (!windows.success) expect(windows.error.issues[0].path).toEqual(["rules", 0, "anyOf", 6, "condition", "pattern"]);
    const skill = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", formatProfile: { severityMap: { error: profile.severityMap.error.slice(0, 3) } }, parsing: { schemaVersion: "parsing/v1", extractors: extractors.slice(0, 4) } });
    expect(skill.success).toBe(false);
    if (!skill.success) expect(skill.error.issues[0].path).toEqual(["parsing", "extractors", 3, "pattern"]);
  });

  it("compiles each format pattern once across validation and both parser passes", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      previewLogFormat({ sampleText: "[12] ERROR bad\n  detail", formatProfile: { timestampPattern: "^\\[(\\d+)\\]", multiline: { mode: "start-pattern", startPattern: "^\\[" }, severityMap: { error: ["ERROR"], warn: ["WARN"] } } });
      expect(compile).toHaveBeenCalledTimes(4);
    } finally { compile.mockRestore(); }
  });
  it("shares a signal program cache through window subconditions without sharing window state", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      const text = { type: "text" as const, pattern: "ALERT" };
      const ruleSet = { ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0], anyOf: [text,
        { type: "window" as const, count: 2, seconds: 10, condition: text }] }] };
      const budget = createSignalEvaluationBudget(Infinity, 100, () => 0), cache = createLogPatternCache();
      const first = compileSignalRules(ruleSet, budget, cache)[0].matches;
      const second = compileSignalRules(ruleSet, budget, cache)[0].matches;
      expect(compile).toHaveBeenCalledTimes(1);
      const entry = { lineNumber: 1, message: "ALERT", severity: "info" as const, tokens: {}, timestamp: "2026-01-01T00:00:00Z" };
      expect(first.map((test) => test(entry))).toEqual([true, false]);
      expect(first.map((test) => test({ ...entry, lineNumber: 2, timestamp: "2026-01-01T00:00:01Z" }))).toEqual([true, true]);
      expect(second.map((test) => test(entry))).toEqual([true, false]);
      expect(budget.remaining).toBeLessThan(100);
    } finally { compile.mockRestore(); }
  });
  it("rejects a Unicode-heavy aggregate before compiling any profile pattern", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      const patterns = Array.from({ length: 96 }, (_, index) => `${index}[${"\\p{L}".repeat(800)}]`);
      const profile = { severityMap: { error: patterns.slice(0, 32), warn: patterns.slice(32, 64), info: patterns.slice(64) } };
      expect(validateLogFormatProfile(profile)).toMatchObject({ ok: false, issues: [expect.stringMatching(/所有匹配规则/)] });
      expect(() => previewLogFormat({ sampleText: "a", formatProfile: profile })).toThrow(/所有匹配规则/);
      expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", formatProfile: profile }).success).toBe(false);
      expect(compile).not.toHaveBeenCalled();
    } finally { compile.mockRestore(); }
  });

  it("keeps every template and the complete charging rule set accepted", () => {
    for (const template of logSkillTemplates) expect(logSkillSpecSchema.parse(template.spec)).toEqual(template.spec);
    expect(logSkillSpecSchema.parse({ schemaVersion: "skill/v1", signalRules: defaultChargingRuleSet }).signalRules).toEqual(defaultChargingRuleSet);
  });
});
