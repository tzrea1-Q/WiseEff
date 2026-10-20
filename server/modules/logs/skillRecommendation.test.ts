import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RE2JS } from "re2js";
import { compileSkillFiles, type SkillFileGlob } from "../../../src/domain/logs/fileApplicability";
import { seededChargingRuleSet } from "./chargingSignalRules";
import type { LogSkillSpec } from "./skillSpec";
import { LOG_SKILL_RECOMMENDATION_LIMITS as limits, recommendLogSkills } from "./skillRecommendation";

const candidate = (skillId: string, spec: Partial<LogSkillSpec> = {}) => ({ skillId, spec: { schemaVersion: "skill/v1" as const, ...spec } });
const file = (path = "kernel.log", head = ["CHARGE voltage=12"]) => ({ path, head });
const parsing = (pattern = "CHARGE", files?: string[]): LogSkillSpec["parsing"] => ({
  schemaVersion: "parsing/v1", extractors: [{ id: "charge", pattern, fields: {}, ...(files ? { files } : {}) }]
});
const fixedClock = { now: () => 0 };

describe("published log skill recommendation scorer", () => {
  it("ranks file evidence and role weights, respecting the first matching rule", () => {
    const result = recommendLogSkills([
      candidate("role", { files: [{ glob: "**/*.log", role: "kernel" }] }),
      candidate("name", { files: [{ glob: "**/*.log" }, { glob: "kernel.log", role: "ignored" }] }),
      candidate("extractor", { parsing: parsing("absent", ["**/*.log"]) })
    ], [file(), file("system.log")], fixedClock);
    expect(result.recommendedSkillId).toBe("role");
    expect(result.recommendations.map(({ skillId, score }) => [skillId, score])).toEqual([["role", 12], ["extractor", 8], ["name", 8]]);
    expect(result.recommendations[0].reasons).toEqual([
      { kind: "file", file: "kernel.log", detail: "文件匹配技能路径规则 **/*.log（kernel）", source: "skill-glob", ref: "**/*.log", role: "kernel" },
      { kind: "file", file: "system.log", detail: "文件匹配技能路径规则 **/*.log（kernel）", source: "skill-glob", ref: "**/*.log", role: "kernel" }
    ]);
  });

  it("uses extractor features only in applicable skill and extractor files", () => {
    const skills = [candidate("charge", { files: [{ glob: "kernel.log" }], parsing: parsing("CHARGE", ["kernel.*"]) })];
    expect(recommendLogSkills(skills, [file()], fixedClock)).toMatchObject({ recommendedSkillId: "charge", recommendations: [{ score: 16 }] });
    expect(recommendLogSkills(skills, [file("other.log")], fixedClock)).toMatchObject({ recommendations: [{ score: 0, reasons: [] }] });
    expect(recommendLogSkills([candidate("other", { parsing: parsing("CHARGE", ["other.*"]) })], [file()], fixedClock))
      .toMatchObject({ recommendations: [{ score: 0 }] });
  });

  it.each<[SkillFileGlob[] | undefined, string]>([
    [undefined, "nested/a.log"], [[], "nested/a.log"],
    [[{ glob: "*.log" }], "nested/a.log"], [[{ glob: "**/*.log" }], "a.log"],
    [[{ glob: "charger/**" }], "Charger/a.log"],
    [[{ glob: "kernel/dmesg?.[lt][ox][gt]", role: "内核" }], "kernel/dmesg1.log"],
    [[{ glob: "file[!0-9].log" }], "filex.log"],
    [[{ glob: "a(1)+{b}.log" }], "a(1)+{b}.log"],
    [[{ glob: "**", role: "  主日志  " }, { glob: "charger/**", role: "ignored" }], "charger/a.log"],
    [[{ glob: "**" }, { glob: "**", role: "ignored" }], "a.log"]
  ])("scores skill file rules %j for %s consistently with upload applicability", (files, path) => {
    const { skillMatched, role } = compileSkillFiles(files)(path);
    const result = recommendLogSkills([candidate("a", { files, parsing: parsing() })], [file(path)], fixedClock);
    expect(result.recommendations[0].score).toBe(skillMatched ? 8 + (files?.length ? 4 + (role ? 2 : 0) : 0) : 0);
    expect(result.recommendations[0].reasons.find(({ source }) => source === "skill-glob")?.role).toBe(role ?? undefined);
  });

  it.each<[string[] | undefined, string, number]>([
    [undefined, "kernel.log", 8], [[], "kernel.log", 0],
    [["capture[1].log"], "capture[1].log", 12], [["capture[1].log"], "capture1.log", 0],
    [["capture[.log"], "capture[.log", 12],
    [["*.log"], "nested/a.log", 0], [["**/*.log"], "a.log", 12]
  ])("keeps parsing/v1 extractor glob semantics for %j and %s", (files, path, score) => {
    expect(recommendLogSkills([candidate("a", { parsing: parsing("CHARGE", files) })], [file(path)], fixedClock))
      .toMatchObject({ recommendations: [{ score }] });
  });

  it("ignores decoded-value conditions without suppressing text features in the same skill", () => {
    const condition = { type: "field" as const, field: "charger.val.fields.CHRG_FAULT.meaning",
      operator: "equals" as const, value: "thermal_shutdown" };
    const signalRules: LogSkillSpec["signalRules"] = { ...seededChargingRuleSet,
      rules: [{ ...seededChargingRuleSet.rules[0], anyOf: [condition,
        { type: "window", condition, count: 2, seconds: 10 }] }] };
    const spec = { parsing: parsing(), signalRules };
    const result = recommendLogSkills([candidate("a", spec)], [file()], fixedClock);
    expect(result).toMatchObject({ recommendedSkillId: "a", recommendations: [{ score: 8 }] });
    expect(result.recommendations[0].reasons.map(({ source }) => source)).toEqual(["extractor"]);
    signalRules.rules[0].anyOf.push({ type: "text", pattern: "CHARGE" });
    expect(recommendLogSkills([candidate("a", spec)], [file()], fixedClock))
      .toMatchObject({ recommendedSkillId: "a", recommendations: [{ score: 12 }] });
  });

  it("provides structured references for every reason source, preserving signal names and id fallback", () => {
    const signalRules: LogSkillSpec["signalRules"] = { ...seededChargingRuleSet,
      rules: seededChargingRuleSet.rules.slice(0, 2).map((rule, index) => ({ ...rule,
        name: index === 0 ? "充电降流" : undefined, anyOf: [{ type: "text" as const, pattern: "CHARGE" }] })) };
    const result = recommendLogSkills([candidate("charge", {
      files: [{ glob: "kernel.log", role: "充电" }], parsing: parsing("CHARGE", ["kernel.*"]), signalRules,
      formatProfile: { timestampPattern: "^2026", severityMap: { error: ["ERROR"] } }
    })], [file("kernel.log", ["2026 ERROR CHARGE"])], fixedClock);
    expect(result.recommendations[0].reasons).toEqual([
      { kind: "file", file: "kernel.log", detail: "文件匹配技能路径规则 kernel.log（充电）", source: "skill-glob", ref: "kernel.log", role: "充电" },
      { kind: "file", file: "kernel.log", detail: "文件匹配字段解析路径规则 kernel.*", source: "extractor-glob", ref: "kernel.*" },
      { kind: "pattern", file: "kernel.log", detail: "日志内容匹配字段解析规则 charge：CHARGE", source: "extractor", ref: "charge" },
      ...[...signalRules.rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((rule) => ({
        kind: "pattern", file: "kernel.log", detail: `日志内容匹配技能信号规则 ${rule.id}：CHARGE`, source: "signal", ref: rule.name || rule.id
      })),
      { kind: "pattern", file: "kernel.log", detail: "日志时间格式与技能配置一致：^2026", source: "format-timestamp", ref: "^2026" },
      { kind: "pattern", file: "kernel.log", detail: "日志严重程度 error 与技能配置一致：ERROR", source: "format-severity", ref: "error" }
    ]);
  });

  it("recommends an extractor at the threshold but leaves low scores and ties generic", () => {
    expect(recommendLogSkills([candidate("a", { parsing: parsing() })], [file()], fixedClock).recommendedSkillId).toBe("a");
    expect(recommendLogSkills([candidate("a", { files: [{ glob: "kernel.log", role: "kernel" }] })], [file()], fixedClock).recommendedSkillId).toBeUndefined();
    const tied = recommendLogSkills([candidate("z", { parsing: parsing() }), candidate("a", { parsing: parsing() })], [file()], fixedClock);
    expect(tied.recommendedSkillId).toBeUndefined();
    expect(tied.recommendations.map(({ skillId }) => skillId)).toEqual(["a", "z"]);
  });

  it("uses format support without recommending generic timestamps and severity alone", () => {
    const profile = { timestampPattern: "^2026", severityMap: { error: ["ERROR"], info: ["INFO"] } };
    const files = [file("one", ["2026 INFO", "2026 ERROR"]), file("two", ["2026 ERROR"])];
    const generic = recommendLogSkills([candidate("generic", { formatProfile: profile })], files, fixedClock);
    expect(generic).toMatchObject({ recommendations: [{ score: 2 }] });
    expect(generic.recommendedSkillId).toBeUndefined();
    expect(recommendLogSkills([candidate("supported", { files: [{ glob: "one", role: "kernel" }], formatProfile: profile })], files, fixedClock))
      .toMatchObject({ recommendedSkillId: "supported", recommendations: [{ score: 8 }] });
  });

  it("routes the immutable charging seed sample using text-signal features without counting aliases twice", () => {
    const head = readFileSync("test-fixtures/logs/charging-foldback.log", "utf8").trim().split("\n");
    const skills = [candidate("charging", { signalRules: seededChargingRuleSet })];
    const result = recommendLogSkills(skills, [file("charging.log", head)]);
    expect(result).toMatchObject({ recommendedSkillId: "charging", recommendations: [{ score: 8 }] });
    expect(result.recommendations[0].reasons.map(({ source, ref, detail }) => ({ source, ref, detail }))).toEqual([
      { source: "signal", ref: "充电限流", detail: "日志内容匹配技能信号规则 charge-current-reduction：current reduced" },
      { source: "signal", ref: "热降额", detail: `日志内容匹配技能信号规则 thermal-foldback：${seededChargingRuleSet.rules[0].anyOf[0].type === "text" ? seededChargingRuleSet.rules[0].anyOf[0].pattern : ""}` }
    ]);
    expect(recommendLogSkills(skills, [file("unrelated.log", ["INFO web request completed", "ERROR invalid password"])], fixedClock).recommendedSkillId).toBeUndefined();
  });

  it("deduplicates extractor patterns and uses each matching extractor glob at most once per file", () => {
    const spec = { parsing: { schemaVersion: "parsing/v1" as const, extractors: [
      { id: "a", pattern: "CHARGE", files: ["*", "*.log"], fields: {} },
      { id: "b", pattern: "CHARGE", files: ["*"], fields: {} }
    ] } };
    expect(recommendLogSkills([candidate("a", spec)], [file()], fixedClock)).toMatchObject({ recommendations: [{ score: 12, reasons: [
      { kind: "file" }, { kind: "pattern" }
    ] }] });
  });

  it("bounds heads by original line position and UTF-8 bytes without inventing truncated matches", () => {
    const skills = [candidate("a", { parsing: parsing("CHARGE$") })];
    const beyondLineCap = [...Array<string>(limits.headLines).fill("ordinary"), "CHARGE"];
    expect(recommendLogSkills(skills, [file("a", beyondLineCap)], fixedClock).recommendedSkillId).toBeUndefined();
    const tooLong = `${"界".repeat(700)}CHARGE`;
    expect(recommendLogSkills(skills, [file("a", [tooLong])], fixedClock).recommendedSkillId).toBeUndefined();
    expect(recommendLogSkills(skills, [file("a", [`${"x".repeat(limits.lineBytes - 6)}CHARGE`])], fixedClock).recommendedSkillId).toBe("a");
    expect(recommendLogSkills([candidate("a", { parsing: parsing("x$") })], [file("a", ["x".repeat(limits.lineBytes) + "tail"])], fixedClock).recommendedSkillId).toBeUndefined();
  });

  it("returns no partial rankings when candidate, file, path, pattern, time or evaluation bounds are exhausted", () => {
    const skills = [candidate("a", { parsing: parsing() }), candidate("z", { parsing: parsing() })];
    const empty = { recommendations: [] };
    expect(recommendLogSkills(Array.from({ length: limits.skills + 1 }, (_, i) => candidate(String(i))), [file()], fixedClock)).toEqual(empty);
    expect(recommendLogSkills(skills, Array.from({ length: limits.files + 1 }, (_, i) => file(String(i))), fixedClock)).toEqual(empty);
    expect(recommendLogSkills(skills, [file("x".repeat(limits.pathChars + 1))], fixedClock)).toEqual(empty);
    expect(recommendLogSkills(skills, [file(), file()], fixedClock)).toEqual(empty);
    expect(recommendLogSkills(skills, [file()], { ...fixedClock, maxEvaluations: 7 })).toEqual(empty);
    let clock = 0;
    expect(recommendLogSkills(skills, [file()], { now: () => clock++, maxMs: 8 })).toEqual(empty);
    expect(recommendLogSkills(skills, [file()], { ...fixedClock, maxMs: 0 })).toEqual(empty);
    const tooMany = { schemaVersion: "parsing/v1" as const, extractors: Array.from({ length: limits.patternsPerSkill + 1 }, (_, i) => ({ id: `e${i}`, pattern: "CHARGE", fields: {} })) };
    expect(recommendLogSkills([candidate("a", { parsing: tooMany })], [file()], fixedClock)).toEqual(empty);
  });

  it("uses shared RE2 program caching and fails the entire ranking on invalid patterns or aggregate cache exhaustion", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      recommendLogSkills([candidate("a", { parsing: parsing() }), candidate("b", { parsing: parsing() })], [file()], fixedClock);
      expect(compile).toHaveBeenCalledTimes(1);
    } finally { compile.mockRestore(); }
    for (const pattern of ["(?=CHARGE)", "(a)\\1", `(?:${"a".repeat(1000)}){1000}`]) {
      expect(recommendLogSkills([candidate("a", { parsing: parsing() }), candidate("z", { parsing: parsing(pattern) })], [file()], fixedClock))
        .toEqual({ recommendations: [] });
    }
    const large = `(?:${"a".repeat(100)}){100}`;
    const skills = Array.from({ length: 8 }, (_, i) => candidate(String(i), { formatProfile: { timestampPattern: `${large}${i}` } }));
    expect(recommendLogSkills(skills, [file()], fixedClock)).toEqual({ recommendations: [] });
  });

  it("is deterministic across candidate and file order, bounds reasons, and leaves inputs unchanged", () => {
    const skills = [candidate("z", { parsing: parsing("ordinary") }), candidate("a", { files: [{ glob: "*", role: "kernel" }], parsing: parsing() })];
    const files = Array.from({ length: 30 }, (_, i) => file(String(i)));
    const original = JSON.stringify({ skills, files });
    const first = recommendLogSkills(skills, files, fixedClock);
    const second = recommendLogSkills([...skills].reverse(), [...files].reverse(), fixedClock);
    expect(second).toEqual(first);
    expect(first.recommendations[0].reasons).toHaveLength(limits.reasons);
    expect(JSON.stringify({ skills, files })).toBe(original);
  });
});
