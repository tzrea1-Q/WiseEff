import { z } from "zod";
import { registerCaseKey, type ParsingSpec } from "./spec";

const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/);
const path = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_0-9][a-zA-Z0-9_]*)*$/).max(400);
const endian = z.enum(["big", "little"]);
const integerLength = z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]);
const length = z.union([z.number().int().min(0).max(4096), path]);
const reference = z.union([z.object({ frame: id }).strict(), z.object({ register: id }).strict()]);
const cases = z.record(z.string().min(1).max(100), reference).refine((v) => Object.keys(v).length <= 256, "最多允许 256 个分支");
const name = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(100);
export const frameFieldSchema = z.discriminatedUnion("type", [
  z.object({ name, type: z.literal("uint"), length: integerLength, endian: endian.optional(), register: id.optional(),
    scale: z.number().finite().optional(), offset: z.number().finite().optional(), unit: z.string().max(100).optional(), enum: z.record(z.string().max(100), z.string().max(128)).refine((v) => Object.keys(v).length <= 64, "最多允许 64 个枚举值").optional() }).strict(),
  z.object({ name, type: z.literal("int"), length: integerLength, endian: endian.optional(), register: id.optional(),
    scale: z.number().finite().optional(), offset: z.number().finite().optional(), unit: z.string().max(100).optional(), enum: z.record(z.string().max(100), z.string().max(128)).refine((v) => Object.keys(v).length <= 64, "最多允许 64 个枚举值").optional() }).strict(),
  z.object({ name, type: z.literal("bytes"), length }).strict(),
  z.object({ name, type: z.literal("register"), register: id, length: integerLength, endian: endian.optional() }).strict(),
  z.object({ name, type: z.literal("frame"), frame: id, length: length.optional() }).strict(),
  z.object({ name, type: z.literal("switch"), on: path, cases, default: reference.optional(), length: length.optional(), endian: endian.optional() }).strict(),
  z.object({ name, type: z.literal("repeat"), frame: id, count: z.union([z.number().int().min(0).max(256), path]), multiplier: z.number().int().min(1).max(256).optional() }).strict(),
  z.object({ name, type: z.literal("tlv"), tagSize: z.union([z.literal(1), z.literal(2), z.literal(4)]), lengthSize: z.union([z.literal(1), z.literal(2), z.literal(4)]), endian: endian.optional(), cases, length: length.optional() }).strict(),
  z.object({ name, type: z.literal("checksum"), algorithm: z.enum(["sum8", "xor8", "crc8", "crc16-ccitt", "crc16-modbus", "crc32"]),
    range: z.tuple([z.number().int().min(0).max(4096), z.number().int().min(0).max(4096)]),
    length: z.union([z.literal(1), z.literal(2), z.literal(4)]), endian: endian.optional() }).strict()
]);
export const frameSchema = z.object({ endian: endian.optional(), fields: z.array(frameFieldSchema).max(64) }).strict();
export type FrameSpec = z.infer<typeof frameSchema>;
export type FrameField = z.infer<typeof frameFieldSchema>;
export type FrameReference = z.infer<typeof reference>;

