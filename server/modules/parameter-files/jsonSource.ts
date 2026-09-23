import { isDeepStrictEqual } from "node:util";
import { ApiError } from "../../shared/http/errors";

export const MAX_PARAMETER_SOURCE_BYTES = 2 * 1024 * 1024;

export type JsonSourceDeleteProof = {
  kind: "json-delete-v1";
  rootPointer: string;
  pointer: string;
  parentPointer: string;
  memberKey: string;
  scannerVersion: "json-span-v1";
};

export type JsonSourceDeletion = {
  bytes: Buffer;
  proof: JsonSourceDeleteProof;
};

type JsonObjectMemberSpan = {
  start: number;
  end: number;
  parentPointer: string;
  previousCommaStart: number | null;
};

function pointerToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointerTokens(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/") || /~(?![01])/u.test(pointer)) {
    throw new ApiError("VALIDATION_FAILED", "Invalid JSON Pointer.");
  }
  return pointer.slice(1).split("/").map((token) => token.replace(/~[01]/g, (escape) => escape === "~0" ? "~" : "/"));
}

function normalizedDecimal(text: string): string {
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa!.replace(/^-/, "").split(".");
  const digits = `${whole}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const power = Number(exponent) - fraction.length + digits.length - significant.length;
  return `${text.startsWith("-") ? "-" : ""}${significant}e${power}`;
}

/** Parse source JSON without discarding duplicate keys or changing numeric values. */
function readJsonSource(input: string | Buffer) {
  if (Buffer.byteLength(input, "utf8") > MAX_PARAMETER_SOURCE_BYTES) {
    throw new SyntaxError("JSON source exceeds the 2 MiB limit.");
  }
  const source = typeof input === "string"
    ? input
    : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  let offset = 0;
  let entries = 0;
  let locatorBytes = 0;
  const spans = new Map<string, { start: number; end: number }>();
  const objectMembers = new Map<string, JsonObjectMemberSpan>();
  const objectPointers = new Set<string>();
  const countEntry = () => {
    if (++entries > 100_000) throw new SyntaxError("JSON source exceeds the entry budget.");
  };
  const whitespace = () => {
    while (/\s/u.test(source[offset] ?? "") && offset < source.length) offset += 1;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === "\\") offset += 1;
      else if (char === '"') {
        const decoded = JSON.parse(source.slice(start, offset)) as string;
        if (/\u0000|[\uD800-\uDFFF]/u.test(decoded)) {
          throw new SyntaxError("JSON strings must be representable in PostgreSQL JSONB.");
        }
        return decoded;
      }
    }
    throw new SyntaxError("Unterminated JSON string.");
  };
  const value = (depth = 0, pointer = ""): void => {
    countEntry();
    locatorBytes += Buffer.byteLength(pointer, "utf8");
    if (locatorBytes > 4 * MAX_PARAMETER_SOURCE_BYTES) {
      throw new SyntaxError("JSON source exceeds the locator byte budget.");
    }
    whitespace();
    const start = offset;
    const char = source[offset];
    if (char === '"') {
      string();
    } else if (char === "{" || char === "[") {
      if (depth >= 64) throw new SyntaxError("JSON source exceeds the nesting limit.");
      offset += 1;
      const end = char === "{" ? "}" : "]";
      if (char === "{") objectPointers.add(pointer);
      const keys = new Set<string>();
      whitespace();
      if (source[offset] !== end) {
        let index = 0;
        let previousCommaStart: number | null = null;
        for (;;) {
          const memberStart = offset;
          let key = String(index++);
          if (char === "{") {
            countEntry();
            if (source[offset] !== '"') throw new SyntaxError("Expected JSON key.");
            key = string();
            if (keys.has(key)) throw new SyntaxError("Duplicate decoded JSON key.");
            keys.add(key);
            whitespace();
            if (source[offset++] !== ":") throw new SyntaxError("Expected JSON colon.");
          }
          const memberPointer = `${pointer}/${pointerToken(key)}`;
          value(depth + 1, memberPointer);
          if (char === "{") {
            objectMembers.set(memberPointer, {
              start: memberStart,
              end: offset,
              parentPointer: pointer,
              previousCommaStart
            });
          }
          whitespace();
          if (source[offset] !== ",") break;
          previousCommaStart = offset;
          offset += 1;
          whitespace();
        }
      }
      if (source[offset++] !== end) throw new SyntaxError("Expected JSON container end.");
    } else {
      const token = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u.exec(source.slice(offset));
      if (!token) throw new SyntaxError("Expected JSON value.");
      if (/[-\d]/u.test(char!)) {
        const number = Number(token[0]);
        if (!Number.isFinite(number) || Object.is(number, -0)
          || normalizedDecimal(token[0]) !== normalizedDecimal(String(number))) {
          throw new SyntaxError("JSON number cannot round-trip without a numeric change.");
        }
      }
      offset += token[0].length;
    }
    spans.set(pointer, { start, end: offset });
  };
  value();
  // Native parsing owns final grammar validation, including whitespace and trailing input.
  return { value: JSON.parse(source) as unknown, source, spans, objectMembers, objectPointers };
}

export function parseJsonSource(input: string | Buffer): unknown {
  return readJsonSource(input).value;
}

function locateJsonSourceValue(input: string | Buffer, pointer: string, rootPointer: string) {
  const tokens = pointerTokens(pointer);
  const rootTokens = pointerTokens(rootPointer);
  if (rootTokens.length > tokens.length || rootTokens.some((token, index) => token !== tokens[index])) {
    throw new ApiError("CONFLICT", "JSON parameter is outside its configuration instance.");
  }
  const base = readJsonSource(input);
  const span = base.spans.get(pointer);
  if (!span || !base.spans.has(rootPointer)) {
    throw new ApiError("CONFLICT", "JSON source pointer does not exist.");
  }
  return { base, span };
}

function canonicalPointer(tokens: readonly string[]): string {
  return tokens.length === 0 ? "" : `/${tokens.map(pointerToken).join("/")}`;
}

/** Reprove a retained deleted anchor from exact bytes; null is still present. */
export function proveJsonSourceMemberAbsent(
  input: string | Buffer,
  pointer: string,
  rootPointer = "",
): JsonSourceDeleteProof {
  const tokens = pointerTokens(pointer);
  const rootTokens = pointerTokens(rootPointer);
  if (tokens.length <= rootTokens.length || rootTokens.some((token, index) => token !== tokens[index])) {
    throw new ApiError("CONFLICT", "JSON deletion requires an object member below its configuration root.");
  }
  const source = readJsonSource(input);
  const normalizedPointer = canonicalPointer(tokens);
  const normalizedRoot = canonicalPointer(rootTokens);
  const parentPointer = canonicalPointer(tokens.slice(0, -1));
  if (!source.spans.has(normalizedRoot) || !source.objectPointers.has(parentPointer)
    || source.spans.has(normalizedPointer)) {
    throw new ApiError("CONFLICT", "JSON source does not prove the deleted member absent within its original parent.");
  }
  return {
    kind: "json-delete-v1", rootPointer: normalizedRoot, pointer: normalizedPointer,
    parentPointer, memberKey: tokens[tokens.length - 1]!, scannerVersion: "json-span-v1",
  };
}

/**
 * Remove exactly one object member while preserving every byte outside that
 * member and its required comma. The returned proof is scanner-owned: the
 * source is reparsed and the target is required to be absent before return.
 */
export function deleteJsonSourceMember(
  input: string | Buffer,
  pointer: string,
  rootPointer = "",
): JsonSourceDeletion {
  const pointerParts = pointerTokens(pointer);
  const rootParts = pointerTokens(rootPointer);
  if (pointerParts.length <= rootParts.length || rootParts.some((token, index) => token !== pointerParts[index])) {
    throw new ApiError("CONFLICT", "JSON deletion requires an object member below its configuration root.");
  }

  const base = readJsonSource(input);
  const normalizedPointer = canonicalPointer(pointerParts);
  const normalizedRootPointer = canonicalPointer(rootParts);
  const member = base.objectMembers.get(normalizedPointer);
  if (!member) {
    throw new ApiError("CONFLICT", "JSON deletion requires an existing object member.");
  }
  if (!base.objectPointers.has(member.parentPointer) || !base.spans.has(normalizedRootPointer)) {
    throw new ApiError("CONFLICT", "JSON deletion requires an object member within its configuration instance.");
  }

  let nextComma = member.end;
  while (/\s/u.test(base.source[nextComma] ?? "") && nextComma < base.source.length) nextComma += 1;
  let start = member.start;
  let end = member.end;
  if (base.source[nextComma] === ",") {
    end = nextComma + 1;
  } else if (member.previousCommaStart !== null) {
    start = member.previousCommaStart;
  }

  const source = base.source.slice(0, start) + base.source.slice(end);
  return {
    bytes: Buffer.from(source, "utf8"),
    proof: proveJsonSourceMemberAbsent(source, normalizedPointer, normalizedRootPointer),
  };
}

export function readJsonSourceValue(input: string | Buffer, pointer: string, rootPointer = ""): unknown {
  const { base, span } = locateJsonSourceValue(input, pointer, rootPointer);
  return JSON.parse(base.source.slice(span.start, span.end)) as unknown;
}

/** Read the exact source token at a pinned pointer without normalising it. */
export function readJsonSourceText(input: string | Buffer, pointer: string, rootPointer = ""): string {
  const { base, span } = locateJsonSourceValue(input, pointer, rootPointer);
  return base.source.slice(span.start, span.end);
}

/** Both pointers are document-absolute; the replacement is strict JSON text, not a coerced UI string. */
export function patchJsonSource(
  input: string | Buffer,
  pointer: string,
  replacement: string,
  rootPointer = ""
): Buffer {
  const { base, span } = locateJsonSourceValue(input, pointer, rootPointer);
  const target = parseJsonSource(replacement);
  // Only this value span changes; all non-target bytes remain identical, including formatting.
  const source = base.source.slice(0, span.start) + replacement + base.source.slice(span.end);
  const checked = readJsonSource(source);
  const resultSpan = checked.spans.get(pointer);
  if (!resultSpan || !isDeepStrictEqual(JSON.parse(source.slice(resultSpan.start, resultSpan.end)), target)) {
    throw new ApiError("CONFLICT", "JSON source patch did not preserve the exact target value.");
  }
  return Buffer.from(source, "utf8");
}
