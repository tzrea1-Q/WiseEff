import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { decodeLogFiles } from "./engine";
import { decodedEventSchema, MAX_DECODE_TREE_DEPTH, parsingSpecSchema, type ParsingSpec, type RegisterSpec } from "./spec";
import { decodeLogFilesCooperatively } from "./workerDecoding";

const register: RegisterSpec = { width: 8, fields: [
  { bits: [7, 7], name: "WATCHDOG_FAULT" }, { bits: [6, 6], name: "BOOST_FAULT" },
  { bits: [5, 4], name: "CHRG_FAULT", enum: { "0": "normal", "1": "input_fault", "2": "thermal_shutdown", "3": "safety_timer" } },
  { bits: [3, 3], name: "BAT_FAULT" }, { bits: [2, 0], name: "NTC_FAULT" }
] };
function bq(): ParsingSpec {
  return parsingSpecSchema.parse({ schemaVersion: "parsing/v1", registers: { REG0C: register },
    registerMaps: { charger: { selectBy: "addr", cases: { "0x0C": "REG0C" } } },
    extractors: [{ id: "charger", pattern: "addr=(?P<addr>\\w+) val=(?P<val>\\w+)",
      // Selector deliberately follows the value in declaration order.
      fields: { val: { type: "hex", decode: { registerMap: "charger" } }, addr: { type: "uint" } } }] });
}
const decode = (spec: ParsingSpec, lines = ["addr=0x0C val=0x20"]) => decodeLogFiles(spec, [{ file: "charger.log", lines }]);
function direct(reg: RegisterSpec): ParsingSpec {
  return parsingSpecSchema.parse({ schemaVersion: "parsing/v1", registers: { value: reg }, extractors: [{ id: "value",
    pattern: "(?P<val>.+)", fields: { val: { type: "int", decode: { register: "value" } } } }] });
}

