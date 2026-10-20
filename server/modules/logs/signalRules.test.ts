import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuleBasedLogAnalyzer } from "./analyzer";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import type { ParsedLogEntry } from "./parser";
import { collectRuleEvidence, createPrefilterBudget, prefilterLogStream, runLogPrefilter } from "./prefilter";
import { compileSignalCondition, compileSignalRules, createSignalEvaluationBudget, SIGNAL_RULE_LIMITS, signalRuleSetSchema, MAX_SIGNAL_RULES, MAX_SIGNAL_CONDITIONS_PER_RULE,
  MAX_SIGNAL_CONDITIONS, MAX_SIGNAL_TOKEN_NAMES, MAX_SIGNAL_TOTAL_PATTERN_CHARS, type SignalRuleSet } from "./signalRules";
import * as adminPattern from "./adminPattern";
import { logSkillSpecSchema } from "./skillSpec";

afterEach(() => vi.restoreAllMocks());

const entry = (overrides: Partial<ParsedLogEntry> = {}): ParsedLogEntry => ({
  lineNumber: 1, severity: "info", message: "nominal", tokens: {}, ...overrides
});

function analyze(entries: ParsedLogEntry[], ruleSet?: SignalRuleSet) {
  return createRuleBasedLogAnalyzer(ruleSet).analyze({
    // Isolate skill-rule priorities here; generic/combined summaries have their own run tests.
    signalSummary: { signals: [], templates: [], truncatedSignals: false, truncatedTemplates: false },
    parsed: { ok: true, entries, rawLines: entries.map((item) => item.message) }
  });
}

describe("signal conditions", () => {
  it("bounds requested message/token searches without changing unbounded callers", () => {
    const condition = { type: "text" as const, pattern: "ERROR" };
    const input = entry({ message: "x".repeat(6144) + " ERROR", tokens: { state: "ERROR" } });
    expect(compileSignalCondition(condition)(input)).toBe(true);
    expect(compileSignalCondition(condition, 6144)(input)).toBe(false);
  });
  it("matches the message and key=value tokens with flags, without state leaking between lines", () => {
    const matches = compileSignalCondition({ type: "text", pattern: "ALERT|state=failed", flags: "i" });
    expect(matches(entry({ message: "alert" }))).toBe(true);
    expect(matches(entry({ message: "alert" }))).toBe(true);
    expect(matches(entry({ tokens: { state: "failed" } }))).toBe(true);
    expect(matches(entry())).toBe(false);
    expect(compileSignalCondition({ type: "text", pattern: "ALERT" })(entry({ message: "alert" }))).toBe(false);
  });

  it("supports the RE2 multiline and dotall flags", () => {
    const matches = compileSignalCondition({ type: "text", pattern: "^ALERT.*FAIL$", flags: "ims" });
    expect(matches(entry({ message: "prefix\nalert\nfail\nsuffix" }))).toBe(true);
    expect(compileSignalCondition({ type: "text", pattern: "^ALERT.*FAIL$", flags: "im" })(entry({ message: "prefix\nalert\nfail\nsuffix" }))).toBe(false);
  });

  it.each([
    [{ requested_ma: "5", charge_current_ma: "3" }, true],
    [{ requested_ma: "5", current_ma: "3" }, true],
    [{ requested_ma: "5", charge_current_ma: "6", current_ma: "3" }, false],
    [{ requested_ma: "5", charge_current_ma: "invalid", current_ma: "3" }, false],
    [{ requested_ma: "5", charge_current_ma: "" }, true],
    [{ requested_ma: "5", charge_current_ma: "5" }, false],
    [{ requested_ma: "5", charge_current_ma: "Infinity" }, false],
    [{ requested_ma: "NaN", charge_current_ma: "3" }, false],
    [{ requested_ma: "5" }, false],
    [{ charge_current_ma: "3" }, false]
  ] as const)("preserves numeric conversion and token fallback for %j", (tokens, expected) => {
    const matches = compileSignalCondition({
      type: "numericComparison", leftTokens: ["charge_current_ma", "current_ma"], operator: "lt", rightTokens: ["requested_ma"]
    });
    expect(matches(entry({ tokens: { ...tokens } }))).toBe(expected);
  });

  it.each([
    ["lt", false], ["lte", true], ["eq", true], ["neq", false], ["gte", true], ["gt", false]
  ] as const)("supports %s numeric comparison", (operator, expected) => {
    const matches = compileSignalCondition({ type: "numericComparison", leftTokens: ["a"], operator, rightTokens: ["b"] });
    expect(matches(entry({ tokens: { a: "2", b: "2" } }))).toBe(expected);
  });

  it("requires both the configured severity and a nonempty token", () => {
    const matches = compileSignalCondition({ type: "severityToken", severity: "error", token: "code" });
    expect(matches(entry({ severity: "error", tokens: { code: "E_X" } }))).toBe(true);
    expect(matches(entry({ severity: "warn", tokens: { code: "E_X" } }))).toBe(false);
    expect(matches(entry({ severity: "error", tokens: { code: "" } }))).toBe(false);
    expect(matches(entry({ severity: "error" }))).toBe(false);
  });

  it("combines text and numeric conditions with anyOf and retains evidence order", () => {
    const evidence = collectRuleEvidence([
      entry({ lineNumber: 1, message: "current reduced" }),
      entry({ lineNumber: 2, tokens: { requested_ma: "5", current_ma: "3" } }),
      entry({ lineNumber: 3, message: "thermal foldback current reduced" })
    ]);
    expect(evidence.map((item) => [item.ruleHit, item.lineNumbers])).toEqual([
      ["thermal-foldback", [3]], ["charge-current-reduction", [1, 2, 3]]
    ]);
  });
});

