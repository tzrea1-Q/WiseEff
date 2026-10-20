import { decodeRegister, exactInteger, RegisterDecodeError } from "./registers";
import { registerCaseKey, type DecodedValue, type ParsingSpec } from "./spec";
import type { FrameField, FrameReference } from "./frameSpec";

export const MAX_FRAME_BYTES = 4096;
export const MAX_FRAME_ELEMENTS = 1024;
type Node = Extract<DecodedValue, { raw: string }>;
type Context = { spec: ParsingSpec; external: Record<string, DecodedValue>; elements: number;
  errors: { code: string; message: string; field?: string }[] };
const fail = (code: string, message: string): never => { throw new RegisterDecodeError(code, message); };

export function frameBytes(raw: string): Buffer {
  const hex = raw.replace(/\s/g, "").replace(/^0x/i, "");
  if (!/^(?:[\da-f]{2})*$/i.test(hex)) return fail("frame_encoding", "数据帧须由完整的十六进制字节组成");
  if (hex.length / 2 > MAX_FRAME_BYTES) return fail("frame_length", "数据帧长度不能超过 4096 字节");
  return Buffer.from(hex, "hex");
}

function integer(bytes: Buffer, endian: "big" | "little"): bigint {
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[endian === "big" ? i : bytes.length - i - 1]);
  return value;
}

/** Fixed checksum set; no administrator expressions or executable algorithms. */
export function checksum(bytes: Buffer, algorithm: Extract<FrameField, { type: "checksum" }>["algorithm"]): number {
  let crc = algorithm === "crc32" ? 0xffffffff : algorithm.startsWith("crc16") ? 0xffff : 0;
  for (const byte of bytes) {
    if (algorithm === "sum8") { crc = (crc + byte) & 0xff; continue; }
    if (algorithm === "xor8") { crc ^= byte; continue; }
    const reflected = algorithm === "crc16-modbus" || algorithm === "crc32";
    const width = algorithm === "crc8" ? 8 : algorithm === "crc32" ? 32 : 16;
    const poly = algorithm === "crc8" ? 0x07 : algorithm === "crc16-ccitt" ? 0x1021 : algorithm === "crc16-modbus" ? 0xa001 : 0xedb88320;
    crc ^= reflected ? byte : byte << (width - 8);
    for (let bit = 0; bit < 8; bit++) crc = reflected ? (crc >>> 1) ^ (crc & 1 ? poly : 0) : (crc << 1) ^ (crc & (1 << (width - 1)) ? poly : 0);
    if (width < 32) crc &= (1 << width) - 1;
  }
  return (algorithm === "crc32" ? crc ^ 0xffffffff : crc) >>> 0;
}

function scalar(value: DecodedValue | undefined): unknown { return value && typeof value === "object" && "value" in value ? value.value : value; }
function lookup(path: string, local: Record<string, DecodedValue>, ctx: Context): unknown {
  const [first, ...parts] = path.split(".");
  let value: DecodedValue | undefined = Object.hasOwn(local, first) ? local[first] : ctx.external[first];
  for (const part of parts) value = value && typeof value === "object" && "fields" in value ? value.fields?.[part] : undefined;
  if (value === undefined) return fail("frame_reference", `前置解码字段 ${path} 不存在`);
  return scalar(value);
}
function size(value: number | string, local: Record<string, DecodedValue>, ctx: Context, code: string, limit: number): number {
  const n = typeof value === "number" ? value : lookup(value, local, ctx);
  const numeric = typeof n === "string" && /^\d+$/.test(n) ? Number(n) : n;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < 0 || numeric > limit) return fail(code, `${code === "repeat_count" ? "重复次数" : "数据帧长度"}须为 0 到 ${limit} 之间的整数`);
  return numeric;
}
function charge(ctx: Context) { if (++ctx.elements > MAX_FRAME_ELEMENTS) fail("frame_elements", `单条数据帧的元素数量超过 ${MAX_FRAME_ELEMENTS} 个上限`); }
function node(bytes: Buffer, offset: number, value: Node["value"] = { hex: bytes.toString("hex"), length: bytes.length }): Node {
  return { raw: bytes.toString("hex"), value, byteOffset: offset, byteLength: bytes.length };
}

