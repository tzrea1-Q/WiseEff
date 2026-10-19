import type { DecodedValue, RegisterSpec } from "./spec";

export class RegisterDecodeError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function integerValue(raw: string, hex = false): bigint {
  if (!(hex ? /^[+-]?(?:0x)?[\da-f]+$/i : /^[+-]?(?:\d+|0x[\da-f]+|0b[01]+)$/i).test(raw)) throw new Error("Invalid integer");
  const digits = raw.replace(/^[+-]/, "");
  return (raw[0] === "-" ? -1n : 1n) * BigInt(hex && !/^0x/i.test(digits) ? `0x${digits}` : digits);
}

export function exactInteger(value: bigint): number | string {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

/** One checkpoint per bit field charges register work to the existing worker clock/batch budget. */
export function* decodeRegister(value: bigint, register: RegisterSpec): Generator<{ name: string; value: DecodedValue }> {
  const width = BigInt(register.width), limit = 1n << width;
  if (value < -(1n << (width - 1n)) || value >= limit) throw new RegisterDecodeError("register_range", "Value is outside register width");
  const unsigned = BigInt.asUintN(register.width, value);
  for (const field of register.fields) {
    const [hi, lo] = field.bits, size = BigInt(hi - lo + 1);
    const bits = (unsigned >> BigInt(lo)) & ((1n << size) - 1n);
    const numeric = field.signed ? BigInt.asIntN(Number(size), bits) : bits;
    let physical: number | string = exactInteger(numeric);
    if (field.scale !== undefined || field.offset !== undefined) {
      if (typeof physical === "string") throw new RegisterDecodeError("register_precision", `Field ${field.name} cannot be scaled outside the safe integer range`);
      const scale = field.scale ?? 1, offset = field.offset ?? 0;
      if (Number.isSafeInteger(scale) && Number.isSafeInteger(offset)) {
        physical = exactInteger(numeric * BigInt(scale) + BigInt(offset));
      } else {
        const scaled = physical * scale;
        if (Number.isFinite(scaled) && Math.abs(scaled) > Number.MAX_SAFE_INTEGER) throw new RegisterDecodeError("register_precision", `Field ${field.name} scaled value is outside the safe integer range`);
        physical = scaled + offset;
      }
      if (typeof physical === "string") throw new RegisterDecodeError("register_precision", `Field ${field.name} physical value is outside the safe integer range`);
      if (!Number.isFinite(physical)) throw new RegisterDecodeError("register_range", `Field ${field.name} physical value is not finite`);
      if (Math.abs(physical) > Number.MAX_SAFE_INTEGER) throw new RegisterDecodeError("register_precision", `Field ${field.name} physical value is outside the safe integer range`);
    }
    const meaning = field.enum?.[numeric.toString()];
    yield { name: field.name, value: { raw: bits.toString(), value: physical,
      ...(meaning !== undefined ? { meaning } : {}), ...(field.unit !== undefined ? { unit: field.unit } : {}) } };
  }
}
