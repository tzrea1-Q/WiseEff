import type { DecodedValue, RegisterSpec } from "./spec";

export class RegisterDecodeError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function integerValue(raw: string, hex = false): bigint {
  if (!(hex ? /^[+-]?(?:0x)?[\da-f]+$/i : /^[+-]?(?:\d+|0x[\da-f]+|0b[01]+)$/i).test(raw)) throw new Error("整数格式无效");
  const digits = raw.replace(/^[+-]/, "");
  return (raw[0] === "-" ? -1n : 1n) * BigInt(hex && !/^0x/i.test(digits) ? `0x${digits}` : digits);
}

export function exactInteger(value: bigint): number | string {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

/** One checkpoint per bit field charges register work to the existing worker clock/batch budget. */
export function* decodeRegister(value: bigint, register: RegisterSpec): Generator<{ name: string; value: DecodedValue }> {
  const width = BigInt(register.width), limit = 1n << width;
  if (value < -(1n << (width - 1n)) || value >= limit) throw new RegisterDecodeError("register_range", "数值超出寄存器宽度");
  const unsigned = BigInt.asUintN(register.width, value);
  for (const field of register.fields) {
    const [hi, lo] = field.bits, size = BigInt(hi - lo + 1);
    const bits = (unsigned >> BigInt(lo)) & ((1n << size) - 1n);
    const numeric = field.signed ? BigInt.asIntN(Number(size), bits) : bits;
    let physical: number | string = exactInteger(numeric);
    if (field.scale !== undefined || field.offset !== undefined) {
      if (typeof physical === "string") throw new RegisterDecodeError("register_precision", `字段 ${field.name} 超出安全整数范围，无法换算`);
      const scale = field.scale ?? 1, offset = field.offset ?? 0;
      if (Number.isSafeInteger(scale) && Number.isSafeInteger(offset)) {
        physical = exactInteger(numeric * BigInt(scale) + BigInt(offset));
      } else {
        const scaled = physical * scale;
        if (Number.isFinite(scaled) && Math.abs(scaled) > Number.MAX_SAFE_INTEGER) throw new RegisterDecodeError("register_precision", `字段 ${field.name} 换算后超出安全整数范围`);
        physical = scaled + offset;
      }
      if (typeof physical === "string") throw new RegisterDecodeError("register_precision", `字段 ${field.name} 的物理值超出安全整数范围`);
      if (!Number.isFinite(physical)) throw new RegisterDecodeError("register_range", `字段 ${field.name} 的物理值不是有限数值`);
      if (Math.abs(physical) > Number.MAX_SAFE_INTEGER) throw new RegisterDecodeError("register_precision", `字段 ${field.name} 的物理值超出安全整数范围`);
    }
    const meaning = field.enum?.[numeric.toString()];
    yield { name: field.name, value: { raw: bits.toString(), value: physical,
      ...(meaning !== undefined ? { meaning } : {}), ...(field.unit !== undefined ? { unit: field.unit } : {}) } };
  }
}
