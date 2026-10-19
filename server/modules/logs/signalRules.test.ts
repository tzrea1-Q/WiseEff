import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuleBasedLogAnalyzer } from "./analyzer";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import type { ParsedLogEntry } from "./parser";
import { collectRuleEvidence, runLogPrefilter } from "./prefilter";
import { compileSignalCondition, signalRuleSetSchema, MAX_SIGNAL_RULES, MAX_SIGNAL_CONDITIONS_PER_RULE,
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
      entry({ lineNumber: 3, message: "thermal current reduced" })
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
      { rules: [{ ...rule, anyOf: [text, { type: "numericComparison", leftTokens: ["x".repeat(101)], operator: "lt", rightTokens: ["b"] }] }],
        path: ["rules", 0, "anyOf", 1, "leftTokens", 0] },
      { rules: [{ ...rule, anyOf: [text], analysis: { suggestedActions: Array(33).fill({ value: "a", priority: 1 }) } }],
        path: ["rules", 0, "analysis", "suggestedActions"] },
      { rules: Array.from({ length: 2 }, (_, index) => ({ ...rule, id: `rule-${index}`, anyOf: Array(MAX_SIGNAL_CONDITIONS_PER_RULE)
        .fill({ type: "text", pattern: "x".repeat(4096) }) })), path: ["rules", 1, "anyOf", 0, "pattern"] }
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
      expect.objectContaining({ path: ["rules", 0, "anyOf", 0, field], message: expect.stringMatching(/LogPatternError/) })
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
    ["thermal offline timeout current reduced", "error", "Charging behavior is consistent with thermal foldback protection.", "Critical", 0.85],
    ["offline timeout", "warn", "The log indicates the device went offline or became unavailable.", "Warning", 0.72],
    ["offline", "warn", "The log indicates the device went offline or became unavailable.", "Info", 0.64],
    ["thermal timeout", "warn", "Charging behavior is consistent with thermal foldback protection.", "Warning", 0.72],
    ["thermal", "warn", "Charging behavior is consistent with thermal foldback protection.", "Warning", 0.64]
  ] as const)("preserves charging priorities for %s (%s)", async (message, severity, conclusion, expectedSeverity, confidence) => {
    expect(await analyze([entry({ message, severity })])).toMatchObject({ conclusion, severity: expectedSeverity, confidence });
  });

  it("preserves all-hit evidence, impact and action order exactly", async () => {
    const report = await analyze([entry({ severity: "error", message: "thermal offline timeout current reduced", tokens: { code: "E_X" } })]);
    expect(report.evidence.map((item) => item.ruleHit)).toEqual(defaultChargingRuleSet.rules.map((rule) => rule.id));
    expect(report.impact).toBe("Device availability may block reads, writes, or continued charging diagnostics.");
    expect(report.suggestedActions).toEqual([
      "Inspect pack temperature, cooling path, and BMS thermal thresholds before resuming fast charge.",
      "Compare requested and delivered current around the event window.",
      "Check network latency, controller availability, and retry counts.",
      "Verify device power, link status, and reconnect behavior.",
      "Correlate the error code with firmware diagnostics and recent parameter changes.",
      "Review ambient conditions and recent charge current requests for thermal stress."
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