function* register(bytes: Buffer, id: string, endian: "big" | "little", offset: number, depth: number, ctx: Context): Generator<void, Node> {
  if (depth > 8) return fail("frame_depth", "数据帧和寄存器的解码嵌套不能超过 8 层");
  const spec = ctx.spec.registers?.[id]; if (!spec) return fail("frame_reference", `寄存器不存在 ${id}`);
  if (bytes.length !== spec.width / 8) return fail("frame_range", `寄存器 ${id} 需要 ${spec.width / 8} 字节`);
  const value = integer(bytes, endian), result = node(bytes, offset, exactInteger(value)); result.fields = Object.create(null);
  for (const child of decodeRegister(value, spec)) { yield; charge(ctx); result.fields![child.name] = child.value; }
  return result;
}

function* reference(bytes: Buffer, ref: FrameReference, endian: "big" | "little", offset: number, depth: number, ctx: Context): Generator<void, { value: Node; consumed: number }> {
  if ("frame" in ref) return yield* frame(bytes, ref.frame, offset, depth, ctx);
  const length = (ctx.spec.registers?.[ref.register]?.width ?? 0) / 8;
  if (bytes.length < length) return fail("frame_range", `寄存器 ${ref.register} 的数据字节不足`);
  return { value: yield* register(bytes.subarray(0, length), ref.register, endian, offset, depth, ctx), consumed: length };
}

