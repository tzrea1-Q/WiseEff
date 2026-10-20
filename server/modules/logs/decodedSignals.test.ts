import { describe, expect, it } from "vitest";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { logSkillSpecSchema } from "./skillSpec";
import { parsingSpecSchema } from "./parsing/spec";
import { listSignalFields } from "./parsing/signalFields";
import { previewSignalRules } from "./signalPreview";
import { compileSignalCondition, createSignalEvaluationBudget, withSignalFields, type SignalCondition } from "./signalRules";
import { decodeLogFiles } from "./parsing/engine";

const parsing = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", registers: {
  REG0C: { width: 8, fields: [{ name: "CHRG_FAULT", bits: [5, 4], enum: { "0": "normal", "2": "thermal_shutdown" } }] },
  voltage: { width: 8, fields: [{ name: "voltage", bits: [7, 0], scale: 100, unit: "mV" }] }
}, registerMaps: { bq: { selectBy: "addr", cases: { "0x0C": "REG0C" }, default: "voltage" } }, frames: {
  pdo: { fields: [{ name: "voltage", type: "uint", length: 1, scale: 100, unit: "mV" }] },
  packet: { fields: [{ name: "count", type: "uint", length: 1 }, { name: "pdos", type: "repeat", count: "count", frame: "pdo" }] }
}, extractors: [
  { id: "charger", pattern: "addr=(?P<addr>0x[0-9A-Fa-f]+) val=(?P<val>0x[0-9A-Fa-f]+)", fields: { addr: { type: "uint" }, val: { type: "hex", decode: { registerMap: "bq" } } } },
  { id: "pd", pattern: "data=(?P<pdo>[0-9a-f]+)", fields: { pdo: { type: "hexbytes", decode: { frame: "packet" } } } }
] });
const rules = (condition: SignalCondition) => ({ ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0], id: "decoded", anyOf: [condition] }] });
const field = (path: string, value: string | number): SignalCondition => ({ type: "field", field: path, operator: "equals", value });
const meaning = "charger.val.fields.CHRG_FAULT.meaning";

describe("decoded signal paths", () => {
  it("lists register-map cases/defaults, meanings and repeated frame quantities with units", () => {
    expect(listSignalFields(parsing).fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: meaning, type: "string", values: ["normal", "thermal_shutdown"], extractor: "charger", decoder: "bq" }),
      expect.objectContaining({ path: "charger.val.fields.voltage.value", unit: "mV", type: "number" }),
      expect.objectContaining({ path: "pd.pdo.fields.pdos.fields.*.fields.voltage.value", unit: "mV", type: "number" })
    ]));
  });
  it.each([
    field(meaning, "thermal_shutdown"), field("charger.val.fields.CHRG_FAULT", 2), field("charger.val.fields.CHRG_FAULT.value", 2),
    field("charger.val", 32), field("charger.addr", 12), field("pd.pdo.fields.pdos.fields.*.fields.voltage.value", 9000),
    { type: "field", field: meaning, operator: "in", values: ["thermal_shutdown", "normal"] },
    { type: "field", field: "pd.pdo.fields.pdos.fields.*.fields.voltage", operator: "range", min: 8500, max: 9500 }
  ] satisfies SignalCondition[])("validates and previews %j", async (condition) => {
    expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", parsing, signalRules: rules(condition) }).success).toBe(true);
    const result = await previewSignalRules({ parsing, signalRules: rules(condition) }, {
      fileName: "charger.log", content: "addr=0x0C val=0x20\ndata=02325a"
    }, { now: () => 0 });
    expect(result).toMatchObject({ valid: true, truncated: false, hits: [{ ruleId: "decoded", lineNumber: condition.type === "field" && condition.field.startsWith("pd.") ? 2 : 1 }] });
  });
  it.each([
    [field("charger.val.fields.UNKNOWN.meaning", "x"), "field"],
    [field("charger.val.fields.CHRG_FAULT.raw", "2"), "field"],
    [field("charger.val.fields.voltage.meaning", "x"), "field"],
    [field("pd.pdo.fields.pdos.fields.0.fields.voltage", 9000), "field"],
    [field("pd.pdo.value", 1), "field"],
    [field(meaning, 2), "value"],
    [field("charger.val.fields.CHRG_FAULT", "2"), "value"],
    [{ type: "field", field: meaning, operator: "range", min: 0, max: 2 }, "operator"],
    [{ type: "field", field: meaning, operator: "in", values: [2] }, "values"]
  ])("reports the exact schema/preview path for %j", async (condition, key) => {
    for (const wrapped of [false, true]) {
      const input = wrapped ? { type: "window", condition, count: 2, seconds: 10 } : condition;
      const signalRules = rules(input as SignalCondition);
      const expected = ["signalRules", "rules", 0, "anyOf", 0, ...(wrapped ? ["condition"] : []), key];
      const result = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", parsing, signalRules });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((issue) => issue.path)).toEqual([expected]);
      expect(await previewSignalRules({ parsing, signalRules }, { fileName: "x.log", content: "" }, { now: () => 0 }))
        .toMatchObject({ valid: false, issues: [{ path: expected }], hits: [] });
    }
  });
  it("ignores missing/errored leaves and charges wildcard traversal to the existing budget", () => {
    const events = decodeLogFiles(parsing, [{ file: "x.log", lines: ["data=02325a", "addr=0x0C val=0x20"] }]).events;
    const entry = { lineNumber: 1, severity: "info" as const, message: "x", tokens: {} };
    const matches = compileSignalCondition(field("pd.pdo.fields.pdos.fields.*.fields.voltage.value", 9000));
    expect(matches(withSignalFields(entry, events))).toBe(true);
    expect(matches(withSignalFields(entry))).toBe(false);
    const broken = structuredClone(events);
    broken.find((event) => event.extractor === "pd")!.errors = [{ field: "pdo", code: "invalid_field", message: "Bad frame" }];
    expect(matches(withSignalFields(entry, broken))).toBe(false);
    expect(compileSignalCondition(field(meaning, "thermal_shutdown"))(withSignalFields(entry, broken))).toBe(true);
    const bounded = compileSignalCondition(field("pd.pdo.fields.pdos.fields.*.fields.voltage.value", 9000), undefined, createSignalEvaluationBudget(Infinity, 5));
    expect(() => bounded(withSignalFields(entry, events))).toThrow(expect.objectContaining({ reason: "evaluation_cap" }));
  });
  it("ignores failed nested checksums without suppressing valid fields with the same name", () => {
    const nested = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", frames: {
      inner: { fields: [{ name: "n", type: "uint", length: 1 }, { name: "check", type: "checksum", length: 1, algorithm: "sum8", range: [0, 1] }] },
      outer: { fields: [{ name: "check", type: "uint", length: 1 }, { name: "child", type: "frame", frame: "inner" }] }
    }, extractors: [{ id: "x", pattern: "(?P<v>[0-9a-f]+)", fields: { v: { type: "hex", decode: { frame: "outer" } } } }] });
    const events = decodeLogFiles(nested, [{ file: "x.log", lines: ["072001"] }]).events;
    const entry = withSignalFields({ lineNumber: 1, severity: "info", message: "x", tokens: {} }, events);
    expect(events[0].errors).toMatchObject([{ code: "checksum_mismatch" }]);
    expect(compileSignalCondition(field("x.v.fields.child.fields.check.value", 1))(entry)).toBe(false);
    expect(compileSignalCondition(field("x.v.fields.check.value", 7))(entry)).toBe(true);
    expect(compileSignalCondition(field("x.v.fields.child.fields.n.value", 32))(entry)).toBe(true);
  });
});