/** Validate references at their authoring paths; traversal is bounded by the construct-depth cap. */
export function validateFrames(spec: ParsingSpec, ctx: z.RefinementCtx) {
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const frames = spec.frames ?? {}, registers = spec.registers ?? {};
  const refs = (field: FrameField): Array<[FrameReference, (string | number)[]]> => {
    const values: Array<[FrameReference, (string | number)[]]> = [];
    if ("frame" in field) values.push([{ frame: field.frame }, ["frame"]]);
    if ("register" in field && field.register) values.push([{ register: field.register }, ["register"]]);
    if ("cases" in field) for (const [key, ref] of Object.entries(field.cases)) values.push([ref, ["cases", key, "frame" in ref ? "frame" : "register"]]);
    if ("default" in field && field.default) values.push([field.default, ["default", "frame" in field.default ? "frame" : "register"]]);
    return values;
  };
  const heights = new Map<string, number>();
  function height(id: string, active = new Set<string>()): number {
    if (active.has(id)) return Infinity;
    const cached = heights.get(id); if (cached !== undefined) return cached;
    active = new Set([...active, id]);
    let value = 1;
    for (const field of frames[id]?.fields ?? []) for (const [ref] of refs(field)) value = Math.max(value, 1 + ("frame" in ref ? height(ref.frame, active) : 1));
    heights.set(id, value); return value;
  }
  const pathResults = new WeakMap<FrameField, Map<string, boolean>>();
  function hasPath(field: FrameField, rest: string[]): boolean {
    const key = rest.join("."), cached = pathResults.get(field)?.get(key);
    if (cached !== undefined) return cached;
    const result = resolvePath(field, rest);
    if (!pathResults.has(field)) pathResults.set(field, new Map());
    pathResults.get(field)!.set(key, result);
    return result;
  }
  function resolvePath(field: FrameField, rest: string[]): boolean {
    if (!rest.length) return true;
    if ("register" in field && field.register) return rest.length === 1 && !!registers[field.register]?.fields.some((f) => f.name === rest[0]);
    if ("frame" in field && (field.type === "frame" || field.type === "repeat")) {
      if (field.type === "repeat") { if (!/^\d+$/.test(rest[0])) return false; rest = rest.slice(1); if (!rest.length) return true; }
      const nested = frames[field.frame]?.fields.find((f) => f.name === rest[0]);
      return !!nested && hasPath(nested, rest.slice(1));
    }
    if (field.type === "switch") return [...Object.values(field.cases), ...(field.default ? [field.default] : [])].some((ref) => "register" in ref
      ? rest.length === 1 && !!registers[ref.register]?.fields.some((f) => f.name === rest[0])
      : !!frames[ref.frame]?.fields.some((f) => f.name === rest[0] && hasPath(f, rest.slice(1))));
    if (field.type === "tlv" && /^\d+$/.test(rest[0])) {
      if (rest.length === 1) return true;
      if (rest[1] === "tag" || rest[1] === "length") return rest.length === 2;
      if (rest[1] === "payload") return rest.length === 2 || hasPath({ name: field.name, type: "switch", on: "tag", cases: field.cases }, rest.slice(2));
    }
    return false;
  }
  for (const [id, frame] of Object.entries(frames)) {
    const names = new Set<string>();
    let offset: number | undefined = 0;
    const ranges: [number, number][] = [];
    frame.fields.forEach((field, index) => {
      const base = ["frames", id, "fields", index];
      if ("register" in field && field.register && registers[field.register] && "length" in field && typeof field.length === "number" && field.length !== registers[field.register].width / 8) add([...base, "length"], "长度须与引用的寄存器宽度一致");
      if (field.type === "repeat" && typeof field.count === "number" && field.count * (field.multiplier ?? 1) > 256) add([...base, "count"], "乘以倍数后的重复次数不能超过 256");
      if (names.has(field.name)) add([...base, "name"], "字段名称重复");
      names.add(field.name);
      for (const [ref, location] of refs(field)) {
        if ("frame" in ref ? !Object.hasOwn(frames, ref.frame) : !Object.hasOwn(registers, ref.register)) add([...base, ...location], "引用的解码规则不存在");
        if ("frame" in ref) {
          const depth = height(ref.frame);
          if (!Number.isFinite(depth)) add([...base, ...location], "数据帧之间存在循环引用");
          else if (depth + 1 > 8) add([...base, ...location], "解码嵌套不能超过 8 层");
        }
      }
      if ("cases" in field) {
        const keys = new Set<string>();
        for (const key of Object.keys(field.cases)) { const normalized = registerCaseKey(key); if (keys.has(normalized)) add([...base, "cases", key], "映射分支的数值重复"); keys.add(normalized); }
      }
      for (const key of ["count", "on", "length"] as const) {
        const value = key in field ? field[key as keyof typeof field] : undefined;
        if (typeof value !== "string") continue;
        const [root, ...rest] = value.split(".");
        const local = frame.fields.findIndex((f) => f.name === root);
        if (local >= index || local >= 0 && !hasPath(frame.fields[local], rest)) add([...base, key], "引用须指向已解码的前置字段");
        // External extractor references are checked below for every root using this frame.
      }
      if (field.type === "checksum") {
        const [start, end] = field.range;
        if (start >= end || offset !== undefined && start < offset + field.length && end > offset || ranges.some(([s, e]) => start < e && end > s)) add([...base, "range"], "校验范围无效或重叠");
        ranges.push(field.range);
        const expectedLength = field.algorithm === "crc32" ? 4 : field.algorithm.startsWith("crc16") ? 2 : 1;
        if (field.length !== expectedLength) add([...base, "length"], `校验值须占用 ${expectedLength} 字节`);
      }
      offset = offset !== undefined && "length" in field && typeof field.length === "number" ? offset + field.length : undefined;
      if (offset !== undefined && offset > 4096) add([...base, "length"], "数据帧长度不能超过 4096 字节");
    });
    if (offset !== undefined) frame.fields.forEach((field, index) => {
      if (field.type === "checksum" && field.range[1] > offset!) add(["frames", id, "fields", index, "range"], "校验范围超出数据帧长度");
    });
  }
  // A frame may depend on scalar/register captures from its extractor, but never on a later frame capture.
  spec.extractors.forEach((extractor, ei) => {
    const entries = Object.entries(extractor.fields);
    function check(id: string, seen: Set<string>, captureIndex: number) {
      if (seen.has(id)) return;
      seen.add(id);
      const frame = frames[id]; if (!frame) return;
      frame.fields.forEach((field, index) => {
        for (const key of ["count", "on", "length"] as const) {
          const value = key in field ? field[key as keyof typeof field] : undefined;
          if (typeof value !== "string") continue;
          const [root, ...rest] = value.split(".");
          if (frame.fields.some((f) => f.name === root)) continue;
          const externalIndex = entries.findIndex(([name]) => name === root), external = entries[externalIndex]?.[1];
          let valid = !!external;
          if (external && "decode" in external && external.decode) {
            if ("frame" in external.decode) valid = externalIndex < captureIndex && (!rest.length || !!frames[external.decode.frame]?.fields.some((f) => f.name === rest[0] && hasPath(f, rest.slice(1))));
            else if ("register" in external.decode) valid = rest.length === 0 || rest.length === 1 && !!registers[external.decode.register]?.fields.some((f) => f.name === rest[0]);
            else valid = !rest.length;
          } else if (rest.length) valid = false;
          if (!valid) add(["frames", id, "fields", index, key], `字段解析规则 ${ei} 引用了不存在或尚未解码的字段`);
        }
        for (const [ref] of refs(field)) if ("frame" in ref) check(ref.frame, seen, captureIndex);
      });
    }
    entries.forEach(([name, field], i) => { if ("decode" in field && field.decode && "frame" in field.decode) {
      if (height(field.decode.frame) > 8) add(["extractors", ei, "fields", name, "decode", "frame"], "解码嵌套超过 8 层或存在循环引用");
      check(field.decode.frame, new Set(), i);
    } });
  });
}
