import { describe, expect, it } from "vitest";
import { listSignalFields } from "./signalFields";
import type { ParsingSpec } from "./spec";

function branching(depth: number, width: number, leaves: number): ParsingSpec {
  const frames: NonNullable<ParsingSpec["frames"]> = {};
  for (let i = 0; i < depth; i++) frames[`F${i}`] = { fields: i === depth - 1
    ? Array.from({ length: leaves }, (_, n) => ({ name: `n${n}`, type: "uint", length: 1 }))
    : Array.from({ length: width }, (_, n) => ({ name: `f${n}`, type: "frame", frame: `F${i + 1}` })) };
  return { schemaVersion: "parsing/v1", frames, extractors: [{ id: "x", pattern: "(?<v>.+)", fields: { v: { type: "hexbytes", decode: { frame: "F0" } } } }] };
}

describe("bounded signal field metadata", () => {
  it("caps eager field listing while keeping exact requested paths beyond the cap", () => {
    const spec = branching(3, 32, 4), path = "x.v.fields.f31.fields.f31.fields.n3.value";
    const listed = listSignalFields(spec);
    expect(listed.truncated).toBe(true);
    expect(listed.fields).toHaveLength(4096);
    expect(listed.fields.some((field) => field.path === path)).toBe(false);
    expect(listSignalFields(spec, path)).toMatchObject({ truncated: false, fields: [{ path, type: "number" }] });
  });
  it("caps traversal even when reused frames contain no scalar leaves", () => {
    expect(listSignalFields(branching(4, 32, 0))).toEqual({ fields: [], truncated: true });
  });
  it("visits a repeated switch reference once per path during exact resolution", () => {
    const spec = branching(8, 1, 1);
    for (let i = 0; i < 7; i++) spec.frames![`F${i}`].fields = [{ name: "s", type: "switch", on: "tag",
      cases: Object.fromEntries(Array.from({ length: 256 }, (_, n) => [String(n), { frame: `F${i + 1}` }])) }];
    spec.extractors[0].pattern = "(?<tag>\\d+) (?<v>.+)";
    spec.extractors[0].fields.tag = { type: "uint" };
    let visits = 0;
    const leaf = spec.frames!.F7.fields;
    Object.defineProperty(spec.frames!.F7, "fields", { get: () => { visits++; return leaf; } });
    const path = `x.v${".fields.s".repeat(7)}.fields.n0.value`;
    expect(listSignalFields(spec, path)).toMatchObject({ truncated: false, fields: [{ path, type: "number" }] });
    expect(visits).toBe(1);
  });
  it("omits conflicting units across alternatives and keeps common units", () => {
    const spec: ParsingSpec = { schemaVersion: "parsing/v1", registers: Object.fromEntries(["A", "B", "C"].map((id) => [id,
      { width: 8, fields: [{ name: "voltage", bits: [7, 0], unit: id === "B" ? "mV" : "V" }] }])),
      registerMaps: { map: { selectBy: "tag", cases: { "0": "A", "1": "B", "2": "C" } } },
      extractors: [{ id: "x", pattern: "(?<tag>\\d+) (?<v>.+)", fields: { tag: { type: "uint" }, v: { type: "uint", decode: { registerMap: "map" } } } }] };
    const path = "x.v.fields.voltage.value";
    expect(listSignalFields(spec, path).fields[0].unit).toBeUndefined();
    spec.registers!.B.fields[0].unit = "V";
    expect(listSignalFields(spec, path).fields[0].unit).toBe("V");
  });
});
