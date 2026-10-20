import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { logSkillSpecSchema } from "./skillSpec";
import { signalPreviewResponseSchema, type SignalCondition } from "./signalRules";
import { previewSignalRules } from "./signalPreview";
import { parseLogText } from "./parser";
import { collectRuleEvidence, prefilterLogStream } from "./prefilter";
import { extractLogSignals } from "./genericSignals";

afterEach(() => vi.restoreAllMocks());
const rules = (condition: SignalCondition) => ({ ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0],
  id: "custom", name: "Temperature alarm", severity: "Critical" as const, anyOf: [condition] }] });
const parsing = { schemaVersion: "parsing/v1" as const, extractors: [{ id: "sensor", pattern: "temp=(?P<temp>[0-9]+)", fields: { temp: { type: "int" as const } } }] };
const sample = (content: string) => ({ fileName: "sample.log", content });

describe("signal rule authoring and bounded preview", () => {
  it("applies file globs before evaluating text, field and window rules", async () => {
    for (const condition of [{ type: "text", pattern: "temp" },
      { type: "field", field: "sensor.temp", operator: "equals", value: 80 },
      { type: "window", condition: { type: "text", pattern: "temp" }, count: 1, seconds: 10 }] satisfies SignalCondition[]) {
      const input = { files: [{ glob: "charger/**", role: "充电" }], parsing, signalRules: rules(condition) };
      const content = "2026-01-01T00:00:00Z temp=80";
      expect(await previewSignalRules(input, { fileName: "misc/notes.txt", content }, { now: () => 0 }))
        .toMatchObject({ valid: true, truncated: false, hits: [] });
      expect(await previewSignalRules(input, { fileName: "charger/charger.log", content }, { now: () => 0 }))
        .toMatchObject({ valid: true, truncated: false, hits: [{ lineNumber: 1 }] });
    }
  });
  it("round-trips text, typed field and window rules without changing legacy metadata", () => {
    for (const condition of [{ type: "text", pattern: "thermal", flags: "i" },
      { type: "field", field: "sensor.temp", operator: "equals", value: 80 },
      { type: "field", field: "sensor.temp", operator: "range", min: 60, max: 90 },
      { type: "field", field: "sensor.temp", operator: "in", values: [70, 80] },
      { type: "window", condition: { type: "text", pattern: "ERROR" }, count: 2, seconds: 10 }] satisfies SignalCondition[]) {
      const spec = { schemaVersion: "skill/v1", parsing, signalRules: rules(condition) };
      expect(logSkillSpecSchema.parse(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
    }
  });
  it.each([
    [{ type: "text", pattern: "[" }, ["pattern"]],
    [{ type: "field", field: "missing", operator: "equals", value: 1 }, ["field"]],
    [{ type: "field", field: "sensor.temp", operator: "range", min: "x", max: 90 }, ["min"]],
    [{ type: "field", field: "sensor.temp", operator: "range", min: 90, max: 20 }, ["max"]],
    [{ type: "field", field: "sensor.temp", operator: "equals", value: "80" }, ["value"]],
    [{ type: "field", field: "sensor.temp", operator: "in", values: [] }, ["values"]],
    [{ type: "window", condition: { type: "text", pattern: "x" }, count: 0, seconds: 1 }, ["count"]],
    [{ type: "window", condition: { type: "field", field: "sensor.temp", operator: "range", min: "x", max: 1 }, count: 1, seconds: 1 }, ["condition", "min"]],
    [{ type: "window", condition: { type: "text", pattern: "x" }, count: 1, seconds: 0 }, ["seconds"]]
  ])("returns exact field paths for invalid condition %j", async (condition, path) => {
    const result = await previewSignalRules({ parsing, signalRules: rules(condition as SignalCondition) }, sample("temp=80"), { now: () => 0 });
    expect(result).toMatchObject({ valid: false, hits: [], issues: expect.arrayContaining([
      expect.objectContaining({ path: ["signalRules", "rules", 0, "anyOf", 0, ...path] })]) });
  });
  it.each([
    { type: "field", field: "sensor.temp", operator: "equals", value: 80 },
    { type: "field", field: "sensor.temp", operator: "range", min: 75, max: 85 },
    { type: "field", field: "sensor.temp", operator: "in", values: [80, 81] }
  ] satisfies SignalCondition[])("matches extracted typed values, not parser tokens: %j", async (condition) => {
    const result = await previewSignalRules({ parsing, signalRules: rules(condition) }, sample("temp=70\ntemp=80\ntemp=90"), { now: () => 0 });
    expect(signalPreviewResponseSchema.parse(result)).toMatchObject({ valid: true, truncated: false, hits: [{ ruleId: "custom", lineNumber: 2, excerpt: "temp=80" }] });
  });
  it("uses a sliding inclusive window, skips missing times, resets clock regressions and isolates files", async () => {
    const signalRules = rules({ type: "window", condition: { type: "text", pattern: "ALERT" }, count: 2, seconds: 10 });
    const content = "2026-01-01T00:00:00Z ALERT\nALERT\n2026-01-01T00:00:10Z ALERT\n2026-01-01T00:00:21Z ALERT\n2026-01-01T00:00:02Z ALERT";
    const result = await previewSignalRules({ signalRules }, sample(content), { now: () => 0 });
    expect(result.hits.map((hit) => hit.lineNumber)).toEqual([3]);
    const parsed = parseLogText({ fileName: "sample.log", content });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(collectRuleEvidence(parsed.entries, signalRules)[0].lineNumbers).toEqual([3]);
    const one = { ...parsed, entries: parsed.entries.slice(0, 1), rawLines: [parsed.rawLines[0]] };
    expect(extractLogSignals([{ path: "a.log", parsed: one }, { path: "b.log", parsed: one }], signalRules).signals.filter((signal) => signal.source === "skill")).toEqual([]);
  });
  it("advances all OR conditions even when an earlier one matches", async () => {
    const signalRules = rules({ type: "text", pattern: "ALWAYS" });
    signalRules.rules[0].anyOf.push({ type: "window", condition: { type: "text", pattern: "ALERT" }, count: 2, seconds: 10 });
    const result = await previewSignalRules({ signalRules }, sample("2026-01-01T00:00:00Z ALWAYS ALERT\n2026-01-01T00:00:01Z ALERT"), { now: () => 0 });
    expect(result.hits.map((hit) => hit.lineNumber)).toEqual([1, 2]);
  });
  it("reports line, hit and time caps with only completed bounded hits", async () => {
    const signalRules = rules({ type: "text", pattern: "ALERT" });
    expect(await previewSignalRules({ signalRules }, sample("quiet\n".repeat(5000)), { now: () => 0 })).toMatchObject({ valid: true, truncated: true, reason: "line_cap", hits: [] });
    const hits = await previewSignalRules({ signalRules }, sample("ALERT\n".repeat(501)), { now: () => 0 });
    expect(hits).toMatchObject({ valid: true, truncated: true, reason: "hit_cap" });
    expect(hits.hits).toHaveLength(500);
    expect(await previewSignalRules({ signalRules }, sample("ALERT"), { maxMs: 0 })).toMatchObject({ truncated: true, reason: "time_cap", hits: [] });
    let time = 0;
    expect(await previewSignalRules({ signalRules }, sample("quiet\n".repeat(200)), { now: () => time++ })).toMatchObject({ truncated: true, reason: "time_cap" });
  });
  it("interrupts slow validation with a hard watchdog", async () => {
    vi.spyOn(logSkillSpecSchema, "safeParse").mockImplementationOnce(() => { const end = performance.now() + 500; while (performance.now() < end) { /* bounded by watchdog */ } throw new Error("Not interrupted"); });
    expect(await previewSignalRules({ signalRules: rules({ type: "text", pattern: "x" }) }, sample("x"))).toMatchObject({ truncated: true, reason: "time_cap", hits: [] });
  });
  it("reports the shared evaluation cap with completed hits only", async () => {
    expect(await previewSignalRules({ signalRules: rules({ type: "text", pattern: "ALERT" }) }, sample("ALERT\nALERT"),
      { now: () => 0, maxEvaluations: 3 })).toMatchObject({ valid: true, truncated: true, reason: "evaluation_cap", hits: [{ lineNumber: 1 }] });
  });
  it("preserves completed field-rule evidence when a stream exhausts its allowance", async () => {
    const stream = (async function* () {
      yield { lineNumber: 1, message: "x", severity: "info" as const, tokens: {}, signalFields: { "sensor.temp": 80 } };
      throw Object.assign(new Error("deadline"), { code: "LOG_READER_TIME_CAP" });
    })();
    expect(await prefilterLogStream(stream, rules({ type: "field", field: "sensor.temp", operator: "equals", value: 80 }))).toMatchObject({ truncated: true, ruleHits: ["custom"], evidence: [{ lineNumbers: [1], inference: defaultChargingRuleSet.rules[0].inference }] });
  });
});
