import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { parse, stringify } from "yaml";
import { decodeLogFiles, MAX_DECODE_EVENT_BYTES, MAX_DECODE_OUTPUT_BYTES, MAX_DECODE_OUTPUT_FIELDS } from "./engine";
import { decodedEventSchema, parsingSpecSchema, type DecodedValue, type ParsingSpec } from "./spec";
import { decodeLogFilesCooperatively } from "./workerDecoding";

const byteRegister = { width: 8, fields: [{ name: "low", bits: [3, 0] }] };
const byteFrame = { fields: [{ name: "value", type: "uint", length: 1 }] };
function specFor(frame: unknown, extra: Record<string, unknown> = {}): ParsingSpec {
  return parsingSpecSchema.parse({ schemaVersion: "parsing/v1", ...extra,
    frames: { byte: byteFrame, main: frame, ...(extra.frames as object ?? {}) },
    extractors: [{ id: "wire", pattern: "(?P<payload>.+)", fields: { payload: { type: "hex", decode: { frame: "main" } } } }] });
}
const decode = (spec: ParsingSpec, line: string) => decodeLogFiles(spec, [{ file: "wire.log", lines: [line] }]);
const fields = (spec: ParsingSpec, line: string) => decode(spec, line).events[0].fields.payload;
function issuePaths(value: unknown) {
  const result = parsingSpecSchema.safeParse(value);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.map(({ path }) => path);
}

