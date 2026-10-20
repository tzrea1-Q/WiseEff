import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeLogFiles } from "./parsing/engine";
import { runParseTests } from "./parseTests";
import { logSkillSpecSchema, type LogSkillSpec } from "./skillSpec";
import { parseTestsSchema, parseTestRunSchema, MAX_PARSE_TEST_CHARS } from "./parseTestSpec";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import * as signalRules from "./signalRules";

afterEach(() => vi.restoreAllMocks());
function bq(): LogSkillSpec {
  return logSkillSpecSchema.parse({ schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1",
    registers: { REG0C: { width: 8, fields: [{ bits: [5, 4], name: "CHRG_FAULT", enum: { "2": "thermal_shutdown" } }] } },
    registerMaps: { charger: { selectBy: "addr", cases: { "0x0C": "REG0C" } } },
    extractors: [{ id: "charger", pattern: "addr=(?P<addr>\\w+) val=(?P<val>\\w+)", fields: { addr: { type: "uint" }, val: { type: "hex", decode: { registerMap: "charger" } } } }] },
    signalRules: { ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0], id: "charger-fault", inference: "Charger fault",
      anyOf: [{ type: "text", pattern: "val=0x20" }] }] },
    parseTests: [{ id: "bq", name: "BQ25890 register", fileName: "charger.log", lines: ["addr=0x0C val=0x20"],
      expect: { fields: { val: 32, "val.fields.CHRG_FAULT.meaning": "thermal_shutdown" }, signals: ["charger-fault"], exactSignals: true } }] });
}
describe("parse test runner", () => {
  it.each([
    ["charger/charger.log", true, true],
    ["kernel/dmesg.log", false, false],
    [undefined, false, false],
    ["charger/config.txt", true, false]
  ] as const)("applies skill and extractor file globs to %s", async (fileName, skillMatched, extracted) => {
    const spec = bq(), test = spec.parseTests![0];
    spec.files = [{ glob: "charger/**", role: "充电" }];
    spec.parsing!.extractors[0].files = ["charger/*.log"];
    // Only matching files use the skill's custom severity mapping.
    spec.formatProfile = { severityMap: { error: ["NOTICE"] } };
    test.fileName = fileName;
    test.lines = ["NOTICE addr=0x0C val=0x20", "watchdog reset"];
    test.expect.signals = ["charger-fault", "first-error", "crash"];
    const run = parseTestRunSchema.parse(await runParseTests(spec));
    expect(run.truncated).toBe(false);
    expect(run.results[0]).toMatchObject({ passed: extracted, applicability: { skillMatched, role: skillMatched ? "充电" : null },
      signals: skillMatched ? ["first-error", "charger-fault", "crash"] : ["crash"],
      missingSignals: skillMatched ? [] : ["charger-fault", "first-error"] });
    expect(run.results[0].events).toEqual(extracted ? decodeLogFiles(spec.parsing!, [{ file: fileName!, lines: test.lines }]).events : []);
    if (!extracted) expect(run.results[0].diffs).toContainEqual({ path: "val", expected: 32, actual: null, missing: true });
  });
  it("uses exactly the worker engine output and signal rules for the BQ25890 sample", async () => {
    const spec = bq();
    const run = await runParseTests(spec);
    expect(parseTestRunSchema.parse(run)).toMatchObject({ total: 1, passed: 1, failed: 0, truncated: false,
      results: [{ applicability: { skillMatched: true, role: null } }] });
    expect(run.results[0].events).toEqual(decodeLogFiles(spec.parsing!, [{ file: "charger.log", lines: spec.parseTests![0].lines }]).events);
    spec.parseTests![0].expect.fields!["val.fields.CHRG_FAULT.meaning"] = "normal";
    expect((await runParseTests(spec)).results[0]).toMatchObject({ passed: false, diffs: [{ path: "val.fields.CHRG_FAULT.meaning", expected: "normal", actual: "thermal_shutdown" }] });
  });
  it("evaluates decoded field and window conditions with fresh window state per case within the run budget", async () => {
    const spec = bq(), rule = spec.signalRules!.rules[0];
    const field = { type: "field" as const, field: "charger.addr", operator: "equals" as const, value: 12 };
    spec.signalRules!.rules = [
      { ...rule, id: "field-fault", anyOf: [field] },
      { ...rule, id: "repeated-fault", anyOf: [{ type: "window", condition: field, count: 2, seconds: 10 }] }
    ];
    spec.parseTests![0].lines = ["2026-01-01T00:00:00Z addr=0x0C val=0x20", "2026-01-01T00:00:01Z addr=0x0C val=0x20"];
    spec.parseTests![0].expect.signals = ["field-fault", "repeated-fault"];
    spec.parseTests!.push({ ...spec.parseTests![0], id: "isolated", name: "Isolated window", lines: [spec.parseTests![0].lines[0]],
      expect: { signals: ["field-fault"], exactSignals: true } });
    const started = performance.now();
    const run = await runParseTests(spec);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(run).toMatchObject({ total: 2, passed: 2, failed: 0, truncated: false });
    expect(run.results[0].events).toEqual(decodeLogFiles(spec.parsing!, [{ file: "charger.log", lines: spec.parseTests![0].lines }]).events);
    expect(run.results.map((result) => result.signals)).toEqual([["field-fault", "repeated-fault"], ["field-fault"]]);
    spec.signalRules!.rules[1].anyOf = [{ type: "window", condition: { ...field, value: 13 }, count: 2, seconds: 10 }];
    expect((await runParseTests(spec)).results[0]).toMatchObject({ passed: false,
      diffs: [{ path: "signals.repeated-fault", expected: true, actual: false }], missingSignals: ["repeated-fault"] });
  });
  it("normalizes numeric values, preserves explicit raw and requires all fields on one event", async () => {
    const spec = bq(), test = spec.parseTests![0];
    test.expect.fields = { val: "0x20", "val.raw": "0x20", "val.fields.CHRG_FAULT": { value: 2, meaning: "thermal_shutdown" } };
    expect((await runParseTests(spec)).passed).toBe(1);
    test.expect.fields["val.raw"] = "32";
    expect((await runParseTests(spec)).results[0].diffs).toEqual([{ path: "val.raw", expected: "32", actual: "0x20" }]);
    test.lines = ["addr=0x0C val=0x20", "addr=0x0C val=0x10"];
    test.expect.fields = { val: 16, "val.fields.CHRG_FAULT.meaning": "thermal_shutdown" };
    expect((await runParseTests(spec)).failed).toBe(1);
    test.expect.fields = { absent: null };
    expect((await runParseTests(spec)).results[0].diffs).toEqual([{ path: "absent", expected: null, actual: null, missing: true }]);
  });
  it("compares signals as sets by id or title, with optional exact matching", async () => {
    const spec = bq(), test = spec.parseTests![0];
    test.expect.signals = ["Charger fault", "Charger fault"];
    expect((await runParseTests(spec)).passed).toBe(1);
    test.expect.signals = [];
    expect((await runParseTests(spec)).results[0]).toMatchObject({ passed: false, missingSignals: [], unexpectedSignals: ["charger-fault"],
      diffs: [{ path: "signals.charger-fault", expected: false, actual: true }] });
    test.expect.exactSignals = false;
    expect((await runParseTests(spec)).passed).toBe(1);
    test.expect.signals = ["missing"];
    expect((await runParseTests(spec)).results[0].missingSignals).toEqual(["missing"]);
  });
  it("normalizes 64-bit integer values exactly while preserving literal raw and meaning assertions", async () => {
    const spec: LogSkillSpec = { schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1",
      registers: { wide: { width: 64, fields: [{ bits: [63, 0], name: "whole", enum: { "18446744073709551615": "0xffffffffffffffff" } }] } },
      extractors: [{ id: "wide", pattern: "(?P<val>\\w+)", fields: { val: { type: "hex", decode: { register: "wide" } } } }] },
      parseTests: [{ id: "wide", name: "64-bit value", lines: ["0xffffffffffffffff"], expect: { fields: {
        val: "0xffffffffffffffff", "val.value": "0xffffffffffffffff", "val.fields.whole": "0xffffffffffffffff",
        "val.raw": "0xffffffffffffffff", "val.fields.whole.meaning": "0xffffffffffffffff"
      } } }] };
    expect((await runParseTests(spec)).passed).toBe(1);
    spec.parseTests![0].expect.fields = { "val.value": "0xfffffffffffffffe", "val.raw": "18446744073709551615",
      "val.fields.whole.meaning": "18446744073709551615" };
    expect((await runParseTests(spec)).results[0].diffs).toEqual([
      { path: "val.value", expected: "0xfffffffffffffffe", actual: "18446744073709551615" },
      { path: "val.raw", expected: "18446744073709551615", actual: "0xffffffffffffffff" },
      { path: "val.fields.whole.meaning", expected: "18446744073709551615", actual: "0xffffffffffffffff" }
    ]);
    spec.parseTests![0].lines = ["0x20000000000001"];
    spec.parseTests![0].expect.fields = { val: 9007199254740992 };
    expect((await runParseTests(spec)).results[0].diffs).toEqual([{ path: "val", expected: 9007199254740992, actual: "9007199254740993" }]);
  });
  it("fails remaining cases when the whole-run deadline expires, including validation", async () => {
    const spec = bq();
    spec.parseTests!.push({ ...spec.parseTests![0], id: "second" });
    expect(await runParseTests(spec, { maxMs: 0 })).toMatchObject({ total: 2, passed: 0, failed: 2, truncated: true,
      results: [expect.objectContaining({ error: "Parse test deadline exceeded" }), expect.objectContaining({ error: "Parse test deadline exceeded" })] });
    const parse = logSkillSpecSchema.parse.bind(logSkillSpecSchema);
    vi.spyOn(logSkillSpecSchema, "parse").mockImplementationOnce((value) => {
      const until = performance.now() + 300;
      while (performance.now() < until) { /* watchdog must interrupt synchronous validation */ }
      return parse(value);
    });
    const started = performance.now();
    const run = await runParseTests(spec, { maxMs: 50 });
    expect(performance.now() - started).toBeLessThan(250);
    expect(run).toMatchObject({ failed: 2, truncated: true });
  });
  it("validates case, line, aggregate character, field-path and expectation caps", () => {
    const test = bq().parseTests![0];
    for (const tests of [Array.from({ length: 51 }, (_, index) => ({ ...test, id: String(index) })),
      [{ ...test, lines: Array(201).fill("x") }], [{ ...test, lines: ["x".repeat(6145)] }],
      [{ ...test, lines: ["one\ntwo"] }], [test, test],
      [{ ...test, expect: { fields: { "val.__proto__.value": 1 } } }],
      [{ ...test, expect: { fields: { val: "x".repeat(65 * 1024) } } }],
      Array.from({ length: 26 }, (_, index) => ({ ...test, id: String(index), lines: Array(200).fill("x") }))]) {
      expect(parseTestsSchema.safeParse(tests).success).toBe(false);
    }
    const chars = Array.from({ length: 2 }, (_, index) => ({ ...test, id: String(index), lines: Array(100).fill("x".repeat(6000)) }));
    expect(chars.reduce((sum, test) => sum + test.lines.join("").length, 0)).toBeGreaterThan(MAX_PARSE_TEST_CHARS);
    expect(parseTestsSchema.safeParse(chars).success).toBe(false);
  });
  it("interrupts one slow signal match and never presents a half-written summary as output", async () => {
    const spec = bq();
    const compile = signalRules.compileSignalRules;
    vi.spyOn(signalRules, "compileSignalRules").mockImplementationOnce((...args) => {
      const rules = compile(...args);
      rules[0].matches = [() => {
        const until = performance.now() + 400;
        while (performance.now() < until) { /* simulate one expensive match */ }
        return true;
      }];
      return rules;
    });
    const started = performance.now();
    const run = await runParseTests(spec, { maxMs: 100 });
    expect(performance.now() - started).toBeLessThan(300);
    expect(run).toMatchObject({ passed: 0, failed: 1, truncated: true, results: [{ signals: [], error: expect.stringMatching(/time_cap|deadline/) }] });
  });
});