describe("signal rule schema", () => {
  it("rejects oversized rule graphs at exact paths before compiling any child pattern", () => {
    const base = structuredClone(defaultChargingRuleSet), rule = base.rules[0];
    const text = { type: "text" as const, pattern: "never-compiled" };
    const cases: Array<{ rules: unknown[]; path: (string | number)[] }> = [
      { rules: Array(MAX_SIGNAL_RULES + 1).fill(rule), path: ["rules"] },
      { rules: [{ ...rule, anyOf: Array(500_000).fill(text) }], path: ["rules", 0, "anyOf"] },
      { rules: Array.from({ length: MAX_SIGNAL_CONDITIONS / MAX_SIGNAL_CONDITIONS_PER_RULE + 1 }, (_, index) => ({
        ...rule, id: `rule-${index}`, anyOf: Array(MAX_SIGNAL_CONDITIONS_PER_RULE).fill(text)
      })), path: ["rules", MAX_SIGNAL_CONDITIONS / MAX_SIGNAL_CONDITIONS_PER_RULE, "anyOf"] },
      { rules: [{ ...rule, anyOf: [text, { type: "numericComparison", leftTokens: Array(500_000).fill("a"), operator: "lt", rightTokens: ["b"] }] }],
        path: ["rules", 0, "anyOf", 1, "leftTokens"] },
      { rules: [{ ...rule, anyOf: [text, { type: "severityToken", severity: "error", token: "x".repeat(101) }] }], path: ["rules", 0, "anyOf", 1, "token"] },
      { rules: [{ ...rule, anyOf: [text, { type: "text", pattern: "x".repeat(4097) }] }], path: ["rules", 0, "anyOf", 1, "pattern"] },
      { rules: [{ ...rule, anyOf: [text, { type: "window", condition: { type: "text", pattern: "x".repeat(4097) }, count: 2, seconds: 1 }] }],
        path: ["rules", 0, "anyOf", 1, "condition", "pattern"] },
      { rules: [{ ...rule, anyOf: [text, { type: "window", condition: { type: "field", field: "value.v", operator: "in", values: Array(257).fill(1) }, count: 2, seconds: 1 }] }],
        path: ["rules", 0, "anyOf", 1, "condition", "values"] },
      { rules: [{ ...rule, anyOf: [text, { type: "numericComparison", leftTokens: ["x".repeat(101)], operator: "lt", rightTokens: ["b"] }] }],
        path: ["rules", 0, "anyOf", 1, "leftTokens", 0] },
      { rules: [{ ...rule, anyOf: [text], analysis: { suggestedActions: Array(33).fill({ value: "a", priority: 1 }) } }],
        path: ["rules", 0, "analysis", "suggestedActions"] },
      { rules: Array.from({ length: 2 }, (_, index) => ({ ...rule, id: `rule-${index}`, anyOf: Array(MAX_SIGNAL_CONDITIONS_PER_RULE)
        .fill({ type: "text", pattern: "x".repeat(4096) }) })), path: ["rules", 1, "anyOf", 0, "pattern"] },
      { rules: Array.from({ length: 2 }, (_, index) => ({ ...rule, id: `rule-${index}`, anyOf: Array(index === 0 ? SIGNAL_RULE_LIMITS.windows : 1)
        .fill({ type: "window", condition: text, count: 2, seconds: 1 }) })), path: ["rules", 1, "anyOf", 0] }
    ];
    const compile = vi.spyOn(adminPattern, "compileLogPattern");
    const cost = vi.spyOn(adminPattern, "logPatternProgramCost");
    for (const { rules, path } of cases) {
      const signals = { ...base, rules };
      for (const [result, prefix] of [
        [signalRuleSetSchema.safeParse(signals), []],
        [logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", signalRules: signals,
          formatProfile: { severityMap: { error: ["never-visited"] } } }), ["signalRules"]]
      ] as const) {
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues).toEqual([expect.objectContaining({ path: [...prefix, ...path] })]);
      }
      expect(cost).not.toHaveBeenCalled();
      expect(compile).not.toHaveBeenCalled();
    }
    expect(MAX_SIGNAL_TOTAL_PATTERN_CHARS).toBe(16 * 4096);
    expect(MAX_SIGNAL_TOKEN_NAMES).toBe(16);
  });

  it.each([
    ["rules", ["rules"]], ["conditions", ["rules", 0, "anyOf"]], ["windows", ["rules", 1, "anyOf", 0]]
  ] as const)("rejects excess %s with a stable error path", (kind, path) => {
    const data = structuredClone(defaultChargingRuleSet);
    const rule = data.rules[0];
    if (kind === "rules") data.rules = Array.from({ length: 65 }, (_, i) => ({ ...rule, id: `rule-${i}` }));
    if (kind === "conditions") rule.anyOf = Array.from({ length: 17 }, () => ({ type: "text", pattern: "x" }));
    if (kind === "windows") {
      const window = { type: "window" as const, condition: { type: "text" as const, pattern: "x" }, count: 10_000, seconds: 1 };
      rule.anyOf = Array.from({ length: 16 }, () => window);
      data.rules[1].anyOf = [window];
    }
    const result = signalRuleSetSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: [...path] }));
  });

  it("bounds the worst allowed skill to 1.28 MB of rings and a shared evaluation allowance", async () => {
    const rule = defaultChargingRuleSet.rules[0];
    const data: SignalRuleSet = { ...defaultChargingRuleSet, rules: Array.from({ length: 64 }, (_, i) => ({ ...rule, id: `rule-${i}`,
      anyOf: Array.from({ length: i < 12 ? 16 : i === 12 ? 13 : 1 }, () => i === 0
        ? { type: "window" as const, condition: { type: "text" as const, pattern: "x" }, count: 10_000, seconds: 86400 }
        : { type: "text" as const, pattern: "never" }) })) };
    expect(data.rules.reduce((total, item) => total + item.anyOf.length, 0)).toBe(MAX_SIGNAL_CONDITIONS);
    expect(signalRuleSetSchema.safeParse(data).success).toBe(true);
    const allocated = process.memoryUsage().arrayBuffers;
    const compiled = compileSignalRules(data);
    expect(process.memoryUsage().arrayBuffers - allocated).toBeLessThanOrEqual(SIGNAL_RULE_LIMITS.windowTimestamps * 8 + 65536);
    expect(compiled).toHaveLength(64);
    const budget = createPrefilterBudget(createSignalEvaluationBudget(performance.now() + 5000));
    const started = performance.now();
    const result = await prefilterLogStream((async function* () {
      for (let i = 0; i < 10_000; i++) yield entry({ lineNumber: i + 1, message: "x", timestamp: "2026-01-01T00:00:00Z" });
    })(), data, budget);
    expect(result.truncated).toBe(true);
    expect(budget.evaluation.remaining).toBeLessThan(0);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(Object.values(result.severityCounts).reduce((a, b) => a + b, 0)).toBeLessThan(10_000);
  }, 10_000);

  it("enforces the same total condition cap when compiling rules directly", () => {
    const rule = defaultChargingRuleSet.rules[0];
    const data: SignalRuleSet = { ...defaultChargingRuleSet, rules: Array.from({ length: MAX_SIGNAL_CONDITIONS / MAX_SIGNAL_CONDITIONS_PER_RULE + 1 }, (_, index) => ({
      ...rule, id: `rule-${index}`, anyOf: Array.from({ length: MAX_SIGNAL_CONDITIONS_PER_RULE }, () => ({ type: "text" as const, pattern: "never" }))
    })) };
    const compile = vi.spyOn(adminPattern, "compileLogPattern");
    expect(() => compileSignalRules(data)).toThrow("evaluation_cap");
    expect(compile).not.toHaveBeenCalled();
  });

  it("shares deadline/evaluation exhaustion across initial and subsequent prefilter passes", async () => {
    let now = 0;
    const budget = createPrefilterBudget(createSignalEvaluationBudget(5, 100, () => now));
    const stream = () => (async function* () { yield entry({ message: "thermal foldback" }); now = 5; yield entry({ message: "thermal foldback" }); })();
    expect(await prefilterLogStream(stream(), defaultChargingRuleSet, budget)).toMatchObject({ truncated: true, evidence: [{ lineNumbers: [1] }] });
    expect(await prefilterLogStream(stream(), defaultChargingRuleSet, budget)).toMatchObject({ truncated: true, evidence: [] });
    expect(await prefilterLogStream(stream(), { ...defaultChargingRuleSet, rules: [] }, budget)).toMatchObject({ truncated: true, severityCounts: { error: 0, warn: 0, info: 0 } });
  });
  it("round-trips the charging data through JSON and zod", () => {
    expect(signalRuleSetSchema.parse(JSON.parse(JSON.stringify(defaultChargingRuleSet)))).toEqual(defaultChargingRuleSet);
  });

  it.each([
    ["pattern", "["], ["pattern", "(?=a)a"], ["pattern", "(?!a)b"],
    ["pattern", "(?<=a)b"], ["pattern", "(?<!a)b"], ["pattern", "(a)\\1"], ["pattern", "(?<a>x)\\k<a>"],
    ["flags", "g"], ["flags", "y"], ["flags", "u"], ["flags", "v"], ["flags", "d"], ["flags", "ii"], ["flags", "invalid"]
  ])("rejects invalid %s at the exact condition path", (field, value) => {
    const data = structuredClone(defaultChargingRuleSet);
    data.rules[0].anyOf[0] = { type: "text", pattern: "valid", [field]: value };
    const result = signalRuleSetSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected invalid pattern/flags");
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["rules", 0, "anyOf", 0, field], message: expect.stringMatching(/正则表达式|模式/) })
    ]));
  });

  it.each([
    (data: SignalRuleSet) => { data.rules[1].id = data.rules[0].id; },
    (data: SignalRuleSet) => { data.rules[0].anyOf = []; },
    (data: SignalRuleSet) => { data.rules[0].anyOf = [{ type: "numericComparison", leftTokens: [], operator: "lt", rightTokens: ["b"] }]; },
    (data: SignalRuleSet) => { data.rules[0].analysis.confidence = { value: 1.1, priority: 0 }; },
    (data: SignalRuleSet) => { data.rules[0].anyOf = [{ type: "text", pattern: /thermal/ as unknown as string }]; }
  ])("rejects malformed or ambiguous rule data (%#)", (mutate) => {
    const data = structuredClone(defaultChargingRuleSet);
    mutate(data);
    expect(signalRuleSetSchema.safeParse(data).success).toBe(false);
  });
});