describe("parsing/v1 frame engine interface", () => {
  it("decodes the planned USB-PD sample using header register fields as the PDO count", () => {
    const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", registers: {
      header: { width: 16, fields: [{ name: "messageType", bits: [4, 0], enum: { "1": "Source_Capabilities" } }, { name: "count", bits: [14, 12] }] },
      pdo: { width: 32, fields: [{ name: "type", bits: [31, 30], enum: { "0": "fixed" } },
        { name: "voltage", bits: [19, 10], scale: 50, unit: "mV" }, { name: "maxCurrent", bits: [9, 0], scale: 10, unit: "mA" }] }
    }, frames: { pdo: { fields: [{ name: "pdo", type: "uint", length: 4, endian: "little", register: "pdo" }] },
      data: { fields: [{ name: "objects", type: "repeat", count: "hdr.count", frame: "pdo" }] } },
    extractors: [{ id: "pd", pattern: "hdr=(?P<hdr>0x[0-9a-fA-F]+) data=(?P<data>[0-9a-fA-F]+)", fields: {
      // Register dependencies resolve even when the payload is declared first.
      data: { type: "hex", decode: { frame: "data" } }, hdr: { type: "hex", decode: { register: "header" } }
    } }] });
    const result = decode(spec, "hdr=0x2161 data=2C9101082CD10200");
    expect(result.counts.errors).toEqual({});
    expect(result.events[0].fields.hdr).toHaveProperty("fields.messageType.meaning", "Source_Capabilities");
    expect(result.events[0].fields.data).toMatchObject({ fields: { objects: { fields: {
      "0": { fields: { pdo: { fields: { type: { meaning: "fixed" }, voltage: { value: 5000, unit: "mV" }, maxCurrent: { value: 3000, unit: "mA" } } } } },
      "1": { fields: { pdo: { fields: { type: { meaning: "fixed" }, voltage: { value: 9000, unit: "mV" }, maxCurrent: { value: 3000, unit: "mA" } } } } }
    } } } });
    expect(decodedEventSchema.parse(result.events[0])).toEqual(result.events[0]);
    const wire = specFor({ fields: [{ name: "hdr", type: "uint", length: 2, endian: "little", register: "header" },
      { name: "objects", type: "repeat", count: "hdr.count", frame: "pdo" }] }, { registers: spec.registers, frames: { pdo: spec.frames!.pdo } });
    expect(fields(wire, "61212C9101082CD10200")).toMatchObject({ fields: {
      hdr: { value: 0x2161, fields: { messageType: { meaning: "Source_Capabilities" }, count: { value: 2 } } },
      objects: { fields: {
        "0": { fields: { pdo: { fields: { voltage: { value: 5000 }, maxCurrent: { value: 3000 } } } } },
        "1": { fields: { pdo: { fields: { voltage: { value: 9000 }, maxCurrent: { value: 3000 } } } } }
      } }
    } });
  });

  it.each(["big", "little"] as const)("decodes unsigned and signed integers of every supported width in %s endian", (endian) => {
    for (const length of [1, 2, 4, 8]) {
      const positive = length === 8 ? 9007199254740993n : 42n;
      const bytes = Buffer.alloc(length * 2);
      for (let i = 0; i < length; i++) {
        bytes[endian === "big" ? length - i - 1 : i] = Number((positive >> BigInt(i * 8)) & 255n);
        bytes[length + (endian === "big" ? length - i - 1 : i)] = i === 0 ? 254 : 255;
      }
      const spec = specFor({ endian, fields: [{ name: "unsigned", type: "uint", length }, { name: "signed", type: "int", length }] });
      expect(fields(spec, bytes.toString("hex"))).toMatchObject({ fields: {
        unsigned: { value: length === 8 ? positive.toString() : Number(positive), byteOffset: 0, byteLength: length },
        signed: { value: -2, byteOffset: length, byteLength: length }
      } });
      expect(decode(spec, bytes.toString("hex")).counts.errors).toEqual({});
    }
  });

  it("defaults to big endian and applies signed enum, scale, offset and unit", () => {
    const spec = specFor({ fields: [{ name: "reading", type: "int", length: 2, enum: { "-2": "cold" }, scale: 0.5, offset: -10, unit: "C" }] });
    expect(fields(spec, "0x FF FE")).toMatchObject({ fields: { reading: { value: -11, meaning: "cold", unit: "C" } } });
    expect(fields(spec, "FFFE")).toMatchObject({ fields: { reading: { value: -11, meaning: "cold", unit: "C" } } });
  });

  it("decodes fixed and earlier-field byte lengths and nested frame/register references", () => {
    const spec = specFor({ fields: [
      { name: "size", type: "uint", length: 1 }, { name: "fixed", type: "bytes", length: 2 },
      { name: "variable", type: "bytes", length: "size" }, { name: "nested", type: "frame", frame: "byte", length: 1 },
      { name: "status", type: "register", register: "status", length: 1 }
    ] }, { registers: { status: byteRegister } });
    expect(fields(spec, "02 AABB CCDD 07 0F")).toMatchObject({ fields: {
      size: { value: 2 }, fixed: { value: { hex: "aabb", length: 2 }, byteOffset: 1, byteLength: 2 },
      variable: { value: { hex: "ccdd", length: 2 }, byteOffset: 3, byteLength: 2 },
      nested: { fields: { value: { value: 7 } }, byteOffset: 5, byteLength: 1 }, status: { fields: { low: { value: 15 } } }
    } });
    expect(decode(spec, "02 AABB CCDD 07 0F").counts.errors).toEqual({});
  });

  it("selects normalized switch cases, handles defaults and records misses on the event", () => {
    const frame = { fields: [{ name: "kind", type: "uint", length: 1 },
      { name: "body", type: "switch", on: "kind", cases: { "0x01": { frame: "byte" }, "2": { register: "status" } }, length: 1 }] };
    const spec = specFor(frame, { registers: { status: byteRegister } });
    expect(fields(spec, "0107")).toMatchObject({ fields: { body: { fields: { value: { value: 7 } } } } });
    expect(fields(spec, "020f")).toMatchObject({ fields: { body: { fields: { low: { value: 15 } } } } });
    expect(decode(spec, "0307").events[0].errors).toContainEqual(expect.objectContaining({ code: "unmatched_switch", message: expect.stringContaining("3") }));
    const fallback = specFor({ fields: [frame.fields[0], { ...frame.fields[1], default: { frame: "byte" } }] }, { registers: { status: byteRegister } });
    expect(fields(fallback, "0307")).toMatchObject({ fields: { body: { fields: { value: { value: 7 } } } } });
  });

  it("repeats subframes by a count path with multiplier and by a constant", () => {
    const spec = specFor({ fields: [{ name: "count", type: "uint", length: 1 },
      { name: "dynamic", type: "repeat", frame: "byte", count: "count", multiplier: 2 },
      { name: "constant", type: "repeat", frame: "byte", count: 2 }] });
    expect(fields(spec, "02010203040506")).toMatchObject({ fields: {
      dynamic: { byteOffset: 1, byteLength: 4, fields: { "0": { fields: { value: { value: 1 } } }, "3": { fields: { value: { value: 4 } } } } },
      constant: { byteOffset: 5, byteLength: 2, fields: { "0": { fields: { value: { value: 5 } } }, "1": { fields: { value: { value: 6 } } } } }
    } });
    expect(decode(spec, "02010203040506").counts.errors).toEqual({});
  });

  it.each(["big", "little"] as const)("decodes %s-endian TLV headers, known frames/registers and unknown raw tags", (endian) => {
    const spec = specFor({ fields: [{ name: "items", type: "tlv", tagSize: 2, lengthSize: 2, endian,
      cases: { "0x01": { frame: "byte" }, "2": { register: "status" } } }] }, { registers: { status: byteRegister } });
    const bytes = Buffer.alloc(16);
    const write = endian === "big" ? bytes.writeUInt16BE.bind(bytes) : bytes.writeUInt16LE.bind(bytes);
    write(1, 0); write(1, 2); bytes[4] = 7;
    write(2, 5); write(1, 7); bytes[9] = 15;
    write(9, 10); write(2, 12); bytes[14] = 170; bytes[15] = 187;
    expect(fields(spec, bytes.toString("hex"))).toMatchObject({ fields: { items: { fields: {
      "0": { fields: { tag: { value: 1 }, length: { value: 1 }, payload: { fields: { value: { value: 7 } } } } },
      "1": { fields: { tag: { value: 2 }, payload: { fields: { low: { value: 15 } } } } },
      "2": { fields: { tag: { value: 9 }, payload: { value: { hex: "aabb", length: 2 } } } }
    } } } });
    expect(decode(spec, bytes.toString("hex")).counts.errors).toEqual({});
  });

  it.each([
    ["sum8", 1, 0xdd], ["xor8", 1, 0x31], ["crc8", 1, 0xf4],
    ["crc16-ccitt", 2, 0x29b1], ["crc16-modbus", 2, 0x4b37], ["crc32", 4, 0xcbf43926]
  ] as const)("verifies %s against the known 123456789 vector and retains checksum mismatches as event errors", (algorithm, length, expected) => {
    for (const endian of ["big", "little"] as const) {
      const spec = specFor({ fields: [{ name: "body", type: "bytes", length: 9 },
        { name: "check", type: "checksum", algorithm, range: [0, 9], length, endian }] });
      const stored = Buffer.alloc(length);
      if (endian === "big") stored.writeUIntBE(expected, 0, length); else stored.writeUIntLE(expected, 0, length);
      const good = Buffer.concat([Buffer.from("123456789"), stored]).toString("hex");
      const event = decode(spec, good).events[0];
      expect(event.fields.payload).toMatchObject({ fields: { check: { checksum: { expected, actual: expected, ok: true } } } });
      expect(event.errors).toBeUndefined();
      expect(decodedEventSchema.parse(event)).toEqual(event);
      stored[0] ^= 1;
      const bad = decode(spec, Buffer.concat([Buffer.from("123456789"), stored]).toString("hex"));
      expect(bad.events[0].fields.payload).toMatchObject({ fields: { check: { checksum: { ok: false } } } });
      expect(bad.events[0].errors).toContainEqual(expect.objectContaining({ code: "checksum_mismatch" }));
      const continued = decodeLogFiles(spec, [{ file: "wire.log", lines: [Buffer.concat([Buffer.from("123456789"), stored]).toString("hex"), good] }]);
      expect(continued.counts).toMatchObject({ total: 2, errors: { checksum_mismatch: 1 } });
    }
  });

  it("round trips every frame construct through YAML without changing form values", () => {
    const spec = specFor({ endian: "little", fields: [
      { name: "size", type: "uint", length: 1, enum: { "1": "one" }, scale: 2, offset: 1, unit: "B" },
      { name: "raw", type: "bytes", length: "size" }, { name: "child", type: "frame", frame: "byte" },
      { name: "status", type: "register", register: "status", length: 1 },
      { name: "selected", type: "switch", on: "size", cases: { "0x01": { frame: "byte" } }, default: { register: "status" }, length: 1 },
      { name: "array", type: "repeat", count: "size", multiplier: 2, frame: "byte" },
      { name: "items", type: "tlv", tagSize: 1, lengthSize: 1, cases: { "1": { frame: "byte" } }, length: 0 },
      { name: "check", type: "checksum", algorithm: "crc8", range: [0, 1], length: 1 }
    ] }, { registers: { status: byteRegister } });
    expect(parse(stringify(spec))).toEqual(spec);
    expect(parsingSpecSchema.parse(parse(stringify(spec)))).toEqual(spec);
  });

  it("reports unknown frame/register references and forward count, on and length references at exact paths", () => {
    const candidate = { schemaVersion: "parsing/v1", frames: { main: { fields: [
      { name: "repeat", type: "repeat", frame: "missing", count: "later" },
      { name: "switch", type: "switch", on: "later", cases: { "1": { register: "missing" } }, length: 1 },
      { name: "bytes", type: "bytes", length: "later" }, { name: "nested", type: "frame", frame: "missing" },
      { name: "later", type: "uint", length: 1 }
    ] } }, extractors: [{ id: "wire", pattern: "(?P<payload>.+)", fields: { payload: { type: "hex", decode: { frame: "absent" } } } }] };
    expect(issuePaths(candidate)).toEqual(expect.arrayContaining([
      ["frames", "main", "fields", 0, "frame"], ["frames", "main", "fields", 0, "count"],
      ["frames", "main", "fields", 1, "on"], ["frames", "main", "fields", 1, "cases", "1", "register"],
      ["frames", "main", "fields", 2, "length"], ["frames", "main", "fields", 3, "frame"],
      ["extractors", 0, "fields", "payload", "decode", "frame"]
    ]));
  });

  it("rejects invalid lengths, duplicate normalized cases, cycles and overlapping checksum ranges at exact paths", () => {
    const valid = specFor({ fields: [{ name: "value", type: "uint", length: 1 }] });
    expect(issuePaths({ ...valid, frames: { main: { fields: [{ name: "bad", type: "uint", length: 3 }] } } }))
      .toContainEqual(["frames", "main", "fields", 0, "length"]);
    expect(issuePaths({ ...valid, frames: { main: { fields: [{ name: "loop", type: "frame", frame: "main" }] } } }))
      .toContainEqual(["frames", "main", "fields", 0, "frame"]);
    expect(issuePaths({ ...valid, frames: { byte: byteFrame, main: { fields: [{ name: "kind", type: "uint", length: 1 },
      { name: "body", type: "switch", on: "kind", cases: { "0x01": { frame: "byte" }, "1": { frame: "byte" } }, length: 1 }] } } }))
      .toEqual(expect.arrayContaining([["frames", "main", "fields", 1, "cases", "0x01"]]));
    const checksums = { fields: [{ name: "body", type: "bytes", length: 3 },
      { name: "first", type: "checksum", algorithm: "sum8", range: [0, 2], length: 1 },
      { name: "second", type: "checksum", algorithm: "xor8", range: [1, 3], length: 1 }] };
    expect(issuePaths({ ...valid, frames: { main: checksums } })).toContainEqual(["frames", "main", "fields", 2, "range"]);
    expect(issuePaths({ ...valid, frames: { main: { fields: [{ name: "self", type: "checksum", algorithm: "sum8", range: [0, 1], length: 1 }] } } }))
      .toContainEqual(["frames", "main", "fields", 0, "range"]);
  });

  it("rejects a child checksum that covers a following sibling outside the child frame", () => {
    const spec = specFor({ fields: [{ name: "child", type: "frame", frame: "child" }, { name: "sibling", type: "uint", length: 1 }] }, {
      frames: { child: { fields: [{ name: "check", type: "checksum", algorithm: "sum8", range: [1, 2], length: 1 }, { name: "covered", type: "uint", length: 1 }] } }
    });
    spec.frames!.child.fields.pop();
    expect(issuePaths(spec)).toContainEqual(["frames", "child", "fields", 0, "range"]);
    // Runtime validation remains necessary for typed callers and variable-size children.
    const result = decode(spec, "0707");
    expect(result.events[0].errors).toContainEqual(expect.objectContaining({ code: "frame_range" }));
  });

  it("bounds validation of a repeated switch DAG and retains the exact invalid-path location", () => {
    const frames = Object.fromEntries(Array.from({ length: 6 }, (_, level) => [`f${level}`, level === 5 ? byteFrame : {
      fields: [{ name: "next", type: "switch", on: "selector", cases: Object.fromEntries(Array.from({ length: 256 }, (_, key) => [key, { frame: `f${level + 1}` }])) }]
    }]));
    const candidate = { schemaVersion: "parsing/v1", frames: { ...frames, main: { fields: [
      { name: "selected", type: "frame", frame: "f0" }, { name: "tail", type: "bytes", length: "selected.next.next.next.next.next.missing" }
    ] } }, extractors: [{ id: "wire", pattern: "selector=(?P<selector>\\d+) payload=(?P<payload>.+)", fields: {
      selector: { type: "uint" }, payload: { type: "hex", decode: { frame: "main" } }
    } }] };
    const result: ReturnType<typeof parsingSpecSchema.safeParse> = runInNewContext("validate()", { validate: () => parsingSpecSchema.safeParse(candidate) }, { timeout: 1000 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(({ path }) => path)).toContainEqual(["frames", "main", "fields", 1, "length"]);
  });

  it("bounds frame input length, repeat counts, total repeat elements and TLV items with event diagnostics", () => {
    const large = specFor({ fields: [] });
    large.extractors[0].fields.payload = { type: "base64bytes", decode: { frame: "main" } };
    expect(decode(large, Buffer.alloc(4097).toString("base64")).events[0].errors).toContainEqual(expect.objectContaining({ code: "frame_length" }));
    const repeated = specFor({ fields: [{ name: "count", type: "uint", length: 2 }, { name: "items", type: "repeat", count: "count", frame: "byte" }] });
    expect(decode(repeated, "0101").events[0].errors).toContainEqual(expect.objectContaining({ code: "repeat_count", message: expect.stringContaining("256") }));
    const total = specFor({ fields: [{ name: "outer", type: "repeat", count: 256, frame: "many" }] }, {
      frames: { many: { fields: [{ name: "inner", type: "repeat", count: 5, frame: "byte" }] } }
    });
    expect(decode(total, "00".repeat(1280)).events[0].errors).toContainEqual(expect.objectContaining({ code: "frame_elements", message: expect.stringContaining("1024") }));
    const tlv = specFor({ fields: [{ name: "items", type: "tlv", tagSize: 1, lengthSize: 1, cases: {} }] });
    expect(decode(tlv, "0100".repeat(257)).events[0].errors).toContainEqual(expect.objectContaining({ code: "tlv_items", message: expect.stringContaining("256") }));
  });

  it("bounds combined frame/register nesting in validation and at runtime", () => {
    const spec = specFor({ fields: [{ name: "next", type: "frame", frame: "f1" }] }, { registers: { status: byteRegister }, frames:
      Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i + 1}`, i === 5
        ? { fields: [{ name: "status", type: "register", register: "status", length: 1 }] }
        : { fields: [{ name: "next", type: "frame", frame: `f${i + 2}` }] }])) });
    expect(decode(spec, "01").counts.errors).toEqual({});
    expect(decodedEventSchema.parse(decode(spec, "01").events[0])).toEqual(decode(spec, "01").events[0]);
    const tooDeep = { ...spec, frames: { ...spec.frames, extra: { fields: [{ name: "next", type: "frame", frame: "main" }] } },
      extractors: [{ ...spec.extractors[0], fields: { payload: { type: "hex", decode: { frame: "extra" } } } }] };
    expect(issuePaths(tooDeep)).toContainEqual(["frames", "extra", "fields", 0, "frame"]);
    expect(decode(tooDeep as ParsingSpec, "01").events[0].errors).toContainEqual(expect.objectContaining({ code: "frame_depth", message: expect.stringContaining("8") }));
  });

  it("records truncated or malformed bytes as event errors and continues to the next line", () => {
    const spec = specFor({ fields: [{ name: "value", type: "uint", length: 2 }] });
    const result = decodeLogFiles(spec, [{ file: "wire.log", lines: ["ff", "not hex", "0001"] }]);
    expect(result.events).toHaveLength(3);
    expect(result.events[0].errors).toContainEqual(expect.objectContaining({ code: "frame_range" }));
    expect(result.events[1].errors).toHaveLength(1);
    expect(result.events[2].fields.payload).toHaveProperty("fields.value.value", 1);
  });

  it("keeps an oversized frame expansion within the existing serialized event bound", () => {
    const spec = specFor({ fields: [{ name: "items", type: "repeat", frame: "wide", count: 4 }] }, { frames: { wide: {
      fields: Array.from({ length: 64 }, (_, i) => ({ name: `v${i}`, type: "uint", length: 1, enum: { "0": "x".repeat(128) } }))
    } } });
    const result = decodeLogFiles(spec, [{ file: "wire.log", lines: ["00".repeat(256), "00".repeat(256)] }]);
    expect(result.counts).toMatchObject({ total: 2, errors: { event_size: 2 } });
    for (const event of result.events) {
      expect(Buffer.byteLength(JSON.stringify(event)) + 1).toBeLessThanOrEqual(MAX_DECODE_EVENT_BYTES);
      expect(decodedEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it.each(["output_field_cap", "output_byte_cap"] as const)("charges nested frame output to the shared %s across files", (reason) => {
    const spec = specFor({ fields: Array.from({ length: 32 }, (_, i) => ({ name: `v${i}`, type: "uint", length: 1,
      ...(reason === "output_byte_cap" ? { enum: { "0": "x".repeat(128) } } : {}) })) });
    const result = decodeLogFiles(spec, ["a.log", "b.log"].map((file) => ({ file, lines: Array(500).fill("00".repeat(32)) })));
    expect(result).toMatchObject({ truncated: true, reason, counts: { errors: { [reason]: 1 } } });
    const count = (nodes: Record<string, DecodedValue>): number => Object.values(nodes).reduce<number>((sum, value) => sum + 1
      + (value && typeof value === "object" && "fields" in value && value.fields ? count(value.fields) : 0), 0);
    expect(result.events.reduce((sum, event) => sum + count(event.fields), 0)).toBeLessThanOrEqual(MAX_DECODE_OUTPUT_FIELDS);
    expect(result.events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)) + 1, 0)).toBeLessThanOrEqual(MAX_DECODE_OUTPUT_BYTES);
    expect(result.events.length).toBeLessThan(1000);
    expect(result.unmatchedLineCount).toBe(1000 - result.events.length);
  });

  it("checks the worker time budget during a frame and discards the unfinished event", async () => {
    const spec = specFor({ fields: Array.from({ length: 64 }, (_, i) => ({ name: `v${i}`, type: "uint", length: 1 })) });
    let reads = 0;
    spec.frames!.main.fields = new Proxy(spec.frames!.main.fields, { get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    const result = await decodeLogFilesCooperatively(spec, [{ file: "wire.log", lines: ["01".repeat(64)] }], { maxMs: 10, now: () => reads, hardTimeout: false });
    expect(reads).toBeLessThan(64);
    expect(result).toMatchObject({ events: [], counts: { total: 0, errors: { time_cap: 1 } }, unmatchedLineCount: 1 });
  });
});