describe("parsing/v1 registers interface", () => {
  it("decodes the BQ25890 REG0C acceptance sample by address, preserving the nested raw value and meanings", () => {
    const result = decode(bq());
    expect(result.events[0].fields.val).toEqual({ raw: "0x20", value: 32, fields: {
      WATCHDOG_FAULT: { raw: "0", value: 0 }, BOOST_FAULT: { raw: "0", value: 0 },
      CHRG_FAULT: { raw: "2", value: 2, meaning: "thermal_shutdown" },
      BAT_FAULT: { raw: "0", value: 0 }, NTC_FAULT: { raw: "0", value: 0 }
    } });
    expect(result.counts.errors).toEqual({});
    expect(decodedEventSchema.parse(result.events[0])).toEqual(result.events[0]);
  });
  it("round trips the form spec through YAML with no changed values or defaults", () => {
    const form = bq();
    form.registers!.REG0C.fields[2] = { ...form.registers!.REG0C.fields[2], scale: 0.5, offset: -2, unit: "mA", signed: true, description: "Fault state" };
    const parsed = parse(stringify(form));
    expect(parsed).toEqual(form);
    expect(parsingSpecSchema.parse(parsed)).toEqual(form);
  });
  it("applies two's complement before enum, scale, offset and unit", () => {
    const spec = direct({ width: 16, fields: [{ bits: [15, 8], name: "temperature", signed: true, scale: 0.5, offset: -10, unit: "°C", enum: { "-2": "cold" } }] });
    expect(decode(spec, ["0xfe00"]).events[0].fields.val).toMatchObject({ raw: "0xfe00", value: 65024,
      fields: { temperature: { raw: "254", value: -11, unit: "°C", meaning: "cold" } } });
    expect(decode(direct({ width: 8, fields: [{ bits: [7, 0], name: "signed", signed: true }] }), ["-1"]).events[0].fields.val)
      .toMatchObject({ value: -1, fields: { signed: { raw: "255", value: -1 } } });
  });
  it.each([8, 16, 32, 64] as const)("extracts %s bits without 32-bit coercion or unsafe integer loss", (width) => {
    const spec = direct({ width, fields: [{ bits: [width - 1, width - 1], name: "top" }, { bits: [width - 2, 0], name: "rest" }] });
    const value = (1n << BigInt(width)) - 1n;
    const event = decode(spec, ["0x" + value.toString(16)]).events[0];
    expect(event.fields.val).toMatchObject({ value: width === 64 ? value.toString() : Number(value), fields: { top: { value: 1 }, rest: { value: width === 64 ? ((1n << 63n) - 1n).toString() : 2 ** (width - 1) - 1 } } });
    expect(decodedEventSchema.safeParse(event).success).toBe(true);
  });
  it("rejects overflow and unsafe physical scaling as event errors and keeps processing", () => {
    const spec = direct({ width: 64, fields: [{ bits: [63, 0], name: "whole", scale: 0.5 }] });
    expect(decode(spec, ["18446744073709551615", "18446744073709551616", "2"]).events).toMatchObject([
      { errors: [{ field: "val", code: "register_precision" }] }, { errors: [{ code: "register_range" }] }, { fields: { val: { fields: { whole: { value: 1 } } } } }
    ]);
    expect(decode(direct(register), ["256", "-129", "32"]).counts.errors).toEqual({ register_range: 2 });
    expect(decode(direct({ width: 64, fields: [{ bits: [63, 0], name: "whole", scale: 1, offset: 2 }] }), ["9007199254740991"]).events[0].errors)
      .toMatchObject([{ field: "val", code: "register_precision" }]);
    expect(decode(direct({ width: 64, fields: [{ bits: [63, 0], name: "whole", scale: 3, offset: -9007199254740991 }] }), ["3002399751580331"]).events[0].fields.val)
      .toHaveProperty("fields.whole.value", 2);
  });
  it("normalizes numeric addresses, supports a default and records unmatched cases on the event", () => {
    const spec = bq();
    const unmatched = decode(spec, ["addr=0x0D val=0x20", "addr=12 val=0x20", "addr=0b1100 val=0x20"]);
    expect(unmatched.counts).toMatchObject({ total: 3, errors: { unmatched_register: 1 } });
    expect(unmatched.events[0]).toMatchObject({ fields: { val: { raw: "0x20", value: 32 } }, errors: [{ field: "val", code: "unmatched_register" }] });
    expect(unmatched.events[1].fields.val).toHaveProperty("fields.CHRG_FAULT.meaning", "thermal_shutdown");
    spec.registerMaps!.charger.default = "REG0C";
    expect(decode(spec, ["addr=0x0D val=0x20"]).counts.errors).toEqual({});
  });
  it("preserves the raw selector in decoded-event errors for reports and tools", () => {
    const event = decode(bq(), ["addr=0x0B val=0x2c"]).events[0];
    expect(event.fields.addr).toEqual({ raw: "0x0B", value: 11 });
    expect(event.errors).toEqual([{ field: "val", code: "unmatched_register", message: "未找到与 addr=0x0B 对应的寄存器映射分支（映射 charger）" }]);
    const serialized = JSON.stringify(decodedEventSchema.parse(event));
    expect(serialized).toContain("addr=0x0B");
    expect(serialized).not.toContain("addr=11");
  });
  it("reports overlapping, reversed, out-of-range bits and duplicate names at exact paths", () => {
    const spec = bq();
    spec.registers!.REG0C.fields = [
      { bits: [7, 4], name: "first" }, { bits: [5, 3], name: "first" },
      { bits: [8, 8], name: "outside" }, { bits: [0, 1], name: "reversed" }
    ];
    const result = parsingSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(({ path }) => path)).toEqual([
      ["registers", "REG0C", "fields", 1, "name"], ["registers", "REG0C", "fields", 1, "bits"],
      ["registers", "REG0C", "fields", 2, "bits", 0], ["registers", "REG0C", "fields", 2, "bits", 1],
      ["registers", "REG0C", "fields", 3, "bits"]
    ]);
  });
  it("reports unknown references, missing selectors and equivalent duplicate cases at exact paths", () => {
    const spec = bq();
    spec.registerMaps!.charger = { selectBy: "missing", cases: { "0x0C": "absent", "12": "REG0C" }, default: "absent" };
    spec.extractors[0].fields.addr = { type: "uint", decode: { register: "absent" } };
    const result = parsingSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(({ path }) => path)).toEqual(expect.arrayContaining([
      ["registerMaps", "charger", "cases", "0x0C"],
      ["registerMaps", "charger", "default"], ["registerMaps", "charger", "selectBy"], ["extractors", 0, "fields", "addr", "decode", "register"]
    ]));
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["registerMaps", "charger", "cases", "0x0C"], message: "映射分支的数值重复" }));
  });
  it("accepts only numeric extractor decode and the closed register construct", () => {
    const spec = direct(register);
    for (const field of [{ type: "string", decode: { register: "value" } }, { type: "uint", decode: { frame: "value" } },
      { type: "uint", decode: { register: "value", registerMap: "map" } }]) {
      expect(parsingSpecSchema.safeParse({ ...spec, extractors: [{ ...spec.extractors[0], fields: { val: field } }] }).success).toBe(false);
    }
    expect(parsingSpecSchema.safeParse({ ...spec, registers: { value: { ...register, width: 24 } } }).success).toBe(false);
    expect(parsingSpecSchema.safeParse({ ...spec, registers: { value: { ...register, fields: [{ ...register.fields[0], decode: { register: "value" } }] } } }).success).toBe(false);
  });
  it("bounds the decoded-event tree including structural frame wrappers", () => {
    const event = decode(bq()).events[0];
    let value: unknown = { raw: "1", value: 1 };
    for (let i = 1; i < MAX_DECODE_TREE_DEPTH; i++) value = { raw: "1", value: 1, fields: { child: value } };
    expect(decodedEventSchema.safeParse({ ...event, fields: { value } }).success).toBe(true);
    expect(decodedEventSchema.safeParse({ ...event, fields: { value: { raw: "1", value: 1, fields: { child: value } } } }).success).toBe(false);
  });
  it("rejects excessive register captures before expansion at stable paths", () => {
    const fields = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`v${i}`, { type: "uint", decode: { register: "wide" } }]));
    const spec = parsingSpecSchema.safeParse({ schemaVersion: "parsing/v1", registers: { wide: { width: 64,
      fields: Array.from({ length: 64 }, (_, i) => ({ bits: [i, i], name: `b${i}` })) } },
      extractors: [{ id: "many", pattern: Object.keys(fields).map((name) => `(?P<${name}>1)`).join(" "), fields }] });
    expect(spec.success).toBe(false);
    if (!spec.success) expect(spec.error.issues.map(({ path }) => path)).toEqual(Array.from({ length: 9 }, (_, i) => ["extractors", 0, "fields", `v${i + 8}`, "decode"]));
  });
  it("checks worker time inside a single register and discards its incomplete event", async () => {
    let bitReads = 0;
    const spec = direct({ width: 64, fields: Array.from({ length: 64 }, (_, bit) => ({ bits: [bit, bit], name: `b${bit}` })) });
    spec.registers!.value.fields = new Proxy(spec.registers!.value.fields, { get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) bitReads++;
      return Reflect.get(target, key, receiver);
    } });
    const result = await decodeLogFilesCooperatively(spec, [{ file: "x.log", lines: ["1"] }], { maxMs: 10, now: () => bitReads });
    expect(bitReads).toBeLessThan(64);
    expect(result).toMatchObject({ events: [], counts: { total: 0, errors: { time_cap: 1 } }, unmatchedLineCount: 1 });
  });
});