function* frame(bytes: Buffer, id: string, base: number, depth: number, ctx: Context): Generator<void, { value: Node; consumed: number }> {
  if (depth > 8) return fail("frame_depth", "数据帧和寄存器的解码嵌套不能超过 8 层");
  if (bytes.length > MAX_FRAME_BYTES) return fail("frame_length", "数据帧长度不能超过 4096 字节");
  const spec = ctx.spec.frames?.[id]; if (!spec) return fail("frame_reference", `数据帧 ${id} 不存在`);
  const fields: Record<string, DecodedValue> = Object.create(null);
  let cursor = 0;
  for (const field of spec.fields) {
    yield; charge(ctx);
    const start = cursor, endian = "endian" in field ? field.endian ?? spec.endian ?? "big" : spec.endian ?? "big";
    const explicitLength = "length" in field && field.length !== undefined;
    const length = explicitLength ? size(field.length!, fields, ctx, "frame_length", MAX_FRAME_BYTES) : bytes.length - cursor;
    // The frame editor parses this diagnostic to render the detailed Chinese warning.
    if (cursor + length > bytes.length) return fail("frame_range", `Field ${field.name} requires ${length} bytes at offset ${cursor}; only ${bytes.length - cursor} remain`);
    const slice = bytes.subarray(cursor, cursor + length);
    let value: Node;
    switch (field.type) {
      case "uint": case "int": {
        const unsigned = integer(slice, endian), signed = field.type === "int" ? BigInt.asIntN(length * 8, unsigned) : unsigned;
        if (field.register) value = yield* register(slice, field.register, endian, base + start, depth + 1, ctx);
        else value = node(slice, base + start, exactInteger(signed));
        // Reuse register precision checks and enum/scale semantics for physical quantities.
        const physical = decodeRegister(unsigned, { width: (length * 8) as 8 | 16 | 32 | 64, fields: [{ name: field.name, bits: [length * 8 - 1, 0],
          signed: field.type === "int", scale: field.scale, offset: field.offset, unit: field.unit,
          enum: field.enum && Object.fromEntries(Object.entries(field.enum).map(([key, label]) => [registerCaseKey(key), label])) }] }).next().value;
        if (physical && typeof physical.value === "object" && physical.value && "value" in physical.value) {
          value.value = physical.value.value;
          if (physical.value.meaning !== undefined) value.meaning = physical.value.meaning;
          if (physical.value.unit !== undefined) value.unit = physical.value.unit;
        }
        cursor += length; break;
      }
      case "bytes": value = node(slice, base + start); cursor += length; break;
      case "register": value = yield* register(slice, field.register, endian, base + start, depth + 1, ctx); cursor += length; break;
      case "frame": {
        const nested = yield* frame(slice, field.frame, base + start, depth + 1, ctx); value = nested.value;
        if (explicitLength && nested.consumed !== length) return fail("frame_range", `数据帧字段 ${field.name} 的实际长度与声明不符`);
        cursor += nested.consumed; break;
      }
      case "switch": {
        const selected = registerCaseKey(String(lookup(field.on, fields, ctx)));
        const ref = Object.entries(field.cases).find(([key]) => registerCaseKey(key) === selected)?.[1] ?? field.default;
        if (!ref) return fail("unmatched_switch", `未找到与 ${field.on}=${selected} 对应的分支`);
        const nested = yield* reference(slice, ref, endian, base + start, depth + 1, ctx); value = nested.value;
        if (explicitLength && nested.consumed !== length) return fail("frame_range", `分支 ${field.name} 的实际长度与声明不符`);
        cursor += nested.consumed; break;
      }
      case "repeat": {
        const count = size(field.count, fields, ctx, "repeat_count", 256) * (field.multiplier ?? 1);
        if (count > 256) return fail("repeat_count", "乘以倍数后的重复次数不能超过 256");
        const children: Record<string, DecodedValue> = Object.create(null);
        for (let i = 0; i < count; i++) {
          yield; charge(ctx);
          const nested = yield* frame(bytes.subarray(cursor), field.frame, base + cursor, depth + 1, ctx);
          children[String(i)] = nested.value; cursor += nested.consumed;
        }
        value = node(bytes.subarray(start, cursor), base + start); value.fields = children; break;
      }
      case "tlv": {
        const children: Record<string, DecodedValue> = Object.create(null), end = cursor + length;
        let items = 0;
        while (cursor < end) {
          yield; charge(ctx);
          if (++items > 256) return fail("tlv_items", "TLV 条目数量不能超过 256");
          const itemStart = cursor;
          if (cursor + field.tagSize + field.lengthSize > end) return fail("frame_range", `偏移 ${cursor} 处的 TLV 头不完整`);
          const tag = integer(bytes.subarray(cursor, cursor + field.tagSize), endian); cursor += field.tagSize;
          const payloadLength = Number(integer(bytes.subarray(cursor, cursor + field.lengthSize), endian)); cursor += field.lengthSize;
          if (cursor + payloadLength > end) return fail("frame_range", `偏移 ${cursor} 处的 TLV 内容超出字段 ${field.name} 的范围`);
          const payload = bytes.subarray(cursor, cursor + payloadLength), ref = Object.entries(field.cases).find(([key]) => registerCaseKey(key) === tag.toString())?.[1];
          let decoded = node(payload, base + cursor);
          if (ref) {
            const nested = yield* reference(payload, ref, endian, base + cursor, depth + 1, ctx);
            if (nested.consumed !== payloadLength) return fail("frame_range", `TLV 标签 ${tag} 的实际长度与声明不符`);
            decoded = nested.value;
          }
          const item = node(bytes.subarray(itemStart, cursor + payloadLength), base + itemStart);
          item.fields = { tag: node(bytes.subarray(itemStart, itemStart + field.tagSize), base + itemStart, exactInteger(tag)),
            length: node(bytes.subarray(itemStart + field.tagSize, cursor), base + itemStart + field.tagSize, payloadLength), payload: decoded }; children[String(items - 1)] = item;
          cursor += payloadLength;
        }
        value = node(bytes.subarray(start, cursor), base + start); value.fields = children; break;
      }
      case "checksum": {
        const [from, to] = field.range;
        if (from >= to || to > bytes.length || from < cursor + length && to > cursor) return fail("frame_range", `校验范围无效或重叠 for ${field.name}`);
        const expected = checksum(bytes.subarray(from, to), field.algorithm), actual = Number(integer(slice, endian));
        value = node(slice, base + start, actual); value.checksum = { expected, actual, ok: expected === actual };
        if (!value.checksum.ok) ctx.errors.push({ code: "checksum_mismatch", field: field.name, message: `${field.algorithm} 校验结果不一致：预期 ${expected}，实际 ${actual}` });
        cursor += length; break;
      }
    }
    fields[field.name] = value;
  }
  for (const field of spec.fields) if (field.type === "checksum" && field.range[1] > cursor) return fail("frame_range", `校验字段 ${field.name} 的范围超出数据帧长度 ${cursor}`);
  const value = node(bytes.subarray(0, cursor), base); value.fields = fields;
  return { value, consumed: cursor };
}

/** Every field, register bit-field, repetition and TLV item yields to the shared clock budget. */
export function* decodeFrame(bytes: Buffer, id: string, spec: ParsingSpec, external: Record<string, DecodedValue>, budget: { elements: number }): Generator<void, { value: Node; errors: Context["errors"]; elements: number }> {
  const ctx: Context = { spec, external, elements: budget.elements, errors: [] };
  try {
    const decoded = yield* frame(bytes, id, 0, 1, ctx);
    if (decoded.consumed !== bytes.length) return fail("frame_range", `Frame ${id} left ${bytes.length - decoded.consumed} unconsumed bytes`);
    return { value: decoded.value, errors: ctx.errors, elements: ctx.elements };
  } finally { budget.elements = ctx.elements; }
}