describe("data-driven analysis", () => {
  it("uses a non-charging set for evidence, independent output priorities, and ordered unique actions", async () => {
    const custom: SignalRuleSet = {
      noHit: { confidence: 0.1, conclusion: "No disk issue", impact: "None", severity: "Info", suggestedActions: ["Observe"] },
      hitDefaults: { confidence: 0.5, conclusion: "Disk issue", impact: "Review", severity: "Warning", suggestedActions: [] },
      rules: [
        {
          id: "disk-full", anyOf: [{ type: "text", pattern: "disk full" }], stageId: "rootcause",
          inference: "Disk capacity exhausted", suggestedAction: "Free space",
          analysis: {
            conclusion: { value: "Disk is full", priority: 2 },
            impact: { value: "Writes blocked", priority: 0 },
            severity: { value: "Critical", priority: 0, requiresErrorEvidence: true },
            confidence: { value: 0.93, priority: 0, requiresErrorEvidence: true },
            suggestedActions: [{ value: "Free space", priority: 2 }, { value: "Check disk", priority: 0 }]
          }
        },
        {
          id: "disk-slow", anyOf: [{ type: "text", pattern: "disk" }], stageId: "pattern",
          inference: "Disk needs review", suggestedAction: "Check disk",
          analysis: {
            conclusion: { value: "Disk requires attention", priority: 1 },
            impact: { value: "Latency", priority: 1 },
            suggestedActions: [{ value: "Check disk", priority: 0 }]
          }
        }
      ]
    };
    const data = signalRuleSetSchema.parse(JSON.parse(JSON.stringify(custom)));
    const entries = [entry({ severity: "error", message: "disk full" })];
    expect(runLogPrefilter(entries, data).ruleHits).toEqual(["disk-full", "disk-slow"]);
    const report = await analyze(entries, data);
    expect(report).toMatchObject({
      conclusion: "Disk requires attention", impact: "Writes blocked", severity: "Critical", confidence: 0.93,
      suggestedActions: ["Check disk", "Free space"],
      evidence: [
        { ruleHit: "disk-full", inference: "Disk capacity exhausted", lineNumbers: [1] },
        { ruleHit: "disk-slow", inference: "Disk needs review", lineNumbers: [1] }
      ]
    });
    // Equal priorities use rule order, independently of evidence/action priorities.
    data.rules[0].analysis.conclusion!.priority = 1;
    expect((await analyze(entries, data)).conclusion).toBe("Disk is full");
    expect(await analyze([entry()], data)).toMatchObject(data.noHit);
    expect(await analyze([entry({ message: "disk full" })], data)).toMatchObject({ severity: "Warning", confidence: 0.5 });
  });

  it.each([
    ["thermal foldback offline timeout current reduced", "error", "充电表现符合过热保护降额特征。", "Critical", 0.85],
    ["offline timeout", "warn", "日志显示设备离线或不可用。", "Warning", 0.72],
    ["offline", "warn", "日志显示设备离线或不可用。", "Info", 0.64],
    ["thermal foldback timeout", "warn", "充电表现符合过热保护降额特征。", "Warning", 0.72],
    ["thermal foldback", "warn", "充电表现符合过热保护降额特征。", "Warning", 0.64]
  ] as const)("preserves charging priorities for %s (%s)", async (message, severity, conclusion, expectedSeverity, confidence) => {
    expect(await analyze([entry({ message, severity })])).toMatchObject({ conclusion, severity: expectedSeverity, confidence });
  });

  it("preserves all-hit evidence, impact and action order exactly", async () => {
    const report = await analyze([entry({ severity: "error", message: "thermal foldback offline timeout current reduced", tokens: { code: "E_X" } })]);
    expect(report.evidence.map((item) => item.ruleHit)).toEqual(defaultChargingRuleSet.rules.map((rule) => rule.id));
    expect(report.impact).toBe("设备不可用可能阻碍读写操作或后续充电诊断。");
    expect(report.suggestedActions).toEqual([
      "恢复快充前，请检查电池温度、散热路径及电池管理系统的温度保护阈值。",
      "对比异常发生前后请求的充电电流与实际电流。",
      "检查网络延迟、控制器连接状态和重试次数。",
      "检查设备供电、连接状态及能否重新连接。",
      "根据错误码核对固件诊断结果和近期参数变更。",
      "检查环境温度和近期请求的充电电流，确认是否存在过热风险。"
    ]);
  });

  it("counts any cited error line as error evidence, but ignores uncited error lines", async () => {
    const offline = entry({ message: "offline" });
    expect(await analyze([offline, entry({ lineNumber: 2, severity: "error" })])).toMatchObject({ confidence: 0.64, severity: "Info" });
    expect(await analyze([offline, entry({ lineNumber: 2, severity: "error", tokens: { code: "E_X" } })]))
      .toMatchObject({ confidence: 0.85, severity: "Critical" });
    expect(await analyze([entry({ severity: "error" })])).toMatchObject(defaultChargingRuleSet.noHit);
  });
});
